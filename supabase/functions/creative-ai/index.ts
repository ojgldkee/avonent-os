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
- Extract the source ad's actual opening, story engine, sentence rhythm, offer, product reveal, objection, proof, CTA, sequencing, edit rhythm, visual style and what is observed versus inferred.
- For the PRIMARY SOURCE, adapt CLOSELY at the structural level. Preserve the hook's sentence count, point of view, clause order, reveal placement, curiosity mechanism, emotional turn, pacing and approximate length. Rewrite the actual words for the user's product instead of inventing a different generic hook.
- If the source is a story ad, the output MUST also be a story ad. Do not collapse a narrative into generic education. Preserve the source story spine, tension escalation, delayed reveal and CTA position.
- If the source is direct-response talking-head, preserve that mode. If it is AI animation, preserve or deliberately upgrade that visual language.
- Never blend the primary source's opening with a different source's sequence. One idea has one primary source skeleton. Secondary ads may only contribute supporting patterns.
- Source longevity does not prove profitability. Do not claim an ad is a winner without performance data; call it a long-running or observed ad instead.
- Select a SPECIFIC source ad ID, cite exact source-supported observations, and build the new creative around it. If the source has only primary text, adapt the written sequence and label video pacing as a production hypothesis.
- Treat competitor claims, mechanisms, testimonials, timelines, offers and dramatic statements as CREATIVE SOURCE MATERIAL. They may be retained or closely adapted in the draft when that is what makes the source ad powerful.
- Do not silently present a source-derived claim as verified product truth. Preserve it in the creative, but record its origin in source_claims with origin="competitor_ad_unverified". The user will verify landing-page/product-page support before launch.
- Do not weaken a strong source hook or story merely because its claims are not yet verified. This system is for ad spying, concepting and script development first.
- No default "what if", "the truth about", "the X lie", "doctors hate", "everyone is wrong", "this changes everything", invented conspiracy, or clickbait that undermines the advertised product. Do not make all five concepts skeptical myth-busting.
- Optimize for a viewer who could actually buy: show a specific real-world problem, a believable reason to care, a concrete product moment, a natural CTA.
PRIMARY TEXT ADAPTATION:
- The generated primary_text is part of the source adaptation, not an afterthought. Study the PRIMARY SOURCE's written copy separately from its spoken script.
- Match the source copy's approximate LENGTH, paragraph count, density, use of bullets/emojis, reveal timing, offer placement and CTA rhythm when those elements are present. Do not collapse a long-form source ad into a tiny caption.
- If primary_text_word_count is supplied for the primary source and is at least 60 words, target roughly 80–120% of that word count unless product truth requires a shorter version.
- Preserve persuasive architecture, not copyrighted wording. Rewrite sentences and examples for the user's product; do not reproduce long passages from the source verbatim.
- If the source has only a short caption, a short adaptation is fine. If it has long direct-response copy, produce long direct-response copy.
PRODUCTION CONTRACT:
- Deliver a complete shootable script. Every timed beat MUST contain nonempty time, say, show, on_screen_text, footage_type, and provider. No placeholder fields. SAY is exact spoken dialogue; SHOW is camera/action direction; ON-SCREEN is actual caption. Footage types: UGC, PRODUCT, B_ROLL, AI_VIDEO, GRAPHIC. For non-AI footage provider is "camera/editor"; for AI_VIDEO choose a suggested model/provider (e.g. Higgsfield Seedance or MiniMax Hailuo), plus detailed generation prompt. Recommend AI only for shots impossible or impractical to film. Never imply AI-generated illustrations are clinical evidence.
- Write a complete 60–90 second ad by default, never a 20–25 second opening alone. Use 6–10 sequential timestamped beats starting at 0:00 and covering the entire story through a spoken CTA. Write 130–230 spoken words total at realistic pacing (~2–2.7 words/second). Each beat can span 8–15 seconds; do not force five-second scenes. recommended_duration_seconds must match the final timestamp. Longer source-led stories may run up to 120 seconds with enough dialogue. Keep production directions concise, not the spoken story.
- Every concept must contain 4 strong hook options. Hook 1 should be the closest usable adaptation of the primary source hook. Hooks 2-4 should be clearly different executions built from other observed source patterns, not generic filler.
- Describe filming setup, shot changes, cut timing, product shots, transitions, camera behavior, casting and any animation prompt/provider when relevant.
- VISUAL SPECIFICITY IS REQUIRED. Do not say only "AI animation" or "UGC." State what it looks like: e.g. real iPhone UGC in a parked car, photoreal AI spokesperson, stop-motion claymation, glossy 3D product macro, paper-cut collage, cinematic AI reenactment, medical-style explanatory animation, screen-recording, or practical B-roll.
- For AI_PERSON scenes, recommend Higgsfield + Kling 3.0 Pro by default unless another model better fits. For stylized/high-motion AI_VIDEO, Seedance 2.5 is a strong default. For character animation, Hailuo may be used. Always name provider + model and give a paste-ready prompt.
- The model must NOT make up evidence of video analysis, transcript, scene-by-scene observation, or success metrics.
FEEDBACK LOOP:
- creative_brain contains the user's explicit persistent preferences, rules, customer insights and creative lessons. Treat these as the strongest taste/instruction signal after verified product facts. Pinned memories outrank unpinned memories; product-specific memories outrank global memories.
- creative_feedback contains the user's real usage/winner/loser history when available.
- Prefer patterns similar to items marked winner. Avoid repeating patterns marked loser.
- "used" means the user chose that hook/script for production; treat it as a positive taste signal, but weaker than "winner".
- A recent creative with lifecycle_status="saved" is a mild positive taste signal.
- A recent creative with status="Rejected" is a negative taste signal. Learn what the user disliked structurally, but do not overfit from one rejection.
- "results" may include spend, CTR, CPC, CPA and ROAS. Use those numbers as the strongest optimization signal when they are present.
- Do not simply repeat a previous used hook. Learn the structural preference and apply it to a different source ad.
- recent_creatives lists recent hooks/angles/source IDs and statuses. Avoid near-duplicates. Today's concept should feel materially different in hook mechanism, story premise and visual execution from recent creatives unless the user explicitly marked a pattern as a winner.

