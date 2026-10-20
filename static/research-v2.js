(() => {
  "use strict";

  const cloud = window.AVONENT_CLOUD;
  if (!cloud) return;
  const db = cloud.db;
  const {parseMetaLink,parseFacebookReference,normalizeStoreUrl,researchSources} = window.AVONENT_RESEARCH_UTILS;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

  let session = null;
  let products = [];
  let watchlist = [];
  let ads = [];
  let expandedAdId = null;
  let visibleLimit = 24;


  function adAge(ad, now = Date.now()) {
    if (!ad.started_at || (!ad.is_active && !ad.ended_at)) return null;
    const start = Date.parse(ad.started_at + (ad.started_at.length === 10 ? "T00:00:00Z" : ""));
    const stop = ad.is_active ? now : Date.parse(ad.ended_at + (ad.ended_at.length === 10 ? "T00:00:00Z" : ""));
    return Number.isFinite(start) && Number.isFinite(stop) && stop >= start ? Math.floor((stop - start) / 86400000) : null;
  }
  function qualifies(ad, days = 30) {
    const age = adAge(ad);
    return ad.is_active && age !== null && age >= days;
  }
  function safeUrl(value) {
    try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch { return ""; }
  }
  function mediaKind(ad) {
    const kind = String(ad?.media_kind || "").toLowerCase();
    if (kind === "video") return "video";
    if (kind === "image") return "image";
    return "unknown";
  }
  function sortTime(value) {
    const t = Date.parse(value || "");
    return Number.isFinite(t) ? t : null;
  }
  function copyExcerpt(text) {
    return text.length > 200 ? text.slice(0,200).trimEnd() + "…" : text;
  }
  function toggleCopy(id) {
    expandedAdId = expandedAdId === id ? null : id;
    document.querySelectorAll("[data-expand-ad]").forEach(button => {
      const ad = ads.find(a => String(a.id) === button.dataset.expandAd);
      if (!ad) return;
      const open = String(ad.id) === expandedAdId;
      const paragraph = document.getElementById(button.getAttribute("aria-controls"));
      if (paragraph) paragraph.textContent = open ? ad.primary_text : copyExcerpt(ad.primary_text);
      button.textContent = open ? "Show less" : "Show more";
      button.setAttribute("aria-expanded", String(open));
    });
  }
  function impressionLabel(ad) {
    const raw = ad.raw || {};
    return raw.impressions_type === "public_range" && Number.isSafeInteger(raw.impressions_min) && Number.isSafeInteger(raw.impressions_max) && raw.impressions_max >= raw.impressions_min
      ? raw.impressions_min.toLocaleString() + "–" + raw.impressions_max.toLocaleString() + " (public range)"
      : "Not publicly available";
  }

  function niceDate(value) {
    if (!value) return "Never";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Never";
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return d.toLocaleDateString();
  }

  function productId() {
    return $("research-product")?.value || "";
  }

  function currentProduct() {
    return products.find(p => p.id === productId()) || null;
  }

  function activateTab(name) {
    document.querySelectorAll("[data-research-tab]").forEach(btn => {
      const on = btn.dataset.researchTab === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll("[data-research-panel]").forEach(panel => {
      panel.hidden = panel.dataset.researchPanel !== name;
    });
    history.replaceState(null, "", location.pathname + "#" + name);
  }

  async function loadProducts() {
    const r = await db.from("products").select("*").order("created_at", { ascending: true });
    if (r.error) throw r.error;
    products = r.data || [];
    $("research-product").innerHTML = products.length
      ? products.map(p => '<option value="' + esc(p.id) + '">' + esc(p.brand_name || "") + ' — ' + esc(p.name) + '</option>').join("")
      : '<option value="">No products yet</option>';
  }

  async function loadResearch() {
    const id = productId();
    if (!id) {
      watchlist = [];
      ads = [];
      render();
      return;
    }

    const [w, a] = await Promise.all([
      db.from("competitor_watchlist").select("*").eq("product_id", id).order("created_at", { ascending: true }),
      db.from("competitor_ads").select("*").eq("product_id", id).order("days_running", { ascending: false }).limit(500)
    ]);

    if (w.error) throw w.error;
    if (a.error) throw a.error;
    watchlist = w.data || [];
    ads = Array.from(new Map((a.data || []).map(row => [row.competitor_id + ":" + row.ad_archive_id, row])).values());
    render();
  }

  function render() {
    const activeAds = ads.filter(a => a.is_active);
    const longAds = activeAds.filter(a => qualifies(a));
    const scans = watchlist.map(w => w.last_scanned_at).filter(Boolean).sort().reverse();

    if ($("stat-watchlist")) $("stat-watchlist").textContent = String(watchlist.filter(w => w.active).length);
    if ($("stat-proven")) $("stat-proven").textContent = String(longAds.length);
    if ($("stat-ads")) $("stat-ads").textContent = String(activeAds.length);
    if ($("stat-analyzed")) $("stat-analyzed").textContent = String(ads.filter(a => a.analyzed_at).length);
    if ($("stat-last-scan")) $("stat-last-scan").textContent = scans[0] ? niceDate(scans[0]) : "Never";

    renderBrands();
    renderBrandFilter();
    renderAds();
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return (parts.slice(0,2).map(x => x[0]).join("") || "?").toUpperCase();
  }

  function faviconFor(url) {
    try { return new URL("/favicon.ico", url).toString(); } catch { return ""; }
  }

  function brandAvatar(w) {
    const src = w.logo_url || (w.website_url ? faviconFor(w.website_url) : "");
    return '<div class="brand-avatar">' +
      (src ? '<img src="' + esc(src) + '" alt="' + esc(w.competitor_name) + ' logo" loading="lazy" data-brand-avatar-img>' : '') +
      '<span>' + esc(initials(w.competitor_name)) + '</span>' +
    '</div>';
  }

  function scanState(w) {
    if (w.resolution_status === "ambiguous") return "Choose the matching Facebook advertiser";
    if (w.resolution_status === "unresolved" || w.resolution_status === "needs_meta_resolution" || w.resolution_status === "user_page_link_unresolved") return "Facebook advertiser not resolved";
    if (w.last_scan_status === "running") return "Research in progress";
    if (w.last_scan_status === "error") return "Research error";
    if (w.last_scan_status === "completed") return w.last_scan_complete ? "Research complete" : "Research sampled";
    return "Not researched";
  }

  function candidateMarkup(w) {
    const candidates = Array.isArray(w.brand_data?.advertiser_candidates) ? w.brand_data.advertiser_candidates : [];
    if (!["ambiguous","unresolved","needs_meta_resolution","user_page_link_unresolved"].includes(w.resolution_status) || !candidates.length) return "";
    return '<div class="advertiser-candidates"><strong>Choose the matching Facebook advertiser</strong><p class="helper">Names alone are not treated as proof. Pick the advertiser only when the page/domain details match the store.</p>' +
      candidates.slice(0,6).map((candidate,index) =>
        '<button type="button" class="advertiser-candidate" data-select-candidate="' + esc(w.id) + '" data-candidate-index="' + index + '">' +
          '<span><b>' + esc(candidate.advertiser_name || "Unknown advertiser") + '</b><small>' + Number(candidate.ad_count || 0) + ' sampled ads' +
          (candidate.landing_domains?.length ? ' · ' + esc(candidate.landing_domains.join(", ")) : '') + '</small></span>' +
          '<em>' + (candidate.website_match ? 'Store match' : candidate.facebook_match ? 'Facebook match' : 'Review') + '</em>' +
        '</button>'
      ).join("") + '</div>';
  }

  function storeSummary(w) {
    const discovery = w.brand_data?.store_discovery || {};
    const products = Array.isArray(discovery.products) ? discovery.products : [];
    const categories = Array.isArray(discovery.categories) ? discovery.categories : [];
    if (!products.length && !categories.length) return "";
    const productNames = products.slice(0,4).map(p => p?.name).filter(Boolean);
    return '<div class="store-summary">' +
      (categories.length ? '<span>Categories: ' + esc(categories.slice(0,4).join(", ")) + '</span>' : '') +
      (productNames.length ? '<span>Products: ' + esc(productNames.join(", ")) + (products.length > 4 ? ' +' + (products.length-4) : '') + '</span>' : '') +
    '</div>';
  }

  function renderBrands() {
    const box = $("watchlist-list");
    if (!box) return;

    if (!watchlist.length) {
      box.innerHTML = '<div class="empty">No brands tracked yet.</div>';
      return;
    }

    box.innerHTML = watchlist.map(w => {
      const brandAds = ads.filter(a => a.competitor_id === w.id && a.is_active);
      const longCount = brandAds.filter(a => qualifies(a, Number(w.min_days_running || 30))).length;
      return '<article class="watch-item brand-card" data-brand-card="' + esc(w.id) + '">' +
        '<div class="brand-card-head">' +
          '<div class="brand-identity">' + brandAvatar(w) +
            '<div class="brand-card-name"><span class="eyebrow">TRACKED BRAND</span><h3>' + esc(w.competitor_name) + '</h3><small class="brand-scan-state">' + esc(scanState(w)) + '</small></div>' +
          '</div>' +
          '<label class="watch-toggle"><input type="checkbox" data-watch-active="' + esc(w.id) + '" ' + (w.active ? 'checked' : '') + '><span>' + (w.active ? 'On' : 'Off') + '</span></label>' +
        '</div>' +
        (w.last_scan_message ? '<p class="helper">' + esc(w.last_scan_message) + '</p>' : '') +
        (w.brand_description ? '<p class="brand-description">' + esc(w.brand_description) + '</p>' : '') +
        (w.website_url ? '<a class="brand-site-link" target="_blank" rel="noopener" href="' + esc(w.website_url) + '">' + esc((()=>{try{return new URL(w.website_url).hostname.replace(/^www\./,"")}catch{return "Brand website"}})()) + '</a>' : '') +
        storeSummary(w) + candidateMarkup(w) +
        '<div class="brand-card-stats">' +
          '<div><span>Ads sampled</span><strong>' + Number(w.last_scan_ads || brandAds.length || 0) + '</strong></div>' +
          '<div><span>' + Number(w.min_days_running || 30) + '+ day ads found</span><strong>' + longCount + '</strong></div>' +
          '<div><span>Last research</span><strong class="small-value">' + esc(w.last_scanned_at ? niceDate(w.last_scanned_at) : "Never") + '</strong></div>' +
        '</div>' +
        '<div class="brand-card-actions">' +
          '<button class="button mini" type="button" data-research-brand="' + esc(w.id) + '">Research brand</button>' +
          '<button class="button secondary mini" type="button" data-view-brand="' + esc(w.id) + '">View ads</button>' +
          '<button class="text-button danger" type="button" data-watch-delete="' + esc(w.id) + '">Remove</button>' +
        '</div>' +
        '<details class="brand-card-settings"><summary>Settings · optional overrides</summary>' +
          '<label>Brand name override<input data-brand-name value="' + esc(w.competitor_name) + '" maxlength="120"></label>' +
          '<label>Facebook page or Ad Library link<input data-brand-link type="url" value="' + esc(w.ad_library_url || w.facebook_page_url || (w.meta_page_id ? "https://www.facebook.com/ads/library/?view_all_page_id=" + encodeURIComponent(w.meta_page_id) : "")) + '" placeholder="Optional"></label>' +
          '<label>Store URL<input data-brand-website type="url" value="' + esc(w.website_url || "") + '"></label>' +
          '<label>Logo URL (optional)<input data-brand-logo type="url" value="' + esc(w.logo_url || "") + '"></label>' +
          '<button class="button secondary mini" type="button" data-save-brand="' + esc(w.id) + '">Save brand settings</button>' +
          '<label>Long-running threshold<div class="number-field compact"><input type="number" min="1" max="3650" value="' + Number(w.min_days_running || 30) + '" data-watch-days="' + esc(w.id) + '"><span>days</span></div></label>' +
        '</details>' +
      '</article>';
    }).join("");
    box.querySelectorAll("[data-brand-avatar-img]").forEach(img => {
      img.addEventListener("error", () => img.remove(), { once:true });
    });
  }

  function renderBrandFilter() {
    const select = $("brand-filter");
    if (!select) return;
    const previous = select.value || "all";
    select.innerHTML = '<option value="all">All tracked brands</option>' +
      watchlist.map(w => '<option value="' + esc(w.id) + '">' + esc(w.competitor_name) + '</option>').join("");
    select.value = watchlist.some(w => w.id === previous) ? previous : "all";
  }

  function renderAds() {
    const box = $("research-ads");
    if (!box) return;

    const brand = $("brand-filter")?.value || "all";
    const media = $("media-filter")?.value || "all";
    const age = $("age-filter")?.value || "all";
    const keyword = ($("keyword-filter")?.value || "").trim().toLowerCase();
    const sort = $("sort-filter")?.value || "newest";

    let rows = ads.filter(a => a.is_active);
    if (brand !== "all") rows = rows.filter(a => a.competitor_id === brand);
    if (media !== "all") rows = rows.filter(a => mediaKind(a) === media);
    if (age === "unknown") rows = rows.filter(a => adAge(a) === null);
    if (/^days-\d+$/.test(age)) rows = rows.filter(a => qualifies(a, Number(age.slice(5))));
    if (keyword) rows = rows.filter(a => [a.primary_text,a.headline,a.advertiser_name].some(value => String(value || "").toLowerCase().includes(keyword)));

    rows.sort((a,b) => {
      if (sort === "collected") return (sortTime(b.last_seen_at || b.created_at || b.updated_at) || 0) - (sortTime(a.last_seen_at || a.created_at || a.updated_at) || 0);
      const at = sortTime(a.started_at), bt = sortTime(b.started_at);
      if (at === null && bt === null) return 0;
      if (at === null) return 1;
      if (bt === null) return -1;
      return sort === "oldest" ? at - bt : bt - at;
    });

    const total = rows.length;
    const unknownAge = rows.filter(a => adAge(a) === null).length;
    if ($("ad-sample-count")) $("ad-sample-count").textContent = total + " matching sampled ads · " + unknownAge + " unknown age · up to 500 stored ads loaded";
    rows = rows.slice(0, visibleLimit);
    if ($("load-more-ads")) $("load-more-ads").hidden = visibleLimit >= total;
    if (!rows.length) {
      box.innerHTML = '<div class="empty wide">No collected ads match these filters. Clear filters or research a tracked brand.</div>';
      return;
    }

    box.innerHTML = rows.map(a => {
      const expanded = expandedAdId === String(a.id);
      const adKind = mediaKind(a);
      const ageDays = adAge(a);
      const brandRow = watchlist.find(w => w.id === a.competitor_id) || {};
      const avatar = brandAvatar({competitor_name:a.advertiser_name, logo_url:safeUrl(a.advertiser_logo_url || brandRow.logo_url), website_url:brandRow.website_url});
      const mediaUrl = safeUrl(a.media_url), poster = safeUrl(a.media_thumbnail_url);
      let mediaHtml = '<div class="ad-media-empty"><span>Creative preview</span><p>Media was not captured by this source yet.</p></div>';
      if (adKind === "video" && mediaUrl) {
        mediaHtml = '<div class="source-ad-media"><video controls playsinline preload="none" ' + (poster ? 'poster="' + esc(poster) + '" ' : '') + 'src="' + esc(mediaUrl) + '"></video></div>';
      } else if (adKind === "image" && mediaUrl) {
        mediaHtml = '<div class="source-ad-media"><img loading="lazy" src="' + esc(mediaUrl) + '" alt=""></div>';
      } else if (adKind === "unknown" && poster) {
        mediaHtml = '<div class="source-ad-media media-unknown"><img loading="lazy" src="' + esc(poster) + '" alt=""><span>Media type unknown</span></div>';
      }

      const primary = a.primary_text
        ? '<div class="source-copy"><div class="source-copy-head"><span>Primary text</span><button class="copy-inline" type="button" data-copy-text="' + esc(a.id) + '">Copy</button></div><p id="copy-' + esc(a.id) + '" style="white-space:pre-wrap;overflow-wrap:anywhere">' + esc(expanded ? a.primary_text : copyExcerpt(a.primary_text)) + '</p>' +
          (a.primary_text.length > 200 ? '<button type="button" class="copy-inline" data-expand-ad="' + esc(a.id) + '" aria-controls="copy-' + esc(a.id) + '" aria-expanded="' + expanded + '">' + (expanded ? 'Show less' : 'Show more') + '</button>' : '') +
          (a.raw?.primary_text_complete === false ? '<small>Source text may be incomplete.</small>' : '') + '</div>'
        : '<div class="source-copy muted-copy"><p>Primary text not captured yet.</p></div>';

      const headline = a.headline
        ? '<div class="ad-headline-block"><span>Headline</span><strong>' + esc(a.headline) + '</strong></div>'
        : '';

      const actions =
        (a.source_url ? '<a class="button secondary mini" target="_blank" rel="noopener" href="' + esc(a.source_url) + '">Open Meta ad</a>' : '') +
        (a.landing_url ? '<a class="button secondary mini" target="_blank" rel="noopener" href="' + esc(a.landing_url) + '">Landing page</a>' : '');

      return '<article class="source-ad-card">' +
        '<div class="source-ad-top">' + avatar + '<div><span class="pill">' + esc(a.advertiser_name || "Tracked brand") + '</span><h3>Ad ' + esc(a.ad_archive_id || "") + '</h3></div>' +
        '<div class="days-badge ' + (qualifies(a) ? 'qualified' : '') + '"><strong>' + (ageDays === null ? '—' : ageDays) + '</strong><span>' + (ageDays === null ? 'unknown' : 'days') + '</span></div></div>' +
        mediaHtml + (adKind === "video" && !poster ? '<p class="helper">Preview unavailable · press play to view video.</p>' : '') + headline + primary + '<p class="helper">Impressions: ' + esc(impressionLabel(a)) + '</p>' +
        '<div class="source-meta"><span>' + (a.started_at ? 'Started ' + esc(new Date(a.started_at + 'T00:00:00Z').toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})) : 'Start date unavailable') + '</span>' +
          '<span>' + esc(adKind === "unknown" ? "Unknown media" : adKind === "video" ? "Video" : "Image") + '</span>' +
          (qualifies(a) ? '<span class="qualified-label">Long-running</span>' : '') +
          (a.analyzed_at ? '<span class="qualified-label">AI analyzed</span>' : '') +
        '</div>' +
        '<div class="source-actions">' + actions + '</div>' +
      '</article>';
    }).join("");
    box.querySelectorAll("[data-brand-avatar-img]").forEach(img => img.addEventListener("error", () => img.remove(), {once:true}));
    box.querySelectorAll("video").forEach(video => video.addEventListener("error", () => {
      const message = document.createElement("p"); message.className = "helper";
      message.textContent = "Video unavailable or expired. Open the Meta ad or refresh the brand.";
      video.replaceWith(message);
    }, {once:true}));
  }

  async function addCompetitor(event) {
    event.preventDefault();
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const store = normalizeStoreUrl($("competitor-store").value);
      if (!productId()) throw new Error("Choose a product first.");
      if (watchlist.some(w => {
        try { return normalizeStoreUrl(w.website_url || "") === store; } catch { return false; }
      })) throw new Error("That store is already tracked.");

      const optionalFacebook = parseFacebookReference($("competitor-link").value);
      const logoOverride = $("competitor-logo").value.trim();
      if (logoOverride && !safeUrl(logoOverride)) throw new Error("Logo override must be an http or https URL.");

      $("research-status").textContent = "Reading the store and brand details…";
      let discovery = {};
      try {
        discovery = await cloud.invoke("enrich-competitor-brand", { site: store });
      } catch (error) {
        discovery = {canonical_url:store,brand_name:"",logo_url:"",brand_description:"",products:[],categories:[],facebook_candidates:[],resolution_status:"needs_meta_resolution"};
        $("research-status").textContent = "The store will be saved, but automatic brand enrichment failed: " + (error.message || String(error));
      }

      const canonical = discovery.canonical_url || store;
      const hostName = (() => { try { return new URL(canonical).hostname.replace(/^www\./,"").split(".")[0].replace(/[-_]+/g," "); } catch { return "Competitor"; } })();
      const name = ($("competitor-name").value.trim() || discovery.brand_name || hostName).slice(0,120);
      const metaPageId = optionalFacebook.pageId || discovery.meta_page_id || "";
      const adLibraryUrl = optionalFacebook.adLibraryUrl || discovery.ad_library_url || "";
      const facebookPageUrl = optionalFacebook.pageUrl || discovery.facebook_page_url || "";
      const resolutionStatus = optionalFacebook.adId ? "user_configured_ad" :
        metaPageId ? (optionalFacebook.pageId ? "user_configured" : "verified_store_link") :
        facebookPageUrl ? "user_page_link_unresolved" : (discovery.resolution_status || "needs_meta_resolution");

      const brandData = {
        manual_name_override:Boolean($("competitor-name").value.trim()),
        manual_logo_override:Boolean(logoOverride),
        store_discovery:{
          products:Array.isArray(discovery.products)?discovery.products:[],
          categories:Array.isArray(discovery.categories)?discovery.categories:[],
          facebook_candidates:Array.isArray(discovery.facebook_candidates)?discovery.facebook_candidates:[],
          page_title:discovery.page_title || "",
          discovered_at:new Date().toISOString()
        }
      };

      const r = await db.from("competitor_watchlist").insert({
        user_id: session.user.id,
        product_id: productId(),
        competitor_name: name,
        website_url: canonical,
        logo_url: logoOverride || discovery.logo_url || "",
        brand_description: discovery.brand_description || "",
        facebook_page_url: facebookPageUrl,
        ad_library_url: adLibraryUrl,
        meta_page_id: metaPageId,
        resolution_status: resolutionStatus,
        brand_data: brandData,
        min_days_running: Math.max(1, Number($("competitor-days").value || 30)),
        active: true
      });
      if (r.error) throw r.error;

      $("competitor-store").value = "";
      $("competitor-name").value = "";
      $("competitor-link").value = "";
      $("competitor-logo").value = "";
      await loadResearch();
      $("research-status").textContent = metaPageId || adLibraryUrl
        ? name + " saved with a resolved Facebook source. The collector can now research it."
        : name + " saved from the store URL. Facebook is still unresolved; the collector can discover candidates for you to confirm.";
    } catch (error) {
      $("research-status").textContent = error.message || String(error);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function runResearch(competitorId = null) {
    const btn = competitorId ? document.querySelector('[data-research-brand="' + competitorId + '"]') : $("scan-now");
    if (btn) {
      btn.disabled = true;
      btn.dataset.oldText = btn.textContent;
      btn.textContent = "Researching…";
    }

    const brand = competitorId ? watchlist.find(w => w.id === competitorId) : null;
    $("research-status").textContent = brand
      ? "Researching " + brand.competitor_name + "…"
      : "Researching tracked brands…";

    try {
      const result = await cloud.invoke("scan-competitor-ads", {
        product_id: productId(),
        competitor_id: competitorId || undefined
      });

      if (Array.isArray(result.errors) && result.errors.length) {
        const useful = result.errors.map(e => e.error || "").filter(Boolean);
        if (useful.length) throw new Error(useful.some(message => /No scraper is configured/i.test(message)) ? "On-demand scanning is not connected. Open Run collector below, choose Run workflow, then refresh this page. Scheduled scans still run twice daily." : useful.join(" · "));
      }

      if (competitorId) {
        try { await cloud.invoke("enrich-competitor-brand", { competitor_id: competitorId }); } catch {}
      } else {
        for (const item of watchlist.filter(w => w.active)) {
          try { await cloud.invoke("enrich-competitor-brand", { competitor_id: item.id }); } catch {}
        }
      }
      await loadResearch();

      if (competitorId && $("brand-filter")) $("brand-filter").value = competitorId;
      if ($("age-filter")) $("age-filter").value = "all";
      renderAds();
      activateTab("ads");

      $("research-status").textContent =
        "Research sample updated: " + Number(result.stored || 0) + " ads saved; " + Number(result.long_running || 0) + " older ads found in this scan. This is not the advertiser’s total.";
    } catch (error) {
      const saved = competitorId ? ads.filter(a => a.competitor_id === competitorId && a.is_active) : ads.filter(a => a.is_active);
      if (saved.length) {
        if (competitorId && $("brand-filter")) $("brand-filter").value = competitorId;
        if ($("age-filter")) $("age-filter").value = "all";
        renderAds();
        activateTab("ads");
        $("research-status").textContent = "Showing " + saved.length + " previously saved ads, not the full advertiser library. Refresh failed: " + (error.message || String(error));
      } else {
        $("research-status").textContent = error.message || String(error);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.oldText || (competitorId ? "Research brand" : "Research all");
      }
    }
  }

  async function analyzeResearch() {
    const btn = $("analyze-ads");
    btn.disabled = true;
    btn.textContent = "Analyzing…";
    try {
      const result = await cloud.invoke("analyze-competitor-ads", { product_id: productId(), limit: 5 });
      if (result.errors?.length) throw new Error("Analyzed " + Number(result.analyzed || 0) + " ads. " + result.errors.map(e => e.error).join(" · "));
      $("research-status").textContent = result.analyzed
        ? "Analyzed " + result.analyzed + " ads. Their hooks and patterns are now saved for the strategist."
        : "No new ads with captured copy to analyze.";
      await loadResearch();
    } catch (error) {
      $("research-status").textContent = error.data?.setup_required
        ? "AI setup required: add OPENAI_API_KEY in Supabase → Edge Functions → Secrets. Use the AI setup link below."
        : (error.message || String(error));
    } finally {
      btn.disabled = false;
      btn.textContent = "Analyze research";
    }
  }

  async function generateIdeas() {
    const p = currentProduct();
    if (!p) return;

    const sources = researchSources(ads);

    if (!sources.length) {
      $("research-status").textContent = "Research at least one tracked brand first.";
      return;
    }

    const btn = $("generate-ideas");
    btn.disabled = true;
    btn.textContent = "Generating…";
    $("research-status").textContent = "Building original concepts from " + sources.length + " source ads…";

    try {
      const result = await cloud.invoke("creative-ai", { task: "ideas", product: p, competitor_ads: sources });
      const parsed = result.result || {};
      const ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
      if (!ideas.length) throw new Error("AI returned no ideas.");

      const available = new Set(sources.map(a => String(a.ad_archive_id)));
      const date = new Date().toISOString().slice(0, 10);
      const rows = ideas.slice(0, 5).map(idea => ({
        user_id: session.user.id,
        product_id: p.id,
        title: idea.title || "",
        hook: idea.hook || "",
        angle: idea.angle || "",
        format: idea.format || "",
        first_frame: idea.first_frame || "",
        execution: idea.idea || idea.execution || "",
        proof_to_show: idea.proof_to_show || "",
        cta: idea.cta || "",
        why_test: idea.why_test || "",
        inspiration: idea.inspiration || "",
        source_ad_ids: Array.isArray(idea.source_ad_ids)
          ? idea.source_ad_ids.map(String).filter(id => available.has(id)).slice(0, 4)
          : [],
        strategy: {
          hooks: idea.hooks || [], primary_text: idea.primary_text || "", headline: idea.headline || "", description: idea.description || "", video_structure: idea.video_structure || "",
          hypothesis: idea.hypothesis || "",
          risk: idea.risk || "",
          scores: idea.scores || {},
          overall_score: Number(idea.overall_score || 0)
        },
        idea_model: result.model || "",
        generated_for_date: date
      }));

      const insert = await db.from("ai_ideas").insert(rows);
      if (insert.error) throw insert.error;
      location.href = "creatives.html?cloud=1";
    } catch (error) {
      $("research-status").textContent = error.data?.setup_required
        ? "AI setup required: add OPENAI_API_KEY in Supabase → Edge Functions → Secrets. Use the AI setup link below."
        : (error.message || String(error));
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate ideas";
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      session = await cloud.requireSession();
      await loadProducts();
      await loadResearch();

      const initialTab = ["brands","ads","insights"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "brands";
      activateTab(initialTab);

      document.querySelectorAll("[data-research-tab]").forEach(btn => {
        btn.onclick = () => activateTab(btn.dataset.researchTab);
      });

      $("research-product").onchange = loadResearch;
      $("competitor-form").onsubmit = addCompetitor;
      $("scan-now").onclick = () => runResearch();
      $("analyze-ads").onclick = analyzeResearch;
      $("generate-ideas").onclick = generateIdeas;
      if ($("load-more-ads")) $("load-more-ads").onclick = () => { visibleLimit += 24; renderAds(); };
      ["brand-filter","media-filter","age-filter","sort-filter"].forEach(id => {
        if ($(id)) $(id).onchange = () => { visibleLimit = 24; renderAds(); };
      });
      if ($("keyword-filter")) $("keyword-filter").oninput = () => { visibleLimit = 24; renderAds(); };
      if ($("clear-filters")) $("clear-filters").onclick = () => {
        $("brand-filter").value = "all";
        $("media-filter").value = "all";
        $("age-filter").value = "all";
        $("keyword-filter").value = "";
        $("sort-filter").value = "newest";
        visibleLimit = 24;
        renderAds();
      };

      $("watchlist-list").onchange = async event => {
        const activeId = event.target.getAttribute("data-watch-active");
        const daysId = event.target.getAttribute("data-watch-days");

        if (activeId) {
          const r = await db.from("competitor_watchlist").update({
            active: event.target.checked,
            updated_at: new Date().toISOString()
          }).eq("id", activeId);
          if (r.error) alert(r.error.message); else await loadResearch();
        }

        if (daysId) {
          const days = Math.max(1, Number(event.target.value || 30));
          const r = await db.from("competitor_watchlist").update({
            min_days_running: days,
            updated_at: new Date().toISOString()
          }).eq("id", daysId);
          if (r.error) alert(r.error.message); else await loadResearch();
        }
      };

      $("watchlist-list").onclick = async event => {
        const selectCandidate = event.target.closest("[data-select-candidate]");
        if (selectCandidate) {
          const brand = watchlist.find(w => w.id === selectCandidate.dataset.selectCandidate);
          const candidates = Array.isArray(brand?.brand_data?.advertiser_candidates) ? brand.brand_data.advertiser_candidates : [];
          const candidate = candidates[Number(selectCandidate.dataset.candidateIndex)];
          if (!brand || !candidate) return;
          selectCandidate.disabled = true;
          try {
            const pageId = String(candidate.meta_page_id || "");
            const adLibraryUrl = pageId ? parseMetaLink("https://www.facebook.com/profile.php?id=" + encodeURIComponent(pageId)).url : "";
            const data = {...(brand.brand_data || {}),selected_advertiser_name:candidate.advertiser_name || "",advertiser_resolution_evidence:"user_selection",advertiser_resolved_at:new Date().toISOString()};
            const patch = {
              meta_page_id:pageId,
              ad_library_url:adLibraryUrl,
              facebook_page_url:candidate.facebook_page_url || brand.facebook_page_url || "",
              logo_url:brand.logo_url || candidate.logo_url || "",
              resolution_status:pageId ? "user_selected" : "user_selected_name",
              brand_data:data,
              updated_at:new Date().toISOString()
            };
            const result = await db.from("competitor_watchlist").update(patch).eq("id",brand.id);
            if (result.error) throw result.error;
            $("research-status").textContent = "Advertiser selected. The next collector scan will use this choice instead of guessing from the brand name.";
            await loadResearch();
          } catch(error) {
            $("research-status").textContent = error.message || String(error);
          } finally {
            selectCandidate.disabled = false;
          }
          return;
        }

        const save = event.target.closest("[data-save-brand]");
        if (save) {
          const card = save.closest("[data-brand-card]");
          try {
            const ref = parseFacebookReference(card.querySelector("[data-brand-link]").value);
            const name = card.querySelector("[data-brand-name]").value.trim();
            if (!name) throw new Error("Enter a brand name.");
            const website = normalizeStoreUrl(card.querySelector("[data-brand-website]").value);
            const logo = card.querySelector("[data-brand-logo]").value.trim();
            if (logo && !safeUrl(logo)) throw new Error("Logo must be an http or https URL.");
            const current = watchlist.find(w => w.id === save.dataset.saveBrand) || {};
            const data = current.brand_data && typeof current.brand_data === "object" ? current.brand_data : {};
            save.disabled = true;
            const keepExistingMeta = !card.querySelector("[data-brand-link]").value.trim();
            const resolution = ref.adId ? "user_configured_ad" : ref.pageId ? "user_configured" : ref.pageUrl ? "user_page_link_unresolved" : current.resolution_status;
            const result = await db.from("competitor_watchlist").update({
              competitor_name:name.slice(0,120),
              ad_library_url:keepExistingMeta ? (current.ad_library_url || "") : ref.adLibraryUrl,
              meta_page_id:keepExistingMeta ? (current.meta_page_id || "") : ref.pageId,
              facebook_page_url:keepExistingMeta ? (current.facebook_page_url || "") : (ref.pageUrl || current.facebook_page_url || ""),
              website_url:website,
              logo_url:logo,
              resolution_status:resolution,
              brand_data:{...data,manual_name_override:true,manual_logo_override:Boolean(logo)},
              updated_at:new Date().toISOString()
            }).eq("id",save.dataset.saveBrand);
            if (result.error) throw result.error;
            try { await cloud.invoke("enrich-competitor-brand", { competitor_id:save.dataset.saveBrand, site:website }); } catch {}
            $("research-status").textContent = ref.pageId || ref.adId ? "Brand settings saved with a Facebook source." : "Brand settings saved. Facebook remains unresolved until a trustworthy match is found or selected.";
            await loadResearch();
          } catch(error) { $("research-status").textContent = error.message; }
          finally { save.disabled = false; }
          return;
        }
        const research = event.target.closest("[data-research-brand]");
        if (research) {
          await runResearch(research.getAttribute("data-research-brand"));
          return;
        }

        const view = event.target.closest("[data-view-brand]");
        if (view) {
          if ($("brand-filter")) $("brand-filter").value = view.getAttribute("data-view-brand");
          if ($("age-filter")) $("age-filter").value = "all";
          renderAds();
          activateTab("ads");
          return;
        }

        const del = event.target.closest("[data-watch-delete]");
        if (del) {
          const id = del.getAttribute("data-watch-delete");
          if (!confirm("Remove this brand from the watchlist?")) return;
          const r = await db.from("competitor_watchlist").delete().eq("id", id);
          if (r.error) alert(r.error.message); else await loadResearch();
        }
      };

      $("research-ads").onclick = async event => {
        const expand = event.target.closest("[data-expand-ad]");
        if (expand) { toggleCopy(expand.getAttribute("data-expand-ad")); return; }
        const id = event.target.getAttribute("data-copy-text");
        if (!id) return;
        const ad = ads.find(a => a.id === id);
        if (!ad) return;
        try { await navigator.clipboard.writeText(ad.primary_text || ""); event.target.textContent = "Copied"; }
        catch { $("research-status").textContent = "Copy failed. Expand the text and select it to copy."; }
      };
    } catch (error) {
      console.error(error);
      if ($("research-status")) $("research-status").textContent = error.message || String(error);
    }
  });
})();