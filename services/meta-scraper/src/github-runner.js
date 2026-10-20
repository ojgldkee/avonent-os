const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const SCRAPER_KEY = String(process.env.SCRAPER_API_KEY || "github-actions-local");
const COMPETITOR_ID = String(process.env.COMPETITOR_ID || "").trim();
const SCRAPER_URL = String(process.env.LOCAL_SCRAPER_URL || "http://127.0.0.1:8080").replace(/\/$/, "");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  authorization: "Bearer " + SERVICE_KEY,
  "content-type": "application/json"
};

async function rest(path, options = {}) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("Supabase " + response.status + ": " + text.slice(0, 500));
  }
  return text ? JSON.parse(text) : null;
}

async function updateBrand(id, patch) {
  await rest("competitor_watchlist?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
}

async function upsertAds(rows) {
  for (let i = 0; i < rows.length; i += 75) {
    const chunk = rows.slice(i, i + 75);
    const ids = chunk.map(row => row.ad_archive_id).join(",");
    const existing = await rest("competitor_ads?user_id=eq." + encodeURIComponent(chunk[0].user_id) + "&ad_archive_id=in.(" + ids + ")&select=*", {method:"GET"});
    for (const row of chunk) {
      const old = existing.find(ad => ad.ad_archive_id === row.ad_archive_id);
      if (!old) continue;
      if (old.product_id !== row.product_id || old.competitor_id !== row.competitor_id) {
        throw new Error("Ad already belongs to another product/brand; shared-ad schema migration required.");
      }
      for (const key of ["primary_text","headline","description","cta_text","landing_url","media_url","media_thumbnail_url","advertiser_logo_url","media_kind","started_at","ended_at"]) {
        if (!row[key] && old[key]) row[key] = old[key];
      }
      if (old.primary_text.length > row.primary_text.length && row.raw.primary_text_complete !== true) row.primary_text = old.primary_text;
      if (row.started_at) {
        const stop = row.is_active ? Date.now() : row.ended_at ? Date.parse(row.ended_at) : NaN;
        row.days_running = Number.isFinite(stop) ? Math.max(0, Math.floor((stop-Date.parse(row.started_at))/86400000)) : 0;
      }
      row.qualifies_long_running = Boolean(row.started_at) && row.is_active && row.days_running >= Number(row.raw.long_running_threshold || 30);
    }
    await rest("competitor_ads?on_conflict=user_id,ad_archive_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk)
    });
  }
}

function externalWebsite(url) {
  try {
    let u = new URL(url);
    if (["l.facebook.com","lm.facebook.com"].includes(u.hostname.toLowerCase()) && u.searchParams.get("u")) u = new URL(u.searchParams.get("u"));
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (u.protocol !== "https:") return "";
    if (["facebook.com","fb.com","instagram.com"].some(domain => h === domain || h.endsWith("." + domain))) return "";
    return u.origin + "/";
  } catch {
    return "";
  }
}

