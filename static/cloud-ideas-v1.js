(() => {
  "use strict";

  const cloud = window.AVONENT_CLOUD;
  if (!cloud) return;
  const db = cloud.db;
  const {researchSources} = window.AVONENT_RESEARCH_UTILS;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

  let session = null;
  let products = [];
  let ideas = [];
  let sourceAds = [];
  let usageEvents = [];
  let workspaceMode = "concepts";
  let progressTimer = null;
  let progressStartedAt = 0;

  function progressStage(seconds) {
    if (seconds < 5) return "Preparing product facts and research…";
    if (seconds < 14) return "Selecting the strongest competitor patterns…";
    if (seconds < 30) return "Writing five differentiated concepts and hooks…";
    if (seconds < 48) return "Building scripts, shot plans and animation directions…";
    if (seconds < 68) return "Ranking concepts and checking source support…";
    return "Validating and packaging the final creative set…";
  }

  function progressPercent(seconds) {
    if (seconds <= 3) return 5 + seconds * 3;
    if (seconds <= 15) return 14 + Math.round((seconds - 3) * 1.8);
    if (seconds <= 35) return 36 + Math.round((seconds - 15) * 1.5);
    if (seconds <= 60) return 66 + Math.round((seconds - 35) * 0.8);
    if (seconds <= 90) return 86 + Math.round((seconds - 60) * 0.2);
    return 94;
  }

  let completedConcepts = 0;
  function updateProgress() {
    const panel = $("ideas-progress");
    if (!panel || !progressStartedAt) return;
    const seconds = Math.floor((Date.now() - progressStartedAt) / 1000);
    const pct = completedConcepts ? Math.min(90, 8 + completedConcepts * 16) : 8;
    $("ideas-progress-percent").textContent = pct + "%";
    $("ideas-progress-fill").style.width = pct + "%";
    $("ideas-progress-stage").textContent = completedConcepts
      ? completedConcepts + " of 5 concepts finished · " + (completedConcepts < 5 ? "waiting on the remaining concepts…" : "saving creative pack…")
      : "Five concepts are generating in parallel…";
    $("ideas-progress-note").textContent = seconds + "s elapsed · progress moves when a concept actually finishes.";
  }

  function startProgress(sourceCount) {
    const panel = $("ideas-progress");
    if (!panel) return;
    progressStartedAt = Date.now();
    completedConcepts = 0;
    panel.classList.remove("hidden");
    $("ideas-progress-label").textContent = "Generating 5 concepts from " + sourceCount + " source ads";
    $("ideas-progress-percent").textContent = "5%";
    $("ideas-progress-fill").style.width = "5%";
    $("ideas-progress-stage").textContent = "Preparing product facts and research…";
    $("ideas-progress-note").textContent = "Estimated progress. Keep this page open while the model works.";
    clearInterval(progressTimer);
    progressTimer = setInterval(updateProgress, 1000);
  }

  function endProgress(message, ok) {
    clearInterval(progressTimer);
    progressTimer = null;
    const panel = $("ideas-progress");
    if (!panel) return;
    if (ok) {
      $("ideas-progress-percent").textContent = "100%";
      $("ideas-progress-fill").style.width = "100%";
    } else {
      $("ideas-progress-percent").textContent = "Stopped";
    }
    $("ideas-progress-stage").textContent = message || (ok ? "Creative pack saved." : "Generation stopped.");
    $("ideas-progress-note").textContent = ok ? "Done." : "The request did not complete.";
    if (ok) setTimeout(() => panel.classList.add("hidden"), 2800);
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function currentProductId() {
    return $("ideas-product").value || "";
  }

  function currentProduct() {
    return products.find(p => p.id === currentProductId()) || null;
  }

  async function loadProducts() {
    const r = await db.from("products").select("*").order("created_at", { ascending: true });
    if (r.error) throw r.error;
    products = r.data || [];
    $("ideas-product").innerHTML = products.length
      ? products.map(p => '<option value="' + p.id + '">' + esc(p.brand_name || "") + ' — ' + esc(p.name) + '</option>').join("")
      : '<option value="">No products yet</option>';
  }

  async function loadData() {
    const productId = currentProductId();
    if (!productId) {
      ideas = [];
      sourceAds = [];
      usageEvents = [];
      render();
      return;
    }

    const results = await Promise.all([
      db.from("ai_ideas").select("*").eq("product_id", productId).order("created_at", { ascending: false }).limit(300),
      db.from("competitor_ads").select("*").eq("product_id", productId).order("days_running", { ascending: false }).limit(300),
      db.from("creative_usage_events").select("*").eq("product_id", productId).order("created_at", { ascending: false }).limit(500)
    ]);

    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    if (results[2].error) throw results[2].error;
    ideas = results[0].data || [];
    sourceAds = results[1].data || [];
    usageEvents = results[2].data || [];
    render();
  }

  function filteredIdeas() {
    const mode = $("ideas-filter").value;
    const active = ideas.filter(i => i.lifecycle_status !== "archived");
    if (mode === "today") return active.filter(i => i.generated_for_date === today() && i.status !== "Rejected");
    if (mode === "approved") return active.filter(i => i.approved || i.status === "Approved" || i.lifecycle_status === "saved");
    if (mode === "scripted") return active.filter(i => i.ai_script);
    if (mode === "used") return ideas.filter(i => i.lifecycle_status === "used");
    if (mode === "archive") return ideas.filter(i => i.lifecycle_status === "archived");
    if (mode === "rejected") return ideas.filter(i => i.status === "Rejected");
    return active.filter(i => i.status !== "Rejected");
  }

  function usageFor(ideaId, kind, index=null) {
    return usageEvents.find(e => e.idea_id === ideaId && e.asset_kind === kind && (index == null || Number(e.asset_index) === Number(index)) && e.action === "used");
  }

  function outcomeFor(ideaId) {
    return usageEvents.find(e => e.idea_id === ideaId && ["winner","loser"].includes(e.action));
  }

  function sourceCount() {
    const ids = new Set();
    ideas.forEach(i => {
      (Array.isArray(i.source_ad_ids) ? i.source_ad_ids : []).forEach(id => ids.add(String(id)));
    });
    return ids.size;
  }

  function timedBeatHtml(beat) {
    const type = beat?.footage_type || "Not specified";
    const provider = beat?.provider || (type === "AI_VIDEO" ? "AI provider TBD" : "camera/editor");
    return '<div class="timed-beat">' +
      '<strong>' + esc(beat?.time || "") + '</strong>' +
      '<span>SAY</span><p>' + esc(beat?.say || "") + '</p>' +
      '<span>SHOW</span><p>' + esc(beat?.show || "") + '</p>' +
      '<span>ON-SCREEN</span><p>' + esc(beat?.on_screen_text || "") + '</p>' +
      '<span>FOOTAGE</span><p><strong>' + esc(type) + '</strong> · ' + esc(provider) + (beat?.video_model ? ' · ' + esc(beat.video_model) : '') + '</p>' +
      (beat?.visual_style ? '<span>VISUAL STYLE</span><p>' + esc(beat.visual_style) + '</p>' : '') +
      (beat?.camera ? '<span>CAMERA</span><p>' + esc(beat.camera) + '</p>' : '') +
      (beat?.setting ? '<span>SETTING</span><p>' + esc(beat.setting) + '</p>' : '') +
      (beat?.actor_or_subject ? '<span>ACTOR / SUBJECT</span><p>' + esc(beat.actor_or_subject) + '</p>' : '') +
      (beat?.action ? '<span>ACTION</span><p>' + esc(beat.action) + '</p>' : '') +
      (beat?.transition ? '<span>TRANSITION</span><p>' + esc(beat.transition) + '</p>' : '') +
      (beat?.animation_style ? '<span>ANIMATION STYLE</span><p>' + esc(beat.animation_style) + '</p>' : '') +
      (beat?.source_reference ? '<span>SOURCE BEAT</span><p>' + esc(beat.source_reference) + '</p>' : '') +
      (beat?.animation_prompt ? '<span>AI VIDEO PROMPT</span><p>' + esc(beat.animation_prompt) + '</p>' : '') +
    '</div>';
  }

  function sourceAdaptationHtml(strategy) {
    const s = strategy?.source_adaptation;
    if (!s) return "";
    const openingLabel = s.opening_type === "spoken_transcript" ? "Actual transcribed opening" : "Observed written opening";
    return '<section class="source-adaptation-card">' +
      '<span class="eyebrow">SOURCE AD ADAPTATION</span>' +
      '<p><strong>' + esc(s.advertiser_name || "Competitor") + '</strong> · Ad ' + esc(s.ad_archive_id || "") + '</p>' +
      '<p><strong>' + openingLabel + ':</strong> ' + esc(s.observed_opening_text || "Unavailable") + '</p>' +
      (s.observed_sequence ? '<p><strong>Source sequence:</strong> ' + esc(Array.isArray(s.observed_sequence) ? s.observed_sequence.join(" → ") : s.observed_sequence) + '</p>' : '') +
      (s.adapted_sequence ? '<p><strong>Our adapted sequence:</strong> ' + esc(Array.isArray(s.adapted_sequence) ? s.adapted_sequence.join(" → ") : s.adapted_sequence) + '</p>' : '') +
    '</section>';
  }

  function visualRecipeHtml(strategy) {
    const v = strategy?.visual_recipe;
    if (!v) return "";
    const providers = Array.isArray(v.provider_stack) ? v.provider_stack.filter(Boolean) : [];
    return '<section class="visual-recipe-card">' +
      '<span class="eyebrow">WHAT THE VIDEO SHOULD LOOK LIKE</span>' +
      (v.overall_style ? '<p><strong>Overall:</strong> ' + esc(v.overall_style) + '</p>' : '') +
      (v.adapted_visual_style ? '<p><strong>Visual style:</strong> ' + esc(v.adapted_visual_style) + '</p>' : '') +
      (v.actor_mode ? '<p><strong>Actor:</strong> ' + esc(v.actor_mode) + '</p>' : '') +
      (v.animation_style ? '<p><strong>Animation:</strong> ' + esc(v.animation_style) + '</p>' : '') +
      (v.camera_language ? '<p><strong>Camera:</strong> ' + esc(v.camera_language) + '</p>' : '') +
      (v.setting ? '<p><strong>Setting:</strong> ' + esc(v.setting) + '</p>' : '') +
      (v.edit_rhythm ? '<p><strong>Edit rhythm:</strong> ' + esc(v.edit_rhythm) + '</p>' : '') +
      (v.color_texture ? '<p><strong>Look:</strong> ' + esc(v.color_texture) + '</p>' : '') +
      (providers.length ? '<p><strong>Provider stack:</strong> ' + esc(providers.join(" · ")) + '</p>' : '') +
    '</section>';
  }

  function hookAdaptationHtml(strategy) {
    const h = strategy?.hook_adaptation;
    if (!h) return "";
    const kept = Array.isArray(h.what_was_preserved) ? h.what_was_preserved : [];
    return '<section class="hook-adaptation-card">' +
      '<span class="eyebrow">HOOK ADAPTATION</span>' +
      (h.source_hook_exact ? '<p><strong>Source hook:</strong> “' + esc(h.source_hook_exact) + '”</p>' : '') +
      (h.source_hook_blueprint ? '<p><strong>Blueprint:</strong> ' + esc(h.source_hook_blueprint) + '</p>' : '') +
      (h.adapted_hook ? '<p><strong>Our version:</strong> “' + esc(h.adapted_hook) + '”</p>' : '') +
      (kept.length ? '<p><strong>Preserved:</strong> ' + esc(kept.join(" · ")) + '</p>' : '') +
    '</section>';
  }

  function storyArcHtml(strategy) {
    const s = strategy?.story_arc;
    if (!s) return "";
    const src = Array.isArray(s.source_story_spine) ? s.source_story_spine : [];
    const adapted = Array.isArray(s.adapted_story_spine) ? s.adapted_story_spine : [];
    return '<section class="story-arc-card">' +
      '<span class="eyebrow">STORY BLUEPRINT</span>' +
      (src.length ? '<p><strong>Source:</strong> ' + esc(src.join(" → ")) + '</p>' : '') +
      (adapted.length ? '<p><strong>Adapted:</strong> ' + esc(adapted.join(" → ")) + '</p>' : '') +
      (s.tension_curve ? '<p><strong>Tension:</strong> ' + esc(s.tension_curve) + '</p>' : '') +
      (s.reveal_point ? '<p><strong>Reveal:</strong> ' + esc(s.reveal_point) + '</p>' : '') +
    '</section>';
  }

  function hooksFor(idea) {
    return [idea.hook, ...(Array.isArray(idea.strategy?.hooks) ? idea.strategy.hooks : [])]
      .filter(Boolean).filter((hook,index,all) => all.indexOf(hook) === index);
  }

  function savedAsset(idea, kind, index=0) {
    return kind === "hook" ? (idea.strategy?.saved_hook_indexes || []).includes(index) : !!idea.strategy?.saved_script;
  }

  function assetButton(idea, kind, index=0) {
    const saved = savedAsset(idea,kind,index);
    return '<button type="button" class="copy-inline" data-save-asset="' + esc(idea.id) + '" data-kind="' + kind + '" data-hook-index="' + index + '" aria-pressed="' + saved + '">' + (saved ? 'Saved ✓ · Unsave' : 'Save ' + kind) + '</button>';
  }

  function fold(title, body) {
    return '<details class="idea-copy-pack" name="idea-content"><summary>' + title + '</summary><div class="idea-fold-body">' + body + '</div></details>';
  }

  function render() {
    $("ideas-today-count").textContent = String(ideas.filter(i => i.generated_for_date === today()).length);
    $("ideas-used-count").textContent = String(ideas.filter(i => i.lifecycle_status === "used").length);
    $("ideas-archive-count").textContent = String(ideas.filter(i => i.lifecycle_status === "archived").length);
    $("ideas-source-count").textContent = String(sourceAds.length);
    const savedView = workspaceMode === "saved";
    const rows = savedView ? ideas.filter(i => i.approved || i.strategy?.saved_script || i.strategy?.saved_hook_indexes?.length) : filteredIdeas();
    $("cloud-ideas-grid").innerHTML = rows.length ? rows.map((idea,index) => {
      const strategy = idea.strategy || {};
      const hooks = hooksFor(idea);
      const savedPack = !!idea.approved;
      const visibleHooks = hooks.map((hook,n) => ({hook,n})).filter(({n}) => !savedView || savedPack || savedAsset(idea,"hook",n));
      const hookHtml = visibleHooks.map(({hook,n}) => '<section class="idea-hook-block"><div class="idea-section-head"><span>Hook ' + (n+1) + '</span></div><p>' + esc(hook) + '</p><div class="idea-inline-actions"><button class="copy-inline" data-copy-library-hook="' + esc(idea.id) + '" data-hook-index="' + n + '">Copy</button>' + assetButton(idea,"hook",n) + '<button class="copy-inline" data-use-hook="' + esc(idea.id) + '" data-hook-index="' + n + '" aria-pressed="' + !!usageFor(idea.id,"hook",n) + '">' + (usageFor(idea.id,"hook",n) ? 'Used ✓ · Undo' : 'Use hook') + '</button></div></section>').join("");
      const timed = Array.isArray(strategy.timed_script) ? strategy.timed_script : [];
      const script = (idea.ai_script ? '<pre class="final-script-pre">' + esc(idea.ai_script) + '</pre>' : timed.length ? '<div class="timed-script">' + timed.map(timedBeatHtml).join("") + '</div>' : '<p>Generate a complete 60–90 second production script.</p>') +
        '<div class="idea-inline-actions">' + assetButton(idea,"script") + '<button class="copy-inline" data-copy-script="' + esc(idea.id) + '">Copy script</button><button class="copy-inline" data-use-script="' + esc(idea.id) + '">' + (usageFor(idea.id,"script") ? 'Used ✓ · Undo' : 'Use script') + '</button><button class="button secondary mini" data-script="' + esc(idea.id) + '">' + (idea.ai_script || timed.length ? 'Regenerate · 60–90 sec' : 'Generate · 60–90 sec') + '</button></div>';
      const brief = (strategy.audience ? '<h4>Audience</h4><p>' + esc(strategy.audience) + '</p>' : '') +
        (idea.angle ? '<h4>Angle</h4><p>' + esc(idea.angle) + '</p>' : '') +
        (idea.first_frame ? '<h4>First frame</h4><p>' + esc(idea.first_frame) + '</p>' : '') +
        (strategy.video_concept ? '<h4>Video concept</h4><p>' + esc(strategy.video_concept) + '</p>' : '') +
        hookAdaptationHtml(strategy) + storyArcHtml(strategy) + visualRecipeHtml(strategy) + sourceAdaptationHtml(strategy) +
        '<button class="button secondary mini" data-copy-pack="' + esc(idea.id) + '">Copy creative brief</button>';
      const primary = '<p class="primary-copy">' + esc(strategy.primary_text || 'No primary text generated yet.') + '</p>' +
        (strategy.headline ? '<h4>Headline</h4><p>' + esc(strategy.headline) + '</p>' : '') +
        (strategy.description ? '<h4>Description</h4><p>' + esc(strategy.description) + '</p>' : '') +
        (idea.cta ? '<h4>CTA</h4><p>' + esc(idea.cta) + '</p>' : '') +
        '<button class="button secondary mini" data-copy-primary="' + esc(idea.id) + '">Copy primary text</button>';
      return '<article class="cloud-idea-card" data-idea="' + esc(idea.id) + '"><div class="idea-card-top"><div><span class="idea-number">' + esc(idea.format || 'CONCEPT') + '</span><h2>' + esc(idea.title || idea.angle || 'Ad idea') + '</h2></div></div>' + hookHtml +
        ((!savedView || savedPack || savedAsset(idea,"script")) ? fold('Script',script) : '') + fold('Full creative brief',brief) + fold('Primary text',primary) +
        '<div class="idea-decision-row"><button class="decision-button" data-approve="' + esc(idea.id) + '">' + (savedPack ? 'Saved pack ✓ · Unsave' : 'Save whole pack') + '</button><button class="decision-button" data-archive="' + esc(idea.id) + '">' + (idea.lifecycle_status === 'archived' ? 'Restore' : 'Archive') + '</button><button class="source-link" data-sources="' + esc(idea.id) + '">Source ads</button></div>' +
        (idea.lifecycle_status === 'used'
          ? '<div class="idea-performance-row"><span class="helper">How did it perform?</span><button class="copy-inline" data-outcome="winner" data-outcome-id="' + esc(idea.id) + '">Winner</button><button class="copy-inline" data-outcome="loser" data-outcome-id="' + esc(idea.id) + '">Loser</button><button class="copy-inline" data-results="' + esc(idea.id) + '">Add results</button>' + (outcomeFor(idea.id) ? '<span class="pill">' + esc(outcomeFor(idea.id).action) + '</span>' : '') + '</div>'
          : '') +
        '</article>';
    }).join("") : '<div class="empty wide">' + (savedView ? 'No saved hooks or scripts yet. Tap Save hook, Save script, or Save whole pack.' : 'No ideas in this view yet.') + '</div>';
  }

  async function toggleSavedAsset(idea, kind, index) {
    const strategy = {...(idea.strategy || {})};
    if (kind === "hook") {
      const indexes = new Set(strategy.saved_hook_indexes || []);
      if (indexes.has(index)) indexes.delete(index); else indexes.add(index);
      strategy.saved_hook_indexes = [...indexes];
    } else strategy.saved_script = !strategy.saved_script;
    const r = await db.from("ai_ideas").update({strategy,updated_at:new Date().toISOString()}).eq("id",idea.id).select("id");
    if(r.error) throw r.error;
    if(!r.data?.length) throw new Error("Could not save this item. Please refresh and try again.");
    await loadData();
  }

  function pickPrimarySources(sources, count=5) {
    const recentIds = new Set(
      ideas.filter(i => i.created_at && (Date.now() - new Date(i.created_at).getTime()) < 30*86400000)
        .flatMap(i => Array.isArray(i.source_ad_ids) ? i.source_ad_ids.map(String) : [])
    );
    const ranked = [...sources].sort((a,b) => {
      const aFresh = recentIds.has(String(a.ad_archive_id)) ? -1200 : 0;
      const bFresh = recentIds.has(String(b.ad_archive_id)) ? -1200 : 0;
      const aScore = aFresh + (a.video_transcript ? 1000 : 0) + (a.ai_analysis?.visual_analysis_available ? 500 : 0) + Number(a.ai_analysis?.research_score || 0)*3 + Number(a.days_running || 0);
      const bScore = bFresh + (b.video_transcript ? 1000 : 0) + (b.ai_analysis?.visual_analysis_available ? 500 : 0) + Number(b.ai_analysis?.research_score || 0)*3 + Number(b.days_running || 0);
      return bScore-aScore;
    });
    const chosen = [];
    const signatures = new Set();
    for (const ad of ranked) {
      const signature = [
        String(ad.advertiser_name || "").toLowerCase(),
        String(ad.ai_analysis?.story_structure || ad.ai_analysis?.spoken_hook_type || "").toLowerCase(),
        String(ad.media_kind || ad.display_format || "").toLowerCase()
      ].join("|");
      if (!signatures.has(signature)) {
        chosen.push(ad);
        signatures.add(signature);
      }
      if (chosen.length >= count) return chosen;
    }
    for (const ad of ranked) {
      if (!chosen.includes(ad)) chosen.push(ad);
      if (chosen.length >= count) break;
    }
    return chosen;
  }

  async function generateIdeas() {
    const p = currentProduct();
    if (!p) return;

    const sources = researchSources(sourceAds, 80);
    if (!sources.length) {
      $("ideas-status").textContent = "No captured ad copy yet. Open Research and collect a brand’s ads first.";
      return;
    }

    const btn = $("generate-more-ideas");
    btn.disabled = true;
    btn.textContent = "Generating…";
    $("ideas-status").textContent = "Generating 5 concepts in parallel. Keep this page open.";
    startProgress(sources.length);

    try {
      const primarySources = pickPrimarySources(sources, 5);
      const jobs = [1,2,3,4,5].map(async variation => {
        const primarySource = primarySources[(variation - 1) % primarySources.length];
        let lastError = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const result = await cloud.invoke("creative-ai", {
              task: "idea",
              variation,
              primary_source_ad_id: primarySource?.ad_archive_id || "",
              product: p,
              competitor_ads: [primarySource, ...sources.filter(ad => ad !== primarySource).slice(0, 7)]
            });
            const idea = result.result?.idea;
            if (!idea?.title || !idea?.hook) throw new Error("AI returned an incomplete concept.");
            completedConcepts += 1;
            updateProgress();
            return { idea, model: result.model || "" };
          } catch (error) {
            lastError = error;
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350));
          }
        }
        throw lastError || new Error("Concept generation failed.");
      });

      const settled = await Promise.allSettled(jobs);
      const generated = settled.filter(x => x.status === "fulfilled").map(x => x.value);
      const failures = settled.filter(x => x.status === "rejected");

      if (!generated.length) {
        const first = failures[0]?.reason;
        throw first instanceof Error ? first : new Error("No concepts were generated.");
      }

      const availableSourceIds = new Set(sources.map(a => String(a.ad_archive_id)));
      const rows = generated.map(({idea:i,model}) => {
        const requestedSources = Array.from(new Set([
          String(i.source_adaptation?.ad_archive_id || ""),
          ...(Array.isArray(i.source_ad_ids) ? i.source_ad_ids.map(String) : [])
        ].filter(id => id && availableSourceIds.has(id)))).slice(0,4);
        return {
          user_id: session.user.id,
          product_id: p.id,
          title: i.title || "",
          hook: i.hook || "",
          angle: i.angle || "",
          format: i.format || "",
          first_frame: i.first_frame || "",
          execution: i.idea || i.execution || "",
          proof_to_show: i.proof_to_show || "",
          cta: i.cta || "",
          why_test: i.why_test || "",
          inspiration: i.inspiration || "",
          source_ad_ids: requestedSources,
          strategy: {
            hooks: Array.isArray(i.hooks) ? i.hooks : [],
            audience: i.audience || "",
            first_three_seconds: i.first_three_seconds || {},
            primary_text: i.primary_text || "",
            headline: i.headline || "",
            description: i.description || "",
            video_concept: i.video_concept || "",
            video_structure: i.video_structure || "",
            recommended_duration_seconds: Number(i.recommended_duration_seconds || 0),
            production_style: i.production_style || "",
            shot_directions: Array.isArray(i.shot_directions) ? i.shot_directions : [],
            timed_script: Array.isArray(i.timed_script) ? i.timed_script : [],
            animation_prompts: Array.isArray(i.animation_prompts) ? i.animation_prompts : [],
            hook_adaptation: i.hook_adaptation || null,
            narrative_truth_mode: i.narrative_truth_mode || "",
            story_arc: i.story_arc || null,
            visual_recipe: i.visual_recipe || null,
            source_adaptation: i.source_adaptation || null,
            source_observations: Array.isArray(i.source_observations) ? i.source_observations : [],
            source_claims: Array.isArray(i.source_claims) ? i.source_claims : [],
            ai_inferences: Array.isArray(i.ai_inferences) ? i.ai_inferences : [],
            product_fact_checks: Array.isArray(i.product_fact_checks) ? i.product_fact_checks : [],
            unsupported_claim_checks: Array.isArray(i.unsupported_claim_checks) ? i.unsupported_claim_checks : [],
            hypothesis: i.hypothesis || "",
            risk: i.risk || "",
            scores: i.scores || {},
            overall_score: Number(i.overall_score || 0)
          },
          idea_model: model,
          generated_for_date: today()
        };
      });

      const insert = await db.from("ai_ideas").insert(rows);
      if (insert.error) throw insert.error;

      const note = rows.length === 5
        ? "5 concepts generated and saved."
        : rows.length + " concepts saved; " + failures.length + " slot(s) failed after retry.";
      $("ideas-status").textContent = note;
      endProgress(note, true);
      await loadData();
    } catch (error) {
      $("ideas-status").textContent = error.data?.setup_required
        ? "AI connection is not configured correctly."
        : (error.message || String(error));
      endProgress(error.message || "Generation stopped.", false);
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate from research";
    }
  }

  function adsForIdea(idea) {
    const ids = new Set((Array.isArray(idea.source_ad_ids) ? idea.source_ad_ids : []).map(String));
    return sourceAds.filter(a => ids.has(String(a.ad_archive_id)));
  }

  function openSources(idea) {
    const rows = adsForIdea(idea);
    $("source-drawer").classList.remove("hidden");
    $("source-drawer").setAttribute("aria-hidden", "false");

    $("source-drawer-content").innerHTML = rows.length
      ? rows.map(a => '<article class="drawer-source-ad">' +
          '<div class="drawer-source-top"><span class="pill">' + esc(a.advertiser_name || "Competitor") + '</span><div class="days-badge ' + (a.started_at ? 'qualified' : '') + '"><strong>' + (a.started_at ? Number(a.days_running || 0) : '—') + '</strong><span>' + (a.started_at ? 'days' : 'unknown') + '</span></div></div>' +
          (a.headline ? '<h3>' + esc(a.headline) + '</h3>' : '') +
          (a.ai_analysis?.exact_spoken_opening ? '<div class="drawer-analysis"><span>Actual transcribed opening</span><p>“' + esc(a.ai_analysis.exact_spoken_opening) + '”</p></div>' : '') +
          (a.primary_text ? '<details><summary>Primary text</summary><p>' + esc(a.primary_text) + '</p></details>' : '') +
          (a.video_transcript ? '<details><summary>Video transcript</summary><p>' + esc(a.video_transcript) + '</p></details>' : '') +
          (a.ai_analysis && a.ai_analysis.reusable_pattern ? '<div class="drawer-analysis"><span>Reusable structure</span><p>' + esc(a.ai_analysis.reusable_pattern) + '</p></div>' : '') +
          '<div class="source-actions">' + (a.source_url ? '<a class="button secondary mini" target="_blank" rel="noopener" href="' + esc(a.source_url) + '">Open Meta</a>' : '') + '</div>' +
        '</article>').join("")
      : '<div class="empty">No source-ad rows are available for this idea.</div>';
  }

  function closeSources() {
    $("source-drawer").classList.add("hidden");
    $("source-drawer").setAttribute("aria-hidden", "true");
  }

  async function setDecision(id, decision) {
    const idea = ideas.find(i => i.id === id);
    const update = decision === "approve" && idea?.approved
      ? {approved:false, status:"Idea", lifecycle_status:idea.lifecycle_status === "used" ? "used" : "new", updated_at:new Date().toISOString()}
      : decision === "approve"
      ? { approved: true, status: "Approved", lifecycle_status: idea?.lifecycle_status === "used" ? "used" : "saved", updated_at: new Date().toISOString() }
      : { approved: false, status: "Rejected", updated_at: new Date().toISOString() };

    const r = await db.from("ai_ideas").update(update).eq("id", id);
    if (r.error) throw r.error;
    await loadData();
  }

  async function recordUsage(idea, kind, content, index=null) {
    const now = new Date().toISOString();
    const existing = usageEvents.find(e => e.idea_id === idea.id && e.asset_kind === kind && (index == null || Number(e.asset_index) === Number(index)) && e.action === "used");
    if (existing) {
      const matches = usageEvents.filter(e => e.idea_id === idea.id && e.asset_kind === kind && (index == null || Number(e.asset_index) === Number(index)) && e.action === "used");
      const removed = await db.from("creative_usage_events").delete().in("id", matches.map(e => e.id)).eq("user_id",session.user.id).select("id");
      if(removed.error) throw removed.error;
      if(removed.data?.length !== matches.length) throw new Error("Could not undo usage. Please refresh and try again.");
      const remaining = usageEvents.some(e => e.idea_id === idea.id && e.action === "used" && !matches.some(m => m.id === e.id));
      const restored = await db.from("ai_ideas").update({lifecycle_status:idea.lifecycle_status === "archived" ? "archived" : remaining ? "used" : idea.approved ? "saved" : "new", used_at:remaining ? idea.used_at : null, updated_at:now}).eq("id",idea.id);
      if(restored.error) throw restored.error;
      $("ideas-status").textContent = "Usage undone. This " + kind + " is available again.";
      await loadData();
      return;
    }
    if (!existing) {
      const insert = await db.from("creative_usage_events").insert({
        user_id: session.user.id,
        product_id: idea.product_id,
        idea_id: idea.id,
        asset_kind: kind,
        asset_index: index,
        action: "used",
        content_snapshot: content || ""
      });
      if (insert.error) throw insert.error;
    }
    const update = await db.from("ai_ideas").update({
      lifecycle_status: "used",
      used_at: idea.used_at || now,
      updated_at: now
    }).eq("id", idea.id);
    if (update.error) throw update.error;
    $("ideas-status").textContent = kind === "hook" ? "Hook marked as used. Avonent will remember this choice." : "Script marked as used. Avonent will remember this choice.";
    await loadData();
  }

  async function toggleArchive(idea) {
    const restoring = idea.lifecycle_status === "archived";
    const update = await db.from("ai_ideas").update({
      lifecycle_status: restoring ? "new" : "archived",
      archived_at: restoring ? null : new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", idea.id);
    if (update.error) throw update.error;
    await db.from("creative_usage_events").insert({
      user_id: session.user.id,
      product_id: idea.product_id,
      idea_id: idea.id,
      asset_kind: "concept",
      action: restoring ? "restored" : "archived",
      content_snapshot: idea.title || idea.hook || ""
    });
    await loadData();
  }

  async function markOutcome(idea, outcome) {
    const note = window.prompt("Optional: add a quick note about why this ad was a " + outcome + " (you can leave this blank).", "") || "";
    const insert = await db.from("creative_usage_events").insert({
      user_id: session.user.id,
      product_id: idea.product_id,
      idea_id: idea.id,
      asset_kind: idea.ai_script ? "script" : "concept",
      action: outcome,
      content_snapshot: idea.ai_script || idea.hook || idea.title || "",
      notes: note
    });
    if (insert.error) throw insert.error;
    const update = await db.from("ai_ideas").update({
      performance: {...(idea.performance || {}), verdict: outcome, note},
      last_feedback_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", idea.id);
    if (update.error) throw update.error;
    $("ideas-status").textContent = "Marked " + outcome + ". Future creative will learn from it.";
    await loadData();
  }

  async function addResults(idea) {
    const ask = (label) => {
      const raw = window.prompt(label + " (optional — leave blank to skip)", "");
      if (raw == null || String(raw).trim() === "") return null;
      const n = Number(String(raw).replace(/[$,%x]/gi,"").trim());
      return Number.isFinite(n) ? n : null;
    };
    const performance = {
      spend: ask("Spend $"),
      ctr: ask("CTR %"),
      cpc: ask("CPC $"),
      cpa: ask("CPA $"),
      roas: ask("ROAS")
    };
    const notes = window.prompt("Optional note about what happened with this ad", "") || "";
    const insert = await db.from("creative_usage_events").insert({
      user_id: session.user.id,
      product_id: idea.product_id,
      idea_id: idea.id,
      asset_kind: idea.ai_script ? "script" : "concept",
      action: "results",
      content_snapshot: idea.ai_script || idea.hook || idea.title || "",
      performance,
      notes
    });
    if (insert.error) throw insert.error;
    const update = await db.from("ai_ideas").update({
      performance: {...(idea.performance || {}), ...performance, notes},
      last_feedback_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", idea.id);
    if (update.error) throw update.error;
    $("ideas-status").textContent = "Results saved. Future creative can learn from them.";
    await loadData();
  }

  async function generateScript(idea) {
    const p = currentProduct();
    if (!p) return;

    const sources = adsForIdea(idea).slice(0, 20);
    $("ideas-status").textContent = "Generating production script for " + (idea.title || "selected idea") + "…";

    const result = await cloud.invoke("creative-ai", {
      task: "script",
      primary_source_ad_id: idea.strategy?.source_adaptation?.ad_archive_id || "",
      product: p,
      competitor_ads: sources,
      idea: {
        title: idea.title,
        hook: idea.hook,
        angle: idea.angle,
        format: idea.format,
        first_frame: idea.first_frame,
        execution: idea.execution,
        proof_to_show: idea.proof_to_show,
        cta: idea.cta,
        why_test: idea.why_test,
        audience: idea.strategy?.audience || "",
        first_three_seconds: idea.strategy?.first_three_seconds || {},
        video_concept: idea.strategy?.video_concept || "",
        shot_directions: idea.strategy?.shot_directions || [],
        timed_script: idea.strategy?.timed_script || [],
        source_adaptation: idea.strategy?.source_adaptation || null,
        hook_adaptation: idea.strategy?.hook_adaptation || null,
        story_arc: idea.strategy?.story_arc || null,
        visual_recipe: idea.strategy?.visual_recipe || null,
        narrative_truth_mode: idea.strategy?.narrative_truth_mode || "",
        source_observations: idea.strategy?.source_observations || [],
        ai_inferences: idea.strategy?.ai_inferences || [],
        product_fact_checks: idea.strategy?.product_fact_checks || [],
        unsupported_claim_checks: idea.strategy?.unsupported_claim_checks || []
      }
    });

    const script = result.result?.script;
    const scriptText = result.text || (script ? [
      script.title, "Duration: " + (script.recommended_duration_seconds || "—") + " seconds",
      ...(Array.isArray(script.beats) ? script.beats.map(b => [b.time, "SAY: " + (b.say || ""), "SHOW: " + (b.show || ""), "ON SCREEN: " + (b.on_screen_text || ""), "FOOTAGE: " + (b.footage_type || "") + " · " + (b.provider || b.video_model || "camera/editor"), ...(b.source_reference ? ["SOURCE BEAT: " + b.source_reference] : []), ...(b.animation_prompt ? ["AI VIDEO PROMPT: " + b.animation_prompt] : [])].join("\n")) : []),
      "CTA: " + (script.cta || ""), "Alternative openings: " + JSON.stringify(script.three_alt_openings || []),
      "Observed evidence: " + JSON.stringify(script.source_observations || []),
      "AI inferences: " + JSON.stringify(script.ai_inferences || []),
      "Product fact checks: " + JSON.stringify(script.product_fact_checks || []),
      "Unsupported claims: " + JSON.stringify(script.unsupported_claim_checks || []),
      "Editor notes: " + JSON.stringify(script.editor_notes || ""), "Compliance notes: " + JSON.stringify(script.compliance_notes || "")
    ].join("\n\n") : result.result ? JSON.stringify(result.result,null,2) : "");
    if (!scriptText) throw new Error("AI returned no script.");

    const r = await db.from("ai_ideas").update({
      ai_script: scriptText,
      script_model: result.model || "",
      strategy: {...(idea.strategy || {}), final_script: script || null},
      status: idea.approved ? "Approved" : "Scripted",
      updated_at: new Date().toISOString()
    }).eq("id", idea.id);

    if (r.error) throw r.error;
    $("ideas-status").textContent = "AI Script saved.";
    await loadData();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      session = await cloud.requireSession();
      await loadProducts();
      await loadData();

      $("ideas-product").onchange = loadData;
      $("ideas-filter").onchange = render;
      $("generate-more-ideas").onclick = generateIdeas;

      document.querySelectorAll("[data-ideas-workspace]").forEach(button => {
        button.onclick = () => {
          workspaceMode = button.dataset.ideasWorkspace || "concepts";
          document.querySelectorAll("[data-ideas-workspace]").forEach(item => {
            const active = item === button;
            item.classList.toggle("active", active);
            item.setAttribute("aria-selected", String(active));
          });
          render();
        };
      });

      document.querySelectorAll("[data-close-sources]").forEach(el => el.onclick = closeSources);

      $("cloud-ideas-grid").addEventListener("toggle", event => {
        const opened = event.target;
        if (!opened.matches("details.idea-copy-pack") || !opened.open) return;
        $("cloud-ideas-grid").querySelectorAll("details.idea-copy-pack[open]").forEach(other => { if(other !== opened) other.open = false; });
      },true);
      $("cloud-ideas-grid").onclick = async event => {
        const target = event.target.closest("button");
        if (!target || target.disabled) return;
        const saveId = target.dataset.saveAsset;
        if(saveId) {
          target.disabled = true;
          try { await toggleSavedAsset(ideas.find(i => i.id === saveId),target.dataset.kind,Number(target.dataset.hookIndex || 0)); }
          catch(error) { $("ideas-status").textContent = error.message; }
          finally { target.disabled = false; }
          return;
        }
        if(target.dataset.copyPrimary) {
          try { await navigator.clipboard.writeText(ideas.find(i => i.id === target.dataset.copyPrimary)?.strategy?.primary_text || ""); target.textContent = "Copied"; }
          catch { $("ideas-status").textContent = "Copy unavailable. Select the text to copy it."; }
          return;
        }
        const libraryHookId = event.target.getAttribute("data-copy-library-hook");
        if (libraryHookId) {
          const idea = ideas.find(i => i.id === libraryHookId);
          const hooks = [idea?.hook, ...(Array.isArray(idea?.strategy?.hooks) ? idea.strategy.hooks : [])].filter(Boolean)
            .filter((hook,index,arr) => arr.indexOf(hook) === index);
          const hook = hooks[Number(event.target.getAttribute("data-hook-index") || 0)] || "";
          try { await navigator.clipboard.writeText(hook); event.target.textContent = "Copied"; }
          catch { $("ideas-status").textContent = "Copy unavailable. Select the hook to copy it."; }
          return;
        }

        const packId = event.target.getAttribute("data-copy-pack");
        if (packId) {
          const idea = ideas.find(i => i.id === packId), pack = idea?.strategy || {};
          try { await navigator.clipboard.writeText([
            idea?.title,
            "Audience", pack.audience,
            "Angle", idea?.angle,
            "Hooks", ...(pack.hooks || [idea?.hook]),
            "First 3 seconds", JSON.stringify(pack.first_three_seconds || {}),
            "Primary text", pack.primary_text,
            "Headline", pack.headline,
            "Description", pack.description,
            "CTA", idea?.cta,
            "Video concept", pack.video_concept,
            "Shot directions", JSON.stringify(pack.shot_directions || []),
            "Timed script", JSON.stringify(pack.timed_script || []),
            "Observed evidence", JSON.stringify(pack.source_observations || []),
            "AI inferences", JSON.stringify(pack.ai_inferences || []),
            "Product fact checks", JSON.stringify(pack.product_fact_checks || []),
            "Unsupported claims", JSON.stringify(pack.unsupported_claim_checks || [])
          ].filter(Boolean).join("\n\n")); event.target.textContent = "Copied"; }
          catch { $("ideas-status").textContent = "Copy unavailable. Select the text to copy it."; }
          return;
        }
        const useHookId = event.target.getAttribute("data-use-hook");
        const useScriptId = event.target.getAttribute("data-use-script");
        const archiveId = event.target.getAttribute("data-archive");
        const outcome = event.target.getAttribute("data-outcome");
        const outcomeId = event.target.getAttribute("data-outcome-id");
        const resultsId = event.target.getAttribute("data-results");
        const approveId = event.target.getAttribute("data-approve");
        const rejectId = event.target.getAttribute("data-reject");
        const sourceId = event.target.getAttribute("data-sources");
        const scriptId = event.target.getAttribute("data-script");
        const hookId = event.target.getAttribute("data-copy-hook");
        const copyScriptId = event.target.getAttribute("data-copy-script");

        try {
          if (useHookId) {
            const idea = ideas.find(i => i.id === useHookId);
            if (!idea) return;
            const hooks = [idea.hook, ...(Array.isArray(idea.strategy?.hooks) ? idea.strategy.hooks : [])].filter(Boolean)
              .filter((hook,index,arr) => arr.indexOf(hook) === index);
            const index = Number(event.target.getAttribute("data-hook-index") || 0);
            event.target.disabled = true;
            try { return await recordUsage(idea,"hook",hooks[index] || idea.hook || "",index); } finally { event.target.disabled = false; }
          }
          if (useScriptId) {
            const idea = ideas.find(i => i.id === useScriptId);
            if (idea) { event.target.disabled = true; try { return await recordUsage(idea,"script",idea.ai_script || JSON.stringify(idea.strategy?.timed_script || []),null); } finally { event.target.disabled = false; } }
          }
          if (archiveId) {
            const idea = ideas.find(i => i.id === archiveId);
            if (idea) return await toggleArchive(idea);
          }
          if (outcome && outcomeId) {
            const idea = ideas.find(i => i.id === outcomeId);
            if (idea) return await markOutcome(idea,outcome);
          }
          if (resultsId) {
            const idea = ideas.find(i => i.id === resultsId);
            if (idea) return await addResults(idea);
          }
          if (approveId) return await setDecision(approveId, "approve");
          if (rejectId) return await setDecision(rejectId, "reject");

          if (sourceId) {
            const idea = ideas.find(i => i.id === sourceId);
            if (idea) openSources(idea);
            return;
          }

          if (hookId) {
            const idea = ideas.find(i => i.id === hookId);
            if (idea) {
              await navigator.clipboard.writeText(idea.hook || "");
              event.target.textContent = "Copied";
            }
            return;
          }

          if (copyScriptId) {
            const idea = ideas.find(i => i.id === copyScriptId);
            if (idea) {
              await navigator.clipboard.writeText(idea.ai_script || (idea.strategy?.timed_script || []).map(b => [b.time,"SAY: " + b.say,"SHOW: " + b.show].join("\n")).join("\n\n"));
              event.target.textContent = "Copied";
            }
            return;
          }

          if (scriptId) {
            const idea = ideas.find(i => i.id === scriptId);
            if (!idea) return;
            const button = event.target;
            const old = button.textContent;
            button.disabled = true;
            button.textContent = "Generating…";
            try {
              await generateScript(idea);
            } finally {
              button.disabled = false;
              button.textContent = old;
            }
          }
        } catch (error) {
          if (error.data && error.data.setup_required) {
            $("ideas-status").textContent = "AI connection is not configured correctly.";
          } else {
            $("ideas-status").textContent = error.message || String(error);
          }
        }
      };

    } catch (error) {
      console.error(error);
    }
  });
})();
