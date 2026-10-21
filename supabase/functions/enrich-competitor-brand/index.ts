import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods":"POST, OPTIONS",
  "content-type":"application/json"
};
const out=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:CORS});
const decode=(s:string)=>String(s||"").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&#039;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
const textOnly=(s:string)=>decode(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());
const abs=(value:string,base:string)=>{try{return new URL(value,base).toString()}catch{return ""}};
const numeric=(value:any)=>/^\d{5,30}$/.test(String(value||""))?String(value):"";

function safeWebsite(raw:string){
  const u=new URL(/^https?:\/\//i.test(raw)?raw:"https://"+raw);
  if(u.protocol!=="https:")throw new Error("Brand website must use HTTPS.");
  const host=u.hostname.toLowerCase();
  if(
    host==="localhost"||host.endsWith(".local")||host==="0.0.0.0"||host==="127.0.0.1"||host==="::1"||
    /^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)||/^\d+\.\d+\.\d+\.\d+$/.test(host)
  )throw new Error("Unsupported website host.");
  u.hash="";u.search="";u.pathname="/";
  return u.toString();
}

function meta(html:string,key:string){
  const safe=key.replace(/[.*+?^$()|[\]\\]/g,"\\$&");
  for(const r of [
    new RegExp('<meta[^>]+property=["\\\']'+safe+'["\\\'][^>]+content=["\\\']([^"\\\']*)["\\\']','i'),
    new RegExp('<meta[^>]+name=["\\\']'+safe+'["\\\'][^>]+content=["\\\']([^"\\\']*)["\\\']','i'),
    new RegExp('<meta[^>]+content=["\\\']([^"\\\']*)["\\\'][^>]+(?:property|name)=["\\\']'+safe+'["\\\']','i')
  ]){const m=html.match(r);if(m?.[1])return decode(m[1]);}
  return "";
}

function jsonLdNodes(html:string){
  const nodes:any[]=[];
  for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{
      const raw=JSON.parse(m[1].trim());
      const list=Array.isArray(raw)?raw:(Array.isArray(raw?.["@graph"])?raw["@graph"]:[raw]);
      nodes.push(...list.filter(Boolean));
    }catch{}
  }
  return nodes;
}