Return one valid JSON object only, no markdown.`;

const IDEA_PROMPT=BASE+`
Generate exactly 5 source-grounded, DIFFERENT original concepts, with different primary source ads and persuasive approaches where available. Return {"ideas":[...]}.
Each idea: title,audience,angle,format,hook,hooks (4 strings),first_frame,first_three_seconds {say,show,on_screen_text},primary_text,headline,description,cta,video_concept,recommended_duration_seconds,production_style,shot_directions,timed_script,proof_to_show,execution,why_test,hypothesis,inspiration,source_ad_ids,source_observations,ai_inferences,product_fact_checks,unsupported_claim_checks,animation_prompts,scores,overall_score,risk.
Also include source_adaptation:{ad_archive_id,advertiser_name,observed_opening_text,opening_type,observed_sequence,adapted_sequence,spoken_hook_available,why_selected}.
timed_script beats must have {time,say,show,on_screen_text,footage_type,provider,animation_prompt}. All fields required and populated.
`;

const ONE_IDEA_PROMPT=BASE+`
Generate ONE production-ready ad by closely adapting ONE primary source ad.

PRIMARY SOURCE RULE:
- primary_source_ad_id identifies the source skeleton. Use that exact ad.
- competitor_research may contain short_exact_hook. When short_exact_hook is present for the PRIMARY SOURCE, Hook 1 MUST equal it WORD-FOR-WORD. Do not change the person, relationship, age, location, event, insult, scandal, wording, or sentence order. This is deliberate source-hook reuse.
- If the primary source has no short_exact_hook, make Hook 1 the closest practical adaptation of exact_spoken_opening: preserve sentence count, POV, clause order, curiosity device, emotional turn, reveal placement, intensity and approximate length.
- Hooks 2-4 should preferentially use short_exact_hook from the other supplied source ads, word-for-word, when available. Only invent/adapt a hook when there are not enough usable short source openings.
- Do NOT turn "mother-in-law + wedding dress" into "husband + wedding dress", "stepmom + Christmas" into "aunt + kitchen", or otherwise swap the source story for a new scenario. Preserve the actual source premise whenever a short exact hook is available.
- If the source opening is a narrative story, preserve the narrative grammar and open loop. If the source says "character → surprising observation → time span → hidden relationship/secret → expected outcome → reversal", the adapted hook should follow that same sequence.
- Keep strong source-derived claims/mechanisms in the creative draft when they are important to the source ad. Put each such claim in source_claims with the source ad ID and origin="competitor_ad_unverified" so it can be checked before launch.
- primary_text MUST also be closely source-shaped: use the primary source's copy length and formatting metadata and mirror its persuasive sequence without copying its sentences.
- If no real testimonial/story exists for the user's product, you may create a dramatized story concept, but label narrative_truth_mode="DRAMATIZED_SCENARIO" rather than pretending it is a verified customer testimonial.

STORY RULE:
- Build story_arc.source_story_spine directly from the primary source.
- Build story_arc.adapted_story_spine beat-for-beat from it.
- Preserve tension escalation and delayed product reveal when the source uses them.
- Do not turn a dramatic Resilia-style story into "here are 3 benefits" education.

VISUAL RULE:
- Create a visual_recipe that explains exactly what the finished ad should look and feel like.
- For every timed beat specify footage_type, visual_style, camera, setting, actor_or_subject, action, transition, provider, video_model, animation_style and animation_prompt.
- Allowed footage_type values: REAL_UGC, REAL_PRODUCT, REAL_B_ROLL, AI_PERSON, AI_VIDEO, AI_CLAYMATION, AI_3D, GRAPHIC, SCREEN_RECORDING.
- If AI is not needed, provider="camera/editor", video_model="", animation_prompt="".
- For AI_PERSON/AI_VIDEO/AI_CLAYMATION/AI_3D name the provider/model and provide a detailed generation prompt.

