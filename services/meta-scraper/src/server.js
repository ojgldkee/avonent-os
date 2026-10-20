import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "128kb" }));

const PORT = Number(process.env.PORT || 8080);
const API_KEY = String(process.env.SCRAPER_API_KEY || "");
const MAX_ADS_HARD_LIMIT = 150;
const MAX_SCROLLS = 35;

function authorized(req) {
  if (!API_KEY) return false;
  const header = String(req.headers.authorization || "");
  return header === "Bearer " + API_KEY;
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
  const cleaned = raw.replace(/^[A-Za-z]+\s+/, "").trim();
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysRunning(start, end = null) {
  if (!start) return 0;
  const stop = end || new Date();
  return Math.max(0, Math.floor((stop.getTime() - start.getTime()) / 86400000));
}

function normalizeText(text = "") {
  return String(text).replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractCards(page, maxAds) {
  const raw = await page.evaluate((limit) => {
    function compact(s) {
      return String(s || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    }

    const all = Array.from(document.querySelectorAll("div, article"));
    const idNodes = all.filter(el => /Library ID:\s*\d{5,30}/i.test(el.innerText || ""));
    const candidates = [];
    const seen = new Set();

    for (const node of idNodes) {
      const match = (node.innerText || "").match(/Library ID:\s*(\d{5,30})/i);
      if (!match || seen.has(match[1])) continue;

      let card = node;
      for (let i = 0; i < 8 && card.parentElement; i++) {
        const parent = card.parentElement;
        const text = parent.innerText || "";
        if (text.length > 250 && text.length < 12000 && /Sponsored/i.test(text)) {
          card = parent;
          break;
        }
        card = parent;
      }

      const text = compact(card.innerText || "");
      if (!text || text.length > 18000) continue;

      const links = Array.from(card.querySelectorAll("a[href]")).map(a => a.href).filter(Boolean);
      const images = Array.from(card.querySelectorAll("img[src]")).map(x => x.src).filter(Boolean);
      const videos = Array.from(card.querySelectorAll("video[src], video source[src]")).map(x => x.src).filter(Boolean);

      candidates.push({
        ad_archive_id: match[1],
        text,
        links,
        images,
        videos
      });
      seen.add(match[1]);
      if (candidates.length >= limit) break;
    }
    return candidates;
  }, maxAds);

  return raw.map(card => {
    const text = normalizeText(card.text);
    const startMatch = text.match(/Started running on\s+([^\n]+)/i);
    const rangeMatch = text.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s*[-–]\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/);
    const start = parseDate(startMatch?.[1] || rangeMatch?.[1] || "");
    const end = parseDate(rangeMatch?.[2] || "");
    const isActive = /\bActive\b/i.test(text) && !/^Inactive\b/i.test(text);

    const lines = text.split("\n").map(x => x.trim()).filter(Boolean);
    const sponsoredIndex = lines.findIndex(x => /^Sponsored/i.test(x));
    const advertiser = sponsoredIndex > 0 ? lines[sponsoredIndex - 1] : "";

    const primaryCandidates = lines.filter(line => {
      if (line.length < 20) return false;
      if (/^(Active|Inactive|Library ID:|Started running on|Platforms|Open Dropdown|See ad details|Sponsored)/i.test(line)) return false;
      if (line === advertiser) return false;
      return true;
    });

    const primaryText = primaryCandidates.sort((a,b) => b.length - a.length)[0] || "";
    const sourceUrl = card.links.find(x => /facebook\.com\/ads\/library\/.+id=/i.test(x)) ||
      "https://www.facebook.com/ads/library/?id=" + card.ad_archive_id;

    const landingUrl = card.links.find(x => {
      try {
        const u = new URL(x);
        return !/facebook\.com$/i.test(u.hostname) && !/fb\.com$/i.test(u.hostname);
      } catch { return false; }
    }) || "";

    return {
      ad_archive_id: card.ad_archive_id,
      advertiser_name: advertiser,
      source_url: sourceUrl,
      primary_text: primaryText,
      headline: "",
      description: "",
      landing_url: landingUrl,
      media_url: card.videos[0] || card.images.find(x => !/profile|emoji/i.test(x)) || "",
      media_kind: card.videos[0] ? "video" : card.images.length ? "image" : "",
      started_at: start ? start.toISOString().slice(0,10) : null,
      ended_at: end ? end.toISOString().slice(0,10) : null,
      days_running: daysRunning(start, isActive ? null : end),
      is_active: isActive,
      visible_text: text
    };
  });
}

async function scrape(input) {
  const url = metaLibraryUrl(input);
  const maxAds = Math.max(1, Math.min(Number(input.max_ads || 50), MAX_ADS_HARD_LIMIT));

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"]
  });

  try {
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 1440, height: 1100 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136 Safari/537.36"
    });
    const page = await context.newPage();

    await page.route("**/*", async route => {
      const type = route.request().resourceType();
      if (type === "font") return route.abort();
      return route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);

    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/temporarily blocked|try again later|security check|captcha/i.test(bodyText)) {
      return {
        ok: false,
        blocked: true,
        error: "Meta blocked the automated browser. Avonent will not bypass access controls.",
        source_url: url,
        ads: []
      };
    }

    let previousCount = 0;
    for (let i = 0; i < MAX_SCROLLS; i++) {
      const current = (await extractCards(page, maxAds)).length;
      if (current >= maxAds) break;
      await page.mouse.wheel(0, 2600);
      await page.waitForTimeout(900);
      if (current === previousCount && i > 5) {
        await page.waitForTimeout(1200);
      }
      previousCount = current;
    }

    let ads = await extractCards(page, maxAds);
    const query = String(input.query || "").trim().toLowerCase();
    if (!input.page_id && query) {
      const exact = ads.filter(ad => String(ad.advertiser_name || "").trim().toLowerCase() === query);
      if (exact.length) ads = exact;
      else {
        const close = ads.filter(ad => String(ad.advertiser_name || "").trim().toLowerCase().includes(query));
        if (close.length) ads = close;
      }
    }
    return {
      ok: true,
      source_url: url,
      scraped_at: new Date().toISOString(),
      count: ads.length,
      ads
    };
  } finally {
    await browser.close();
  }
}

app.get("/health", (_req,res) => {
  res.json({ ok: true, service: "avonent-meta-scraper", version: "0.1.0" });
});

app.post("/v1/meta/search", async (req,res) => {
  if (!authorized(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const result = await scrape(req.body || {});
    res.status(result.ok ? 200 : result.blocked ? 429 : 500).json(result);
  } catch (error) {
    res.status(400).json({ ok:false, error:error?.message || String(error) });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Avonent Meta scraper listening on :" + PORT);
});
