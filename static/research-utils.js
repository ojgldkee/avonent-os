/* Shared public Meta Ad Library input validation. */
(function(root) {
  "use strict";
  function parseMetaLink(input) {
    const value = String(input || "").trim();
    if (!value) return {url:"",pageId:"",adId:""};
    let url;
    try { url = new URL(/^https?:\/\//i.test(value) ? value : "https://" + value); }
    catch { throw new Error("Paste a valid Facebook Ad Library link."); }
    if (url.protocol !== "https:" || !["facebook.com","www.facebook.com","m.facebook.com","business.facebook.com"].includes(url.hostname.toLowerCase())) throw new Error("Use an https Facebook Ad Library link.");
    const numeric = value => /^\d{5,30}$/.test(value || "") ? value : "";
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
  function researchSources(rows, limit=30) {
    return rows.filter(a => a.is_active && (a.primary_text || a.headline))
      .sort((a,b) => Number(Boolean(b.analyzed_at))-Number(Boolean(a.analyzed_at)) || String(a.started_at || "9999").localeCompare(String(b.started_at || "9999")))
      .slice(0,limit);
  }
  root.AVONENT_RESEARCH_UTILS = {parseMetaLink,researchSources};
})(typeof window === "undefined" ? globalThis : window);