Return:
{"idea":{
"title":"","audience":"","angle":"","format":"",
"hook":"","hooks":["","","",""],
"hook_adaptation":{
  "source_hook_exact":"",
  "source_hook_type":"",
  "source_hook_blueprint":"",
  "adapted_hook":"",
  "what_was_preserved":[],
  "what_changed":[]
},
"narrative_truth_mode":"FACTUAL|DRAMATIZED_SCENARIO|NON_TESTIMONIAL",
"story_arc":{
  "source_story_type":"",
  "source_story_spine":[],
  "adapted_story_spine":[],
  "tension_curve":"",
  "reveal_point":"",
  "cta_position":""
},
"first_frame":"",
"first_three_seconds":{"say":"","show":"","on_screen_text":"","footage_type":"","visual_style":"","provider":"","video_model":""},
"primary_text":"","headline":"","description":"","cta":"",
"video_concept":"",
"recommended_duration_seconds":0,
"production_style":"",
"visual_recipe":{
  "overall_style":"",
  "source_visual_pattern":"",
  "adapted_visual_style":"",
  "actor_mode":"",
  "animation_style":"",
  "camera_language":"",
  "setting":"",
  "edit_rhythm":"",
  "color_texture":"",
  "aspect_ratio":"9:16",
  "provider_stack":[]
},
"shot_directions":[],
"timed_script":[{
  "time":"","say":"","show":"","on_screen_text":"",
  "footage_type":"","visual_style":"","camera":"","setting":"",
  "actor_or_subject":"","action":"","transition":"",
  "provider":"","video_model":"","animation_style":"",
  "animation_prompt":"","source_reference":""
}],
"proof_to_show":"","execution":"","why_test":"","hypothesis":"","inspiration":"",
"source_ad_ids":[],
"source_observations":[],
"source_claims":[{"claim":"","source_ad_id":"","origin":"competitor_ad_unverified"}],
"ai_inferences":[],
"product_fact_checks":[],
"unsupported_claim_checks":[],
"animation_prompts":[],
"scores":{},"overall_score":0,"risk":"",
"source_adaptation":{
  "ad_archive_id":"","advertiser_name":"","observed_opening_text":"",
  "opening_type":"","observed_sequence":[],"adapted_sequence":[],
  "spoken_hook_available":false,"why_selected":"",
  "source_story_structure":"","source_visual_hook":"","source_first_frame":"",
  "source_pacing":"","source_visual_production_notes":[]
}
}}

VALIDATION TARGETS:
- hooks exactly 4; hook === hook_adaptation.adapted_hook === hooks[0].
- first_three_seconds SAY/SHOW/ON-SCREEN all nonempty.
- timed_script 6-10 beats covering at least 60 seconds through a spoken CTA, with at least 120 spoken words. A hook-only 25-second timeline is invalid.
- Every beat has substantive SAY/SHOW, footage_type, visual_style, provider and source_reference.
- If footage is AI, provider/model/prompt must be populated.
- Do not sanitize the draft just because a competitor claim is unverified. Preserve useful source-derived claims in source_claims and keep them visible in the draft for creative review.
- Prioritize a compelling story, source fidelity, specificity and emotional intensity over generic marketing theory.
- Keep the JSON compact enough to finish reliably: concise strings, 6-8 timed beats, and no essay-length explanations. Aim to stay under about 3,800 output tokens.
`;

const SCRIPT_PROMPT=BASE+`
Turn the selected source-adapted concept into a final shoot-ready production script.

This is NOT a generic rewrite. Keep the exact source-ad creative architecture already stored in selected_idea:
- hook mechanism and cadence
- story spine
- tension/reveal order
- approximate pacing
- visual language
- product reveal position
- CTA position

The final script must feel like the same creative FORMAT rebuilt for the user's brand. Preserve the useful source claims/mechanisms in the draft when they drive the ad, while labeling them as source-derived/unverified rather than silently treating them as proven facts.
If selected_idea.hook_adaptation.copy_mode="verbatim_short_source_hook", the script MUST begin with selected_idea.hook exactly, word-for-word. Do not paraphrase, soften, swap characters, or replace the opening scenario. The first beat SAY must start with that exact short hook before continuing into original script material.

Return:
{"script":{
"title":"","audience":"","recommended_duration_seconds":0,"format":"",
"hook":"",
"hook_adaptation":{"source_hook_exact":"","source_hook_blueprint":"","adapted_hook":"","what_was_preserved":[]},
"story_arc":{"source_story_spine":[],"adapted_story_spine":[],"tension_curve":"","reveal_point":"","cta_position":""},
"visual_recipe":{"overall_style":"","actor_mode":"","animation_style":"","camera_language":"","setting":"","edit_rhythm":"","color_texture":"","provider_stack":[]},
"first_three_seconds":{"say":"","show":"","on_screen_text":"","footage_type":"","visual_style":"","provider":"","video_model":""},
"beats":[{
  "time":"","say":"","show":"","on_screen_text":"",
  "footage_type":"","visual_style":"","camera":"","setting":"",
  "actor_or_subject":"","action":"","transition":"",
  "provider":"","video_model":"","animation_style":"",
  "animation_prompt":"","source_reference":""
}],
"product_reveal":"","proof_moment":"","cta":"",
"editor_notes":[],
"source_observations":[],
"ai_inferences":[],
"product_fact_checks":[],
"unsupported_claim_checks":[],
"compliance_notes":[],
"three_alt_openings":[]
}}

