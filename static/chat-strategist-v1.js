/* Avonent local creative strategist chat engine. */
(() => {
  "use strict";
  const db=window.AVONENT_LOCAL_CLIENT;
  if(!db) return;

  function hash(text){
    let h=2166136261;
    for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
    return h>>>0;
  }

  async function getBrand(brandId){
    const r=await db.from("brands").select("*").order("updated_at",{ascending:false});
    const brands=r.data||[];
    return brands.find(b=>b.id===brandId)||brands.find(b=>b.active!==false)||brands[0]||null;
  }

  async function recentResearch(){
    const r=await db.from("ad_references").select("*").order("created_at",{ascending:false}).limit(12);
    return r.data||[];
  }

  function genericBrand(prompt){
    return {
      id:"generic",
      name:"Current product",
      product_name:"the product",
      audience:"the target customer",
      pain_points:"the problem the customer is trying to solve",
      benefits:"a clearer, simpler desired outcome",
      offer:"Learn more / try the product",
      proof:"use supportable product facts, demonstrations and customer experience",
      voice:"direct, specific and conversational",
      notes:prompt||""
    };
  }

  function packageText(p){
    return [
      "HOOK",p.hook,"",
      "PRIMARY TEXT A",p.primary_texts[0],"",
      "PRIMARY TEXT B",p.primary_texts[1],"",
      "HEADLINE A",p.headlines[0],"",
      "HEADLINE B",p.headlines[1],"",
      "VIDEO IDEA",p.video_idea,"",
      "30-SECOND SCRIPT",p.script,"",
      "WHY THIS WORKS",p.why,"",
      "COMPLIANCE",p.compliance
    ].join("\n");
  }

  function extraHooks(brand,base,count){
    const product=brand.product_name||brand.name||"this product";
    const pain=(brand.pain_points||"this problem").split(/\n|,|;/)[0].trim();
    const benefit=(brand.benefits||"a better outcome").split(/\n|,|;/)[0].trim();
    const hooks=[
      base.hook,
      "Before you buy another product for "+pain+", look at this.",
      "The part nobody explains about "+pain+" is what made me change my routine.",
      "I stopped making "+pain+" more complicated than it needed to be.",
      "If "+benefit+" is the goal, this is the product detail I would pay attention to.",
      "I was skeptical of "+product+" for one reason — then I saw how it actually fits into a routine.",
      "Three reasons I would choose "+product+" over another complicated routine.",
      "This is what I would want to know before spending money on "+product+".",
      "The best ad for "+product+" should show this before it says anything else.",
      "You do not need another vague promise. You need to see how "+product+" actually works."
    ];
    return hooks.slice(0,count||10);
  }

  function researchInsight(refs,brand){
    const relevant=refs.filter(r=>{
      if(!brand) return true;
      const hay=[r.advertiser_name,r.product_name,r.primary_text,r.hook,r.angle].join(" ").toLowerCase();
      return hay.includes(String(brand.name||"").toLowerCase())||hay.includes(String(brand.product_name||"").toLowerCase());
    });
    const rows=(relevant.length?relevant:refs).slice(0,5);
    if(!rows.length) return "";
    const patterns=rows.map(r=>{
      const pieces=[];
      if(r.advertiser_name) pieces.push(r.advertiser_name);
      if(r.hook) pieces.push("hook: "+r.hook);
      if(r.angle) pieces.push("angle: "+r.angle);
      return pieces.join(" — ");
    }).filter(Boolean);
    return patterns.length?"\n\nRECENT AD RESEARCH PATTERNS\n"+patterns.map(x=>"• "+x).join("\n"):"";
  }

  async function respond(prompt,brandId){
    const brand=(await getBrand(brandId))||genericBrand(prompt);
    const refs=await recentResearch();
    const date=new Date().toISOString().slice(0,10);
    const index=hash(prompt+"|"+brand.id+"|"+date)%7;
    const pack=window.AVONENT_STRATEGIST
      ? window.AVONENT_STRATEGIST.buildPackage(brand,date,index)
      : null;

    if(!pack) return {text:"Add a brand in Brands so the strategist can build a complete creative package.",brand};

    const q=String(prompt||"").toLowerCase();
    let text="";

    if(/hook|opening|pattern interrupt/.test(q)){
      const hooks=extraHooks(brand,pack,10);
      text="10 HOOKS FOR "+String(brand.name||"THE BRAND").toUpperCase()+"\n\n"+
        hooks.map((h,i)=>(i+1)+". "+h).join("\n")+
        "\n\nBEST NEXT TEST\n"+pack.video_idea+
        "\n\nPRIMARY TEXT\n"+pack.primary_texts[0]+
        "\n\nHEADLINES\n1. "+pack.headlines[0]+"\n2. "+pack.headlines[1];
    } else if(/script|ugc|video script|30.?second/.test(q)){
      text="VIDEO CONCEPT\n"+pack.video_idea+
        "\n\nSCRIPT\n"+pack.script+
        "\n\nPRIMARY TEXT A\n"+pack.primary_texts[0]+
        "\n\nPRIMARY TEXT B\n"+pack.primary_texts[1]+
        "\n\nHEADLINES\n1. "+pack.headlines[0]+"\n2. "+pack.headlines[1];
    } else if(/brief|production/.test(q)){
      text="CREATIVE BRIEF\n\nBrand: "+brand.name+
        "\nProduct: "+(brand.product_name||"")+
        "\nAngle: "+pack.angle+
        "\nFormat: "+pack.format+
        "\nAudience: "+(brand.audience||"")+
        "\n\nHOOK\n"+pack.hook+
        "\n\nCORE MESSAGE\n"+pack.primary_texts[0]+
        "\n\nSHOT / VIDEO IDEA\n"+pack.video_idea+
        "\n\nSCRIPT\n"+pack.script+
        "\n\nHEADLINES\n1. "+pack.headlines[0]+"\n2. "+pack.headlines[1]+
        "\n\nCOMPLIANCE\n"+pack.compliance;
    } else if(/primary text|copy|caption|body text/.test(q)){
      text="PRIMARY TEXT A\n"+pack.primary_texts[0]+
        "\n\nPRIMARY TEXT B\n"+pack.primary_texts[1]+
        "\n\nHEADLINE A\n"+pack.headlines[0]+
        "\n\nHEADLINE B\n"+pack.headlines[1]+
        "\n\nVIDEO IDEA\n"+pack.video_idea;
    } else if(/angle|concept|idea|creative/.test(q)){
      const variants=[];
      for(let i=0;i<5;i++){
        const p=window.AVONENT_STRATEGIST.buildPackage(brand,date,(index+i)%10);
        variants.push(
          (i+1)+". "+p.angle.toUpperCase()+
          "\nHook: "+p.hook+
          "\nVideo: "+p.video_idea+
          "\nHeadline: "+p.headlines[0]
        );
      }
      text="5 CREATIVE DIRECTIONS\n\n"+variants.join("\n\n")+
        "\n\nI would start with #1, #2 and #3 as a three-creative test.";
    } else if(/analy|competitor|research|ad library/.test(q)){
      text="COMPETITOR RESEARCH TAKEAWAY\n"+
        (refs.length
          ? "I found "+refs.length+" saved competitor reference"+(refs.length===1?"":"s")+" in this device workspace. Use them as pattern research, not proof an ad is profitable."
          : "There are no saved competitor ads yet. Add some in Ad Library so I can use the hooks and angles as research patterns.")+
        researchInsight(refs,brand)+
        "\n\nORIGINAL DIRECTION TO TEST\n"+packageText(pack);
    } else {
      text="CREATIVE STRATEGY FOR "+String(brand.name||"YOUR BRAND").toUpperCase()+"\n\n"+packageText(pack);
    }

    if(brand.notes) text+="\n\nBRAND MEMORY USED\n"+brand.notes;
    text+=researchInsight(refs,brand);

    return {text,brand,package:pack};
  }

  window.AVONENT_CHAT_STRATEGIST={respond,getBrand,recentResearch};

  document.addEventListener("DOMContentLoaded",async()=>{
    const select=document.getElementById("chat-brand-select");
    if(!select) return;
    const r=await db.from("brands").select("*").order("updated_at",{ascending:false});
    const list=r.data||[];
    select.innerHTML=list.length
      ? list.map((b,i)=>'<option value="'+b.id+'"'+(i===0?' selected':'')+'>'+String(b.name||"Brand").replace(/[&<>"]/g,"")+' — '+String(b.product_name||"").replace(/[&<>"]/g,"")+'</option>').join("")
      : '<option value="">No brand yet — add one in Brands</option>';
  });
})();