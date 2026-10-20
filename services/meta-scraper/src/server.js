import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 8080);
const API_KEY = String(process.env.SCRAPER_API_KEY || "");
const MAX_ADS_HARD_LIMIT = Math.max(100, Number(process.env.MAX_ADS_HARD_LIMIT || 1000));
const MAX_SCROLLS_HARD_LIMIT = Math.max(40, Number(process.env.MAX_SCROLLS_HARD_LIMIT || 180));

let browserPromise = null;
let scanBusy = false;

function authorized(req) {
  if (!API_KEY) return false;
  return String(req.headers.authorization || "") === "Bearer " + API_KEY;
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"]
    }).catch(error => {
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

function metaLibraryUrl(input = {}) {
  if (input.url) {
    const u = new URL(String(input.url));
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (u.protocol !== "https:" || !["facebook.com","business.facebook.com"].includes(host)) {
      throw new Error("Only public Meta Ad Library URLs are accepted.");
    }
    if (!u.pathname.includes("/ads/library")) throw new Error("URL must be a Meta Ad Library URL.");
    return u.toString();
  }

  const q = String(input.query || "").trim();
  const pageId = String(input.page_id || "").trim();
  if (!q && !pageId) throw new Error("Provide url, page_id, or query.");

  const u = new URL("https://www.facebook.com/ads/library/");
  u.searchParams.set("active_status", input.active_status || "active");
  u.searchParams.set("ad_type", "all");
  u.searchParams.set("country", input.country || "US");
  u.searchParams.set("media_type", "all");

  if (pageId) {
    u.searchParams.set("search_type", "page");
    u.searchParams.set("view_all_page_id", pageId);
  } else {
    u.searchParams.set("search_type", "keyword_unordered");
    u.searchParams.set("q", q);
  }
  return u.toString();
}

function parseDate(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/^[A-Za-z]+\s+/, "").trim();
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysRunning(start, end = null) {
  if (!start) return 0;
  const stop = end || new Date();
  return Math.max(0, Math.floor((stop.getTime() - start.getTime()) / 86400000));
}

function normalizeText(text = "") {
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeCard(card) {
  const text = normalizeText(card.text);
  const startMatch = text.match(/Started running on\s+([^\n]+)/i);
  const rangeMatch = text.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s*[-–]\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
  const start = parseDate(startMatch?.[1] || rangeMatch?.[1] || "");
  const end = parseDate(rangeMatch?.[2] || "");
  const isActive = /\bActive\b/i.test(text) && !/\bInactive\b/i.test(text);

  const lines = text.split("\n").map(x => x.trim()).filter(Boolean);
  const sponsoredIndex = lines.findIndex(x => /^Sponsored$/i.test(x) || /^Sponsored\b/i.test(x));
  const advertiser = sponsoredIndex > 0 ? lines[sponsoredIndex - 1] : "";

  const excluded = /^(Active|Inactive|Library ID:|Started running on|Platforms|Open Dropdown|See ad details|Sponsored|Multiple versions|This ad has multiple versions)/i;
  const textCandidates = lines.filter(line => {
    if (line.length < 18) return false;
    if (excluded.test(line)) return false;
    if (line === advertiser) return false;
    return true;
  });

  // Primary text is usually the longest meaningful copy line/block in the visible card.
  const primaryText = [...textCandidates].sort((a,b) => b.length - a.length)[0] || "";

  const sourceUrl = card.links.find(x => /facebook\.com\/ads\/library\/.+id=/i.test(x)) ||
    "https://www.facebook.com/ads/library/?id=" + card.ad_archive_id;

  const landingUrl = card.links.find(x => {
    try {
      const u = new URL(x);
      const h = u.hostname.replace(/^www\./, "").toLowerCase();
      return !["facebook.com","fb.com","instagram.com"].includes(h);
    } catch {
      return false;
    }
  }) || "";

  const mediaUrl =
    card.videos.find(x => /^https?:/i.test(x)) ||
    card.images.find(x => /^https?:/i.test(x) && !/profile|emoji|avatar/i.test(x)) ||
    card.posters.find(x => /^https?:/i.test(x)) ||
    "";

  return {
    ad_archive_id: card.ad_archive_id,
    advertiser_name: advertiser,
    source_url: sourceUrl,
    primary_text: primaryText,
    headline: "",
    description: "",
    landing_url: landingUrl,
    media_url: mediaUrl,
    media_kind: card.videos.some(x => /^https?:/i.test(x)) ? "video" : mediaUrl ? "image" : "",
    started_at: start ? start.toISOString().slice(0,10) : null,
    ended_at: end ? end.toISOString().slice(0,10) : null,
    days_running: daysRunning(start, isActive ? null : end),
    is_active: isActive,
    visible_text: text
  };
}

async function extractVisibleCards(page, limit = 300) {
  const raw = await page.evaluate((maxVisible) => {
    const compact = s => String(s || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const all = Array.from(document.querySelectorAll("div, article"));
    const idNodes = all.filter(el => /Library ID:\s*\d{5,30}/i.test(el.innerText || ""));
    const candidates = [];
    const seen = new Set();

    for (const node of idNodes) {
      const match = (node.innerText || "").match(/Library ID:\s*(\d{5,30})/i);
      if (!match || seen.has(match[1])) continue;

      let card = node;
      for (let i = 0; i < 10 && card.parentElement; i++) {
        const parent = card.parentElement;
        const text = parent.innerText || "";
        if (text.length > 180 && text.length < 18000 && /Sponsored/i.test(text)) {
          card = parent;
          if (/Started running on|Library ID:/i.test(text)) break;
        } else {
          card = parent;
        }
      }

      const text = compact(card.innerText || "");
      if (!text || text.length > 22000) continue;

      const links = Array.from(card.querySelectorAll("a[href]"))
        .map(a => a.href)
        .filter(Boolean);

      const images = Array.from(card.querySelectorAll("img"))
        .map(x => x.currentSrc || x.src || "")
        .filter(Boolean);

      const videos = Array.from(card.querySelectorAll("video"))
        .flatMap(v => [
          v.currentSrc || v.src || "",
          ...Array.from(v.querySelectorAll("source[src]")).map(s => s.src)
        ])
        .filter(Boolean);

      const posters = Array.from(card.querySelectorAll("video[poster]"))
        .map(v => v.poster || "")
        .filter(Boolean);

      candidates.push({
        ad_archive_id: match[1],
        text,
        links,
        images,
        videos,
        posters
      });

      seen.add(match[1]);
      if (candidates.length >= maxVisible) break;
    }

    return candidates;
  }, limit);

  return raw.map(normalizeCard);
}

function mergeAd(map, ad) {
  const old = map.get(ad.ad_archive_id);
  if (!old) {
    map.set(ad.ad_archive_id, ad);
    return true;
  }

  // Later passes may expose media/copy that was lazy-loaded after the first pass.
  map.set(ad.ad_archive_id, {
    ...old,
    ...ad,
    advertiser_name: ad.advertiser_name || old.advertiser_name,
    primary_text: ad.primary_text || old.primary_text,
    headline: ad.headline || old.headline,
    description: ad.description || old.description,
    landing_url: ad.landing_url || old.landing_url,
    media_url: ad.media_url || old.media_url,
    media_kind: ad.media_kind || old.media_kind,
    started_at: ad.started_at || old.started_at,
    ended_at: ad.ended_at || old.ended_at,
    days_running: Math.max(Number(old.days_running || 0), Number(ad.days_running || 0)),
    is_active: old.is_active || ad.is_active
  });
  return false;
}

async function scrape(input) {
  const sourceUrl = metaLibraryUrl(input);
  const maxAds = Math.max(1, Math.min(Number(input.max_ads || 400), MAX_ADS_HARD_LIMIT));
  const maxScrolls = Math.max(10, Math.min(Number(input.max_scrolls || 120), MAX_SCROLLS_HARD_LIMIT));

  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 1100 },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136 Safari/537.36"
  });

  try {
    const page = await context.newPage();

    await page.route("**/*", async route => {
      const type = route.request().resourceType();
      if (type === "font") return route.abort();
      return route.continue();
    });

    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/temporarily blocked|try again later|security check|captcha/i.test(bodyText)) {
      return {
        ok: false,
        blocked: true,
        error: "Meta blocked the automated browser. Avonent will not bypass access controls.",
        source_url: sourceUrl,
        ads: []
      };
    }

    const collected = new Map();
    let stagnantPasses = 0;
    let previousSize = 0;
    let reachedEndSignal = false;

    for (let i = 0; i < maxScrolls; i++) {
      const visible = await extractVisibleCards(page, 350);
      for (const ad of visible) mergeAd(collected, ad);

      if (collected.size >= maxAds) break;

      if (collected.size === previousSize) stagnantPasses++;
      else stagnantPasses = 0;
      previousSize = collected.size;

      const pageState = await page.evaluate(() => ({
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        scrollHeight: document.documentElement.scrollHeight,
        textTail: (document.body.innerText || "").slice(-1200)
      }));

      reachedEndSignal =
        pageState.scrollY + pageState.innerHeight >= pageState.scrollHeight - 80 &&
        /end of results|no more results|that's all|no ads/i.test(pageState.textTail);

      if (reachedEndSignal && stagnantPasses >= 3) break;
      if (stagnantPasses >= 12) break;

      await page.evaluate(() => window.scrollBy(0, Math.max(1800, Math.floor(window.innerHeight * 2.2))));
      await page.waitForTimeout(stagnantPasses > 4 ? 1600 : 850);
    }

    // One final pass catches media/copy that lazy-loaded on the last viewport.
    for (const ad of await extractVisibleCards(page, 350)) mergeAd(collected, ad);

    let ads = Array.from(collected.values());

    const query = String(input.query || "").trim().toLowerCase();
    if (!input.page_id && query) {
      const exact = ads.filter(ad => String(ad.advertiser_name || "").trim().toLowerCase() === query);
      if (exact.length) ads = exact;
      else {
        const close = ads.filter(ad => String(ad.advertiser_name || "").trim().toLowerCase().includes(query));
        if (close.length) ads = close;
      }
    }

    ads.sort((a,b) => Number(b.days_running || 0) - Number(a.days_running || 0));
    if (ads.length > maxAds) ads = ads.slice(0, maxAds);

    const dated = ads.filter(a => a.started_at);
    const oldestStartedAt = dated.length
      ? dated.map(a => a.started_at).sort()[0]
      : null;
    const mediaCount = ads.filter(a => a.media_url).length;
    const copyCount = ads.filter(a => a.primary_text).length;
    const longRunningCount = ads.filter(a => a.is_active && Number(a.days_running || 0) >= Number(input.long_running_days || 30)).length;

    return {
      ok: true,
      source_url: sourceUrl,
      scraped_at: new Date().toISOString(),
      count: ads.length,
      long_running_count: longRunningCount,
      oldest_started_at: oldestStartedAt,
      media_count: mediaCount,
      primary_text_count: copyCount,
      reached_end_signal: reachedEndSignal,
      sample_complete: reachedEndSignal,
      note: reachedEndSignal
        ? "Collector reached an apparent end-of-results signal."
        : "This is a collected sample; Meta may have additional ads beyond the retrieved set.",
      ads
    };
  } finally {
    await context.close();
  }
}

app.get("/health", async (_req,res) => {
  let browserOk = true;
  try { await getBrowser(); } catch { browserOk = false; }
  res.json({
    ok: browserOk,
    service: "avonent-meta-scraper",
    version: "0.2.0",
    busy: scanBusy,
    max_ads_hard_limit: MAX_ADS_HARD_LIMIT
  });
});

app.post("/v1/meta/search", async (req,res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
  if (scanBusy) return res.status(429).json({ error: "Collector is busy. Retry after the current brand scan finishes." });

  scanBusy = true;
  try {
    const result = await scrape(req.body || {});
    res.status(result.ok ? 200 : result.blocked ? 429 : 500).json(result);
  } catch (error) {
    res.status(400).json({ ok:false, error:error?.message || String(error) });
  } finally {
    scanBusy = false;
  }
});

async function shutdown() {
  try {
    if (browserPromise) {
      const browser = await browserPromise.catch(() => null);
      if (browser) await browser.close();
    }
  } finally {
    process.exit(0);
  }
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

app.listen(PORT, "0.0.0.0", () => {
  console.log("Avonent Meta scraper v0.2.0 listening on :" + PORT);
});
