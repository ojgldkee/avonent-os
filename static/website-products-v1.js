(() => {
  "use strict";
  const cloud=window.AVONENT_CLOUD;
  if(!cloud) return;
  const db=cloud.db;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  let session=null, products=[], selected=null;

  function imageFor(p){
    return p?.site_data?.image_url || p?.shopify_data?.image?.url || "";
  }
  function variantsFor(p){
    return Array.isArray(p?.site_data?.variants) ? p.site_data.variants :
      Array.isArray(p?.shopify_data?.variants) ? p.shopify_data.variants : [];
  }
  function priceRange(p){
    const nums=variantsFor(p).map(v=>Number(v.price)).filter(Number.isFinite);
    if(!nums.length) return "";
    const min=Math.min(...nums), max=Math.max(...nums);
    return min===max ? "$"+min.toFixed(2) : "$"+min.toFixed(2)+"–$"+max.toFixed(2);
  }

  async function load(){
    const r=await db.from("products").select("*").order("updated_at",{ascending:false});
    if(r.error) throw r.error;
    products=r.data||[];
    $("product-count").textContent=String(products.length);
    renderList();
    if(selected){
      const again=products.find(p=>p.id===selected.id);
      if(again) selectProduct(again);
    } else if(products[0]) {
      selectProduct(products[0]);
    }
  }

  function renderList(){
    const box=$("product-list");
    if(!products.length){
      box.innerHTML='<div class="empty">No products yet. Scan avonent.com.</div>';
      return;
    }
    box.innerHTML=products.map(p=>{
      const img=imageFor(p), price=priceRange(p);
      return '<button type="button" class="product-list-card'+(selected?.id===p.id?' active':'')+'" data-product="'+p.id+'">'+
        (img?'<img src="'+esc(img)+'" alt="" loading="lazy">':'<div class="product-thumb-empty">AV</div>')+
        '<div><strong>'+esc(p.name)+'</strong><span>'+esc(p.category||"Uncategorized")+(price?" · "+esc(price):"")+'</span>'+
        '<small>'+(p.site_synced_at?"Website synced":"Manual product")+'</small></div>'+
      '</button>';
    }).join("");
  }

  function selectProduct(p){
    selected=p;
    renderList();
    $("product-empty").classList.add("hidden");
    $("product-form").classList.remove("hidden");
    $("product-id").value=p.id;
    $("product-form-title").textContent=p.name||"Product";
    $("product-brand").value=p.brand_name||"Avonent Health";
    $("product-name").value=p.name||"";
    $("product-category").value=p.category||"";
    $("product-active").value=String(p.active!==false);
    $("product-audience").value=p.audience||"";
    $("product-pains").value=p.pain_points||"";
    $("product-benefits").value=p.benefits||"";
    $("product-offer").value=p.offer||"";
    $("product-proof").value=p.proof||"";
    $("product-facts").value=p.product_facts||p.site_data?.description||"";
    $("product-claims").value=p.claim_limits||"";
    $("product-voice").value=p.voice||"";
    $("product-notes").value=p.notes||"";

    const source=$("product-source-link");
    if(p.source_url){
      source.href=p.source_url;source.classList.remove("hidden");
    }else source.classList.add("hidden");

    const facts=[];
    const price=priceRange(p);
    if(price) facts.push(["Public price",price]);
    if(variantsFor(p).length) facts.push(["Variants",String(variantsFor(p).length)]);
    if(p.site_data?.vendor) facts.push(["Vendor",String(p.site_data.vendor)]);
    if(Array.isArray(p.site_data?.tags)&&p.site_data.tags.length) facts.push(["Tags",p.site_data.tags.slice(0,8).join(", ")]);
    if(p.site_synced_at) facts.push(["Last website scan",new Date(p.site_synced_at).toLocaleString()]);
    $("store-facts").innerHTML=facts.length
      ? '<div class="store-facts-grid">'+facts.map(([k,v])=>'<div><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>').join("")+'</div>'
      : '<p class="helper">No storefront metadata yet. Run the website scan.</p>';
  }

  async function save(event){
    event.preventDefault();
    if(!selected) return;
    const payload={
      brand_name:$("product-brand").value.trim()||"Avonent Health",
      name:$("product-name").value.trim(),
      category:$("product-category").value.trim(),
      active:$("product-active").value==="true",
      audience:$("product-audience").value.trim(),
      pain_points:$("product-pains").value.trim(),
      benefits:$("product-benefits").value.trim(),
      offer:$("product-offer").value.trim(),
      proof:$("product-proof").value.trim(),
      product_facts:$("product-facts").value.trim(),
      claim_limits:$("product-claims").value.trim(),
      voice:$("product-voice").value.trim(),
      notes:$("product-notes").value.trim(),
      updated_at:new Date().toISOString()
    };
    $("product-status").textContent="Saving product intelligence…";
    const r=await db.from("products").update(payload).eq("id",selected.id);
    if(r.error){$("product-status").textContent=r.error.message;return;}
    $("product-status").textContent="Saved. Future research and ideas will use this context.";
    await load();
  }

  async function scan(){
    const btn=$("scan-website");
    btn.disabled=true;btn.textContent="Scanning…";
    $("product-status").textContent="Scanning avonent.com for public products and product pages…";
    try{
      const r=await cloud.invoke("website-product-scan",{site:"https://avonent.com"});
      $("product-status").textContent="Found "+r.found+" product(s): "+r.created+" new, "+r.updated+" updated. Source: "+r.method+".";
      await load();
    }catch(e){
      $("product-status").textContent=e.message||String(e);
    }finally{
      btn.disabled=false;btn.textContent="Scan avonent.com";
    }
  }

  document.addEventListener("DOMContentLoaded",async()=>{
    try{
      session=await cloud.requireSession();
      await load();
      $("scan-website").onclick=scan;
      $("refresh-products").onclick=()=>load().catch(e=>$("product-status").textContent=e.message);
      $("product-form").onsubmit=save;
      $("product-list").onclick=e=>{
        const button=e.target.closest("[data-product]");
        if(!button)return;
        const p=products.find(x=>x.id===button.getAttribute("data-product"));
        if(p)selectProduct(p);
      };
    }catch(e){
      $("product-status").textContent=e.message||String(e);
    }
  });
})();