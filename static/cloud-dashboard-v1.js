(()=>{"use strict";const c=window.AVONENT_CLOUD,$=id=>document.getElementById(id);if(!c)return;
const esc=v=>String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
function today(){return new Date().toISOString().slice(0,10)}
async function load(){
 const [p,w,a,i]=await Promise.all([
  c.db.from("products").select("id,name",{count:"exact"}),
  c.db.from("competitor_watchlist").select("id",{count:"exact"}).eq("active",true),
  c.db.from("competitor_ads").select("id,qualifies_long_running,analyzed_at",{count:"exact"}).eq("is_active",true),
  c.db.from("ai_ideas").select("id,title,hook,angle,status,approved,strategy,idea_model,generated_for_date,created_at,products(name)").eq("generated_for_date",today()).order("created_at",{ascending:false}).limit(10)
 ]);
 for(const r of [p,w,a,i])if(r.error)throw r.error;
 const products=p.data||[],watch=w.data||[],ads=a.data||[],ideas=i.data||[];
 const long=ads.filter(x=>x.qualifies_long_running),analyzed=ads.filter(x=>x.analyzed_at);
 $("dash-products").textContent=String(products.length);
 $("dash-watchlist").textContent=String(watch.length);
 $("dash-long").textContent=String(long.length);
 $("dash-analyzed").textContent=String(analyzed.length);
 $("dash-ideas").textContent=String(ideas.length);

 const sorted=[...ideas].sort((x,y)=>Number(y.strategy?.overall_score||0)-Number(x.strategy?.overall_score||0));
 $("dash-idea-list").innerHTML=sorted.length?sorted.slice(0,5).map(x=>'<a class="dashboard-idea-row" href="creatives.html"><div><span>'+esc(x.products?.name||"Product")+'</span><strong>'+esc(x.hook||x.title||"Idea")+'</strong><small>'+esc(x.angle||"")+'</small></div><div class="dash-score">'+(Number(x.strategy?.overall_score||0)||"—")+'</div></a>').join(""):'<div class="empty">No ideas generated today yet.</div>';

 let title="",copy="",href="";
 if(!products.length){title="Scan your products";copy="Start by scanning avonent.com so the strategist has real product facts.";href="brands.html";}
 else if(!watch.length){title="Add competitors";copy="Choose a product and build its competitor watchlist.";href="ads.html";}
 else if(!ads.length){title="Scan competitors";copy="Run the Meta research collector so Avonent has source ads.";href="ads.html";}
 else if(long.length&&!analyzed.length){title="Analyze research";copy="Turn long-running ads into reusable hook, angle, proof and story patterns.";href="ads.html";}
 else if(!ideas.length){title="Generate today's ideas";copy="You have product context and research. Generate ranked creative hypotheses.";href="creatives.html";}
 else{title="Review today's ideas";copy="Approve the strongest concept, inspect its source ads, then generate the AI script.";href="creatives.html";}
 $("next-action-title").textContent=title;$("next-action-copy").textContent=copy;$("next-action-button").href=href;$("next-action-button").textContent="Open";
}
document.addEventListener("DOMContentLoaded",async()=>{try{await c.requireSession();await load()}catch(e){console.error(e)}});})();