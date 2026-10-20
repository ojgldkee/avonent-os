(() => {
  "use strict";
  const db=window.AVONENT_LOCAL_CLIENT;
  if(!db) return;

  const $=id=>document.getElementById(id);
  const esc=value=>String(value==null?"":value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
  let refs=[];
  let assets={};
  let brands=[];

  function safeUrl(raw){
    try{const u=new URL(raw);return u.protocol==="https:"?u.href:"";}catch{return "";}
  }

  function parseMetaUrl(raw){
    const source=safeUrl(raw);
    if(!source) return {source:"",id:"",valid:false};
    try{
      const u=new URL(source);
      const host=u.hostname.replace(/^www\./,"").toLowerCase();
      const isMeta=(host==="facebook.com"||host==="fb.com")&&u.pathname.includes("/ads/library");
      const id=u.searchParams.get("id")||"";
      return {source,id,valid:isMeta&&/^\d+$/.test(id)};
    }catch{return {source,id:"",valid:false};}
  }

  function downloadBlob(blob,name){
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2500);
  }

  function fileSafe(value){
    return String(value||"ad").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"ad";
  }

  function currentData(){
    const parsed=parseMetaUrl($("ad-source-url").value.trim());
    return {
      source:"Meta Ad Library",
      source_url:parsed.source,
      ad_library_id:$("ad-library-id").value.trim()||parsed.id,
      brand_id:$("ad-brand-select").value||"",
      advertiser_name:$("ad-advertiser").value.trim(),
      product_name:$("ad-product").value.trim(),
      primary_text:$("ad-primary-text").value.trim(),
      hook:$("ad-hook").value.trim(),
      angle:$("ad-angle").value.trim(),
      description:$("ad-description").value.trim(),
      media_url:safeUrl($("ad-media-url").value.trim()),
      first_observed_date:$("ad-date").value||"",
      status:$("ad-status").value||"Saved"
    };
  }

  function packageText(data){
    return [
      "AVONENT AD RESEARCH",
      "",
      "Brand: "+(data.advertiser_name||""),
      "Product: "+(data.product_name||""),
      "Meta Ad ID: "+(data.ad_library_id||""),
      "Source: "+(data.source_url||""),
      "First observed: "+(data.first_observed_date||""),
      "",
      "PRIMARY TEXT",
      data.primary_text||"",
      "",
      "HOOK",
      data.hook||"",
      "",
      "ANGLE",
      data.angle||"",
      "",
      "DESCRIPTION / NOTES",
      data.description||"",
      "",
      "DIRECT MEDIA URL",
      data.media_url||""
    ].join("\n");
  }

  async function downloadDirectMedia(url,baseName){
    if(!url) return false;
    try{
      const response=await fetch(url,{mode:"cors",credentials:"omit"});
      if(!response.ok) throw new Error("HTTP "+response.status);
      const type=(response.headers.get("content-type")||"").toLowerCase();
      if(!(type.startsWith("image/")||type.startsWith("video/"))) throw new Error("Not image/video media");
      const blob=await response.blob();
      const ext=type.startsWith("video/")?".mp4":type.includes("png")?".png":".jpg";
      downloadBlob(blob,fileSafe(baseName)+"-media"+ext);
      return true;
    }catch{
      window.open(url,"_blank","noopener");
      return false;
    }
  }

  async function inspectMetaLink(){
    const raw=$("meta-link-input").value.trim();
    const parsed=parseMetaUrl(raw);
    const status=$("meta-link-status");

    if(!parsed.source){
      status.textContent="Paste a valid HTTPS URL.";
      return;
    }

    $("ad-source-url").value=parsed.source;
    $("ad-library-id").value=parsed.id;
    if(!$("ad-date").value) $("ad-date").value=new Date().toISOString().slice(0,10);

    if(!parsed.valid){
      status.textContent="The link was saved, but it does not look like a standard Meta Ad Library URL with an ad ID.";
    }else{
      status.textContent="Meta ad ID "+parsed.id+" captured. Add the visible brand/copy and attach the creative or a direct media URL, then save.";
    }

    renderPreview(currentData());
    $("ad-advertiser").focus();
  }

  function renderPreview(data,assetUrl){
    const preview=$("meta-preview");
    const media=assetUrl||data.media_url||"";
    let mediaHtml='<div class="research-media-empty"><span>AD '+esc(data.ad_library_id||"REFERENCE")+'</span><strong>'+esc(data.advertiser_name||"Meta Ad Library")+'</strong></div>';
    if(media){
      const lower=media.toLowerCase();
      mediaHtml=/\.(mp4|mov|webm)(\?|$)/.test(lower)
        ?'<video src="'+esc(media)+'" controls playsinline preload="metadata"></video>'
        :'<img src="'+esc(media)+'" alt="">';
    }

    preview.innerHTML=
      '<div class="research-preview-media">'+mediaHtml+'</div>'+
      '<div class="research-preview-copy">'+
        '<div class="research-preview-top"><span class="pill">'+esc(data.advertiser_name||"Unlabeled brand")+'</span><span class="meta">Ad '+esc(data.ad_library_id||"—")+'</span></div>'+
        '<h3>'+esc(data.product_name||"Competitor ad research")+'</h3>'+
        '<p class="research-primary">'+esc(data.primary_text||"Paste the primary text to make this research card searchable and reusable.")+'</p>'+
        '<div class="research-preview-actions">'+
          (data.primary_text?'<button class="button secondary mini" data-preview-copy="primary" type="button">Copy primary text</button>':'')+
          (data.source_url?'<a class="button secondary mini" href="'+esc(data.source_url)+'" target="_blank" rel="noopener">Open Meta ad</a>':'')+
        '</div>'+
      '</div>';

    const copy=preview.querySelector("[data-preview-copy]");
    if(copy) copy.onclick=async()=>{await navigator.clipboard.writeText(data.primary_text);copy.textContent="Copied";};
  }

  async function loadBrands(){
    const r=await db.from("brands").select("*").order("updated_at",{ascending:false});
    brands=r.data||[];
    const select=$("ad-brand-select");
    select.innerHTML='<option value="">No saved brand</option>'+brands.map(b=>'<option value="'+b.id+'">'+esc(b.name)+' — '+esc(b.product_name||"")+'</option>').join("");
    select.onchange=()=>{
      const b=brands.find(x=>x.id===select.value);
      if(b){
        if(!$("ad-advertiser").value) $("ad-advertiser").value=b.name||"";
        if(!$("ad-product").value) $("ad-product").value=b.product_name||"";
      }
      renderPreview(currentData());
    };
  }

  async function loadRefs(){
    const r=await db.from("ad_references").select("*").order("created_at",{ascending:false}).limit(500);
    refs=r.data||[];
    assets={};
    const ids=[...new Set(refs.map(x=>x.media_asset_id).filter(Boolean))];
    if(ids.length){
      const ar=await db.from("creative_assets").select("*").in("id",ids);
      for(const asset of (ar.data||[])){
        const signed=await db.storage.from("creative-assets").createSignedUrl(asset.storage_path,3600);
        asset.url=signed.data?signed.data.signedUrl:"";
        assets[asset.id]=asset;
      }
    }
    renderGrid();
  }

  function renderGrid(){
    const q=$("ad-search").value.trim().toLowerCase();
    const rows=refs.filter(r=>[
      r.advertiser_name,r.product_name,r.primary_text,r.hook,r.angle,r.description,r.ad_library_id
    ].join(" ").toLowerCase().includes(q));

    $("ad-grid").innerHTML=rows.length?rows.map(ref=>{
      const asset=assets[ref.media_asset_id];
      let media="";
      if(asset&&asset.url){
        media=(asset.mime_type||"").startsWith("video/")
          ?'<div class="ad-preview"><video src="'+esc(asset.url)+'" controls playsinline preload="metadata"></video></div>'
          :'<div class="ad-preview"><img src="'+esc(asset.url)+'" alt=""></div>';
      }
      return '<article class="ad-card">'+media+
        '<div class="ad-card-top"><span class="pill">'+esc(ref.advertiser_name||"Saved ad")+'</span><span class="meta">#'+esc(ref.ad_library_id||"—")+'</span></div>'+
        '<h3>'+esc(ref.product_name||"Competitor creative")+'</h3>'+
        (ref.primary_text?'<div class="saved-copy-block"><span>Primary text</span><p>'+esc(ref.primary_text)+'</p></div>':'')+
        (ref.hook?'<div class="saved-copy-block"><span>Hook</span><p>'+esc(ref.hook)+'</p></div>':'')+
        (ref.angle?'<div class="saved-copy-block"><span>Angle</span><p>'+esc(ref.angle)+'</p></div>':'')+
        '<div class="ad-actions">'+
          (ref.primary_text?'<button class="button secondary mini" data-copy-primary="'+ref.id+'">Copy primary</button>':'')+
          '<button class="button secondary mini" data-download-ref="'+ref.id+'">Download all</button>'+
          '<button class="button secondary mini" data-concept-ref="'+ref.id+'">Create concept</button>'+
          (ref.source_url?'<a class="button secondary mini" href="'+esc(ref.source_url)+'" target="_blank" rel="noopener">Open Meta</a>':'')+
          '<button class="button secondary mini" data-delete-ad="'+ref.id+'">Delete</button>'+
        '</div>'+
      '</article>';
    }).join(""):'<div class="empty wide">No matching ad research.</div>';
  }

  async function saveRef(event){
    event.preventDefault();
    const button=event.target.querySelector('button[type="submit"]');
    button.disabled=true;
    $("ad-save-status").textContent="Saving research…";
    let assetId=null;
    let uploadedPath=null;

    try{
      const data=currentData();
      if(!data.source_url) throw new Error("Paste a valid HTTPS Meta Ad Library link.");
      const file=$("ad-file").files[0];

      if(file){
        if(!/^(image|video)\//.test(file.type)) throw new Error("Choose an image or video file.");
        if(file.size>100*1024*1024) throw new Error("Media must be 100 MB or smaller.");
        const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,"-").slice(-120)||"ad-media";
        uploadedPath="device-workspace/ad-references/"+crypto.randomUUID()+"-"+safe;
        const up=await db.storage.from("creative-assets").upload(uploadedPath,file,{contentType:file.type,upsert:false});
        if(up.error) throw up.error;
        const ar=await db.from("creative_assets").insert({
          user_id:"device-workspace",
          storage_path:uploadedPath,
          original_name:file.name,
          mime_type:file.type||"application/octet-stream",
          size_bytes:file.size
        }).select("*").single();
        if(ar.error) throw ar.error;
        assetId=ar.data.id;
      }

      const saved=await db.from("ad_references").insert({
        user_id:"device-workspace",
        ...data,
        media_asset_id:assetId,
        notes:data.description,
        created_from:"meta_research"
      }).select("*").single();
      if(saved.error) throw saved.error;

      $("ad-save-status").textContent="Saved. This competitor ad can now be used as creative research.";
      event.target.reset();
      $("ad-library-id").value="";
      $("ad-date").value="";
      $("meta-link-input").value="";
      renderPreview({});
      await loadRefs();
    }catch(error){
      if(uploadedPath) await db.storage.from("creative-assets").remove([uploadedPath]);
      if(assetId) await db.from("creative_assets").delete().eq("id",assetId);
      $("ad-save-status").textContent=error.message||String(error);
    }finally{button.disabled=false;}
  }

  async function downloadPackage(ref){
    const data=ref||currentData();
    const name=fileSafe((data.advertiser_name||"ad")+"-"+(data.ad_library_id||"research"));
    downloadBlob(new Blob([packageText(data)],{type:"text/plain;charset=utf-8"}),name+".txt");

    const json={...data,exported_at:new Date().toISOString()};
    downloadBlob(new Blob([JSON.stringify(json,null,2)],{type:"application/json"}),name+".json");

    if(ref&&ref.media_asset_id&&assets[ref.media_asset_id]?.url){
      const asset=assets[ref.media_asset_id];
      const a=document.createElement("a");
      a.href=asset.url;a.download=asset.original_name||name+"-media";document.body.appendChild(a);a.click();a.remove();
      return;
    }

    if(data.media_url) await downloadDirectMedia(data.media_url,name);
  }

  async function createConcept(ref){
    const brand=brands.find(b=>b.id===(ref.brand_id||$("ad-brand-select").value));
    if(!brand){
      alert("Link this ad to a saved brand first. Avonent uses the brand knowledge to create an original concept.");
      return;
    }

    const date=new Date().toISOString().slice(0,10);
    const pack=window.AVONENT_STRATEGIST.buildPackage(brand,date,Math.abs(Number(String(ref.ad_library_id||"1").slice(-3)))%7);
    pack.hook=ref.hook?("Pattern to reinvent: "+ref.hook+"\n\nOriginal hook: "+pack.hook):pack.hook;
    pack.why="Inspired by the saved competitor angle without copying its wording. "+pack.why;

    const content=[
      "HOOK",pack.hook,"","PRIMARY TEXT A",pack.primary_texts[0],"","PRIMARY TEXT B",pack.primary_texts[1],"",
      "HEADLINE A",pack.headlines[0],"","HEADLINE B",pack.headlines[1],"","VIDEO IDEA",pack.video_idea,"",
      "30-SECOND SCRIPT",pack.script,"","SOURCE RESEARCH",ref.source_url||""
    ].join("\n");

    await db.from("creative_items").insert({
      user_id:"device-workspace",
      kind:"concept",
      title:brand.name+" — Competitor pattern iteration",
      content,
      angle:pack.angle,
      format:pack.format,
      status:"Idea",
      metadata:{
        source:"competitor_iteration",
        brand_id:brand.id,
        brand_name:brand.name,
        ad_reference_id:ref.id||null,
        package:pack
      }
    });
    location.href="creatives.html?q="+encodeURIComponent("Competitor pattern iteration");
  }

  function clearForm(){
    $("ad-form").reset();
    $("ad-library-id").value="";
    $("meta-link-input").value="";
    $("ad-save-status").textContent="";
    $("meta-link-status").textContent="";
    renderPreview({});
  }

  document.addEventListener("DOMContentLoaded",async()=>{
    await db.open();
    await loadBrands();
    await loadRefs();

    $("inspect-meta-link").onclick=inspectMetaLink;
    $("ad-form").onsubmit=saveRef;
    $("ad-search").oninput=renderGrid;
    $("clear-ad-form").onclick=clearForm;
    $("download-current-package").onclick=()=>downloadPackage(null);
    $("create-from-ad").onclick=()=>createConcept({...currentData(),id:null});

    document.querySelectorAll("[data-copy-source]").forEach(btn=>{
      btn.onclick=async()=>{
        const source=$(btn.getAttribute("data-copy-source"));
        await navigator.clipboard.writeText(source.value||"");
        const old=btn.textContent;btn.textContent="Copied";setTimeout(()=>btn.textContent=old,1000);
      };
    });

    $("ad-source-url").oninput=()=>{
      const parsed=parseMetaUrl($("ad-source-url").value);
      $("ad-library-id").value=parsed.id;
      renderPreview(currentData());
    };
    ["ad-advertiser","ad-product","ad-primary-text","ad-media-url"].forEach(id=>{
      $(id).addEventListener("input",()=>renderPreview(currentData()));
    });

    $("ad-grid").onclick=async event=>{
      const copyId=event.target.getAttribute("data-copy-primary");
      const downloadId=event.target.getAttribute("data-download-ref");
      const conceptId=event.target.getAttribute("data-concept-ref");
      const deleteId=event.target.getAttribute("data-delete-ad");

      if(copyId){
        const ref=refs.find(x=>x.id===copyId);if(ref){await navigator.clipboard.writeText(ref.primary_text||"");event.target.textContent="Copied";}
      }
      if(downloadId){
        const ref=refs.find(x=>x.id===downloadId);if(ref) await downloadPackage(ref);
      }
      if(conceptId){
        const ref=refs.find(x=>x.id===conceptId);if(ref) await createConcept(ref);
      }
      if(deleteId){
        const ref=refs.find(x=>x.id===deleteId);
        if(!ref||!confirm("Delete this saved ad research?")) return;
        if(ref.media_asset_id&&assets[ref.media_asset_id]){
          const asset=assets[ref.media_asset_id];
          await db.storage.from("creative-assets").remove([asset.storage_path]);
          await db.from("creative_assets").delete().eq("id",asset.id);
        }
        await db.from("ad_references").delete().eq("id",deleteId);
        await loadRefs();
      }
    };
  });
})();