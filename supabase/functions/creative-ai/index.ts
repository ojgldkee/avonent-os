import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, apikey, content-type, x-client-info, x-avonent-cron-secret",
  "access-control-allow-methods":"POST, OPTIONS",
  "content-type":"application/json"
};
const out=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:CORS});

async function authenticate(req:Request,admin:any,body:any){
  const cron=Deno.env.get("AVONENT_CRON_SECRET")||"";
  const sent=req.headers.get("x-avonent-cron-secret")||"";
  if(cron&&sent&&sent===cron)return{mode:"cron",userId:null};

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
  let t=String(text||"").trim();
  t=t.replace(/^```json\s*/i,"").replace(/```$/,"").trim();
  const start=t.indexOf("{");
  if(start<0)throw new Error("AI output validation failed: JSON object not found.");
  let depth=0,inString=false,escaped=false;
  for(let i=start;i<t.length;i++){
    const ch=t[i];
    if(inString){
      if(escaped){escaped=false;continue;}
      if(ch==="\\"){escaped=true;continue;}
      if(ch==='"'){inString=false;}
      continue;
    }
    if(ch==='"'){inString=true;continue;}
    if(ch==="{")depth++;
    else if(ch==="}"){
      depth--;
      if(depth===0)return JSON.parse(t.slice(start,i+1));
    }
  }
  throw new Error("AI output validation failed: incomplete JSON object.");
}
const BASE=`You are AVONENT'S PERFORMANCE CREATIVE DIRECTOR, not a generic AI copywriter.
Your job is SOURCE-FIRST AD ADAPTATION: study the actual supplied competitor ad evidence and build a compelling, shootable original advertisement using its persuasive architecture.
Be direct, human, conversational, emotionally precise, specific and commercially convincing. Write like a real creator talking to a friend, not a marketing chatbot.
IMPORTANT EVIDENCE RULES:
- Supplied primary_text is written Facebook ad copy, NOT necessarily spoken video dialogue. Only identify an ACTUAL SPOKEN HOOK when an explicit transcript with timestamps is supplied. Otherwise label the observed written opening as "primary text opening"; say "spoken hook unavailable" and do not invent video scenes as observed.
- Extract the source ad's actual opening text, offer, product reveal, objection, proof, CTA, sequencing and what is observed versus inferred. Preserve persuasive STRUCTURE and pacing while producing new wording and visuals, not near-verbatim reproduction of a competitor's distinctive script.
- Source longevity does not prove profitability. Do not claim an ad is a winner without performance data; call it a long-running or observed ad instead.
- Select a SPECIFIC source ad ID, cite exact source-supported observations, and build the new creative around it. If the source has only primary text, adapt the written sequence and label video pacing as a production hypothesis.
- Do not claim the user's own product is fake, fraudulent, filler, dangerous, placebo, a scam, clinically proven or ineffective. Do not fabricate a lab result, testimonial, discount, price, ingredient, certification, sourcing story, dosage, timeline, biological mechanism, medical outcome, wellness outcome, or competitor misconduct. Only use verified supplied product facts.
- Competitor claims are NEVER transferable product facts. A source ad may supply the rhetorical structure, sequence, cadence and production pattern; it does not supply evidence for the user's product.
- If verified product facts are sparse, DO NOT fill the gap with generic supplement claims. Build the creative around observable facts that are supplied (product name/form, visible packaging, verified price/offer, demonstrated product experience) and explicitly make missing proof a production requirement.
- No default "what if", "the truth about", "the X lie", "doctors hate", "everyone is wrong", "this changes everything", invented conspiracy, or clickbait that undermines the advertised product. Do not make all five concepts skeptical myth-busting.
- Optimize for a viewer who could actually buy: show a specific real-world problem, a believable reason to care, a concrete product moment, a natural CTA.
PRODUCTION CONTRACT:
- Deliver a complete shootable script. Every timed beat MUST contain nonempty time, say, show, on_screen_text, footage_type, and provider. No placeholder fields. SAY is exact spoken dialogue; SHOW is camera/action direction; ON-SCREEN is actual caption. Footage types: UGC, PRODUCT, B_ROLL, AI_VIDEO, GRAPHIC. For non-AI footage provider is "camera/editor"; for AI_VIDEO choose a suggested model/provider (e.g. Higgsfield Seedance or MiniMax Hailuo), plus detailed generation prompt. Recommend AI only for shots impossible or impractical to film. Never imply AI-generated illustrations are clinical evidence.
- Use 5-8 sequential timestamped beats covering the entire duration including a spoken CTA. Match speech to realistic pacing (~2-2.7 words/second). Video length is chosen from the idea, not a fixed template.
- Every concept must contain 4 distinct, spoken, natural-sounding ORIGINAL hook options. The source's actual opening must be listed separately as research evidence, not disguised as original.
- Describe filming setup, shot changes, cut timing, product shots, and any animation prompt/provider when relevant.
- The model must NOT make up evidence of video analysis, transcript, scene-by-scene observation, or success metrics.
Return one valid JSON object only, no markdown.`;