function normalizeAdvertiser(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function collectBrand(brand) {
  console.log("\n[" + brand.competitor_name + "] starting");

  await updateBrand(brand.id, {
    last_scan_status: "running",
    last_scan_message: "Research in progress"
  });

  const response = await fetch(SCRAPER_URL + "/v1/meta/search", {
    method: "POST",
    headers: {
      authorization: "Bearer " + SCRAPER_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: brand.competitor_name,
      page_id: brand.meta_page_id || "",
      url: brand.ad_library_url || "",
      country: "US",
      active_status: "active",
      max_ads: 500,
      max_scrolls: 140,
      long_running_days: Number(brand.min_days_running || 30)
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.error || ("collector returned " + response.status));
  }

  let sourceAds = Array.isArray(result.ads) ? result.ads : [];

  // If we do not yet know the Meta page ID, do not silently mix unrelated keyword matches
  // into a brand's research history. Prefer exact/near advertiser-name matches.
  if (!brand.meta_page_id && !brand.ad_library_url) {
    const target = normalizeAdvertiser(brand.competitor_name);
    const exact = sourceAds.filter(a => normalizeAdvertiser(a.advertiser_name) === target);
    const close = sourceAds.filter(a => {
      const n = normalizeAdvertiser(a.advertiser_name);
      return n && target && (n.includes(target) || target.includes(n));
    });
    if (exact.length) sourceAds = exact;
    else if (close.length) sourceAds = close;
    else if (sourceAds.length) throw new Error("No matching advertiser found. Set the correct Meta page ID in brand settings.");
  }

  const now = new Date().toISOString();
  const seen = new Map();

  for (const ad of sourceAds) {
    const id = String(ad.ad_archive_id || "").trim();
    if (!/^\d{5,30}$/.test(id)) continue;

    const sourceUrl = /^https:\/\/www\.facebook\.com\/ads\/library\//i.test(String(ad.source_url || ""))
      ? String(ad.source_url)
      : "https://www.facebook.com/ads/library/?id=" + encodeURIComponent(id);

    const days = ad.started_at ? Math.max(0, Number(ad.days_running || 0)) : 0; // Legacy NOT NULL column; started_at is authoritative.
    const row = {
      user_id: brand.user_id,
      product_id: brand.product_id,
      competitor_id: brand.id,
      ad_archive_id: id,
      advertiser_name: String(ad.advertiser_name || brand.competitor_name),
      source_url: sourceUrl,
      primary_text: String(ad.primary_text || ""),
      headline: String(ad.headline || ""),
      description: String(ad.description || ""),
      cta_text: String(ad.cta_text || ""),
      landing_url: String(ad.landing_url || ""),
      display_format: String(ad.display_format || ""),
      media_url: String(ad.media_url || ""),
      media_thumbnail_url: String(ad.media_thumbnail_url || ""),
      advertiser_logo_url: String(ad.advertiser_logo_url || ""),
      media_kind: String(ad.media_kind || ""),
      platforms: Array.isArray(ad.platforms) ? ad.platforms : [],
      started_at: ad.started_at || null,
      ended_at: ad.ended_at || null,
      days_running: days,
      is_active: ad.is_active !== false,
      qualifies_long_running: Boolean(ad.started_at) && ad.is_active !== false && days >= Number(brand.min_days_running || 30),
      raw: { ...ad, long_running_threshold: Number(brand.min_days_running || 30) },
      last_seen_at: now,
      updated_at: now
    };
    seen.set(id, row);
  }

  const rows = Array.from(seen.values());
  if (!rows.length && !result.reached_end_signal) throw new Error("No ads captured; the page may be blocked or its format may have changed.");
  if (rows.length) await upsertAds(rows);

  const logo = rows.map(x => x.advertiser_logo_url).find(Boolean) || brand.logo_url || "";
  const site = rows.map(x => externalWebsite(x.landing_url)).find(Boolean) || brand.website_url || "";
  const longCount = rows.filter(x => x.qualifies_long_running).length;
  const mediaCount = rows.filter(x => x.media_url || x.media_thumbnail_url).length;
  const copyCount = rows.filter(x => x.primary_text).length;

  await updateBrand(brand.id, {
    logo_url: logo,
    website_url: site,
    ...(/^(Linked Meta ad |Meta advertiser )/.test(brand.competitor_name) && rows[0]?.advertiser_name ? {competitor_name:rows[0].advertiser_name} : {}),
    last_scanned_at: now,
    last_scan_status: "completed",
    last_scan_ads: rows.length,
    last_scan_long_running: longCount,
    last_scan_complete: Boolean(result.sample_complete),
    last_scan_message:
      rows.length +
      " ads collected · " +
      copyCount +
      " with primary text · " +
      mediaCount +
      " with media · oldest " +
      (result.oldest_started_at || "unknown")
  });

  console.log(
    "[" + brand.competitor_name + "] " +
    rows.length + " ads, " +
    longCount + " long-running, " +
    copyCount + " copy, " +
    mediaCount + " media"
  );
}

async function main() {
  let query = "competitor_watchlist?active=eq.true&select=*";
  if (COMPETITOR_ID) query += "&id=eq." + encodeURIComponent(COMPETITOR_ID);

  const brands = await rest(query, { method: "GET" });
  if (!Array.isArray(brands) || !brands.length) {
    console.log("No active tracked brands to research.");
    return;
  }

  console.log("Researching " + brands.length + " tracked brand(s).");

  let failures = 0;
  for (const brand of brands) {
    try {
      await collectBrand(brand);
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : String(error);
      console.error("[" + brand.competitor_name + "] " + message);
      await updateBrand(brand.id, {
        last_scan_status: "error",
        last_scan_message: message.slice(0, 500),
        last_scan_complete: false
      }).catch(() => {});
    }
  }

  if (failures) {
    console.error(failures + " brand scan(s) failed.");
    process.exitCode = 1;
  }
}

await main();
