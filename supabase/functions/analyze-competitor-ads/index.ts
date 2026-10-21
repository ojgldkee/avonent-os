import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods":"POST, OPTIONS",
  "content-type":"application/json"
};
const out=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:CORS});

async function authenticate(req:Request,admin:any,body:any){
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(service&&token&&token===service)return{mode:"service",userId:null};
  if(token){
    const user=await admin.auth.getUser(token);
    if(!user.error&&user.data.user)return{mode:"user",userId:user.data.user.id};
  }
  const schedulerToken=String(body?.scheduler_token||"");
  if(schedulerToken){
    const secret=await admin.from("avonent_scheduler_secret").select("token").eq("id",true).maybeSingle();
    if(!secret.error&&secret.data?.token&&String(secret.data.token)===schedulerToken)return{mode:"scheduler",userId:null};
  }
  return null;
}

function parseJson(text:string){
  const t=String(text||"").trim().replace(/^```json\s*/i,"").replace(/```$/,"").trim();
  const start=t.indexOf("{");
  if(start<0)throw new Error("Analysis returned no JSON object.");
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<t.length;i++){
    const ch=t[i];
    if(inString){
      if(escaped){escaped=false;continue;}
      if(ch==="\\"){escaped=true;continue;}
      if(ch==='"')inString=false;
      continue;
    }
    if(ch==='"'){inString=true;continue;}
    if(ch==="{")depth++;
    if(ch==="}"){
      depth--;
      if(depth===0)return JSON.parse(t.slice(start,i+1));
    }
  }
  throw new Error("Analysis returned incomplete JSON.");
}

function exactSpokenOpening(segments:any[], transcript:string){
  const usable=Array.isArray(segments)?segments:[];
  const parts:string[]=[];
  for(const segment of usable){
    const text=String(segment?.text||"").trim();
    if(!text)continue;
    parts.push(text);
    const words=parts.join(" ").split(/\s+/).filter(Boolean);
    if(Number(segment?.end||0)>=8||words.length>=25)break;
  }
  const joined=parts.join(" ").replace(/\s+/g," ").trim();
  if(joined)return joined.split(/\s+/).slice(0,25).join(" ");
  return String(transcript||"").replace(/\s+/g," ").trim().split(/\s+/).slice(0,25).join(" ");
}

const SYSTEM=`You are Avonent's competitor creative analyst. Analyze the supplied ad as source material for an original production team.

Evidence discipline:
- Separate OBSERVED evidence from INFERENCE.
- If a transcript is supplied, the field exact_spoken_opening must reproduce the supplied transcript opening without rewriting it.
- If visual media is supplied, describe only visible composition, hierarchy, captions, product placement, offer badges, backgrounds, actions/cuts (for video), and product moments you can actually observe.
- For a static/image ad, analyze the actual image layout as a design reference. Do not infer unseen animation or video behavior.
- Primary text is Facebook ad copy and is not automatically spoken dialogue.
- Ad longevity is a research signal, not proof of sales or profitability.
- Do not invent product claims, performance, demographics, testimonials, laboratory evidence, or scenes.

Return JSON with:
{
  "hook_text": "opening written-copy hook or empty",
  "hook_source": "primary_text|headline|none",
  "exact_spoken_opening": "exact supplied transcript opening or empty",
  "spoken_hook_type": "plain-language classification",
  "visual_hook": "observed first visual pattern or empty",
  "first_frame": "observed first-frame description or empty",
  "angle": "central persuasion angle",
  "awareness_level": "unaware|problem-aware|solution-aware|product-aware|most-aware|unknown",
  "format": "UGC|founder|podcast|demo|testimonial|montage|animation|static|mixed|unknown",
  "observed_sequence": ["ordered source beats"],
  "pacing": "specific observed pacing notes",
  "product_reveal": "when/how product appears, or unknown",
  "proof_structure": "what proof device is actually used, or none",
  "offer_structure": "observed offer/CTA structure",
  "cta_structure": "observed ending/CTA",
  "problem_or_desire": "",
  "objection": "",
  "mechanism_or_product_detail": "",
  "story_structure": "",
  "specificity": "",
  "reusable_pattern": "transferable structural pattern without copying distinctive wording",
  "pattern_summary": "2-4 concise sentences",
  "visual_production_notes": ["camera/editing/graphics patterns worth adapting"],
  "static_visual_analysis": {
    "layout": "observed layout or empty",
    "headline_hierarchy": "how headline/subhead are arranged",
    "product_placement": "where/how product is shown",
    "offer_badge": "observed sale/offer badge treatment or empty",
    "background_art_direction": "background, setting, texture, seasonality",
    "text_density": "low|medium|high|unknown",
    "design_style": "plain-language style classification",
    "reusable_static_pattern": "transferable layout pattern without copying brand assets"
  },
  "compliance_risks": ["claims or tactics requiring review"],
  "research_score": 1
}
research_score is 1-100 for usefulness as a creative reference, not profitability.
Return JSON only.`;