Every beat must be fully populated and shootable. Use 6-10 beats covering 60–90 seconds (at least 120 spoken words). If selected_idea has a short draft, expand it into a complete story rather than preserving its short duration. End with the spoken CTA.
For story ads, write an actual beginning, escalation, reveal and resolution rather than a list of claims. Mirror the source story's emotional intensity and pacing; do not flatten it into cautious generic wellness copy.
For AI scenes, explain exactly what the viewer sees and how it should be generated. Name provider/model and write a paste-ready prompt.
For real UGC, specify the actor type, location, camera framing, movement, props and edit rhythm.
Do not reproduce the competitor's full script verbatim.
`;


function sourceWordCount(value:any){
  return String(value||"").trim().split(/\s+/).filter(Boolean).length;
}
function shortExactSourceHook(ad:any){
  const exact=String(ad?.exact_spoken_opening||"").trim().replace(/^["“]|["”]$/g,"");
  const written=String(ad?.primary_text||ad?.headline||"").trim();
  const candidate=exact||written.split(/\n+/).map((x:string)=>x.trim()).find(Boolean)||"";
  if(!candidate)return "";
  if(sourceWordCount(candidate)<=25)return candidate;
  const sentences=candidate.match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[];
  const first=String(sentences[0]||"").trim();
  return first&&sourceWordCount(first)<=25?first:"";
}

function normalizeClaimText(value:any){
  return String(value||"").toLowerCase().replace(/[’']/g,"'").replace(/[-–—]+/g," ").replace(/\s+/g," ").trim();
}
function creativeClaimCorpus(task:string,result:any){
  const x=task==="script"?result?.script:task==="idea"?result?.idea:result?.ideas;
  if(Array.isArray(x))return x.map((i:any)=>creativeClaimCorpus("idea",{idea:i})).join(" ");
  if(!x)return "";
  const beats=task==="script"?x.beats:x.timed_script;
  return normalizeClaimText([
    x.title,x.hook,...(Array.isArray(x.hooks)?x.hooks:[]),x.primary_text,x.headline,x.description,
    x.cta,x.proof_to_show,x.execution,x.video_concept,x.first_frame,
    x.first_three_seconds?.say,x.first_three_seconds?.show,x.first_three_seconds?.on_screen_text,
    ...(Array.isArray(x.shot_directions)?x.shot_directions.map((d:any)=>typeof d==="string"?d:JSON.stringify(d)):[]),
    ...(Array.isArray(beats)?beats.flatMap((b:any)=>[b?.say,b?.show,b?.on_screen_text]):[])
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
function findUnsupportedProductClaims(task:string,result:any,product:any){
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
    "filler","knockoff","fake product","scam","crash","jitter","reset","vitality","well being",
    "supports","support energy","boost energy","boosts energy","improve digestion","improves digestion",
    "feel the difference","nutrient deficit","nutrient depletion","steady energy","natural energy",
    "two capsules","two softgels","two soft gels"
  ];
  const unsupported=risky.filter(term=>output.includes(term)&&!facts.includes(term));
  const statMatches=output.match(/\b\d+(?:\.\d+)?\s*(?:%|percent|out of\s+\d+)\b/g)||[];
  for(const stat of statMatches)if(!facts.includes(stat))unsupported.push(stat);
  const timeMatches=output.match(/\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty four|forty eight|seventy two)\s*(?:hour|hours|day|days|week|weeks)\b/g)||[];
  for(const span of timeMatches)if(!facts.includes(span))unsupported.push(span);
  const dosageMatches=output.match(/\b(?:take|taking|use|using)\s+(?:one|two|three|four|\d+)\s+(?:capsule|capsules|softgel|softgels|soft gel|soft gels)\b/g)||[];
  for(const dose of dosageMatches)if(!facts.includes(dose))unsupported.push(dose);
  return [...new Set(unsupported)];
}
function validateProductClaims(task:string,result:any,product:any){
  const unique=findUnsupportedProductClaims(task,result,product);
  if(unique.length)throw new Error("AI output validation failed: unsupported product claims detected: "+unique.slice(0,8).join(", "));
  return result;
}

function deepMergeCreative(base:any, patch:any):any{
  if(Array.isArray(patch))return patch;
  if(!patch||typeof patch!=="object")return patch===undefined?base:patch;
  const output={...(base&&typeof base==="object"&&!Array.isArray(base)?base:{})};
  for(const [key,value] of Object.entries(patch)){
    if(value&&typeof value==="object"&&!Array.isArray(value)&&output[key]&&typeof output[key]==="object"&&!Array.isArray(output[key])){
      output[key]=deepMergeCreative(output[key],value);
    }else{
      output[key]=value;
    }
  }
  return output;
}

async function repairUnsupportedClaims(key:string,task:string,result:any,product:any,issues:string[]){
  const facts=verifiedFactCorpus(product);
  const repairPrompt=`You are a strict factual editor for advertising production.
