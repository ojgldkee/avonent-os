import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const root = new URL("../../../", import.meta.url);
const server = readFileSync(new URL("services/meta-scraper/src/server.js", root), "utf8");
const frontend = readFileSync(new URL("static/research-v2.js", root), "utf8");
const parser = new Function(server.slice(server.indexOf("function parseDate"), server.indexOf("async function extractVisibleCards")) + ";return {parseDate,daysRunning,primaryCopy,publicImpressions,normalizeCard};")();
const age = new Function(frontend.slice(frontend.indexOf("  function adAge"), frontend.indexOf("  function niceDate")) + ";return {adAge,qualifies};")();
test("dates preserve month, validate calendar and support day first", () => {
  for (const input of ["Oct 13, 2026","13 October 2026","2026-10-13"]) assert.equal(parser.parseDate(input).toISOString().slice(0,10),"2026-10-13");
  assert.equal(parser.parseDate("Feb 30, 2026"),null);
  assert.equal(parser.daysRunning(null),null);
});
test("age is current, nullable, and stops for ended ads", () => {
  assert.equal(age.adAge({started_at:"2026-10-06",is_active:true},Date.parse("2026-10-20")),14);
  assert.equal(age.adAge({started_at:"2026-10-01",ended_at:"2026-10-08",is_active:false}),7);
  assert.equal(age.adAge({started_at:"2026-10-01",is_active:false}),null);
  assert.equal(age.qualifies({is_active:true,days_running:999}),false);
});
test("visible copy retains paragraphs without video controls or landing headline", () => {
  const copy = "First paragraph\n\n💧 Second paragraph";
  assert.equal(parser.primaryCopy("Brand\nSponsored\n"+copy+"\n0:00 / 5:45\nSHOP.COM\nShop now"),copy);
});
test("impressions require a labeled range outside primary text", () => {
  assert.equal(parser.publicImpressions("Impressions\n1,000 – 5,000\nBrand\nSponsored\nCopy").impressions_max,5000);
  assert.equal(parser.publicImpressions("Brand\nSponsored\nImpressions: 1000 – 5000").impressions_min,null);
});
test("accordion changes text only and collapses previous card", () => {
  const ads = [{id:"a",primary_text:"A".repeat(250)},{id:"b",primary_text:"B".repeat(250)}];
  const paragraphs = new Map(ads.map(ad => ["copy-"+ad.id,{textContent:""}]));
  const buttons = ads.map(ad => ({
    dataset:{expandAd:ad.id}, attributes:{"aria-controls":"copy-"+ad.id},
    getAttribute(key){return this.attributes[key]}, setAttribute(key,value){this.attributes[key]=value}
  }));
  const document = {querySelectorAll:() => buttons,getElementById:id => paragraphs.get(id)};
  const toggle = new Function("ads","document","let expandedAdId=null;" + frontend.slice(frontend.indexOf("  function copyExcerpt"),frontend.indexOf("  function impressionLabel")) + "; return toggleCopy;")(ads,document);
  toggle("a"); assert.equal(buttons[0].attributes["aria-expanded"],"true");
  toggle("b"); assert.equal(buttons[0].attributes["aria-expanded"],"false");
  assert.equal(buttons[1].attributes["aria-expanded"],"true");
  assert.equal(paragraphs.get("copy-b").textContent,ads[1].primary_text);
  toggle("b"); assert.equal(buttons[1].attributes["aria-expanded"],"false");
});

const utilities = readFileSync(new URL("static/research-utils.js", root), "utf8");
new Function(utilities)();
test("Meta links distinguish advertiser from individual ad and reject other hosts", () => {
  const parse = globalThis.AVONENT_RESEARCH_UTILS.parseMetaLink;
  assert.equal(parse("https://www.facebook.com/ads/library/?id=1620540869854919").adId,"1620540869854919");
  assert.equal(parse("https://www.facebook.com/ads/library/?view_all_page_id=12345678").pageId,"12345678");
  assert.equal(parse("https://www.facebook.com/profile.php?id=12345678").pageId,"12345678");
  assert.throws(() => parse("https://facebook.com.evil.example/ads/library/?id=123456"));
  assert.throws(() => parse("https://example.com"));
  assert.throws(() => parse("javascript:alert(1)"));
  assert.throws(() => parse("https://www.facebook.com/ads/library/"));
});
test("research generation accepts younger ads with copy", () => {
  const rows = [{id:"new",is_active:true,primary_text:"Real copy",started_at:"2026-10-20",qualifies_long_running:false},{id:"empty",is_active:true},{id:"inactive",is_active:false,primary_text:"Old"}];
  assert.equal(globalThis.AVONENT_RESEARCH_UTILS.researchSources(rows).length,1);
  assert.equal(globalThis.AVONENT_RESEARCH_UTILS.researchSources(rows)[0].id,"new");
});

test("store URLs are canonicalized and Facebook page links can remain unresolved", () => {
  const utils = globalThis.AVONENT_RESEARCH_UTILS;
  assert.equal(utils.normalizeStoreUrl("resilia.shop/products/test"), "https://resilia.shop/");
  const page = utils.parseFacebookReference("https://www.facebook.com/resiliahealth/");
  assert.equal(page.pageUrl, "https://www.facebook.com/resiliahealth/");
  assert.equal(page.pageId, "");
  assert.equal(page.adLibraryUrl, "");
  const numeric = utils.parseFacebookReference("https://www.facebook.com/profile.php?id=12345678");
  assert.equal(numeric.pageId, "12345678");
  assert.match(numeric.adLibraryUrl, /view_all_page_id=12345678/);
});