const IDEA_PROMPT=BASE+`
Generate exactly 5 source-grounded, DIFFERENT original concepts, with different primary source ads and persuasive approaches where available. Return {"ideas":[...]}.
Each idea: title,audience,angle,format,hook,hooks (4 strings),first_frame,first_three_seconds {say,show,on_screen_text},primary_text,headline,description,cta,video_concept,recommended_duration_seconds,production_style,shot_directions,timed_script,proof_to_show,execution,why_test,hypothesis,inspiration,source_ad_ids,source_observations,ai_inferences,product_fact_checks,unsupported_claim_checks,animation_prompts,scores,overall_score,risk.
Also include source_adaptation:{ad_archive_id,advertiser_name,observed_opening_text,opening_type,observed_sequence,adapted_sequence,spoken_hook_available,why_selected}.
timed_script beats must have {time,say,show,on_screen_text,footage_type,provider,animation_prompt}. All fields required and populated.
`;

const ONE_IDEA_PROMPT=BASE+`
Generate ONE production-ready concept by deeply adapting a SINGLE source ad. If primary_source_ad_id is supplied, that exact ad is the primary source and must be used in source_adaptation.ad_archive_id. variation (1-5) changes the creative execution, not the source evidence.
Use the primary source as the SKELETON: preserve its persuasion order, approximate reveal timing, pacing pattern, objection/proof placement, and CTA position when those are supported by transcript/visual analysis. Adapt every line to the user's product facts and voice. The result should feel like the same proven creative format rebuilt for this product, not a generic concept invented from scratch. Do not reproduce a competitor's full distinctive script verbatim. Do not create five near-identical moringa scare campaigns.
Read the source ad's actual primary_text and headline; quote its observed opening accurately in source_adaptation.observed_opening_text. Do not say you heard the video's spoken opening without transcript.
Produce JSON {"idea":{title,audience,angle,format,hook,hooks,first_frame,first_three_seconds,primary_text,headline,description,cta,video_concept,recommended_duration_seconds,production_style,shot_directions,timed_script,proof_to_show,execution,why_test,hypothesis,inspiration,source_ad_ids,source_observations,ai_inferences,product_fact_checks,unsupported_claim_checks,animation_prompts,scores,overall_score,risk,source_adaptation}}.
source_adaptation:{ad_archive_id,advertiser_name,observed_opening_text,opening_type:"primary_text" or "spoken_transcript",observed_sequence,adapted_sequence,spoken_hook_available:boolean,why_selected}.
hooks: exactly 4 original short natural spoken hooks. When an exact spoken source opening exists, mirror its rhetorical shape, cadence and attention mechanism while rewriting the actual wording for the user's product. Do not default to questions unless the source does.
timed_script: 5-8 beats, each {time,say,show,on_screen_text,footage_type,provider,animation_prompt,source_reference}; ALL required, SAY and SHOW must be substantive. source_reference briefly states which source beat/pattern this adapted beat corresponds to. Include full CTA in last beat. For UGC/PRODUCT/B_ROLL/GRAPHIC use provider "camera/editor" and animation_prompt "". For AI_VIDEO specify a real suggested video generator and a detailed generation prompt.
shot_directions: 4-7 specific shoot/edit instructions. animation_prompts: only when an AI_VIDEO shot is recommended, each {scene,seconds,model,prompt,cost_estimate_note}. Never invent prices.
Keep the JSON reasonably compact; prioritize dialogue, production instructions and source adaptation over verbose theory.
`;

