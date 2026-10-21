(() => {
  "use strict";
  const cfg=window.AVONENT_CONFIG||{};
  if(!window.supabase||!cfg.supabaseUrl||!cfg.supabasePublishableKey) return;

  const db=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });

  async function session(){
    const r=await db.auth.getSession();
    if(r.error) throw r.error;
    return r.data.session||null;
  }

  async function requireSession(){
    const s=await session();
    if(!s){
      const next=encodeURIComponent(location.pathname.split("/").pop()+location.search);
      location.href="auth.html?mode=login&next="+next;
      throw new Error("Login required");
    }
    return s;
  }

  async function invoke(name,body,options={}){
    const s=await requireSession();
    const timeoutMs=Math.max(5000,Number(options.timeoutMs||75000));
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    let r;
    try{
      r=await fetch(cfg.supabaseUrl.replace(/\/$/,"")+"/functions/v1/"+name,{
        method:"POST",
        headers:{
          "authorization":"Bearer "+s.access_token,
          "content-type":"application/json"
        },
        body:JSON.stringify(body||{}),
        signal:controller.signal
      });
    }catch(error){
      if(error?.name==="AbortError")throw new Error("AI request timed out instead of finishing. Please try again.");
      throw error;
    }finally{
      clearTimeout(timer);
    }
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      const e=new Error(data.error||("Request failed: "+r.status));
      e.status=r.status;
      e.data=data;
      throw e;
    }
    return data;
  }

  async function renderAccount(){
    const s=await session();
    document.querySelectorAll("[data-cloud-login]").forEach(el=>el.classList.toggle("hidden",!!s));
    document.querySelectorAll("[data-cloud-user]").forEach(el=>{
      el.classList.toggle("hidden",!s);
      if(s) el.textContent=s.user.email||"Account";
    });
    document.querySelectorAll("[data-cloud-signout]").forEach(el=>{
      el.classList.toggle("hidden",!s);
      el.onclick=async()=>{await db.auth.signOut();location.href="index.html";};
    });
  }

  document.addEventListener("DOMContentLoaded",()=>{renderAccount().catch(()=>{});});
  window.AVONENT_CLOUD={db,session,requireSession,invoke,renderAccount};
})();