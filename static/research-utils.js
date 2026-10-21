/* Shared research input validation and source selection. */
(function(root) {
  "use strict";

  const FACEBOOK_HOSTS = ["facebook.com","www.facebook.com","m.facebook.com","business.facebook.com"];
  const numeric = value => /^\d{5,30}$/.test(String(value || "")) ? String(value) : "";

  function normalizeStoreUrl(input) {
    const value = String(input || "").trim();
    if (!value) throw new Error("Paste the competitor store URL.");
    let url;
    try { url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value); }
    catch { throw new Error("Paste a valid store URL, such as https://resilia.shop."); }
    if (url.protocol !== "https:") throw new Error("Use the store's https URL.");
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local")) throw new Error("Use a public store URL.");
    url.hash = "";
    url.search = "";
    url.pathname = "/";
    return url.href;
  }

  function parseMetaLink(input) {
    const value = String(input || "").trim();
    if (!value) return {url:"",pageId:"",adId:""};
    let url;
    try { url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value); }
    catch { throw new Error("Paste a valid Facebook Ad Library link."); }
    if (url.protocol !== "https:" || !FACEBOOK_HOSTS.includes(url.hostname.toLowerCase())) throw new Error("Use an https Facebook Ad Library link.");
    const library = /^\/ads\/library\/?$/.test(url.pathname);
    const pageId = numeric(url.searchParams.get("view_all_page_id")) || (!library ? numeric(url.searchParams.get("id")) || numeric(url.pathname.split("/").filter(Boolean).pop()) : "");
    const adId = library ? numeric(url.searchParams.get("id")) : "";
    if (!library && !pageId) throw new Error("Open this brand in Meta Ad Library and copy its link. A page name link alone does not identify its advertiser ID.");
    if (!pageId && !adId && !url.searchParams.get("q")) throw new Error("This library link has no advertiser, ad ID, or search. Copy a brand's Ad Library link.");
    const canonical = new URL("https://www.facebook.com/ads/library/");
    if (pageId) {canonical.searchParams.set("view_all_page_id",pageId);canonical.searchParams.set("search_type","page");}
    else if(adId) canonical.searchParams.set("id",adId);
    else {canonical.searchParams.set("q",url.searchParams.get("q"));canonical.searchParams.set("search_type","keyword_unordered");}
    if(!adId) {canonical.searchParams.set("active_status","active");canonical.searchParams.set("ad_type","all");canonical.searchParams.set("country","US");}
    return {url:canonical.href,pageId,adId};
  }

  function parseFacebookReference(input) {
    const value = String(input || "").trim();
    if (!value) return {pageUrl:"",pageId:"",adLibraryUrl:"",adId:""};
    let url;
    try { url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value); }
    catch { throw new Error("Paste a valid Facebook page or Ad Library link."); }
    if (url.protocol !== "https:" || !FACEBOOK_HOSTS.includes(url.hostname.toLowerCase())) throw new Error("Use an https Facebook page or Ad Library link.");

    if (/^\/ads\/library\/?$/.test(url.pathname)) {
      const meta = parseMetaLink(url.href);
      return {pageUrl:"",pageId:meta.pageId,adLibraryUrl:meta.url,adId:meta.adId};
    }

    const pageId = numeric(url.searchParams.get("id")) || numeric(url.pathname.split("/").filter(Boolean).pop());
    const clean = new URL(url.href);
    clean.protocol = "https:";
    clean.hostname = "www.facebook.com";
    clean.hash = "";
    if (/^\/profile\.php$/i.test(clean.pathname) && pageId) {
      clean.search = "";
      clean.searchParams.set("id", pageId);
    } else {
      clean.search = "";
    }
    const adLibraryUrl = pageId ? parseMetaLink(clean.href).url : "";
    return {pageUrl:clean.href,pageId,adLibraryUrl,adId:""};
  }

  function isMetaGroupSummaryText(value) {
    return /^\s*\d+\s+ads?\s+use\s+this\s+creative\s+and\s+text\s*$/i.test(String(value || ""));
  }

  function researchSourceScore(ad) {
    const analysis = ad?.ai_analysis || {};
    const transcript = String(ad?.video_transcript || "").trim();
    const visual = Boolean(analysis.visual_analysis_available);
    const analyzed = Boolean(ad?.analyzed_at);
    const researchScore = Math.max(0, Math.min(100, Number(analysis.research_score || 0)));
    const days = Math.max(0, Math.min(180, Number(ad?.days_running || 0)));
    const primary = isMetaGroupSummaryText(ad?.primary_text) ? "" : String(ad?.primary_text || "");
    const hasCopy = Boolean(String(primary || ad?.headline || "").trim());
    return (transcript ? 1000 : 0) + (visual ? 500 : 0) + (analyzed ? 250 : 0) + researchScore * 3 + days + (hasCopy ? 25 : 0);
  }

  function researchSources(rows, limit=30) {
    return rows.filter(a => {
      if (!a?.is_active) return false;
      const primary = isMetaGroupSummaryText(a.primary_text) ? "" : String(a.primary_text || "");
      return Boolean(a.video_transcript || primary || a.headline || a.media_url || a.media_thumbnail_url);
    })
      .sort((a,b) => researchSourceScore(b) - researchSourceScore(a) || Number(b.days_running || 0) - Number(a.days_running || 0))
      .slice(0,limit);
  }

  root.AVONENT_RESEARCH_UTILS = {normalizeStoreUrl,parseMetaLink,parseFacebookReference,researchSources,isMetaGroupSummaryText};
})(typeof window === "undefined" ? globalThis : window);