const SCRIPT_PROMPT=BASE+`
Turn the selected source-adapted concept into a fully written production script, not an outline.
Return JSON {"script":{title,audience,recommended_duration_seconds,format,hook,first_three_seconds:{say,show,on_screen_text},beats:[{time,say,show,on_screen_text,footage_type,provider,animation_prompt,video_model,source_reference}],product_reveal,proof_moment,cta,editor_notes,source_observations,ai_inferences,product_fact_checks,unsupported_claim_checks,compliance_notes,three_alt_openings}}.
Write exact human-sounding spoken dialogue in every beat, actionable visuals and text, realistic duration, full CTA, specific UGC/B-roll/product/AI footage types. Each beat must include source_reference explaining which part of the competitor source structure it adapts. For AI_VIDEO, suggest provider/model and a paste-ready video prompt. Do not copy competitor script verbatim.
`;

function openingFromText(value:string){
  const text=String(value||"").replace(/\s+/g," ").trim();
  if(!text)return "";
  const first=text.split(/(?<=[.!?])\s+/)[0]||text;
  return first.split(/\s+/).slice(0,25).join(" ");
}

function normalizeClaimText(value:any){
  return String(value||"").toLowerCase().replace(/[’']/g,"'").replace(/\s+/g," ").trim();
}
function creativeClaimCorpus(task:string,result:any){
  const x=task==="script"?result?.script:task==="idea"?result?.idea:result?.ideas;
  if(Array.isArray(x))return x.map((i:any)=>creativeClaimCorpus("idea",{idea:i})).join(" ");
  if(!x)return "";
  const beats=task==="script"?x.beats:x.timed_script;
  return normalizeClaimText([
    x.title,x.hook,...(Array.isArray(x.hooks)?x.hooks:[]),x.primary_text,x.headline,x.description,
    x.cta,x.proof_to_show,x.execution,x.video_concept,
    ...(Array.isArray(beats)?beats.flatMap((b:any)=>[b?.say,b?.on_screen_text]):[])
  ].filter(Boolean).join(" "));
}
function verifiedFactCorpus(product:any){
  return normalizeClaimText([
    product?.brand_name,product?.name,product?.category,product?.benefits,product?.offer,product?.proof,
    product?.product_facts,product?.site_data?.description,
    ...(Array.isArray(product?.site_data?.tags)?product.site_data.tags:[]),
    ...(Array.isArray(product?.site_data?.variants)?product.site_data.variants.flatMap((v:any)=>[v?.title,v?.price,v?.sku]):[])
  ].filter(Boolean).join(" "));
}
function validateProductClaims(task:string,result:any,product:any){
  const output=creativeClaimCorpus(task,result);
  const facts=verifiedFactCorpus(product);
  const risky=[
    "third-party tested","third party tested","lab tested","clinically proven","clinically tested","certified",
    "fda approved","made in the usa","non-gmo","organic","vegan","gluten-free","money-back","money back",
    "guarantee","limited-time","limited time offer","free shipping","free bottle","introductory price",
    "one ingredient","single ingredient","no fillers","no filler","veggie capsule","vegetarian capsule",
    "100% pure","iron","vitamin a","vitamin c","antioxidant","energy","fatigue","bloating","digestion",
    "immunity","immune","detox","weight loss","blood sugar","cholesterol","inflammation","brain fog",
    "focus","clarity","endurance","absorption","cellular","replenish","bioavailability","potency",
    "nutrient-rich","nutrient rich","grown in","sustainably sourced","harvested","parasite","parasites",
    "filler","knockoff","fake product","scam","crash","jitter"
  ];
  const unsupported=risky.filter(term=>output.includes(term)&&!facts.includes(term));
  const statMatches=output.match(/\b\d+(?:\.\d+)?\s*(?:%|percent|out of\s+\d+)\b/g)||[];
  for(const stat of statMatches)if(!facts.includes(stat))unsupported.push(stat);
  const timeMatches=output.match(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty[- ]?four|forty[- ]?eight|seventy[- ]?two)\s*(?:hour|hours|day|days|week|weeks)\b/g)||[];
  for(const span of timeMatches)if(!facts.includes(span))unsupported.push(span);
  const unique=[...new Set(unsupported)];
  if(unique.length)throw new Error("AI output validation failed: unsupported product claims detected: "+unique.slice(0,8).join(", "));
  return result;
}

function validateResult(task:string,result:any){
  if(task==="idea"){
    const idea=result?.idea;
    if(!idea||!idea.title||!idea.hook)throw new Error("AI output validation failed: incomplete idea.");
    if(!Array.isArray(idea.timed_script)||idea.timed_script.length<4||idea.timed_script.some((b:any)=>!String(b?.say||"").trim()||!String(b?.show||"").trim()||!String(b?.on_screen_text||"").trim()||!String(b?.time||"").trim()))throw new Error("AI output validation failed: script has empty SAY/SHOW/ON-SCREEN fields.");
    if(!Array.isArray(idea.hooks))idea.hooks=[idea.hook];
    if(idea.hooks.filter((x:any)=>String(x||"").trim()).length<4)throw new Error("AI output validation failed: expected four usable hooks.");
    if(!Array.isArray(idea.source_ad_ids))idea.source_ad_ids=[];
    if(!idea?.source_adaptation?.ad_archive_id)throw new Error("AI output validation failed: source adaptation is missing.");
    if(!Array.isArray(idea.shot_directions))idea.shot_directions=[];
    if(!Array.isArray(idea.timed_script))idea.timed_script=[];
    if(idea.timed_script.some((b:any)=>!String(b?.footage_type||"").trim()||!String(b?.provider||"").trim()))throw new Error("AI output validation failed: every script beat needs footage type and provider.");
    if(!Array.isArray(idea.source_observations))idea.source_observations=[];
    if(!Array.isArray(idea.ai_inferences))idea.ai_inferences=[];
    if(!Array.isArray(idea.product_fact_checks))idea.product_fact_checks=[];
    if(!Array.isArray(idea.unsupported_claim_checks))idea.unsupported_claim_checks=[];
    if(!Array.isArray(idea.animation_prompts))idea.animation_prompts=[];
  }else if(task==="ideas"){
    if(!Array.isArray(result?.ideas)||result.ideas.length!==5)throw new Error("AI output validation failed: expected five ideas.");
    for(const idea of result.ideas){
      if(!idea||!idea.title||!idea.hook)throw new Error("AI returned an incomplete idea.");
      if(!Array.isArray(idea.hooks))idea.hooks=[idea.hook];
      if(!Array.isArray(idea.source_ad_ids))idea.source_ad_ids=[];
      if(!Array.isArray(idea.shot_directions))idea.shot_directions=[];
      if(!Array.isArray(idea.timed_script))idea.timed_script=[];
      if(!Array.isArray(idea.source_observations))idea.source_observations=[];
      if(!Array.isArray(idea.ai_inferences))idea.ai_inferences=[];
      if(!Array.isArray(idea.product_fact_checks))idea.product_fact_checks=[];
      if(!Array.isArray(idea.unsupported_claim_checks))idea.unsupported_claim_checks=[];
      if(!Array.isArray(idea.animation_prompts))idea.animation_prompts=[];
    }
  }else if(!result?.script||!Array.isArray(result.script.beats)||result.script.beats.length<4||result.script.beats.some((b:any)=>!String(b?.say||"").trim()||!String(b?.show||"").trim()||!String(b?.on_screen_text||"").trim()||!String(b?.footage_type||"").trim()||!String(b?.provider||b?.video_model||"").trim()||!String(b?.source_reference||"").trim())){
    throw new Error("AI output validation failed: final script is missing dialogue, visuals, footage provider, or source mapping.");
  }
  return result;
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

    const task=body?.task==="script"?"script":body?.task==="idea"?"idea":"ideas";
    let product=body?.product||{};
    if(!product?.id&&body?.product_id){
      let pq=admin.from("products").select("*").eq("id",String(body.product_id));
      if(auth.userId)pq=pq.eq("user_id",auth.userId);
      const found=await pq.maybeSingle();
      if(found.error)throw found.error;
      if(!found.data)return out(404,{error:"Product not found"});
      product=found.data;
    }
    let ads=Array.isArray(body?.competitor_ads)?body.competitor_ads.slice(0,task==="idea"?8:16):[];

    if(product?.id&&!ads.length){
      let rowsQuery=admin.from("competitor_ads")
        .select("ad_archive_id,advertiser_name,primary_text,headline,description,cta_text,landing_url,display_format,media_kind,media_url,media_thumbnail_url,started_at,days_running,source_url,video_transcript,video_transcript_segments,video_duration_seconds,transcription_status,ai_analysis")
        .eq("product_id",product.id)
        .eq("is_active",true)
        .order("days_running",{ascending:false})
        .limit(task==="idea"?8:16);
      if(auth.userId)rowsQuery=rowsQuery.eq("user_id",auth.userId);
      const rows=await rowsQuery;
      if(rows.error)throw rows.error;
      ads=rows.data||[];
    }

    const primarySourceId=String(body?.primary_source_ad_id||"");
    const research=ads.map((a:any)=>({
      ad_archive_id:a.ad_archive_id,
      advertiser_name:a.advertiser_name,
      days_running:a.days_running,
      primary_text:String(a.primary_text||"").slice(0,task==="idea"?2200:4500),
      headline:String(a.headline||"").slice(0,500),
      description:String(a.description||"").slice(0,task==="idea"?700:1200),
      format:a.display_format||a.media_kind,
      source_url:a.source_url,
      transcript:String(a.ad_archive_id||"")===primarySourceId
        ? (a.video_transcript||a.transcript||a.ai_analysis?.transcript||null)
        : String(a.video_transcript||a.transcript||"").slice(0,800),
      transcript_segments:Array.isArray(a.video_transcript_segments)?a.video_transcript_segments.slice(0,80):[],
      video_duration_seconds:a.video_duration_seconds||null,
      media_url:a.media_url||"",
      media_thumbnail_url:a.media_thumbnail_url||"",
      exact_spoken_opening:a.ai_analysis?.exact_spoken_opening||a.ai_analysis?.spoken_hook||"",
      visual_hook:a.ai_analysis?.visual_hook||"",
      first_frame:a.ai_analysis?.first_frame||"",
      observed_sequence:a.ai_analysis?.observed_sequence||[],
      analysis:JSON.stringify(a.ai_analysis||{}).slice(0,task==="idea"?3200:5000)
    }));

    const model=task==="script"
      ? (Deno.env.get("AVONENT_SCRIPT_MODEL")||"qwen/qwen3.8-max-0902")
      : (Deno.env.get("AVONENT_IDEA_MODEL")||"qwen/qwen3.8-max-0902");

    const prompt=task==="script"?SCRIPT_PROMPT:task==="idea"?ONE_IDEA_PROMPT:IDEA_PROMPT;
    const input={
      product:{
        id:product.id||"",
        brand_name:product.brand_name||"",
        name:product.name||product.product_name||"",
        category:product.category||"",
        audience:product.audience||"",
        pain_points:product.pain_points||"",
        benefits:product.benefits||"",
        offer:product.offer||"",
        proof:product.proof||"",
        product_facts:product.product_facts||product.site_data?.description||"",
        claim_limits:product.claim_limits||"",
        voice:product.voice||"",
        notes:product.notes||"",
        site_data:product.site_data||{}
      },
      competitor_research:research,
      selected_idea:body?.idea||null,
      primary_source_ad_id:String(body?.primary_source_ad_id||""),
      variation:Number(body?.variation||1)
    };

    const candidates=task==="script"
      ? [model,"qwen/qwen3.8-max-0902","deepseek/deepseek-v3.2"]
      : task==="idea"
        ? [model,"qwen/qwen3.8-max-0902","deepseek/deepseek-v3.2"]
        : [model,"qwen/qwen3.8-max-0902","deepseek/deepseek-v3.2"];
    let result:any=null;
    let raw:any=null;
    let usedModel=model;
    let lastError="OpenRouter returned no usable generated text.";

    for(const candidate of [...new Set(candidates)]){
      usedModel=candidate;
      try{
        const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
          method:"POST",
          headers:{"authorization":"Bearer "+key,"content-type":"application/json","HTTP-Referer":"https://ojgldkee.github.io/avonent-os/","X-Title":"Avonent OS"},
          body:JSON.stringify({
            model:candidate,
            temperature:task==="script"?0.55:0.62,
            messages:[
              {role:"system",content:prompt},
              {role:"user",content:JSON.stringify(input)}
            ],
            ...(task==="idea"?{}:{response_format:{type:"json_object"}}),
            ...(candidate.startsWith("deepseek/")?{reasoning:{enabled:false}}:candidate.includes("qwen3.8-max")?{reasoning:{effort:"low",exclude:true}}:{}),
            provider:{sort:"throughput",allow_fallbacks:true},
            max_tokens:task==="script"?5600:task==="idea"?3600:7000
          }),
          signal:AbortSignal.timeout(task==="script"?55000:task==="idea"?42000:55000)
        });
        raw=await response.json().catch(()=>({}));
        if(!response.ok){
          lastError=raw?.error?.message||("OpenRouter request failed with status "+response.status);
          console.warn("creative-ai provider error",JSON.stringify({candidate,status:response.status,error:lastError}));
          continue;
        }
        const message=raw?.choices?.[0]?.message;
        const generated=typeof message?.content==="string"
          ? message.content
          : Array.isArray(message?.content)
            ? message.content.map((part:any)=>typeof part==="string"?part:(part?.text||"")).join("")
            : "";
        if(!generated.trim()){
          console.warn("creative-ai empty",JSON.stringify({
            candidate,
            finish_reason:raw?.choices?.[0]?.finish_reason||"",
            native_finish_reason:raw?.choices?.[0]?.native_finish_reason||"",
            provider:raw?.provider||"",
            message_keys:Object.keys(message||{}),
            usage:raw?.usage||null
          }));
          lastError="The model returned an empty response.";
          continue;
        }
        result=validateProductClaims(task,validateResult(task,parseJson(generated)),input.product);
        break;
      }catch(error){
        lastError=error instanceof Error?error.message:String(error);
        console.warn("creative-ai candidate failed",JSON.stringify({candidate,error:lastError}));
      }
    }

    if(!result)throw new Error(lastError);

    if(task==="idea"){
      const requested=String(body?.primary_source_ad_id||"");
      const primary=research.find((a:any)=>String(a.ad_archive_id)===requested)||research[0];
      if(!primary)throw new Error("AI output validation failed: no source ad was available.");
      const exact=String(primary.exact_spoken_opening||"").trim();
      const observed=exact||openingFromText(primary.primary_text||primary.headline||"");
      result.idea.source_adaptation={
        ...(result.idea.source_adaptation||{}),
        ad_archive_id:String(primary.ad_archive_id||""),
        advertiser_name:String(primary.advertiser_name||""),
        observed_opening_text:observed,
        opening_type:exact?"spoken_transcript":"primary_text",
        spoken_hook_available:Boolean(exact)
      };
      result.idea.source_ad_ids=Array.from(new Set([
        String(primary.ad_archive_id||""),
        ...(Array.isArray(result.idea.source_ad_ids)?result.idea.source_ad_ids.map(String):[])
      ].filter(Boolean))).slice(0,4);
    }

    return out(200,{ok:true,task,model:usedModel,result,usage:raw?.usage||null});
  }catch(e){
    console.error("creative-ai",e instanceof Error?e.message:String(e));
    return out(500,{error:e instanceof Error?e.message:"Creative AI failed."});
  }
});