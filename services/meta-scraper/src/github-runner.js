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

function urlHost(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function sameStore(a, b) {
  const ah = urlHost(a), bh = urlHost(b);
  return Boolean(ah && bh && (ah === bh || ah.endsWith("." + bh) || bh.endsWith("." + ah)));
}

function sameFacebookPage(a, b) {
  try {
    const normalize = value => {
      const u = new URL(value);
      return u.pathname.replace(/\/+$/, "").toLowerCase() + (u.pathname.toLowerCase() === "/profile.php" ? "?id=" + (u.searchParams.get("id") || "") : "");
    };
    return Boolean(a && b && normalize(a) === normalize(b));
  } catch {
    return false;
  }
}

function advertiserCandidates(sourceAds, brand) {
  const groups = new Map();
  for (const ad of sourceAds) {
    const name = String(ad.advertiser_name || "").trim();
    if (!name) continue;
    const pageId = String(ad.advertiser_page_id || "").trim();
    const pageUrl = String(ad.advertiser_page_url || "").trim();
    const key = pageId || normalizeAdvertiser(name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, {
      key,
      advertiser_name:name,
      meta_page_id:pageId,
      facebook_page_url:pageUrl,
      logo_url:String(ad.advertiser_logo_url || ""),
      ad_count:0,
      landing_domains:new Set(),
      website_match:false,
      facebook_match:false
    });
    const item = groups.get(key);
    item.ad_count++;
    const landing = externalWebsite(ad.landing_url || "");
    const host = urlHost(landing);
    if (host) item.landing_domains.add(host);
    if (landing && brand.website_url && sameStore(landing, brand.website_url)) item.website_match = true;
    if (pageUrl && brand.facebook_page_url && sameFacebookPage(pageUrl, brand.facebook_page_url)) item.facebook_match = true;
    if (!item.logo_url && ad.advertiser_logo_url) item.logo_url = String(ad.advertiser_logo_url);
    if (!item.meta_page_id && pageId) item.meta_page_id = pageId;
    if (!item.facebook_page_url && pageUrl) item.facebook_page_url = pageUrl;
  }
  return [...groups.values()].map(item => ({
    ...item,
    landing_domains:[...item.landing_domains].slice(0,6)
  })).sort((a,b) => Number(b.website_match)-Number(a.website_match) || Number(b.facebook_match)-Number(a.facebook_match) || b.ad_count-a.ad_count);
}

function sourceMatchesCandidate(ad, candidate) {
  if (candidate.meta_page_id && String(ad.advertiser_page_id || "") === candidate.meta_page_id) return true;
  return normalizeAdvertiser(ad.advertiser_name) === normalizeAdvertiser(candidate.advertiser_name);
}

function facebookSearchQuery(pageUrl, brandName) {
  try {
    const u = new URL(pageUrl);
    let slug = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "").toLowerCase().replace(/[^a-z0-9]+/g,"");
    if (!slug || /^\d+$/.test(slug) || slug === "profile.php") return "";
    const brandCompact = normalizeAdvertiser(brandName).replace(/\s+/g,"");
    if (brandCompact && slug.endsWith(brandCompact)) {
      let prefix = slug.slice(0, -brandCompact.length);
      prefix = prefix.replace(/by$/, " by ").trim();
      if (prefix) return (prefix + " " + brandName).replace(/\s+/g," ").trim();
    }
    return slug.replace(/([a-z])by([a-z])/g, "$1 by $2").trim();
  } catch {
    return "";
  }
}