test("a poster without captured image/video remains unknown media", () => {
  const ad = parser.normalizeCard({
    ad_archive_id:"123456789",
    text:"Active\nLibrary ID: 123456789\nStarted running on Oct 20, 2026\nBrand\nSponsored\nThis is enough primary copy to parse.",
    links:[], link_meta:[], images:[], videos:[], posters:["https://example.com/poster.jpg"], image_meta:[]
  });
  assert.equal(ad.media_url, "https://example.com/poster.jpg");
  assert.equal(ad.media_thumbnail_url, "https://example.com/poster.jpg");
  assert.equal(ad.media_kind, "");
});

test("frontend exposes combined media, age, keyword and sort filtering", () => {
  assert.match(frontend, /media-filter/);
  assert.match(frontend, /age-filter/);
  assert.match(frontend, /keyword-filter/);
  assert.match(frontend, /sort-filter/);
  assert.match(frontend, /function mediaKind/);
  assert.doesNotMatch(frontend, /\$\("ad-filter"\)/);
});


test("prepared strategist requires source evidence and complete production fields", () => {
  const creativeAi = readFileSync(new URL("supabase/functions/creative-ai/index.ts", root), "utf8");
  const ideasUi = readFileSync(new URL("static/cloud-ideas-v1.js", root), "utf8");
  for (const field of ["audience","first_three_seconds","video_concept","shot_directions","timed_script","source_adaptation","hook_adaptation","story_arc","visual_recipe","source_observations","source_claims","footage_type","provider"]) {
    assert.match(creativeAi, new RegExp(field));
    assert.match(ideasUi, new RegExp(field));
  }
  assert.match(creativeAi, /four usable hooks/);
  assert.match(creativeAi, /production script is incomplete/);
  assert.match(creativeAi, /primary_source_ad_id/);
  assert.match(ideasUi, /"SAY: " \+ \(b\.say \|\| ""\)/);
  assert.match(ideasUi, /"SHOW: " \+ \(b\.show \|\| ""\)/);
  assert.match(ideasUi, /"FOOTAGE: " \+ \(b\.footage_type \|\| ""\)/);
});

test("competitor analysis only reports transcript and visuals when evidence exists", () => {
  const analysisFn = readFileSync(new URL("supabase/functions/analyze-competitor-ads/index.ts", root), "utf8");
  assert.match(analysisFn, /exactSpokenOpening/);
  assert.match(analysisFn, /transcript_available/);
  assert.match(analysisFn, /visual_analysis_available/);
  assert.match(analysisFn, /analysis_scope:visual\?"video_transcript_visual":hasTranscript\?"transcript_and_copy":"copy_only"/);
  assert.match(analysisFn, /analysis\.visual_hook=""/);
  assert.match(analysisFn, /analysis\.first_frame=""/);
});


test("research buttons use the built-in queue instead of the unconfigured on-demand scraper", () => {
  const workflow = readFileSync(new URL(".github/workflows/competitor-research.yml", root), "utf8");
  const runner = readFileSync(new URL("services/meta-scraper/src/github-runner.js", root), "utf8");
  assert.doesNotMatch(frontend, /cloud\.invoke\("scan-competitor-ads"/);
  assert.match(frontend, /scan_request_status:\s*"queued"/);
  assert.match(workflow, /cron:\s*"\*\/10 \* \* \* \*"/);
  assert.match(runner, /scan_request_status \|\| ""\) === "queued"/);
  assert.match(runner, /12 \* 60 \* 60 \* 1000/);
});

test("ad cards expose sample-relative research ratings without claiming profitability", () => {
  assert.match(frontend, /function adResearchScore/);
  assert.match(frontend, /function adRank/);
  assert.match(frontend, /Research score · not profitability/);
  assert.match(frontend, /Sample rank #/);
  assert.match(frontend, /creative repeated/);
});

test("primary copy expansion uses a footer control instead of overlaying text", () => {
  assert.match(frontend, /source-copy-body/);
  assert.match(frontend, /source-copy-footer/);
  const strategistCss = readFileSync(new URL("static/strategist.css", root), "utf8");
  assert.match(strategistCss, /source-copy-footer \[data-expand-ad\]\{position:static!important/);
  assert.match(strategistCss, /source-copy \.source-copy-body>p\{max-height:none!important;overflow:visible!important/);
});

test("ideas have concepts and combined hooks plus scripts workspaces", () => {
  const ideasHtml = readFileSync(new URL("creatives.html", root), "utf8");
  const ideasUi = readFileSync(new URL("static/cloud-ideas-v1.js", root), "utf8");
  for (const mode of ["concepts","hooks"]) assert.match(ideasHtml, new RegExp('data-ideas-workspace="'+mode+'"'));
  assert.doesNotMatch(ideasHtml, /data-ideas-workspace="scripts"/);
  assert.match(ideasHtml, /Hooks \+ scripts/);
  assert.match(ideasUi, /renderHooksWorkspace/);
  assert.match(ideasUi, /data-copy-library-hook/);
  assert.match(ideasUi, /Generate production script/);
});


test("ad library supports highest-score sorting and transparent score breakdown", () => {
  const adsHtml = readFileSync(new URL("ads.html", root), "utf8");
  const strategistCss = readFileSync(new URL("static/strategist.css", root), "utf8");
  assert.match(adsHtml, /option value="score">Highest research score/);
  assert.match(frontend, /function adScoreBreakdown/);
  assert.match(frontend, /Why ' \+ researchScore \+ '\/100\?/);
  assert.match(strategistCss, /\.score-breakdown/);
});
