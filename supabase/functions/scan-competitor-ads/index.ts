import { createClient } from "npm:@supabase/supabase-js@2";

function j(data:any,status=200){
  return new Response(JSON.stringify(data),{status,headers:{
    "content-type":"application/json",
    "access-control-allow-origin":"*",
    "access-control-allow-headers":"authorization, content-type, x-avonent-cron-secret",
    "access-control-allow-methods":"POST, OPTIONS"
  }});
}
function s(v:any){return v==null?"":String(v)}
function normalize(row:any){
  const start=row.started_at ? new Date(row.started_at) : null;
  const days = Number(row.days_running || (start && !Number.isNaN(start.getTime()) ? Math.max(0,Math.floor((Date.now()-start.getTime())/86400000)) : 0));
  return {
    ad_archive_id:s(row.ad_archive_id || row.id),
    advertiser_name:s(row.advertiser_name),
    advertiser_page_id:s(row.advertiser_page_id || row.page_id),
    advertiser_page_url:s(row.advertiser_page_url || row.page_url),
    source_url:s(row.source_url || (row.ad_archive_id ? "https://www.facebook.com/ads/library/?id="+encodeURIComponent(s(row.ad_archive_id)) : "")),
    primary_text:s(row.primary_text),
    headline:s(row.headline),
    description:s(row.description),
    cta_text:s(row.cta_text),
    landing_url:s(row.landing_url),
    display_format:s(row.display_format),
    media_url:s(row.media_url),
    media_thumbnail_url:s(row.media_thumbnail_url),
    advertiser_logo_url:s(row.advertiser_logo_url),
    media_kind:s(row.media_kind),
    platforms:Array.isArray(row.platforms)?row.platforms:[],
    started_at:row.started_at || null,
    ended_at:row.ended_at || null,
    days_running:days,
    is_active:Boolean(row.is_active),
    raw:row
  };
}
async function selfHosted(w:any){
  const base=(Deno.env.get("META_SCRAPER_URL")||"").replace(/\/$/,"");
  const key=Deno.env.get("META_SCRAPER_KEY")||"";
  if(!base||!key) return null;
  const body:any={query:w.competitor_name,country:"US",active_status:"active",max_ads:500};
  if(w.meta_page_id) body.page_id=w.meta_page_id;
  if(w.ad_library_url) body.url=w.ad_library_url;
  const r=await fetch(base+"/v1/meta/search",{method:"POST",headers:{"authorization":"Bearer "+key,"content-type":"application/json"},body:JSON.stringify(body)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data?.error || ("Self-hosted scraper failed: "+r.status));
  return Array.isArray(data?.ads)?data.ads:[];
}
async function apifyFallback(w:any){
  const token=Deno.env.get("APIFY_TOKEN")||"";
  if(!token) return null;
  const actor=Deno.env.get("APIFY_ACTOR")||"calm_builder~facebook-ads-library-scraper";
  let searchUrl=s(w.ad_library_url).trim();
  if(!searchUrl){
    searchUrl="https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&search_type=keyword_unordered&q="+encodeURIComponent(s(w.competitor_name));
  }
  const api="https://api.apify.com/v2/acts/"+actor+"/run-sync-get-dataset-items?token="+encodeURIComponent(token);
  const r=await fetch(api,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({startUrls:[{url:searchUrl}],maxAds:500})});
  const raw=await r.text();
  if(!r.ok) throw new Error("Apify "+r.status+": "+raw.slice(0,300));
  const x=JSON.parse(raw);
  return Array.isArray(x)?x:[];
}
async function authenticate(req:Request, admin:any){
  const cronSecret=Deno.env.get("AVONENT_CRON_SECRET")||"";
  const sentCron=req.headers.get("x-avonent-cron-secret")||"";
  if(cronSecret && sentCron && sentCron===cronSecret) return {mode:"cron",userId:null};
  const auth=req.headers.get("authorization")||"";
  const token=auth.replace(/^Bearer\s+/i,"").trim();
  if(!token) return null;
  const user=await admin.auth.getUser(token);
  if(user.error||!user.data.user) return null;
  return {mode:"user",userId:user.data.user.id};
}
function normalizeAdvertiser(value:any){
  return s(value).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function externalWebsite(value:any){
  try{
    let u=new URL(s(value));
    if(["l.facebook.com","lm.facebook.com"].includes(u.hostname.toLowerCase())&&u.searchParams.get("u"))u=new URL(u.searchParams.get("u")!);
    const h=u.hostname.replace(/^www\./,"").toLowerCase();
    if(u.protocol!=="https:"||["facebook.com","fb.com","instagram.com"].some(d=>h===d||h.endsWith("."+d)))return "";
    return u.origin+"/";
  }catch{return ""}
}
function host(value:any){
  try{return new URL(s(value)).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""}
}
function sameStore(a:any,b:any){
  const ah=host(a),bh=host(b);
  return Boolean(ah&&bh&&(ah===bh||ah.endsWith("."+bh)||bh.endsWith("."+ah)));
}
function facebookKey(value:any){
  try{
    const u=new URL(s(value));
    return u.pathname.replace(/\/+$/,"").toLowerCase()+(u.pathname.toLowerCase()==="/profile.php"?"?id="+(u.searchParams.get("id")||""):"");
  }catch{return ""}
}
function candidates(rows:any[],w:any){
  const groups=new Map();
  for(const ad of rows){
    const name=s(ad.advertiser_name).trim();
    if(!name)continue;
    const pageId=s(ad.advertiser_page_id).trim();
    const pageUrl=s(ad.advertiser_page_url).trim();
    const key=pageId||normalizeAdvertiser(name);
    if(!key)continue;
    if(!groups.has(key))groups.set(key,{advertiser_name:name,meta_page_id:pageId,facebook_page_url:pageUrl,logo_url:s(ad.advertiser_logo_url),ad_count:0,landing_domains:new Set(),website_match:false,facebook_match:false});
    const item=groups.get(key);
    item.ad_count++;
    const landing=externalWebsite(ad.landing_url);
    const h=host(landing);
    if(h)item.landing_domains.add(h);
    if(landing&&w.website_url&&sameStore(landing,w.website_url))item.website_match=true;
    if(pageUrl&&w.facebook_page_url&&facebookKey(pageUrl)===facebookKey(w.facebook_page_url))item.facebook_match=true;
    if(!item.logo_url&&ad.advertiser_logo_url)item.logo_url=s(ad.advertiser_logo_url);
    if(!item.meta_page_id&&pageId)item.meta_page_id=pageId;
    if(!item.facebook_page_url&&pageUrl)item.facebook_page_url=pageUrl;
  }
  return [...groups.values()].map((x:any)=>({...x,landing_domains:[...x.landing_domains].slice(0,6)}))
    .sort((a:any,b:any)=>Number(b.website_match)-Number(a.website_match)||Number(b.facebook_match)-Number(a.facebook_match)||b.ad_count-a.ad_count);
}
function matches(ad:any,candidate:any){
  if(candidate.meta_page_id&&s(ad.advertiser_page_id)===s(candidate.meta_page_id))return true;
  return normalizeAdvertiser(ad.advertiser_name)===normalizeAdvertiser(candidate.advertiser_name);
}
function adLibraryFor(pageId:any){
  if(!/^\d{5,30}$/.test(s(pageId)))return "";
  return "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id="+encodeURIComponent(s(pageId))+"&search_type=page";
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return j({ok:true});
  if(req.method!=="POST")return j({error:"POST required"},405);

  const url=Deno.env.get("SUPABASE_URL")||"";
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!service)return j({error:"Supabase server configuration missing"},500);

  const admin=createClient(url,service,{auth:{persistSession:false}});
  const auth=await authenticate(req,admin);
  if(!auth)return j({error:"Unauthorized"},401);
  const body=await req.json().catch(()=>({}));

  const run=await admin.from("automation_runs").insert({
    user_id:auth.userId,
    run_type:"competitor_scan",
    status:"running",
    details:{trigger:auth.mode}
  }).select("id").single();
  const runId=run.data?.id||null;

  let watchQuery=admin.from("competitor_watchlist").select("*, products(name, brand_name)").eq("active",true);
  if(auth.userId) watchQuery=watchQuery.eq("user_id",auth.userId);
  if(body?.product_id) watchQuery=watchQuery.eq("product_id",String(body.product_id));
  if(body?.competitor_id) watchQuery=watchQuery.eq("id",String(body.competitor_id));
  const watchResult=await watchQuery;
  if(watchResult.error)return j({error:watchResult.error.message},500);
  const watch=watchResult.data||[];

  let scanned=0,stored=0,longRunning=0;
  const errors:any[]=[];
  const sources:any[]=[];

  for(const w of watch){
    try{
      let rows:any[]|null=null;
      let source="self-hosted";
      try{ rows=await selfHosted(w); }
      catch(e){ errors.push({competitor:w.competitor_name,source:"self-hosted",error:e instanceof Error?e.message:String(e)}); }

      if(rows===null){
        source="apify";
        try{ rows=await apifyFallback(w); }
        catch(e){ errors.push({competitor:w.competitor_name,source:"apify",error:e instanceof Error?e.message:String(e)}); }
      }
      if(rows===null) throw new Error("No scraper is configured. Deploy the self-hosted scraper and set META_SCRAPER_URL + META_SCRAPER_KEY.");

      let validRows=rows.map(normalize).filter((a:any)=>a.ad_archive_id && a.source_url.includes("facebook.com/ads/library/"));
      sources.push({competitor:w.competitor_name,source,count:validRows.length});

      if(!w.meta_page_id&&!w.ad_library_url){
        const data=w.brand_data&&typeof w.brand_data==="object"?w.brand_data:{};
        const selectedName=s(data.selected_advertiser_name).trim();

        if(selectedName){
          validRows=validRows.filter((a:any)=>normalizeAdvertiser(a.advertiser_name)===normalizeAdvertiser(selectedName));
          if(!validRows.length){
            await admin.from("competitor_watchlist").update({
              resolution_status:"unresolved",
              last_scanned_at:new Date().toISOString(),
              last_scan_status:"completed",
              last_scan_message:"The selected advertiser was not found in this sample. Review advertiser candidates.",
              last_scan_complete:false,
              updated_at:new Date().toISOString()
            }).eq("id",w.id);
            continue;
          }
        }else{
          const found=candidates(validRows,w);
          const strong=found.filter((x:any)=>x.website_match||x.facebook_match);
          if(strong.length===1){
            const chosen=strong[0];
            const nextData={...data,advertiser_candidates:found,selected_advertiser_name:chosen.advertiser_name,advertiser_resolution_evidence:chosen.website_match?"landing_domain_matches_store":"facebook_page_matches_store_link",advertiser_resolved_at:new Date().toISOString()};
            const patch:any={
              competitor_name:chosen.advertiser_name||w.competitor_name,
              logo_url:chosen.logo_url||w.logo_url||"",
              facebook_page_url:chosen.facebook_page_url||w.facebook_page_url||"",
              resolution_status:chosen.meta_page_id?"verified_website_match":"verified_store_social_match",
              brand_data:nextData,
              updated_at:new Date().toISOString()
            };
            if(chosen.meta_page_id){
              patch.meta_page_id=chosen.meta_page_id;
              patch.ad_library_url=adLibraryFor(chosen.meta_page_id);
            }
            await admin.from("competitor_watchlist").update(patch).eq("id",w.id);
            Object.assign(w,patch);
            validRows=validRows.filter((a:any)=>matches(a,chosen));
          }else{
            await admin.from("competitor_watchlist").update({
              resolution_status:found.length?"ambiguous":"unresolved",
              brand_data:{...data,advertiser_candidates:found,advertiser_candidates_updated_at:new Date().toISOString()},
              last_scanned_at:new Date().toISOString(),
              last_scan_status:"completed",
              last_scan_message:found.length?"Advertiser match needs confirmation before ads are imported.":"No trustworthy Facebook advertiser match was found in this sample.",
              last_scan_ads:0,
              last_scan_long_running:0,
              last_scan_complete:false,
              updated_at:new Date().toISOString()
            }).eq("id",w.id);
            continue;
          }
        }
      }

      for(const ad of validRows){
        scanned++;
        const qualifies=ad.is_active && ad.days_running>=Number(w.min_days_running||30);
        const existing=await admin.from("competitor_ads").select("id,product_id,competitor_id").eq("user_id",w.user_id).eq("ad_archive_id",ad.ad_archive_id).maybeSingle();
        if(existing.error)throw new Error(existing.error.message);
        if(existing.data&&(existing.data.product_id!==w.product_id||existing.data.competitor_id!==w.id)){
          throw new Error("Ad already belongs to another product/brand; shared-ad schema migration required.");
        }
        const payload={
          user_id:w.user_id,product_id:w.product_id,competitor_id:w.id,
          ...ad,qualifies_long_running:qualifies,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()
        };
        const up=await admin.from("competitor_ads").upsert(payload,{onConflict:"user_id,ad_archive_id"});
        if(up.error)throw new Error(up.error.message);
        stored++;
        if(qualifies)longRunning++;
      }

      const logo=validRows.map((a:any)=>a.advertiser_logo_url).find(Boolean)||"";
      const update:any={
        last_scanned_at:new Date().toISOString(),
        last_scan_status:"completed",
        last_scan_message:validRows.length?"Collected public ads; some fields may be unavailable.":"No ads captured. This does not mean the brand has no ads.",
        last_scan_ads:validRows.length,
        last_scan_long_running:validRows.filter((a:any)=>a.is_active && a.days_running>=Number(w.min_days_running||30)).length,
        last_scan_complete:false,
        updated_at:new Date().toISOString()
      };
      if(logo) update.logo_url=logo;
      await admin.from("competitor_watchlist").update(update).eq("id",w.id);
    }catch(e){
      const message=e instanceof Error?e.message:String(e);
      errors.push({competitor:w.competitor_name,error:message});
      await admin.from("competitor_watchlist").update({last_scan_status:"error",last_scan_message:message.slice(0,500),updated_at:new Date().toISOString()}).eq("id",w.id);
    }
  }

  if(runId)await admin.from("automation_runs").update({
    status:errors.length?"completed_with_errors":"completed",
    finished_at:new Date().toISOString(),
    details:{watchlist_count:watch.length,scanned,stored,long_running:longRunning,sources,errors}
  }).eq("id",runId);

  const configured=Boolean(Deno.env.get("META_SCRAPER_URL")&&Deno.env.get("META_SCRAPER_KEY"))||Boolean(Deno.env.get("APIFY_TOKEN"));
  return j({ok:true,collector_configured:configured,watchlist_count:watch.length,scanned,stored,long_running:longRunning,sources,errors});
});