Preserve the source-ad structure, pacing, hook mechanism, timestamps, footage choices, and overall concept.
Rewrite ONLY what is needed to remove unsupported product claims.
You may use only VERIFIED_FACTS below for factual claims about the advertised product.
Do not replace removed claims with new wellness, biological, ingredient, testing, certification, offer, dosage, timeline, or outcome claims.
If proof is unavailable, use neutral observable product language and put "Proof needed before use" in proof_to_show.
Every script beat must remain complete. Return either the full corrected object or a same-shaped JSON patch containing only fields you changed. Never rename the top-level "idea" or "script" key. JSON only.`;

  let lastError="Claim repair failed.";
  for(const repairModel of ["qwen/qwen3.7-flash","google/gemini-3.8-flash"]){
    try{
      const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{
        method:"POST",
        headers:{"authorization":"Bearer "+key,"content-type":"application/json","HTTP-Referer":"https://ojgldkee.github.io/avonent-os/","X-Title":"Avonent OS"},
        body:JSON.stringify({
          model:repairModel,
          temperature:0.2,
          ...(repairModel.includes("qwen3.7-flash")?{reasoning:{enabled:false}}:{}),
          response_format:{type:"json_object"},
          messages:[
            {role:"system",content:repairPrompt},
            {role:"user",content:JSON.stringify({
              verified_facts:facts,
              unsupported_claims:issues,
              draft:result
            })}
          ],
          provider:{sort:"throughput",allow_fallbacks:true},
          max_tokens:task==="script"?5200:3600
        }),
        signal:AbortSignal.timeout(task==="script"?40000:32000)
      });
      const raw=await response.json().catch(()=>({}));
      if(!response.ok){
        lastError=raw?.error?.message||("Claim repair failed with status "+response.status);
        continue;
      }
      const message=raw?.choices?.[0]?.message?.content;
      const text=typeof message==="string"?message:Array.isArray(message)?message.map((p:any)=>typeof p==="string"?p:(p?.text||"")).join(""):"";
      if(!text.trim()){
        lastError="Claim repair returned no text.";
        continue;
      }
      const patch=parseJson(text);
      return deepMergeCreative(result,patch);
    }catch(error){
      lastError=error instanceof Error?error.message:String(error);
    }
  }
  throw new Error(lastError);
}

function compactCaption(text:any){
  return String(text||"").replace(/\s+/g," ").trim().split(/\s+/).slice(0,9).join(" ");
}

function normalizeBeat(beat:any,index:number,script:any){
  const b={...(beat||{})};
  b.time=String(b.time||"").trim()||("Beat "+(index+1));
  b.say=String(b.say||"").trim();
  b.show=String(b.show||"").trim();
  b.on_screen_text=String(b.on_screen_text||"").trim()||compactCaption(b.say);
  b.footage_type=String(b.footage_type||"").trim()||"REAL_UGC";
  b.visual_style=String(b.visual_style||"").trim()||String(b.show||"natural direct-response social video").trim();
  b.camera=String(b.camera||"").trim()||"Vertical 9:16 social framing; camera choice follows the described shot.";
  b.setting=String(b.setting||"").trim()||"Setting follows the described shot.";
  b.actor_or_subject=String(b.actor_or_subject||"").trim()||"Primary speaker or product shown in the scene.";
  b.action=String(b.action||"").trim()||String(b.show||"Perform the described visual action.").trim();
  b.transition=String(b.transition||"").trim()||(index===0?"Hard open":"Fast direct-response cut");
  b.provider=String(b.provider||"").trim()||(/^AI_/i.test(b.footage_type)?"Higgsfield":"camera/editor");
  b.video_model=String(b.video_model||"").trim();
  b.animation_style=String(b.animation_style||"").trim();
  b.animation_prompt=String(b.animation_prompt||"").trim();
  b.source_reference=String(b.source_reference||"").trim()||("Primary source beat "+(index+1));
  if(/^AI_/i.test(b.footage_type)&&!b.video_model){
    b.video_model=b.footage_type==="AI_PERSON"?"Kling 3.0 Pro":b.footage_type==="AI_CLAYMATION"?"Seedance 2.5":"Seedance 2.5";
  }
  if(/^AI_/i.test(b.footage_type)&&!b.animation_prompt){
    b.animation_prompt="Generate the described vertical 9:16 scene: "+b.show+" Style: "+b.visual_style+". Camera: "+b.camera+". Setting: "+b.setting+". Action: "+b.action+".";
  }
  return b;
}

function validateScriptDuration(script:any, beats:any[]) {
  let end = 0;
  let words = 0;
  for (const beat of beats) {
    const match = String(beat.time || "").match(/^\s*(\d+):(\d{2})\s*[-–—]\s*(\d+):(\d{2})\s*$/);
    if (!match) throw new Error("Script timing must use m:ss-m:ss ranges covering the full 60–90 second story.");
    const start = Number(match[1])*60 + Number(match[2]);
    const next = Number(match[3])*60 + Number(match[4]);
    if (Number(match[2]) >= 60 || Number(match[4]) >= 60 || start !== end || next <= start) throw new Error("Script beats must be sequential with no gaps or overlaps, starting at 0:00.");
    words += String(beat.say || "").trim().split(/\s+/).filter(Boolean).length;
    end = next;
  }
  if (end < 60 || words < 120 || words / end < 1.6 || words / end > 3.1) {
    throw new Error("Script is too short or has unrealistic pacing. Write a full 60–90 second story with 130–230 spoken words and a closing CTA; do not pad timestamps around a short hook.");
  }
  script.recommended_duration_seconds = end;
}

function validateResult(task:string,result:any){
  if(task==="idea"){
    const idea=result?.idea;
    if(!idea||!String(idea.title||"").trim()||!String(idea.hook||"").trim())throw new Error("AI output validation failed: incomplete idea.");

    if(!Array.isArray(idea.hooks))idea.hooks=[];
    idea.hooks=[idea.hook,...idea.hooks].map((x:any)=>String(x||"").trim()).filter(Boolean)
      .filter((x:string,i:number,a:string[])=>a.indexOf(x)===i).slice(0,4);
    if(idea.hooks.length<4)throw new Error("AI output validation failed: expected four usable hooks.");

    if(!Array.isArray(idea.timed_script))idea.timed_script=[];
    idea.timed_script=idea.timed_script.map((b:any,i:number)=>normalizeBeat(b,i,idea));
    if(idea.timed_script.length<4||idea.timed_script.some((b:any)=>!b.say||!b.show)){
      throw new Error("AI output validation failed: production script needs at least four complete spoken/visual beats.");
    }

    if(!idea.first_three_seconds||typeof idea.first_three_seconds!=="object")idea.first_three_seconds={};
    validateScriptDuration(idea,idea.timed_script);
    const first=idea.timed_script[0]||{};
    idea.first_three_seconds.say=String(idea.first_three_seconds.say||first.say||idea.hook||"").trim();
    idea.first_three_seconds.show=String(idea.first_three_seconds.show||first.show||idea.first_frame||"").trim();
    idea.first_three_seconds.on_screen_text=String(idea.first_three_seconds.on_screen_text||first.on_screen_text||compactCaption(idea.hook)).trim();
    idea.first_three_seconds.footage_type=String(idea.first_three_seconds.footage_type||first.footage_type||"REAL_UGC");
    idea.first_three_seconds.visual_style=String(idea.first_three_seconds.visual_style||first.visual_style||"native social ad");
    idea.first_three_seconds.provider=String(idea.first_three_seconds.provider||first.provider||"camera/editor");
    idea.first_three_seconds.video_model=String(idea.first_three_seconds.video_model||first.video_model||"");
    if(!idea.first_three_seconds.say||!idea.first_three_seconds.show||!idea.first_three_seconds.on_screen_text){
      throw new Error("AI output validation failed: first 3 seconds are incomplete.");
    }

    if(!idea.hook_adaptation||typeof idea.hook_adaptation!=="object")idea.hook_adaptation={};
    idea.hook_adaptation.adapted_hook=String(idea.hook_adaptation.adapted_hook||idea.hook||"");
    idea.hook_adaptation.source_hook_blueprint=String(idea.hook_adaptation.source_hook_blueprint||"Mirror the primary source hook's POV, pacing, curiosity mechanism and reveal pattern.");

    if(!idea.story_arc||typeof idea.story_arc!=="object")idea.story_arc={};
    if(!Array.isArray(idea.story_arc.adapted_story_spine)||idea.story_arc.adapted_story_spine.length<3){
      idea.story_arc.adapted_story_spine=idea.timed_script.slice(0,6).map((b:any)=>b.source_reference||b.say);
    }

    if(!idea.visual_recipe||typeof idea.visual_recipe!=="object")idea.visual_recipe={};
    idea.visual_recipe.overall_style=String(idea.visual_recipe.overall_style||idea.production_style||idea.timed_script[0]?.visual_style||"Native vertical direct-response video");
    if(!Array.isArray(idea.visual_recipe.provider_stack))idea.visual_recipe.provider_stack=[
      ...new Set(idea.timed_script.map((b:any)=>[b.provider,b.video_model].filter(Boolean).join(" / ")).filter(Boolean))
    ];

    if(!Array.isArray(idea.source_ad_ids))idea.source_ad_ids=[];
    if(!idea.source_adaptation||typeof idea.source_adaptation!=="object")idea.source_adaptation={};
    if(!Array.isArray(idea.shot_directions))idea.shot_directions=[];
    if(!Array.isArray(idea.source_observations))idea.source_observations=[];
    if(!Array.isArray(idea.source_claims))idea.source_claims=[];
    if(!Array.isArray(idea.ai_inferences))idea.ai_inferences=[];
    if(!Array.isArray(idea.product_fact_checks))idea.product_fact_checks=[];
    if(!Array.isArray(idea.unsupported_claim_checks))idea.unsupported_claim_checks=[];
    if(!Array.isArray(idea.animation_prompts))idea.animation_prompts=[];
  }else if(task==="ideas"){
    if(!Array.isArray(result?.ideas)||result.ideas.length!==5)throw new Error("AI output validation failed: expected five ideas.");
    result.ideas=result.ideas.map((idea:any)=>validateResult("idea",{idea}).idea);
  }else{
    const script=result?.script;
    if(!script||!Array.isArray(script.beats))throw new Error("AI output validation failed: incomplete script.");
    script.beats=script.beats.map((b:any,i:number)=>normalizeBeat(b,i,script));
    if(script.beats.length<5||script.beats.some((b:any)=>!b.say||!b.show)){
      throw new Error("AI output validation failed: final script needs at least five complete spoken/visual beats.");
    }
    if(!script.first_three_seconds||typeof script.first_three_seconds!=="object")script.first_three_seconds={};
    validateScriptDuration(script,script.beats);
    const first=script.beats[0]||{};
    script.first_three_seconds.say=String(script.first_three_seconds.say||first.say||script.hook||"");
    script.first_three_seconds.show=String(script.first_three_seconds.show||first.show||"");
    script.first_three_seconds.on_screen_text=String(script.first_three_seconds.on_screen_text||first.on_screen_text||compactCaption(script.hook||first.say));
    if(!script.visual_recipe||typeof script.visual_recipe!=="object")script.visual_recipe={overall_style:first.visual_style||"Native vertical direct-response video"};
    if(!script.story_arc||typeof script.story_arc!=="object")script.story_arc={adapted_story_spine:script.beats.slice(0,6).map((b:any)=>b.source_reference||b.say)};
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
    const suppliedAds=Array.isArray(body?.competitor_ads)?body.competitor_ads:[];
    const requestedPrimaryId=String(body?.primary_source_ad_id||body?.idea?.source_adaptation?.ad_archive_id||"");
    let ads=suppliedAds.length?[...suppliedAds]:[];

    if(product?.id&&!ads.length){
      let rowsQuery=admin.from("competitor_ads")
        .select("ad_archive_id,advertiser_name,primary_text,headline,description,cta_text,landing_url,display_format,media_kind,media_url,media_thumbnail_url,started_at,days_running,source_url,video_transcript,video_transcript_segments,video_duration_seconds,transcription_status,ai_analysis")
        .eq("product_id",product.id)
        .eq("is_active",true)
        .order("days_running",{ascending:false})
        .limit(task==="idea"?80:20);
      if(auth.userId)rowsQuery=rowsQuery.eq("user_id",auth.userId);
      const rows=await rowsQuery;
      if(rows.error)throw rows.error;
      ads=rows.data||[];
    }

    const primarySourceId=requestedPrimaryId;
    const primaryAd=ads.find((a:any)=>String(a.ad_archive_id||"")===primarySourceId)||ads[0]||null;
    const selectedAds=primaryAd ? [primaryAd,...ads.filter((a:any)=>a!==primaryAd).slice(0,3)] : ads.slice(0,4);
    const research=selectedAds.map((a:any)=>{
      const fullPrimary=String(a.primary_text||"");
      const isPrimary=String(a.ad_archive_id||"")===primarySourceId;
      const primaryTextLimit=isPrimary ? (task==="idea"?6000:7000) : (task==="idea"?1800:3000);
      const paragraphs=fullPrimary.split(/\n\s*\n/).map((x:string)=>x.trim()).filter(Boolean);
      const bulletLines=fullPrimary.split(/\n/).filter((line:string)=>/^\s*(?:[-•✅✔️💧🌿⭐👉→]|\d+[.)])/.test(line)).length;
      return {
      ad_archive_id:a.ad_archive_id,
      advertiser_name:a.advertiser_name,
      days_running:a.days_running,
      primary_text:fullPrimary.slice(0,primaryTextLimit),
      primary_text_word_count:fullPrimary.trim()?fullPrimary.trim().split(/\s+/).filter(Boolean).length:0,
      primary_text_paragraph_count:paragraphs.length,
      primary_text_bullet_lines:bulletLines,
      primary_text_has_emojis:/[\u{1F300}-\u{1FAFF}]/u.test(fullPrimary),
      headline:String(a.headline||"").slice(0,500),
      description:String(a.description||"").slice(0,task==="idea"?350:700),
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
      short_exact_hook:shortExactSourceHook({
        exact_spoken_opening:a.ai_analysis?.exact_spoken_opening||a.ai_analysis?.spoken_hook||"",
        primary_text:fullPrimary,
        headline:a.headline||""
      }),
      spoken_hook_type:a.ai_analysis?.spoken_hook_type||"",
      visual_hook:a.ai_analysis?.visual_hook||"",
      first_frame:a.ai_analysis?.first_frame||"",
      observed_sequence:a.ai_analysis?.observed_sequence||[],
      story_structure:a.ai_analysis?.story_structure||"",
      reusable_pattern:a.ai_analysis?.reusable_pattern||"",
      pacing:a.ai_analysis?.pacing||"",
      product_reveal:a.ai_analysis?.product_reveal||"",
      cta_structure:a.ai_analysis?.cta_structure||"",
      visual_production_notes:Array.isArray(a.ai_analysis?.visual_production_notes)?a.ai_analysis.visual_production_notes:[],
      analysis:JSON.stringify(a.ai_analysis||{}).slice(0,task==="idea"?1600:2800)
      };
    });

    const model=task==="script"
      ? (Deno.env.get("AVONENT_SCRIPT_MODEL")||"qwen/qwen3.8-27b")
      : (Deno.env.get("AVONENT_IDEA_MODEL")||"qwen/qwen3.8-27b");

    const prompt=task==="script"?SCRIPT_PROMPT:task==="idea"?ONE_IDEA_PROMPT:IDEA_PROMPT;
    let creativeFeedback:any[]=[];
    let recentCreatives:any[]=[];
    let creativeBrain:any[]=[];
    if(product?.id){
      let fq=admin.from("creative_usage_events")
        .select("asset_kind,action,content_snapshot,performance,notes,created_at")
        .eq("product_id",product.id)
        .order("created_at",{ascending:false})
        .limit(40);
      if(auth.userId)fq=fq.eq("user_id",auth.userId);
      const feedback=await fq;
      if(!feedback.error)creativeFeedback=feedback.data||[];

      let bq=admin.from("creative_brain")
        .select("title,content,category,pinned,product_id,source,updated_at")
        .or("product_id.is.null,product_id.eq."+product.id)
        .order("pinned",{ascending:false})
        .order("updated_at",{ascending:false})
        .limit(40);
      if(auth.userId)bq=bq.eq("user_id",auth.userId);
      const brain=await bq;
      if(!brain.error)creativeBrain=brain.data||[];

      let rq=admin.from("ai_ideas")
        .select("title,hook,angle,format,source_ad_ids,strategy,created_at,lifecycle_status,status")
        .eq("product_id",product.id)
        .order("created_at",{ascending:false})
        .limit(40);
      if(auth.userId)rq=rq.eq("user_id",auth.userId);
      const recent=await rq;
      if(!recent.error)recentCreatives=(recent.data||[]).map((row:any)=>({
        title:row.title||"",
        hook:row.hook||"",
        angle:row.angle||"",
        format:row.format||"",
        source_ad_ids:row.source_ad_ids||[],
        source_hook_blueprint:row.strategy?.hook_adaptation?.source_hook_blueprint||"",
        lifecycle_status:row.lifecycle_status||"new",
        status:row.status||"Idea"
      }));
    }

    const input={
      creative_brain:creativeBrain,
      creative_feedback:creativeFeedback,
      recent_creatives:recentCreatives,
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

    const candidates=[model,"google/gemini-3.8-flash"];
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
            response_format:{type:"json_object"},
            ...((candidate.includes("qwen3.8-27b")||candidate.includes("qwen3.7-flash"))?{reasoning:{enabled:false}}:{}),
            provider:{sort:"throughput",allow_fallbacks:true},
            max_tokens:task==="script"?5200:task==="idea"?3800:6200
          }),
          signal:AbortSignal.timeout(task==="script"?40000:task==="idea"?32000:40000)
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
        result=validateResult(task,parseJson(generated));
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
        observed_sequence:Array.isArray(primary.observed_sequence)?primary.observed_sequence:[],
        spoken_hook_available:Boolean(exact),
        source_story_structure:String(primary.story_structure||""),
        source_visual_hook:String(primary.visual_hook||""),
        source_first_frame:String(primary.first_frame||""),
        source_pacing:String(primary.pacing||""),
        source_visual_production_notes:Array.isArray(primary.visual_production_notes)?primary.visual_production_notes:[]
      };
      const exactSourceHooks=research.map((ad:any)=>({
        hook:String(ad.short_exact_hook||"").trim(),
        ad_archive_id:String(ad.ad_archive_id||""),
        advertiser_name:String(ad.advertiser_name||"")
      })).filter((item:any)=>item.hook);
      const uniqueExact:any[]=[];
      const seenExact=new Set<string>();
      for(const item of exactSourceHooks){
        const key=item.hook.toLowerCase().replace(/\s+/g," ").trim();
        if(!seenExact.has(key)){seenExact.add(key);uniqueExact.push(item);}
      }
      const primaryExact=uniqueExact.find((item:any)=>item.ad_archive_id===String(primary.ad_archive_id||""))?.hook||"";
      result.idea.hook_adaptation={
        ...(result.idea.hook_adaptation||{}),
        source_hook_exact:observed,
        source_hook_type:String(primary.spoken_hook_type||""),
        copy_mode:primaryExact?"verbatim_short_source_hook":"close_source_adaptation",
        exact_source_hook_used:Boolean(primaryExact),
        alt_source_hooks:uniqueExact.slice(1,4)
      };
      const generatedHooks=Array.isArray(result.idea.hooks)?result.idea.hooks.map((h:any)=>String(h||"").trim()).filter(Boolean):[];
      const exactHooks=uniqueExact.map((item:any)=>item.hook);
      const firstHook=primaryExact||String(result.idea.hook_adaptation?.adapted_hook||result.idea.hook||"").trim();
      const mergedHooks=[firstHook,...exactHooks.filter((h:string)=>h!==firstHook),...generatedHooks]
        .filter(Boolean)
        .filter((h:string,i:number,a:string[])=>a.findIndex(x=>x.toLowerCase().replace(/\s+/g," ").trim()===h.toLowerCase().replace(/\s+/g," ").trim())===i)
        .slice(0,4);
      result.idea.hook=firstHook;
      result.idea.hooks=mergedHooks;
      result.idea.hook_adaptation.adapted_hook=firstHook;
      if(primaryExact&&result.idea.first_three_seconds&&typeof result.idea.first_three_seconds==="object"){
        result.idea.first_three_seconds.say=primaryExact;
      }
      if(primaryExact&&Array.isArray(result.idea.timed_script)&&result.idea.timed_script.length){
        result.idea.timed_script[0].say=primaryExact;
      }
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
