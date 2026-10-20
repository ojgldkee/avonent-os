import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, apikey, content-type, x-client-info, x-avonent-cron-secret",
  "access-control-allow-methods":"POST, OPTIONS",
  "content-type":"application/json"
};
const out=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:CORS});

async function authenticate(req:Request, admin:any){
  const cronSecret=Deno.env.get("AVONENT_CRON_SECRET")||"";
  const sent=req.headers.get("x-avonent-cron-secret")||"";
  if(cronSecret&&sent&&sent===cronSecret)return{mode:"cron",userId:null};
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return null;
  const user=await admin.auth.getUser(token);
  if(user.error||!user.data.user)return null;
  return{mode:"user",userId:user.data.user.id};
}
function responseText(raw:any){
  if(typeof raw?.output_text==="string"&&raw.output_text)return raw.output_text;
  for(const item of raw?.output||[])for(const p of item?.content||[])if(p?.text)return p.text;
  return "";
}
function cleanJson(text:string){
  let t=String(text||"").trim();
  t=t.replace(/^```json\s*/i,"").replace(/```$/,"").trim();
  return JSON.parse(t);
}
const SYSTEM=`You are Avonent's competitor-ad research analyst.
Analyze only what is actually present in the supplied ad record.
An ad being active for 30+ days is a research signal, NOT proof of profitability.
Do not invent performance, audience demographics, product facts, claims, visuals, or landing-page content.
Extract the creative strategy so another model can learn the pattern without copying the competitor.

For every ad return:
- hook_text: the opening hook if inferable from the primary text/headline; otherwise ""
- hook_type: e.g. problem callout, question, product fact, curiosity, comparison, story, testimonial, offer, demonstration
- angle: the central persuasion angle
- awareness_level: unaware/problem-aware/solution-aware/product-aware/most-aware/unknown
- format: likely creative format from available evidence, otherwise unknown
- hook_source: "primary_text" or "headline"; never label written ad copy as a spoken video hook
- spoken_hook: "" (no audio transcript has been supplied)
- visual_hook: "" (no video frames have been supplied)
- first_frame: "" (media URLs and written copy do not establish the video opening)
- evidence_limits: explicitly state that this is copy-only analysis, not video/audio analysis
- problem_or_desire
- objection
- mechanism_or_product_detail
- proof_structure
- offer_structure
- story_structure
- specificity: the concrete detail that makes the ad non-generic
- reusable_pattern: one concise transferable structure, not copied wording
- pattern_summary: 2-4 sentences explaining why the structure is interesting
- compliance_risks: any claims/patterns Avonent should not copy blindly
- research_score: integer 1-100 based on specificity, clarity, longevity signal, and usefulness for creative research; do NOT treat this as profitability.

Return JSON only.`;

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(req.method!=="POST")return out(405,{error:"POST required"});
  try{
    const url=Deno.env.get("SUPABASE_URL")||"";
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    const key=Deno.env.get("OPENAI_API_KEY")||"";
    if(!url||!service)return out(503,{error:"Supabase server configuration missing"});
    const admin=createClient(url,service,{auth:{persistSession:false}});
    const auth=await authenticate(req,admin);
    if(!auth)return out(401,{error:"Unauthorized"});
    if(!key)return out(503,{setup_required:true,error:"OPENAI_API_KEY is not configured in Supabase."});

    const body=await req.json().catch(()=>({}));
    const limit=Math.max(1,Math.min(Number(body?.limit||5),5));
    let q=admin.from("competitor_ads")
      .select("id,user_id,product_id,ad_archive_id,advertiser_name,primary_text,headline,description,cta_text,landing_url,display_format,media_kind,started_at,days_running,source_url")
      .eq("is_active",true)
      .is("analyzed_at",null)
      .neq("primary_text","")
      .order("days_running",{ascending:false})
      .limit(limit);
    if(auth.userId)q=q.eq("user_id",auth.userId);
    if(body?.product_id)q=q.eq("product_id",String(body.product_id));
    const rows=await q;
    if(rows.error)throw rows.error;

    const model=Deno.env.get("AVONENT_ANALYSIS_MODEL")||"gpt-6-luna";
    let analyzed=0;
    const errors:any[]=[];

    for(const ad of rows.data||[]){
      try{
        const payload={
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
          source_url:ad.source_url
        };
        const response=await fetch("https://api.openai.com/v1/responses",{
          method:"POST",
          headers:{"authorization":"Bearer "+key,"content-type":"application/json"},
          body:JSON.stringify({
            model,
            reasoning:{effort:"low"},
            input:[
              {role:"system",content:SYSTEM},
              {role:"user",content:JSON.stringify(payload)}
            ],
            max_output_tokens:1500
          }),
          signal:AbortSignal.timeout(30000)
        });
        const raw=await response.json();
        if(!response.ok)throw new Error(raw?.error?.message||"AI analysis request failed");
        const analysis=cleanJson(responseText(raw));
        const upd=await admin.from("competitor_ads").update({
          ai_analysis:{...analysis,analysis_model:model,analysis_scope:"copy_only",spoken_hook:"",visual_hook:"",first_frame:""},
          analyzed_at:new Date().toISOString(),
          updated_at:new Date().toISOString()
        }).eq("id",ad.id);
        if(upd.error)throw upd.error;
        analyzed++;
      }catch(e){
        errors.push({ad_archive_id:ad.ad_archive_id,error:e instanceof Error?e.message:String(e)});
      }
    }

    return out(200,{ok:true,found:(rows.data||[]).length,analyzed,errors,model});
  }catch(e){
    console.error("analyze-competitor-ads",e instanceof Error?e.message:String(e));
    return out(500,{error:"Competitor analysis failed."});
  }
});