(() => {
  "use strict";
  const db=window.AVONENT_LOCAL_CLIENT;
  if(!db) return;

  const $=id=>document.getElementById(id);
  const esc=value=>String(value==null?"":value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
  let brands=[];

  function clearForm(){
    $("brand-form").reset();
    $("brand-id").value="";
    $("brand-active").checked=true;
    $("brand-form-title").textContent="Add brand";
    $("brand-status").textContent="";
  }

  function values(){
    return {
      name:$("brand-name").value.trim(),
      product_name:$("brand-product").value.trim(),
      category:$("brand-category").value.trim(),
      competitors:$("brand-competitors").value.trim(),
      audience:$("brand-audience").value.trim(),
      pain_points:$("brand-pains").value.trim(),
      benefits:$("brand-benefits").value.trim(),
      offer:$("brand-offer").value.trim(),
      proof:$("brand-proof").value.trim(),
      product_facts:$("brand-facts").value.trim(),
      claim_limits:$("brand-claim-limits").value.trim(),
      voice:$("brand-voice").value.trim(),
      notes:$("brand-notes").value.trim(),
      active:$("brand-active").checked
    };
  }

  async function load(){
    const result=await db.from("brands").select("*").order("updated_at",{ascending:false});
    brands=result.data||[];
    render();
  }

  function summary(value,fallback){
    const text=String(value||"").replace(/\s+/g," ").trim();
    return text ? (text.length>115?text.slice(0,114)+"…":text) : fallback;
  }

  function render(){
    const grid=$("brand-grid");
    grid.innerHTML=brands.length?brands.map(brand=>
      '<article class="brand-card">'+
        '<div class="brand-card-head"><div><span class="pill">'+(brand.active!==false?"Daily on":"Paused")+'</span>'+
        '<h3>'+esc(brand.name)+'</h3><div class="meta">'+esc(brand.product_name||"No product")+'</div></div>'+
        '<button class="text-button mini" data-edit-brand="'+brand.id+'">Edit</button></div>'+
        '<div class="brand-knowledge-row"><span>Audience</span><p>'+esc(summary(brand.audience,"Not added yet"))+'</p></div>'+
        '<div class="brand-knowledge-row"><span>Problems</span><p>'+esc(summary(brand.pain_points,"Not added yet"))+'</p></div>'+
        '<div class="brand-knowledge-row"><span>Benefits</span><p>'+esc(summary(brand.benefits,"Not added yet"))+'</p></div>'+
        '<div class="card-actions">'+
          '<button class="button secondary mini" data-generate-brand="'+brand.id+'">Generate ideas</button>'+
          '<button class="button secondary mini" data-toggle-brand="'+brand.id+'">'+(brand.active!==false?"Pause daily":"Resume daily")+'</button>'+
          '<button class="button secondary mini" data-delete-brand="'+brand.id+'">Delete</button>'+
        '</div>'+
      '</article>'
    ).join(""):'<div class="empty">Add your first product. The daily strategist uses this knowledge instead of generic prompts.</div>';
  }

  $("brand-form").onsubmit=async event=>{
    event.preventDefault();
    const id=$("brand-id").value;
    const data=values();
    $("brand-status").textContent="Saving…";

    let result;
    if(id) result=await db.from("brands").update(data).eq("id",id);
    else result=await db.from("brands").insert({...data,user_id:"device-workspace"}).select("*").single();

    if(result.error){
      $("brand-status").textContent=result.error.message;
      return;
    }

    $("brand-status").textContent="Saved. Daily creative generation is ready.";
    await load();
    if(window.AVONENT_STRATEGIST) await window.AVONENT_STRATEGIST.ensureDaily();
    setTimeout(clearForm,500);
  };

  $("reset-brand").onclick=clearForm;

  $("seed-avonent").onclick=()=>{
    $("brand-name").value="Avonent Health";
    $("brand-product").value="Pure Moringa Capsules";
    $("brand-category").value="Supplements";
    $("brand-competitors").value="Resilia, Rosabella, Metabolae, Resia";
    $("brand-audience").value="Adults who want a simpler daily wellness routine and respond to practical, direct-response creative rather than vague wellness branding.";
    $("brand-pains").value="Afternoon energy slump; complicated supplement routines; skepticism about overhyped wellness products; inconsistent routines.";
    $("brand-benefits").value="Simple daily routine; convenient capsules; feeling more consistent with a wellness habit; an easy product to understand and use.";
    $("brand-offer").value="Current direct-response offer and 30-day money-back guarantee. Keep price/discount details editable before launch.";
    $("brand-proof").value="Use only supportable product facts, ingredient information, sourcing/testing facts that are actually documented, customer experience, product-in-hand demonstration, and the money-back guarantee.";
    $("brand-facts").value="Add exact label facts, format, sourcing, testing and documented differentiators here before AI generation.";
    $("brand-claim-limits").value="Do not invent product facts, testimonials, evidence, medical claims or guaranteed outcomes.";
    $("brand-voice").value="Direct, premium, conversational, skeptical of hype, clear and specific.";
    $("brand-notes").value="Avoid unsupported medical claims. Strong creative should feel native to Meta/TikTok, lead with a real problem or curiosity gap, and show the product quickly.";
  };

  $("brand-grid").onclick=async event=>{
    const editId=event.target.getAttribute("data-edit-brand");
    const generateId=event.target.getAttribute("data-generate-brand");
    const toggleId=event.target.getAttribute("data-toggle-brand");
    const deleteId=event.target.getAttribute("data-delete-brand");

    if(editId){
      const b=brands.find(x=>x.id===editId);
      if(!b) return;
      $("brand-id").value=b.id;
      $("brand-name").value=b.name||"";
      $("brand-product").value=b.product_name||"";
      $("brand-category").value=b.category||"";
      $("brand-competitors").value=b.competitors||"";
      $("brand-audience").value=b.audience||"";
      $("brand-pains").value=b.pain_points||"";
      $("brand-benefits").value=b.benefits||"";
      $("brand-offer").value=b.offer||"";
      $("brand-proof").value=b.proof||"";
      $("brand-facts").value=b.product_facts||"";
      $("brand-claim-limits").value=b.claim_limits||"";
      $("brand-voice").value=b.voice||"";
      $("brand-notes").value=b.notes||"";
      $("brand-active").checked=b.active!==false;
      $("brand-form-title").textContent="Edit "+b.name;
      scrollTo({top:0,behavior:"smooth"});
    }

    if(generateId){
      const b=brands.find(x=>x.id===generateId);
      if(!b||!window.AVONENT_STRATEGIST) return;
      event.target.disabled=true;event.target.textContent="Generating…";
      await window.AVONENT_STRATEGIST.generateForBrand(b,{force:true,count:3});
      event.target.disabled=false;event.target.textContent="Generate ideas";
      location.href="creatives.html?q="+encodeURIComponent(b.name);
    }

    if(toggleId){
      const b=brands.find(x=>x.id===toggleId);
      if(!b) return;
      await db.from("brands").update({active:b.active===false}).eq("id",b.id);
      await load();
    }

    if(deleteId){
      const b=brands.find(x=>x.id===deleteId);
      if(!b||!confirm("Delete "+b.name+" brand knowledge? Existing creatives stay in the library.")) return;
      await db.from("brands").delete().eq("id",b.id);
      await load();
    }
  };

  $("generate-all-brands").onclick=async()=>{
    if(!window.AVONENT_STRATEGIST) return;
    const btn=$("generate-all-brands");
    btn.disabled=true;btn.textContent="Generating…";
    const made=await window.AVONENT_STRATEGIST.generateNow();
    btn.disabled=false;btn.textContent="Generate today's ideas";
    if(!made.length) return alert("Add an active brand first.");
    location.href="creatives.html?kind=concept";
  };

  document.addEventListener("DOMContentLoaded",async()=>{
    await db.open();
    await load();
  });
})();