import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods":"POST, OPTIONS",
  "content-type":"application/json"
};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:CORS});

function decodeHtml(s:string){
  return s.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&#039;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
}
function textOnly(s:string){
  return decodeHtml(String(s||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());
}
function canonicalSite(raw:string){
  const u=new URL(raw);
  if(u.protocol!=="https:") throw new Error("Website must use HTTPS.");
  const host=u.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".local")||host==="0.0.0.0"||host==="127.0.0.1"||host==="::1"||
    /^10\./.test(host)||/^192\.168\./.test(host)||/^169\.254\./.test(host)||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error("That website address is not allowed.");
  u.hash="";
  u.search="";
  u.pathname="/";
  return u;
}
function meta(html:string,key:string){
  const safe=key.replace(/[.*+?^$()|[\]\\]/g,"\\$&");
  const patterns=[
    new RegExp('<meta[^>]+property=["\\\']'+safe+'["\\\'][^>]+content=["\\\']([^"\\\']*)["\\\']','i'),
    new RegExp('<meta[^>]+name=["\\\']'+safe+'["\\\'][^>]+content=["\\\']([^"\\\']*)["\\\']','i'),
    new RegExp('<meta[^>]+content=["\\\']([^"\\\']*)["\\\'][^>]+(?:property|name)=["\\\']'+safe+'["\\\']','i')
  ];
  for(const r of patterns){const m=html.match(r);if(m?.[1])return decodeHtml(m[1]);}
  return "";
}
function jsonLdProducts(html:string){
  const out:any[]=[];
  const re=/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while((m=re.exec(html))){
    try{
      const x=JSON.parse(m[1].trim());
      const nodes=Array.isArray(x)?x:(x?.["@graph"]?x["@graph"]:[x]);
      for(const n of nodes){
        if(n?.["@type"]==="Product" || (Array.isArray(n?.["@type"])&&n["@type"].includes("Product"))) out.push(n);
      }
    }catch{}
  }
  return out;
}
async function fetchText(url:string){
  const r=await fetch(url,{redirect:"follow",headers:{
    "user-agent":"Mozilla/5.0 AvonentProductResearch/1.0",
    "accept":"text/html,application/json,application/xml;q=0.9,*/*;q=0.7"
  },signal:AbortSignal.timeout(20000)});
  return {ok:r.ok,status:r.status,type:r.headers.get("content-type")||"",text:await r.text(),url:r.url};
}
async function fromShopifyProductsJson(site:URL){
  const target=new URL("/products.json?limit=250",site).toString();
  const r=await fetchText(target);
  if(!r.ok || !/json/i.test(r.type)) return [];
  let payload:any;
  try{payload=JSON.parse(r.text);}catch{return [];}
  const products=Array.isArray(payload?.products)?payload.products:[];
  return products.map((p:any)=>({
    external_id:String(p.id||""),
    name:String(p.title||"").trim(),
    category:String(p.product_type||"").trim(),
    source_url:new URL("/products/"+String(p.handle||""),site).toString(),
    description:textOnly(p.body_html||""),
    image_url:String(p.images?.[0]?.src||p.image?.src||""),
    vendor:String(p.vendor||""),
    tags:Array.isArray(p.tags)?p.tags:String(p.tags||"").split(",").map((x:string)=>x.trim()).filter(Boolean),
    variants:(p.variants||[]).map((v:any)=>({
      id:String(v.id||""),title:String(v.title||""),price:String(v.price||""),sku:String(v.sku||""),available:v.available!==false
    })),
    raw:p
  })).filter((p:any)=>p.name&&p.source_url);
}
async function discoverProductUrls(site:URL){
  const roots=[new URL("/sitemap.xml",site).toString(),new URL("/sitemap_products_1.xml",site).toString()];
  const urls=new Set<string>();
  for(const root of roots){
    try{
      const r=await fetchText(root);
      if(!r.ok)continue;
      const locs=[...r.text.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m=>decodeHtml(m[1].trim()));
      for(const loc of locs){
        if(/sitemap_products/i.test(loc)){
          try{
            const child=await fetchText(loc);
            if(child.ok){
              for(const m of child.text.matchAll(/<loc>([^<]+)<\/loc>/gi)){
                const u=decodeHtml(m[1].trim());
                if(/\/products\//i.test(u))urls.add(u);
              }
            }
          }catch{}
        }else if(/\/products\//i.test(loc))urls.add(loc);
      }
    }catch{}
  }
  return [...urls].slice(0,120);
}
async function scrapeProductPage(url:string){
  const r=await fetchText(url);
  if(!r.ok)return null;
  const ld=jsonLdProducts(r.text)[0]||{};
  const offers=Array.isArray(ld.offers)?ld.offers:(ld.offers?[ld.offers]:[]);
  const images=Array.isArray(ld.image)?ld.image:(ld.image?[ld.image]:[]);
  const title=String(ld.name||meta(r.text,"og:title")||"").replace(/\s*[|–-]\s*Avonent.*$/i,"").trim();
  if(!title)return null;
  return {
    external_id:"",
    name:title,
    category:String(ld.category||""),
    source_url:r.url||url,
    description:(()=>{const d=textOnly(ld.description||meta(r.text,"og:description")||meta(r.text,"description")||"");return d.length>=30?d:"";})(),
    image_url:String(images[0]||meta(r.text,"og:image")||""),
    vendor:String(ld.brand?.name||ld.brand||""),
    tags:[],
    variants:offers.map((o:any)=>({id:"",title:"Default",price:String(o.price||""),sku:String(o.sku||""),available:String(o.availability||"").toLowerCase().includes("instock")})),
    raw:{jsonld:ld}
  };
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(req.method!=="POST")return reply(405,{error:"POST required"});
  try{
    const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
    const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    if(!supabaseUrl||!anon||!service)return reply(503,{error:"Supabase server configuration missing."});
    const admin=createClient(supabaseUrl,service,{auth:{persistSession:false}});
    const body=await req.json().catch(()=>({}));

    let userId="";
    if(token){
      if(token===service)userId=String(body?.user_id||"");
      else{
        const authClient=createClient(supabaseUrl,anon,{auth:{persistSession:false}});
        const auth=await authClient.auth.getUser(token);
        if(!auth.error&&auth.data.user)userId=auth.data.user.id;
      }
    }
    if(!userId&&body?.scheduler_token){
      const secret=await admin.from("avonent_scheduler_secret").select("token").eq("id",true).maybeSingle();
      if(!secret.error&&secret.data?.token&&String(secret.data.token)===String(body.scheduler_token)){
        userId=String(body?.user_id||"");
      }
    }
    if(!userId)return reply(401,{error:"Invalid Avonent session."});
    const user={id:userId};

    const requestedSiteId=String(body?.site_id||"").trim();
    let siteRow:any=null;
    if(requestedSiteId){
      const lookup=await admin.from("connected_sites").select("*").eq("id",requestedSiteId).eq("user_id",user.id).maybeSingle();
      if(lookup.error)throw lookup.error;
      if(!lookup.data)return reply(404,{error:"Connected site not found."});
      siteRow=lookup.data;
    }
    const site=canonicalSite(String(siteRow?.url||body?.site||""));
    const siteUrl=site.toString();
    const fallbackBrand=site.hostname.replace(/^www\./,"").split(".")[0].replace(/[-_]+/g," ").replace(/\b\w/g,(m:string)=>m.toUpperCase());
    const brandName=String(siteRow?.brand_name||siteRow?.name||fallbackBrand||"Brand").trim();

    let products=await fromShopifyProductsJson(site);
    let method="products.json";
    if(!products.length){
      method="sitemap+jsonld";
      const urls=await discoverProductUrls(site);
      const rows:any[]=[];
      for(const url of urls){
        try{const p=await scrapeProductPage(url);if(p)rows.push(p);}catch{}
      }
      products=rows;
    }

    if(!products.length)return reply(502,{error:"No public product data could be discovered on "+site.hostname+".",method});

    // Shopify products.json sometimes omits body_html even when the public product page
    // exposes a useful meta/JSON-LD description. Enrich missing facts from the page.
    for(let i=0;i<products.length;i++){
      if(products[i]?.description)continue;
      try{
        const pageProduct=await scrapeProductPage(products[i].source_url);
        if(pageProduct){
          products[i]={
            ...products[i],
            description:pageProduct.description||products[i].description||"",
            category:products[i].category||pageProduct.category||"",
            image_url:products[i].image_url||pageProduct.image_url||"",
            vendor:products[i].vendor||pageProduct.vendor||""
          };
        }
      }catch{}
    }

    let created=0,updated=0;
    for(const p of products){
      const lookup=await admin.from("products").select("*").eq("user_id",user.id).eq("source_url",p.source_url).maybeSingle();
      if(lookup.error)throw lookup.error;
      const siteData={
        external_id:p.external_id,
        description:p.description,
        image_url:p.image_url,
        vendor:p.vendor,
        tags:p.tags,
        variants:p.variants,
        scraped_from:p.source_url
      };
      if(lookup.data){
        const upd=await admin.from("products").update({
          name:p.name,
          category:p.category||lookup.data.category||"",
          brand_name:brandName||lookup.data.brand_name||"",
          product_facts:(String(p.description||"").trim().length>=30?p.description:lookup.data.product_facts)||"",
          source_kind:"website",
          site_id:siteRow?.id||lookup.data.site_id||null,
          site_data:{...siteData,site_url:siteUrl},
          site_synced_at:new Date().toISOString(),
          updated_at:new Date().toISOString()
        }).eq("id",lookup.data.id).eq("user_id",user.id);
        if(upd.error)throw upd.error;
        updated++;
      }else{
        const ins=await admin.from("products").insert({
          user_id:user.id,
          brand_name:brandName,
          name:p.name,
          category:p.category||"",
          product_facts:p.description||"",
          source_url:p.source_url,
          source_kind:"website",
          site_id:siteRow?.id||null,
          site_data:{...siteData,site_url:siteUrl},
          site_synced_at:new Date().toISOString(),
          active:true
        });
        if(ins.error)throw ins.error;
        created++;
      }
    }

    if(siteRow?.id){
      const touch=await admin.from("connected_sites").update({updated_at:new Date().toISOString()}).eq("id",siteRow.id).eq("user_id",user.id);
      if(touch.error)throw touch.error;
    }
    return reply(200,{ok:true,site:siteUrl,site_id:siteRow?.id||null,brand_name:brandName,method,found:products.length,created,updated});
  }catch(error){
    console.error("website-product-scan",error instanceof Error?error.message:String(error));
    return reply(500,{error:error instanceof Error?error.message:"Website scan failed."});
  }
});