function brandFromHtml(html:string,base:string){
  const nodes=jsonLdNodes(html);
  let name="",logo="";
  for(const n of nodes){
    const types=Array.isArray(n?.["@type"])?n["@type"]:[n?.["@type"]];
    if(types.some((x:any)=>["Organization","Brand","WebSite","OnlineStore"].includes(String(x)))){
      if(!name&&n?.name)name=String(n.name).trim();
      if(!logo&&n?.logo){
        const v=typeof n.logo==="string"?n.logo:(n.logo?.url||n.logo?.contentUrl||"");
        if(v)logo=abs(String(v),base);
      }
    }
  }
  const appleIcon=html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)
    ||html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*apple-touch-icon[^"']*["']/i);
  const icon=html.match(/<link[^>]+rel=["'][^"']*(?:shortcut\s+icon|icon)[^"']*["'][^>]+href=["']([^"']+)["']/i)
    ||html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*(?:shortcut\s+icon|icon)[^"']*["']/i);
  const logoImg=html.match(/<img[^>]+(?:class|id)=["'][^"']*logo[^"']*["'][^>]+(?:src|data-src)=["']([^"']+)["']/i)
    ||html.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]+(?:class|id)=["'][^"']*logo[^"']*["']/i);
  const title=textOnly((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1]||"");
  const siteName=(meta(html,"og:site_name")||"").trim();
  name=name||siteName||title.split(/\s+[|–—-]\s+/)[0].trim();
  // Small square site icons work much better in Avonent's avatar than a wide header wordmark.
  logo=abs(appleIcon?.[1]||"",base)||abs(icon?.[1]||"",base)||logo||abs(logoImg?.[1]||"",base)||abs(meta(html,"og:image")||"",base);
  const description=(meta(html,"og:description")||meta(html,"description")||"").trim().slice(0,700);
  return {name:name.slice(0,160),logo,description,title:title.slice(0,200)};
}

function facebookRefs(html:string,base:string){
  const refs:any[]=[];
  const seen=new Set<string>();
  for(const m of html.matchAll(/href\s*=\s*["']([^"']*facebook\.com[^"']*)["']/gi)){
    const href=decode(m[1]);
    let u:URL;
    try{u=new URL(href,base)}catch{continue}
    const host=u.hostname.toLowerCase();
    if(!["facebook.com","www.facebook.com","m.facebook.com","business.facebook.com"].includes(host))continue;
    if(/\/(?:sharer|share|dialog|plugins|help|privacy|policies|login)(?:\/|\?|$)/i.test(u.pathname))continue;
    const library=/^\/ads\/library\/?$/i.test(u.pathname);
    const pageId=numeric(u.searchParams.get("view_all_page_id"))||(!library?(numeric(u.searchParams.get("id"))||numeric(u.pathname.split("/").filter(Boolean).pop())):"");
    const adId=library?numeric(u.searchParams.get("id")):"";
    const clean=new URL(u.href);
    clean.protocol="https:";clean.hostname="www.facebook.com";clean.hash="";
    if(library){
      const canonical=new URL("https://www.facebook.com/ads/library/");
      if(pageId){canonical.searchParams.set("view_all_page_id",pageId);canonical.searchParams.set("search_type","page");}
      else if(adId)canonical.searchParams.set("id",adId);
      const key=canonical.href;
      if(!seen.has(key)){seen.add(key);refs.push({page_url:"",page_id:pageId,ad_library_url:key,ad_id:adId});}
      continue;
    }
    if(/^\/profile\.php$/i.test(clean.pathname)&&pageId){clean.search="";clean.searchParams.set("id",pageId);}else clean.search="";
    const key=clean.href;
    if(!seen.has(key)){
      seen.add(key);
      const adLibraryUrl=pageId?"https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id="+encodeURIComponent(pageId)+"&search_type=page":"";
      refs.push({page_url:key,page_id:pageId,ad_library_url:adLibraryUrl,ad_id:""});
    }
  }
  return refs.slice(0,10);
}

async function fetchText(url:string,accept="text/html,*/*;q=0.8"){
  const response=await fetch(url,{redirect:"follow",headers:{"user-agent":"Mozilla/5.0 AvonentBrandResearch/2.0","accept":accept},signal:AbortSignal.timeout(15000)});
  return {ok:response.ok,status:response.status,url:response.url,type:response.headers.get("content-type")||"",text:await response.text()};
}

async function publicProducts(site:string,html:string){
  const rows:any[]=[];
  try{
    const r=await fetchText(new URL("/products.json?limit=50",site).toString(),"application/json,text/plain;q=0.9,*/*;q=0.5");
    if(r.ok&&/json/i.test(r.type)){
      const data=JSON.parse(r.text);
      for(const p of Array.isArray(data?.products)?data.products:[]){
        const name=String(p?.title||"").trim();
        if(!name)continue;
        rows.push({
          name:name.slice(0,180),
          category:String(p?.product_type||"").trim().slice(0,120),
          vendor:String(p?.vendor||"").trim().slice(0,120),
          url:p?.handle?new URL("/products/"+String(p.handle),site).toString():"",
          tags:Array.isArray(p?.tags)?p.tags.slice(0,12):String(p?.tags||"").split(",").map((x:string)=>x.trim()).filter(Boolean).slice(0,12)
        });
      }
    }
  }catch{}
  if(!rows.length){
    for(const n of jsonLdNodes(html)){
      const types=Array.isArray(n?.["@type"])?n["@type"]:[n?.["@type"]];
      if(!types.includes("Product")||!n?.name)continue;
      rows.push({name:String(n.name).slice(0,180),category:String(n.category||"").slice(0,120),vendor:String(n.brand?.name||n.brand||"").slice(0,120),url:abs(String(n.url||""),site),tags:[]});
    }
  }
  const unique=Array.from(new Map(rows.map((p:any)=>[(p.url||p.name).toLowerCase(),p])).values()).slice(0,20);
  const categories=[...new Set(unique.map((p:any)=>p.category).filter(Boolean))].slice(0,12);
  return {products:unique,categories};
}

async function discover(siteRaw:string){
  const requested=safeWebsite(siteRaw);
  const response=await fetchText(requested);
  if(!response.ok)throw new Error("Brand website returned "+response.status);
  const site=safeWebsite(response.url||requested);
  const identity=brandFromHtml(response.text,site);
  const facebook=facebookRefs(response.text,site);
  const commerce=await publicProducts(site,response.text);
  const trustedFacebook=facebook.find(x=>x.page_id)||facebook[0]||null;
  return {
    canonical_url:site,
    brand_name:identity.name,
    logo_url:identity.logo,
    brand_description:identity.description,
    page_title:identity.title,
    facebook_page_url:trustedFacebook?.page_url||"",
    meta_page_id:trustedFacebook?.page_id||"",
    ad_library_url:trustedFacebook?.ad_library_url||"",
    facebook_candidates:facebook,
    products:commerce.products,
    categories:commerce.categories,
    resolution_status:trustedFacebook?.page_id?"verified_store_link":"needs_meta_resolution"
  };
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(req.method!=="POST")return out(405,{error:"POST required"});
  try{
    const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"",service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    if(!url||!anon||!service||!token)return out(401,{error:"Sign in required"});
    const auth=createClient(url,anon,{auth:{persistSession:false}});
    const ident=await auth.auth.getUser(token);
    if(ident.error||!ident.data.user)return out(401,{error:"Invalid session"});
    const user=ident.data.user;
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const body=await req.json().catch(()=>({}));
    const id=String(body?.competitor_id||"").trim();

    let row:any=null;
    let site=String(body?.site||"").trim();
    if(id){
      const found=await admin.from("competitor_watchlist").select("*").eq("id",id).eq("user_id",user.id).maybeSingle();
      if(found.error)throw found.error;
      if(!found.data)return out(404,{error:"Brand not found"});
      row=found.data;
      if(!site)site=String(row.website_url||"").trim();
      if(!site){
        const ad=await admin.from("competitor_ads").select("landing_url").eq("competitor_id",id).neq("landing_url","").limit(1).maybeSingle();
        if(!ad.error&&ad.data?.landing_url)site=ad.data.landing_url;
      }
    }
    if(!site)return out(400,{error:"Store URL required."});

    const info=await discover(site);

    if(row){
      const existingData=row.brand_data&&typeof row.brand_data==="object"?row.brand_data:{};
      const update:any={
        website_url:info.canonical_url,
        brand_description:info.brand_description||row.brand_description||"",
        brand_data:{...existingData,store_discovery:{products:info.products,categories:info.categories,facebook_candidates:info.facebook_candidates,page_title:info.page_title,discovered_at:new Date().toISOString()}},
        updated_at:new Date().toISOString()
      };
      if(info.logo_url)update.logo_url=info.logo_url;
      if(!row.facebook_page_url&&info.facebook_page_url)update.facebook_page_url=info.facebook_page_url;
      if(!row.meta_page_id&&info.meta_page_id){
        update.meta_page_id=info.meta_page_id;
        update.ad_library_url=info.ad_library_url;
        update.resolution_status="verified_store_link";
      }else if(!row.meta_page_id&&!row.ad_library_url){
        update.resolution_status="needs_meta_resolution";
      }
      if((!row.competitor_name||/^Store\s+/i.test(row.competitor_name))&&info.brand_name)update.competitor_name=info.brand_name.slice(0,120);
      const saved=await admin.from("competitor_watchlist").update(update).eq("id",id).eq("user_id",user.id);
      if(saved.error)throw saved.error;
    }

    return out(200,{ok:true,enriched:true,...info});
  }catch(e){
    console.error("brand enrich",e instanceof Error?e.message:String(e));
    return out(500,{error:e instanceof Error?e.message:"Brand enrichment failed"});
  }
});