/* Avonent Strategist v1 — daily creative packages generated from brand knowledge. */
(() => {
  "use strict";

  const db = window.AVONENT_LOCAL_CLIENT;
  if (!db) return;

  const angles = [
    {name:"Problem aware", frame:"Call out the frustrating moment the customer recognizes immediately."},
    {name:"Unexpected mechanism", frame:"Lead with a surprising reason the problem keeps happening, then introduce the product as the practical next step."},
    {name:"Identity", frame:"Make the viewer feel like the product was made for people like them, not everyone."},
    {name:"Objection reversal", frame:"Start with the biggest reason someone would hesitate, then answer it with supportable proof or a concrete demonstration."},
    {name:"Routine contrast", frame:"Contrast the old routine with a simpler new routine without promising impossible outcomes."},
    {name:"Product demo", frame:"Show the product immediately and let the visual demonstration carry the first half of the ad."},
    {name:"Comparison", frame:"Compare the old alternative or generic option with the brand's approach."},
    {name:"Founder / insider", frame:"Use a useful behind-the-scenes explanation that makes the viewer feel they learned something."},
    {name:"Listicle", frame:"Package the pitch as three reasons, mistakes, or things to know."},
    {name:"Curiosity", frame:"Open a knowledge gap that can be paid off quickly and credibly."}
  ];

  const formats = [
    "UGC selfie",
    "Product demo",
    "Voiceover + B-roll",
    "Founder talking head",
    "Problem / solution montage",
    "Green-screen reaction",
    "Static-to-motion",
    "Customer POV"
  ];

  const competitorPatterns = [
    {name:"Hidden pattern", hook:"The pattern most brands never explain about {pain}.", lead:"Open a curiosity gap around a specific customer problem, then pay it off with a supportable product fact."},
    {name:"Proof before purchase", hook:"Before I trust another supplement for {pain}, I check these 3 things.", lead:"Lead with a buyer checklist: ingredient clarity, proof, and a believable reason to choose the product."},
    {name:"Ingredient specificity", hook:"The ingredient detail I would check before buying anything for {pain}.", lead:"Make one concrete ingredient/product detail the center of the ad instead of vague wellness language."},
    {name:"What brands leave out", hook:"What most {category} ads leave out is the part I actually care about.", lead:"Contrast generic category promises with one specific, supportable product detail."},
    {name:"Insider / authority", hook:"If I were comparing products for {pain}, this is where I would start.", lead:"Use an informed buyer/insider frame without inventing credentials or pretending to be a clinician."},
    {name:"Skeptic conversion", hook:"I did not care about another {category} product until I saw this.", lead:"Start from skepticism and let a demonstration, label detail, guarantee, or proof point earn attention."},
    {name:"Simple outcome", hook:"The goal is not more supplements. It is a simpler way to support {benefit}.", lead:"Sell clarity and ease rather than stacking exaggerated benefits."},
    {name:"Product-first reveal", hook:"If I could show you one thing about {product}, it would be this.", lead:"Reveal the product immediately, then explain one reason it deserves attention."},
    {name:"Three reasons", hook:"3 reasons I would look twice at {product} before buying another option.", lead:"Use a fast listicle around product facts, proof, and the offer."},
    {name:"Routine mistake", hook:"The mistake is choosing a product by the promise instead of what is actually in the routine.", lead:"Challenge the category's usual buying behavior and move into specific product proof."},
    {name:"Guarantee / risk reversal", hook:"The detail that made this easier to try was not the hype — it was the risk reversal.", lead:"Lead with guarantee/offer structure when that is genuinely part of the brand's offer."},
    {name:"Direct comparison", hook:"Before you pick another option for {pain}, compare this first.", lead:"Compare category alternatives on one fair, supportable dimension instead of vague superiority claims."}
  ];

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch];
    });
  }

  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function pick(list, seed, offset) {
    return list[(seed + (offset || 0)) % list.length];
  }

  function firstLine(value, fallback) {
    const parts = String(value || "").split(/\n|,|;/).map(function(x){ return x.trim(); }).filter(Boolean);
    return parts[0] || fallback;
  }

  function fill(template, brand) {
    return template
      .replaceAll("{pain}", firstLine(brand.pain_points, "the problem you are trying to solve"))
      .replaceAll("{benefit}", firstLine(brand.benefits, "the outcome you actually want"))
      .replaceAll("{product}", productName(brand))
      .replaceAll("{category}", firstLine(brand.category, "supplement"));
  }

  function productName(brand) {
    return String(brand.product_name || brand.name || "the product").trim();
  }

  function buildPackage(brand, date, index) {
    const seed = hash([date, brand.id, brand.name, index].join("|"));
    const angle = pick(angles, seed, index);
    const format = pick(formats, seed, 3 + index);
    const product = productName(brand);
    const pain = firstLine(brand.pain_points, "the recurring problem");
    const benefit = firstLine(brand.benefits, "a simpler better outcome");
    const audience = firstLine(brand.audience, "the target customer");
    const offer = firstLine(brand.offer, "See how it fits your routine");
    const proof = firstLine(brand.proof, "Show the product, process, ingredients, customer experience, or other supportable proof");
    const pattern = pick(competitorPatterns, seed, 5 + index);
    const hook = fill(pattern.hook, brand);

    const primaryA =
      hook + "\n\n" +
      pattern.lead + " For " + product + ", the ad should move quickly into a real product detail: " +
      proof + ". Keep the message centered on " + benefit.toLowerCase() + " for " + audience +
      " instead of stacking vague promises.\n\n" + offer + ".";

    const primaryB =
      "Most ads in this category jump straight to a promise. I would start somewhere more believable.\n\n" +
      "If you are dealing with " + pain + ", look at what the product actually is, what the brand can prove, and how it fits into a real routine. " +
      product + " should earn attention with " + proof.toLowerCase() + " — not hype.\n\n" + offer + ".";

    const headlineA = "What most " + firstLine(brand.category, "supplement") + " ads leave out";
    const headlineB = "Look at this before your next " + firstLine(brand.category, "supplement") + " purchase";

    const videoIdea =
      format + ". Open on a visual of " + pain +
      ". Put the hook on screen in the first 1.5 seconds. Cut to " + product +
      " by second 4. Demonstrate the product or routine, then layer in " +
      proof.toLowerCase() + ". End with: " + offer + ".";

    const script =
      "[0–3s — HOOK]\n" + hook +
      "\n\n[3–8s — PROBLEM]\nShow the exact moment " + audience + " feels " + pain + ". Keep it specific and visual." +
      "\n\n[8–17s — SHIFT]\nIntroduce " + product + ". Use the " + angle.name.toLowerCase() +
      " angle in one simple sentence: " + angle.frame +
      "\n\n[17–25s — PROOF / DEMO]\n" + proof +
      ". Avoid unsupported medical or guaranteed-result claims." +
      "\n\n[25–30s — CTA]\n" + offer + ".";

    return {
      title: brand.name + " — " + angle.name,
      angle: angle.name,
      format: format,
      hook: hook,
      primary_texts: [primaryA, primaryB],
      headlines: [headlineA, headlineB],
      video_idea: videoIdea,
      script: script,
      inspiration_pattern: pattern.name,
      why: pattern.lead + " " + angle.frame + " The format is " + format.toLowerCase() + " so the message can be understood quickly.",
      compliance: "Use only claims the brand can substantiate. For supplements, avoid diagnosing, treating, curing, or guaranteeing medical outcomes."
    };
  }

  function applyCompetitorResearch(pack, brand, ref) {
    if (!ref) return pack;
    const source = String(ref.hook || ref.headline || ref.primary_text || "").trim();
    if (!source) return pack;

    const lower = source.toLowerCase();
    const pain = firstLine(brand.pain_points, "the problem you are trying to solve");
    const benefit = firstLine(brand.benefits, "the outcome you want");
    const product = productName(brand);
    let pattern = "Competitor message structure";
    let hook = pack.hook;

    if (/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|%|x)\b/i.test(source)) {
      pattern = "Specific product detail";
      hook = "Before you compare another option for " + pain + ", check the actual product details first.";
    } else if (/\b(i|my|we|our)\b/i.test(lower)) {
      pattern = "Personal story";
      hook = "I was skeptical of another product like " + product + " until I looked at what was actually different.";
    } else if (/pattern|nobody|secret|missing|overlook/i.test(lower)) {
      pattern = "Hidden pattern / curiosity";
      hook = "The part most people overlook when they are trying to improve " + benefit.toLowerCase() + ".";
    } else if (/why|how|what|before/i.test(lower)) {
      pattern = "Question / explanation";
      hook = "What I would check before buying another product for " + pain + ".";
    } else if (/support|feel|reclaim|again/i.test(lower)) {
      pattern = "Desired outcome";
      hook = "If " + benefit.toLowerCase() + " is the goal, this is what I would look at first.";
    }

    pack.hook = hook;
    pack.inspiration_pattern = pattern;
    pack.research_source = {
      advertiser_name: ref.advertiser_name || "",
      headline: ref.headline || "",
      hook: ref.hook || "",
      source_url: ref.source_url || ""
    };
    pack.why = "Pattern learned from saved competitor research: " + pattern + ". Use the structure, not the wording. " + pack.why;
    return pack;
  }

  function contentFromPackage(p) {
    return [
      "HOOK", p.hook, "",
      "PRIMARY TEXT A", p.primary_texts[0], "",
      "PRIMARY TEXT B", p.primary_texts[1], "",
      "HEADLINE A", p.headlines[0], "",
      "HEADLINE B", p.headlines[1], "",
      "VIDEO IDEA", p.video_idea, "",
      "30-SECOND SCRIPT", p.script, "",
      "WHY THIS ANGLE", p.why, "",
      "COMPLIANCE NOTE", p.compliance
    ].join("\n");
  }

  async function getBrands() {
    const result = await db.from("brands").select("*").order("updated_at", {ascending:false});
    return result.data || [];
  }

  async function ensureStarterBrand() {
    const list = await getBrands();
    if (list.length) return list;

    await db.from("brands").insert({
      user_id:"device-workspace",
      name:"Avonent Health",
      product_name:"Pure Moringa Capsules",
      audience:"Adults who want a simpler daily wellness routine and respond to practical, specific direct-response creative rather than vague wellness branding.",
      pain_points:"Afternoon energy slump; complicated supplement routines; skepticism about overhyped wellness products; inconsistent routines.",
      benefits:"Simple daily routine; convenient capsules; easier consistency with a wellness habit; a product that is easy to understand and use.",
      offer:"Current direct-response offer with a 30-day money-back guarantee. Confirm exact price and discount before launch.",
      proof:"Use only documented product facts, ingredient information, sourcing/testing facts, product-in-hand demonstrations, genuine customer experience, and the money-back guarantee.",
      voice:"Direct, premium, conversational, skeptical of hype, clear and specific.",
      notes:"Avoid unsupported medical claims. Strong creative should feel native to Meta/TikTok, lead with a real problem or curiosity gap, show the product quickly, and clearly separate supportable product facts from marketing interpretation.",
      active:true
    });

    return await getBrands();
  }

  async function generateForBrand(brand, options) {
    options = options || {};
    const force = !!options.force;
    const count = Number(options.count || 3);
    const date = new Date().toISOString().slice(0,10);
    const runSalt = force ? Date.now().toString(36) : "daily";
    const generationSeed = date + ":" + runSalt;
    const existingResult = await db.from("creative_items").select("*");
    const researchResult = await db.from("ad_references").select("*").order("created_at", {ascending:false}).limit(60);
    const existing = existingResult.data || [];
    const research = researchResult.data || [];
    const created = [];

    for (let i = 0; i < count; i += 1) {
      const key = "daily-v3:" + date + ":" + brand.id + ":" + runSalt + ":" + i;
      if (!force && existing.some(function(x){ return x.metadata && x.metadata.daily_key === key; })) continue;

      let pack = buildPackage(brand, generationSeed, i);
      if (research.length) {
        const relevant = research.filter(function(ref) {
          return !ref.brand_id || ref.brand_id === brand.id;
        });
        const pool = relevant.length ? relevant : research;
        const ref = pool[(hash(key) + i) % pool.length];
        pack = applyCompetitorResearch(pack, brand, ref);
      }
      const result = await db.from("creative_items").insert({
        user_id:"device-workspace",
        kind:"concept",
        title:pack.title,
        content:contentFromPackage(pack),
        angle:pack.angle,
        format:pack.format,
        status:"Idea",
        favorite:false,
        metadata:{
          source:"daily_strategist",
          daily_key:key,
          generated_date:date,
          brand_id:brand.id,
          brand_name:brand.name,
          package:pack,
          research_source:pack.research_source || null
        }
      }).select("*").single();

      if (!result.error) created.push(result.data);
    }

    return created;
  }

  async function ensureDaily() {
    const list = (await getBrands()).filter(function(b){ return b.active !== false; });
    const created = [];
    for (const brand of list) {
      const rows = await generateForBrand(brand, {force:false, count:3});
      created.push.apply(created, rows);
    }
    return created;
  }

  async function generateNow() {
    const list = (await getBrands()).filter(function(b){ return b.active !== false; });
    const created = [];
    for (const brand of list) {
      const rows = await generateForBrand(brand, {force:true, count:3});
      created.push.apply(created, rows);
    }
    await renderDashboard();
    return created;
  }

  async function renderDashboard() {
    const container = document.getElementById("daily-ideas");
    if (!container) return;

    const result = await db.from("creative_items").select("*").order("created_at", {ascending:false}).limit(250);
    const date = new Date().toISOString().slice(0,10);
    const items = (result.data || []).filter(function(x){
      return x.metadata && x.metadata.source === "daily_strategist" && x.metadata.generated_date === date;
    });

    container.innerHTML = items.length ? items.map(function(item){
      const p = item.metadata.package;
      return '<article class="strategy-card">' +
        '<div class="strategy-card-head"><div><span class="pill">' + escapeHtml(item.metadata.brand_name || "Brand") +
        '</span><h3>' + escapeHtml(p.title) + '</h3></div><span class="meta">' + escapeHtml(p.format) + '</span></div>' +
        '<div class="strategy-block"><span>Hook</span><p>' + escapeHtml(p.hook) + '</p></div>' +
        '<div class="strategy-block"><span>Video idea</span><p>' + escapeHtml(p.video_idea) + '</p></div>' +
        '<div class="strategy-actions"><a class="button secondary mini" href="creatives.html?q=' +
        encodeURIComponent(item.title) + '">Open full package</a>' +
        '<button class="button secondary mini" data-copy-daily="' + item.id + '">Copy hook</button></div>' +
      '</article>';
    }).join("") : '<div class="empty">Add a brand to start getting automatic daily creative packages.</div>';

    container.onclick = async function(event) {
      const id = event.target.getAttribute("data-copy-daily");
      if (!id) return;
      const item = items.find(function(x){ return x.id === id; });
      if (!item) return;
      await navigator.clipboard.writeText(item.metadata.package.hook);
      event.target.textContent = "Copied";
    };
  }

  const ready = (async function(){
    await db.open();
    await ensureStarterBrand();
    await ensureDaily();
    return true;
  })();

  window.AVONENT_STRATEGIST = {
    ready:ready,
    getBrands:getBrands,
    ensureStarterBrand:ensureStarterBrand,
    buildPackage:buildPackage,
    generateForBrand:generateForBrand,
    generateNow:generateNow,
    ensureDaily:ensureDaily,
    renderDashboard:renderDashboard
  };

  document.addEventListener("DOMContentLoaded", async function(){
    await ready;
    await renderDashboard();

    const button = document.getElementById("generate-daily-now");
    if (button) {
      button.onclick = async function(){
        button.disabled = true;
        button.textContent = "Generating…";
        const made = await generateNow();
        button.disabled = false;
        button.textContent = "Generate fresh pack";
        if (!made.length) alert("Add an active brand first.");
      };
    }
  });
})();