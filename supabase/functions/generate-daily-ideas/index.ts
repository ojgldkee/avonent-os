import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={
  "access-control-allow-origin":"*",
  "access-control-allow-headers":"authorization, content-type",
  "access-control-allow-methods":"POST, OPTIONS",
  "content-type":"application/json"
};
const out=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:CORS});

function rowFromIdea(userId:string,product:any,idea:any,model:string,available:Set<string>,date:string){
  return {
    user_id:userId,
    product_id:product.id,
    title:idea.title||"",
    hook:idea.hook||"",
    angle:idea.angle||"",
    format:idea.format||"",
    first_frame:idea.first_frame||"",
    execution:idea.idea||idea.execution||"",
    proof_to_show:idea.proof_to_show||"",
    cta:idea.cta||"",
    why_test:idea.why_test||"",
    inspiration:idea.inspiration||"",
    source_ad_ids:(Array.isArray(idea.source_ad_ids)?idea.source_ad_ids:[])
      .map(String).filter((id:string)=>available.has(id)).slice(0,4),
    strategy:{
      hooks:Array.isArray(idea.hooks)?idea.hooks:[],
      audience:idea.audience||"",
      first_three_seconds:idea.first_three_seconds||{},
      primary_text:idea.primary_text||"",
      headline:idea.headline||"",
      description:idea.description||"",
      video_concept:idea.video_concept||"",
      video_structure:idea.video_structure||"",
      recommended_duration_seconds:Number(idea.recommended_duration_seconds||0),
      production_style:idea.production_style||"",
      shot_directions:Array.isArray(idea.shot_directions)?idea.shot_directions:[],
      timed_script:Array.isArray(idea.timed_script)?idea.timed_script:[],
      animation_prompts:Array.isArray(idea.animation_prompts)?idea.animation_prompts:[],
      hook_adaptation:idea.hook_adaptation||null,
      narrative_truth_mode:idea.narrative_truth_mode||"",
      story_arc:idea.story_arc||null,
      visual_recipe:idea.visual_recipe||null,
      source_adaptation:idea.source_adaptation||null,
      source_claims:Array.isArray(idea.source_claims)?idea.source_claims:[],
      source_observations:Array.isArray(idea.source_observations)?idea.source_observations:[],
      ai_inferences:Array.isArray(idea.ai_inferences)?idea.ai_inferences:[],
      product_fact_checks:Array.isArray(idea.product_fact_checks)?idea.product_fact_checks:[],
      unsupported_claim_checks:Array.isArray(idea.unsupported_claim_checks)?idea.unsupported_claim_checks:[],
      hypothesis:idea.hypothesis||"",
      risk:idea.risk||"",
      scores:idea.scores||{},
      overall_score:Number(idea.overall_score||0),
      generated_by:"nightly",
      generated_at:new Date().toISOString()
    },
    idea_model:model||"",
    generated_for_date:date
  };
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:CORS});
  if(req.method!=="POST")return out(405,{error:"POST required"});

  try{
    const url=Deno.env.get("SUPABASE_URL")||"";
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
    const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    const body=await req.json().catch(()=>({}));
    if(!url||!service)return out(503,{error:"Supabase server configuration missing"});

    const admin=createClient(url,service,{auth:{persistSession:false}});
    let authorized=Boolean(token&&token===service);
    if(!authorized&&body?.scheduler_token){
      const secret=await admin.from("avonent_scheduler_secret").select("token").eq("id",true).maybeSingle();
      if(secret.error)throw secret.error;
      authorized=Boolean(secret.data?.token&&String(secret.data.token)===String(body.scheduler_token));
    }
    if(!authorized)return out(401,{error:"Scheduler authorization required"});

    const today=new Date().toISOString().slice(0,10);
    const archiveBefore=new Date(Date.now()-7*86400000).toISOString().slice(0,10);

    // Keep the live inbox small: untouched ideas older than 7 days move to Archive.
    const archiveOld=await admin.from("ai_ideas").update({
      lifecycle_status:"archived",
      archived_at:new Date().toISOString(),
      updated_at:new Date().toISOString()
    }).eq("lifecycle_status","new").lt("generated_for_date",archiveBefore).neq("status","Approved");
    if(archiveOld.error)throw archiveOld.error;

    const productsResult=await admin.from("products")
      .select("*")
      .eq("active",true)
      .order("updated_at",{ascending:false})
      .limit(12);
    if(productsResult.error)throw productsResult.error;

    const results:any[]=[];
    for(const product of productsResult.data||[]){
      const existing=await admin.from("ai_ideas")
        .select("id,status,strategy")
        .eq("product_id",product.id)
        .eq("generated_for_date",today);
      if(existing.error)throw existing.error;

      const existingCount=(existing.data||[]).filter((row:any)=>
        row.status!=="Rejected" && Boolean(row.strategy?.source_adaptation?.ad_archive_id)
      ).length;
      const needed=Math.max(0,5-existingCount);
      if(!needed){
        results.push({product_id:product.id,product:product.name,status:"already_ready",existing:existingCount,generated:0});
        continue;
      }

      const recentIdeas=await admin.from("ai_ideas")
        .select("source_ad_ids,created_at,lifecycle_status,status")
        .eq("product_id",product.id)
        .gte("created_at",new Date(Date.now()-30*86400000).toISOString())
        .order("created_at",{ascending:false})
        .limit(150);
      if(recentIdeas.error)throw recentIdeas.error;
      const recentlyUsedSourceIds=new Set(
        (recentIdeas.data||[]).flatMap((row:any)=>Array.isArray(row.source_ad_ids)?row.source_ad_ids.map(String):[])
      );

      const adsResult=await admin.from("competitor_ads")
        .select("ad_archive_id,advertiser_name,primary_text,headline,description,display_format,media_kind,media_url,media_thumbnail_url,started_at,days_running,source_url,video_transcript,video_transcript_segments,video_duration_seconds,transcription_status,ai_analysis")
        .eq("user_id",product.user_id)
        .eq("product_id",product.id)
        .eq("is_active",true)
        .order("days_running",{ascending:false})
        .limit(80);
      if(adsResult.error)throw adsResult.error;
      const ads=adsResult.data||[];

      if(!ads.length){
        results.push({product_id:product.id,product:product.name,status:"no_research",existing:existingCount,generated:0});
        continue;
      }

      const slots=Array.from({length:needed},(_,i)=>existingCount+i+1);
      const rankedAds=[...ads].sort((a:any,b:any)=>{
        const freshnessA=recentlyUsedSourceIds.has(String(a.ad_archive_id||""))?-1200:0;
        const freshnessB=recentlyUsedSourceIds.has(String(b.ad_archive_id||""))?-1200:0;
        const as=freshnessA+Number(Boolean(a.video_transcript))*1000+Number(Boolean(a.ai_analysis?.visual_analysis_available))*500+Number(a.ai_analysis?.research_score||0)*3+Number(a.days_running||0);
        const bs=freshnessB+Number(Boolean(b.video_transcript))*1000+Number(Boolean(b.ai_analysis?.visual_analysis_available))*500+Number(b.ai_analysis?.research_score||0)*3+Number(b.days_running||0);
        return bs-as;
      });

      // Pick five materially different source ads: first diversify advertiser, then format,
      // then fill remaining slots with the next-best unused source.
      const diversified:any[]=[];
      const seenAdvertisers=new Set<string>();
      const seenFormats=new Set<string>();
      for(const ad of rankedAds){
        const adv=String(ad.advertiser_name||"").toLowerCase().trim();
        const fmt=String(ad.media_kind||ad.display_format||"").toLowerCase();
        if((adv&&!seenAdvertisers.has(adv)) || (fmt&&!seenFormats.has(fmt))){
          diversified.push(ad);
          if(adv)seenAdvertisers.add(adv);
          if(fmt)seenFormats.add(fmt);
        }
        if(diversified.length>=5)break;
      }
      for(const ad of rankedAds){
        if(diversified.length>=5)break;
        if(!diversified.includes(ad))diversified.push(ad);
      }

      const jobs=slots.map(async variation=>{
        const primary=diversified[(variation-1)%diversified.length];
        const response=await fetch(url.replace(/\/$/,"")+"/functions/v1/creative-ai",{
          method:"POST",
          headers:{
            "authorization":"Bearer "+service,
            "content-type":"application/json"
          },
          body:JSON.stringify({
            task:"idea",
            variation:Math.min(5,variation),
            primary_source_ad_id:primary?.ad_archive_id||"",
            product,
            competitor_ads:rankedAds.slice(0,20)
          }),
          signal:AbortSignal.timeout(70000)
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data?.error||("creative-ai failed: "+response.status));
        const idea=data?.result?.idea;
        if(!idea?.title||!idea?.hook)throw new Error("creative-ai returned an incomplete concept");
        return {idea,model:data.model||""};
      });

      const settled=await Promise.allSettled(jobs);
      const good=settled.filter((x:any)=>x.status==="fulfilled").map((x:any)=>x.value);
      const available=new Set(ads.map((a:any)=>String(a.ad_archive_id||"")).filter(Boolean));
      const rows=good.map(({idea,model}:any)=>rowFromIdea(product.user_id,product,idea,model,available,today));

      if(rows.length){
        const saved=await admin.from("ai_ideas").insert(rows);
        if(saved.error)throw saved.error;
      }

      results.push({
        product_id:product.id,
        product:product.name,
        status:rows.length===needed?"generated":"partial",
        existing:existingCount,
        requested:needed,
        generated:rows.length,
        failed:settled.length-rows.length
      });
    }

    return out(200,{ok:true,date:today,products:results});
  }catch(error){
    console.error("generate-daily-ideas",error instanceof Error?error.message:String(error));
    return out(500,{error:error instanceof Error?error.message:"Nightly idea generation failed"});
  }
});