async function fetchMetaSearch(brand, query, options = {}) {
  const response = await fetch(SCRAPER_URL + "/v1/meta/search", {
    method: "POST",
    headers: {
      authorization: "Bearer " + SCRAPER_KEY,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query: query || brand.competitor_name,
      page_id: options.keywordOnly ? "" : (brand.meta_page_id || ""),
      page_url: options.keywordOnly ? "" : (brand.facebook_page_url || ""),
      url: options.keywordOnly ? "" : (brand.ad_library_url || ""),
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
  return result;
}

async function collectBrand(brand) {
  console.log("\n[" + brand.competitor_name + "] starting");

  await updateBrand(brand.id, {
    last_scan_status: "running",
    last_scan_message: "Research in progress",
    scan_request_status: "running"
  });

  let result = await fetchMetaSearch(brand, brand.competitor_name);
  let sourceAds = Array.isArray(result.ads) ? result.ads : [];

  // If a configured page scan exposes no cards, retry a public keyword search.
  // Keep only ads that still match the configured page, advertiser name, or store domain.
  if (!sourceAds.length && (brand.meta_page_id || brand.ad_library_url)) {
    console.log("[" + brand.competitor_name + "] direct page scan returned no cards; retrying keyword discovery");
    const keyword = await fetchMetaSearch(brand, brand.competitor_name, { keywordOnly:true }).catch(() => null);
    const discovered = Array.isArray(keyword?.ads) ? keyword.ads : [];
    const matched = discovered.filter(ad =>
      (brand.meta_page_id && String(ad.advertiser_page_id || "") === String(brand.meta_page_id)) ||
      normalizeAdvertiser(ad.advertiser_name) === normalizeAdvertiser(brand.competitor_name) ||
      (brand.website_url && sameStore(externalWebsite(ad.landing_url || ""), brand.website_url))
    );
    if (matched.length) {
      sourceAds = matched;
      result = {...keyword, ads:matched};
      console.log("[" + brand.competitor_name + "] keyword fallback matched " + matched.length + " ad(s)");
    }
  }

  if (!brand.meta_page_id && result.resolved_page_id) {
    const resolvedId = String(result.resolved_page_id);
    const adLibraryUrl = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=" + encodeURIComponent(resolvedId) + "&search_type=page";
    const data = brand.brand_data && typeof brand.brand_data === "object" ? brand.brand_data : {};
    const patch = {
      meta_page_id:resolvedId,
      ad_library_url:adLibraryUrl,
      resolution_status:"verified_store_facebook_page",
      brand_data:{...data,advertiser_resolution_evidence:"page_id_extracted_from_store_linked_facebook_page",advertiser_resolved_at:new Date().toISOString()}
    };
    await updateBrand(brand.id, patch);
    Object.assign(brand, patch);
    console.log("[" + brand.competitor_name + "] resolved Meta page ID from store-linked Facebook page: " + resolvedId);
  }

  if (!brand.meta_page_id && !brand.ad_library_url && brand.facebook_page_url) {
    const alternateQuery = facebookSearchQuery(brand.facebook_page_url, brand.competitor_name);
    if (alternateQuery && normalizeAdvertiser(alternateQuery) !== normalizeAdvertiser(brand.competitor_name)) {
      console.log("[" + brand.competitor_name + "] retrying Meta search as: " + alternateQuery);
      const alternate = await fetchMetaSearch(brand, alternateQuery);
      const merged = new Map();
      for (const ad of [...sourceAds, ...(Array.isArray(alternate.ads) ? alternate.ads : [])]) {
        const key = String(ad.ad_archive_id || "").trim();
        if (key) merged.set(key, ad);
      }
      sourceAds = [...merged.values()];
      result = {
        ...result,
        ads: sourceAds,
        reached_end_signal: Boolean(result.reached_end_signal || alternate.reached_end_signal),
        sample_complete: Boolean(result.sample_complete && alternate.sample_complete),
        oldest_started_at: [result.oldest_started_at, alternate.oldest_started_at].filter(Boolean).sort()[0] || ""
      };
    }
  }

  // Store-first brands stay unresolved until a strong website/social match or an explicit user choice.
  // A similar advertiser name alone is never treated as proof that it is the same business.
  if (!brand.meta_page_id && !brand.ad_library_url) {
    const data = brand.brand_data && typeof brand.brand_data === "object" ? brand.brand_data : {};
    const selectedName = String(data.selected_advertiser_name || "").trim();

    if (selectedName) {
      sourceAds = sourceAds.filter(a => normalizeAdvertiser(a.advertiser_name) === normalizeAdvertiser(selectedName));
      if (!sourceAds.length) {
        await updateBrand(brand.id, {
          resolution_status:"unresolved",
          last_scan_status:"completed",
          last_scan_message:"The previously selected advertiser was not found in this sample. Review advertiser candidates.",
          last_scan_complete:false,
          scan_request_status:"",
          scan_requested_at:null
        });
        return;
      }
    } else {
      const candidates = advertiserCandidates(sourceAds, brand);
      const strong = candidates.filter(item => item.website_match || item.facebook_match);

      if (strong.length === 1) {
        const chosen = strong[0];
        const adLibraryUrl = chosen.meta_page_id
          ? "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=" + encodeURIComponent(chosen.meta_page_id) + "&search_type=page"
          : "";
        const nextData = {
          ...data,
          advertiser_candidates:candidates,
          selected_advertiser_name:chosen.advertiser_name,
          advertiser_resolution_evidence:chosen.website_match ? "landing_domain_matches_store" : "facebook_page_matches_store_link",
          advertiser_resolved_at:new Date().toISOString()
        };
        const patch = {
          competitor_name:chosen.advertiser_name || brand.competitor_name,
          logo_url:chosen.logo_url || brand.logo_url || "",
          facebook_page_url:chosen.facebook_page_url || brand.facebook_page_url || "",
          resolution_status:chosen.meta_page_id ? "verified_website_match" : "verified_store_social_match",
          brand_data:nextData,
          ...(chosen.meta_page_id ? {meta_page_id:chosen.meta_page_id,ad_library_url:adLibraryUrl} : {})
        };
        await updateBrand(brand.id, patch);
        Object.assign(brand, patch);
        sourceAds = sourceAds.filter(ad => sourceMatchesCandidate(ad, chosen));
      } else {
        const nextData = {...data, advertiser_candidates:candidates, advertiser_candidates_updated_at:new Date().toISOString()};
        await updateBrand(brand.id, {
          resolution_status:candidates.length ? "ambiguous" : "unresolved",
          brand_data:nextData,
          last_scanned_at:new Date().toISOString(),
          last_scan_status:"completed",
          last_scan_message:candidates.length
            ? "Advertiser match needs confirmation before ads are imported."
            : "No trustworthy Facebook advertiser match was found in this sample.",
          last_scan_complete:Boolean(result.sample_complete),
          scan_request_status:"",
          scan_requested_at:null
        });
        console.log("[" + brand.competitor_name + "] advertiser unresolved; " + candidates.length + " candidate(s)");
        return;
      }
    }
  }

  const now = new Date().toISOString();
  const seen = new Map();

  for (const ad of sourceAds) {
    const id = String(ad.ad_archive_id || "").trim();
    if (!/^\d{5,30}$/.test(id)) continue;
    if (ad.group_summary && !ad.media_url && !ad.media_thumbnail_url && !ad.primary_text && !ad.headline && !ad.landing_url) continue;

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
  if (!rows.length) {
    const now = new Date().toISOString();
    if (result.reached_end_signal || result.capture_status === "no_results") {
      await updateBrand(brand.id, {
        last_scanned_at:now,
        last_scan_status:"completed",
        last_scan_ads:0,
        last_scan_long_running:0,
        last_scan_complete:true,
        last_scan_message:"No active ads were found for this advertiser in the current Meta Ad Library view.",
        scan_request_status:"",
        scan_requested_at:null
      });
      console.log("[" + brand.competitor_name + "] no active ads found");
      return;
    }

    await updateBrand(brand.id, {
      last_scan_status:"queued",
      last_scan_message:"Meta did not expose ad cards on this pass. Avonent will retry automatically.",
      last_scan_complete:false,
      scan_request_status:"queued",
      scan_requested_at:now
    });
    console.log("[" + brand.competitor_name + "] no cards captured; queued automatic retry");
    return;
  }
  await upsertAds(rows);

  const logo = rows.map(x => x.advertiser_logo_url).find(Boolean) || brand.logo_url || "";
  const site = rows.map(x => externalWebsite(x.landing_url)).find(Boolean) || brand.website_url || "";
  const longCount = rows.filter(x => x.qualifies_long_running).length;
  const mediaCount = rows.filter(x => x.media_url || x.media_thumbnail_url).length;
  const copyCount = rows.filter(x => x.primary_text).length;

  await updateBrand(brand.id, {
    logo_url: logo,
    website_url: site,
    resolution_status: brand.meta_page_id || brand.ad_library_url ? (brand.resolution_status === "legacy_name_search" ? "configured_meta" : brand.resolution_status) : (brand.resolution_status || "user_selected"),
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
      (result.oldest_started_at || "unknown"),
    scan_request_status: "",
    scan_requested_at: null
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

  const allBrands = await rest(query, { method: "GET" });
  if (!Array.isArray(allBrands) || !allBrands.length) {
    console.log("No active tracked brands to research.");
    return;
  }

  const staleBefore = Date.now() - 12 * 60 * 60 * 1000;
  const brands = COMPETITOR_ID ? allBrands : allBrands.filter(brand => {
    if (String(brand.scan_request_status || "") === "queued") return true;
    if (!brand.last_scanned_at) return true;
    const last = Date.parse(brand.last_scanned_at);
    return Number.isFinite(last) && last <= staleBefore;
  });

  if (!brands.length) {
    console.log("No queued or stale brands need research.");
    return;
  }

  console.log("Researching " + brands.length + " queued/stale brand(s).");

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
        last_scan_complete: false,
        scan_request_status: "error"
      }).catch(() => {});
    }
  }

  if (failures) {
    console.error(failures + " brand scan(s) failed.");
    process.exitCode = 1;
  }
}

await main();