async function callOpenRouter(key:string, model:string, ad:any, exactOpening:string, visualMode:"video"|"image"|false){
  const payload={
    ad_archive_id:ad.ad_archive_id,
    advertiser_name:ad.advertiser_name,
    primary_text:ad.primary_text,
    headline:ad.headline,
    description:ad.description,
    cta_text:ad.cta_text,
    landing_url:ad.landing_url,
    display_format:ad.display_format,
    media_kind:ad.media_kind,
    days_running:ad.days_running,
    started_at:ad.started_at,
    source_url:ad.source_url,
    video_duration_seconds:ad.video_duration_seconds,
    transcript:ad.video_transcript||"",
    transcript_segments:ad.video_transcript_segments||[],
    exact_spoken_opening:exactOpening
  };
  const content:any[]= [{type:"text",text:JSON.stringify(payload)}];
  const mediaUrl=ad.media_url||ad.media_thumbnail_url||"";
  if(visualMode==="video"&&mediaUrl)content.push({type:"video_url",video_url:{url:mediaUrl}});
  if(visualMode==="image"&&mediaUrl)content.push({type:"image_url",image_url:{url:mediaUrl}});
  const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
    method:"POST",
    headers:{
      "authorization":"Bearer "+key,
      "content-type":"application/json",
      "HTTP-Referer":"https://ojgldkee.github.io/avonent-os/",
      "X-Title":"Avonent OS"
    },
    body:JSON.stringify({
      model,
      temperature:0.15,
      messages:[{role:"system",content:SYSTEM},{role:"user",content}],
      ...(model.includes("qwen3.8")?{reasoning:{enabled:false}}:{}),
      response_format:{type:"json_object"},
      provider:{sort:"throughput",allow_fallbacks:true},
      max_tokens:2600
    }),
    signal:AbortSignal.timeout(visualMode==="video"?70000:visualMode==="image"?55000:45000)
  });
  const raw=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(raw?.error?.message||("OpenRouter analysis failed: "+response.status));
  const message=raw?.choices?.[0]?.message?.content;
  const text=typeof message==="string"?message:Array.isArray(message)?message.map((p:any)=>typeof p==="string"?p:(p?.text||"")).join(""):"";
  if(!text.trim())throw new Error("OpenRouter analysis returned no text.");
  return {analysis:parseJson(text),model};
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(req.method!=="POST")return out(405,{error:"POST required"});
  try{
    const url=Deno.env.get("SUPABASE_URL")||"";
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    const key=Deno.env.get("OPENROUTER_API_KEY")||"";
    if(!url||!service)return out(503,{error:"Supabase server configuration missing"});
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const body=await req.json().catch(()=>({}));
    const auth=await authenticate(req,admin,body);
    if(!auth)return out(401,{error:"Unauthorized"});
    if(!key)return out(503,{setup_required:true,error:"OPENROUTER_API_KEY is not configured."});
    const limit=Math.max(1,Math.min(Number(body?.limit||6),8));
    let q=admin.from("competitor_ads")
      .select("id,user_id,product_id,ad_archive_id,advertiser_name,primary_text,headline,description,cta_text,landing_url,display_format,media_kind,media_url,media_thumbnail_url,started_at,days_running,source_url,video_transcript,video_transcript_segments,video_duration_seconds,transcription_status,analyzed_at,ai_analysis")
      .eq("is_active",true)
      .order("days_running",{ascending:false})
      .limit(80);
    if(auth.userId)q=q.eq("user_id",auth.userId);
    if(body?.product_id)q=q.eq("product_id",String(body.product_id));
    const rows=await q;
    if(rows.error)throw rows.error;
    const candidates=(rows.data||[]).filter((ad:any)=>{
      if(!ad.analyzed_at)return true;
      const hasImage=ad.media_kind==="image"&&Boolean(ad.media_url||ad.media_thumbnail_url);
      return hasImage&&!Boolean(ad.ai_analysis?.visual_analysis_available);
    }).slice(0,limit);

    const textModel=Deno.env.get("AVONENT_ANALYSIS_MODEL")||"qwen/qwen3-30b-a3b-instruct-2507";
    const visualModel=Deno.env.get("AVONENT_VISUAL_MODEL")||"qwen/qwen3.8-27b";
    const jobs=candidates.map(async(ad:any)=>{
      const opening=exactSpokenOpening(ad.video_transcript_segments||[],ad.video_transcript||"");
      const hasTranscript=Boolean(String(ad.video_transcript||"").trim());
      const canInspectVideo=hasTranscript&&ad.media_kind==="video"&&Boolean(ad.media_url);
      const canInspectImage=ad.media_kind==="image"&&Boolean(ad.media_url||ad.media_thumbnail_url);
      let result:any;
      let visual=false;
      let visualKind="";

      if(canInspectVideo){
        try{
          result=await callOpenRouter(key,visualModel,ad,opening,"video");
          visual=true;
          visualKind="video";
        }catch(videoError){
          console.warn("video visual fallback",ad.ad_archive_id,videoError instanceof Error?videoError.message:String(videoError));
          result=await callOpenRouter(key,textModel,ad,opening,false);
        }
      }else if(canInspectImage){
        try{
          result=await callOpenRouter(key,visualModel,ad,opening,"image");
          visual=true;
          visualKind="image";
        }catch(imageError){
          console.warn("image visual fallback",ad.ad_archive_id,imageError instanceof Error?imageError.message:String(imageError));
          result=await callOpenRouter(key,textModel,ad,opening,false);
        }
      }else{
        result=await callOpenRouter(key,textModel,ad,opening,false);
      }

      const analysis:any={
        ...result.analysis,
        exact_spoken_opening:opening||"",
        spoken_hook:opening||"",
        transcript_available:hasTranscript,
        visual_analysis_available:visual,
        analysis_scope:visualKind==="image"?"image_visual_copy":visualKind==="video"?"video_transcript_visual":hasTranscript?"transcript_and_copy":"copy_only",
        analysis_model:result.model,
        analyzed_at:new Date().toISOString()
      };
      if(!hasTranscript){
        analysis.exact_spoken_opening="";
        analysis.spoken_hook="";
      }
      if(!visual){
        analysis.visual_hook="";
        analysis.first_frame="";
      }

      const upd=await admin.from("competitor_ads").update({
        ai_analysis:analysis,
        analyzed_at:new Date().toISOString(),
        updated_at:new Date().toISOString()
      }).eq("id",ad.id);
      if(upd.error)throw upd.error;
      return {ad_archive_id:ad.ad_archive_id,visual,visual_kind:visualKind,scope:analysis.analysis_scope};
    });

    const settled=await Promise.allSettled(jobs);
    const successes=settled.filter((x:any)=>x.status==="fulfilled").map((x:any)=>x.value);
    const errors=settled.map((x:any,index:number)=>x.status==="rejected"
      ? {ad_archive_id:candidates[index]?.ad_archive_id||"",error:x.reason instanceof Error?x.reason.message:String(x.reason)}
      : null).filter(Boolean);

    return out(200,{ok:true,found:candidates.length,analyzed:successes.length,results:successes,errors,text_model:textModel,visual_model:visualModel});
  }catch(e){
    console.error("analyze-competitor-ads",e instanceof Error?e.message:String(e));
    return out(500,{error:e instanceof Error?e.message:"Competitor analysis failed."});
  }
});