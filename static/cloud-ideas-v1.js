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
      render();
      return;
    }

    const results = await Promise.all([
      db.from("ai_ideas").select("*").eq("product_id", productId).order("created_at", { ascending: false }).limit(300),
      db.from("competitor_ads").select("*").eq("product_id", productId).order("days_running", { ascending: false }).limit(300)
    ]);

    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    ideas = results[0].data || [];
    sourceAds = results[1].data || [];
    render();
  }

  function filteredIdeas() {
    const mode = $("ideas-filter").value;
    if (mode === "today") return ideas.filter(i => i.generated_for_date === today());
    if (mode === "approved") return ideas.filter(i => i.approved || i.status === "Approved");
    if (mode === "scripted") return ideas.filter(i => i.ai_script);
    if (mode === "rejected") return ideas.filter(i => i.status === "Rejected");
    return ideas;
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
      '<span>FOOTAGE</span><p><strong>' + esc(type) + '</strong> · ' + esc(provider) + '</p>' +
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

  function renderHooksWorkspace(rows) {
    $("cloud-ideas-grid").innerHTML = rows.length ? rows.map((idea) => {
      const strategy = idea.strategy || {};
      const hooks = [idea.hook, ...(Array.isArray(strategy.hooks) ? strategy.hooks : [])].filter(Boolean)
        .filter((hook,index,arr) => arr.indexOf(hook) === index);
      return '<article class="hook-library-card">' +
        '<div class="hook-library-head"><div><span class="eyebrow">HOOK SET</span><h2>' + esc(idea.title || idea.angle || "Creative idea") + '</h2></div><span class="pill">' + esc(idea.angle || "Angle") + '</span></div>' +
        (strategy.audience ? '<p class="helper">Audience · ' + esc(strategy.audience) + '</p>' : '') +
        '<div class="hook-library-list">' + hooks.map((hook,index) =>
          '<div class="hook-library-row"><span>' + String(index + 1).padStart(2,"0") + '</span><p>' + esc(hook) + '</p><button type="button" class="copy-inline" data-copy-library-hook="' + esc(idea.id) + '" data-hook-index="' + index + '">Copy</button></div>'
        ).join("") + '</div>' +
        '<div class="hook-library-meta"><span>' + (Array.isArray(idea.source_ad_ids) ? idea.source_ad_ids.length : 0) + ' source ads</span><span>' + esc(idea.format || "Format TBD") + '</span></div>' +
        sourceAdaptationHtml(strategy) +
        '<details class="idea-copy-pack"><summary>Connected script and video plan</summary><p>Suggested duration: ' + esc(strategy.recommended_duration_seconds || "AI to decide") + ' seconds · ' + esc(strategy.production_style || "AI to choose footage mix") + '</p>' +
        (Array.isArray(strategy.timed_script) ? strategy.timed_script.map(timedBeatHtml).join("") : '<p>No timed script yet.</p>') +
        (strategy.video_concept ? '<p>' + esc(strategy.video_concept) + '</p>' : '') +
        '<button class="button secondary mini" type="button" data-script="' + esc(idea.id) + '">Generate production script</button></details>' +
      '</article>';
    }).join("") : '<div class="empty wide">No hook sets in this view yet.</div>';
  }

  function renderScriptsWorkspace(rows) {
    const scripted = rows.filter(idea => idea.ai_script || (Array.isArray(idea.strategy?.timed_script) && idea.strategy.timed_script.length));
    $("cloud-ideas-grid").innerHTML = scripted.length ? scripted.map((idea) => {
      const strategy = idea.strategy || {};
      const timed = Array.isArray(strategy.timed_script) ? strategy.timed_script : [];
      return '<article class="script-workspace-card">' +
        '<div class="hook-library-head"><div><span class="eyebrow">SCRIPT</span><h2>' + esc(idea.title || idea.angle || "Creative idea") + '</h2></div>' +
          (idea.ai_script ? '<span class="idea-state approved">Final script</span>' : '<span class="idea-state">Concept script</span>') + '</div>' +
        (strategy.first_three_seconds ? '<section class="script-opening"><span>First 3 seconds</span><div class="timed-beat"><span>SAY</span><p>' + esc(strategy.first_three_seconds.say || "") + '</p><span>SHOW</span><p>' + esc(strategy.first_three_seconds.show || "") + '</p><span>ON-SCREEN</span><p>' + esc(strategy.first_three_seconds.on_screen_text || "") + '</p></div></section>' : '') +
        (idea.ai_script
          ? '<pre class="final-script-pre">' + esc(idea.ai_script) + '</pre><div class="idea-inline-actions"><button class="button secondary mini" type="button" data-copy-script="' + esc(idea.id) + '">Copy script</button><button class="button secondary mini" type="button" data-script="' + esc(idea.id) + '">Regenerate</button></div>'
          : sourceAdaptationHtml(strategy) + '<div class="timed-script">' + timed.map(timedBeatHtml).join("") + '</div><button class="button" type="button" data-script="' + esc(idea.id) + '">Generate final AI script</button>') +
      '</article>';
    }).join("") : '<div class="empty wide">No scripts in this view yet. Generate concepts first, then open Scripts.</div>';
  }

  function render() {
    $("ideas-today-count").textContent = String(ideas.filter(i => i.generated_for_date === today()).length);
    $("ideas-approved-count").textContent = String(ideas.filter(i => i.approved || i.status === "Approved").length);
    $("ideas-script-count").textContent = String(ideas.filter(i => i.ai_script).length);
    $("ideas-source-count").textContent = String(sourceAds.length);

    const rows = filteredIdeas();
    if (workspaceMode === "hooks") { renderHooksWorkspace(rows); return; }
    if (workspaceMode === "scripts") { renderScriptsWorkspace(rows); return; }
    if (!rows.length) {
      $("cloud-ideas-grid").innerHTML = '<div class="empty wide">No ideas in this view yet. Research competitors first, then generate ideas.</div>';
      return;
    }

    $("cloud-ideas-grid").innerHTML = rows.map((idea, index) => {
      const sourceIds = Array.isArray(idea.source_ad_ids) ? idea.source_ad_ids : [];
      const strategy = idea.strategy || {};
      const scores = strategy.scores || {};
      const overall = Number(strategy.overall_score || 0);
      const status = idea.status || "Idea";
      const approved = idea.approved || status === "Approved";
      const rejected = status === "Rejected";

      const scriptBlock = idea.ai_script
        ? '<section class="idea-script-block">' +
            '<div class="idea-section-head"><span>AI Script</span><strong>' + esc(idea.script_model || "AI") + '</strong></div>' +
            '<pre>' + esc(idea.ai_script) + '</pre>' +
            '<div class="idea-inline-actions"><button class="button secondary mini" type="button" data-copy-script="' + idea.id + '">Copy script</button><button class="button secondary mini" type="button" data-script="' + idea.id + '">Regenerate</button></div>' +
          '</section>'
        : '<section class="idea-script-empty"><div><span class="eyebrow">FINAL SCRIPT</span><h4>Generate only when this idea is worth producing.</h4><p>The stronger script model receives the selected idea, product facts, and its source ads.</p></div><button class="button" type="button" data-script="' + idea.id + '">Generate AI Script</button></section>';

      return '<article class="cloud-idea-card" data-idea="' + idea.id + '">' +
        '<div class="idea-card-top">' +
          '<div><span class="idea-number">IDEA ' + String(index + 1).padStart(2, "0") + '</span><h2>' + esc(idea.title || idea.angle || "Ad idea") + '</h2><div class="idea-meta"><span>' + esc(idea.format || "Format TBD") + '</span><span>' + esc(idea.idea_model || "AI") + '</span></div></div>' +
          '<div class="idea-score-state">' +
            (overall ? '<div class="idea-score"><strong>' + overall + '</strong><span>/100</span></div>' : '') +
            '<span class="idea-state ' + (approved ? "approved" : rejected ? "rejected" : "") + '">' + esc(approved ? "Approved" : rejected ? "Rejected" : status) + '</span>' +
          '</div>' +
        '</div>' +

        '<section class="idea-hook-block"><div class="idea-section-head"><span>Hook</span><button class="copy-inline" type="button" data-copy-hook="' + idea.id + '">Copy</button></div><p>' + esc(idea.hook || "") + '</p></section>' +

        '<details class="idea-copy-pack"><summary>Full creative brief</summary>' +
        (strategy.audience ? '<h4>Audience</h4><p>' + esc(strategy.audience) + '</p>' : '') +
        (Array.isArray(strategy.hooks) ? strategy.hooks.map((hook,n) => '<p><strong>Hook ' + (n+1) + '</strong><br>' + esc(hook) + '</p>').join("") : '') +
        (strategy.first_three_seconds ? '<h4>First 3 seconds</h4><div class="timed-beat"><span>SAY</span><p>' + esc(strategy.first_three_seconds.say || "") + '</p><span>SHOW</span><p>' + esc(strategy.first_three_seconds.show || "") + '</p><span>ON-SCREEN</span><p>' + esc(strategy.first_three_seconds.on_screen_text || "") + '</p></div>' : '') +
        (strategy.primary_text ? '<h4>Primary text</h4><p style="white-space:pre-wrap">' + esc(strategy.primary_text) + '</p>' : '') +
        (strategy.headline ? '<h4>Headline</h4><p>' + esc(strategy.headline) + '</p>' : '') +
        (strategy.description ? '<h4>Description</h4><p>' + esc(strategy.description) + '</p>' : '') +
        (strategy.video_concept ? '<h4>Video concept</h4><p>' + esc(strategy.video_concept) + '</p>' : '') +
        sourceAdaptationHtml(strategy) +
        (Array.isArray(strategy.shot_directions) && strategy.shot_directions.length ? '<h4>Shot directions</h4><ol class="strategy-list">' + strategy.shot_directions.map(x => '<li>' + esc(typeof x === "string" ? x : JSON.stringify(x)) + '</li>').join("") + '</ol>' : '') +
        (Array.isArray(strategy.timed_script) && strategy.timed_script.length ? '<h4>Timed script</h4><div class="timed-script">' + strategy.timed_script.map(timedBeatHtml).join("") + '</div>' : '') +
        (Array.isArray(strategy.source_observations) && strategy.source_observations.length ? '<h4>Observed in source ads</h4><ul class="strategy-list evidence-list">' + strategy.source_observations.map(x => '<li><strong>' + esc(x.ad_archive_id || "Source") + '</strong> · ' + esc(x.observation || "") + '</li>').join("") + '</ul>' : '') +
        (Array.isArray(strategy.ai_inferences) && strategy.ai_inferences.length ? '<h4>AI inferences</h4><ul class="strategy-list inference-list">' + strategy.ai_inferences.map(x => '<li>' + esc(typeof x === "string" ? x : JSON.stringify(x)) + '</li>').join("") + '</ul>' : '') +
        (Array.isArray(strategy.product_fact_checks) && strategy.product_fact_checks.length ? '<h4>Product-fact checks</h4><ul class="strategy-list claim-list">' + strategy.product_fact_checks.map(x => '<li><strong>' + esc(x.status || "needs_review") + '</strong> · ' + esc(x.claim || "") + (x.support ? '<br><small>' + esc(x.support) + '</small>' : '') + '</li>').join("") + '</ul>' : '') +
        (Array.isArray(strategy.unsupported_claim_checks) && strategy.unsupported_claim_checks.length ? '<div class="claim-warning"><strong>Unsupported / revise</strong><ul class="strategy-list">' + strategy.unsupported_claim_checks.map(x => '<li>' + esc(typeof x === "string" ? x : JSON.stringify(x)) + '</li>').join("") + '</ul></div>' : '<p class="claim-clear">No unsupported claims flagged in this draft.</p>') +
        '<button type="button" class="button secondary mini" data-copy-pack="' + idea.id + '">Copy creative brief</button></details>' +
        '<div class="idea-execution-grid">' +
          '<section><span>Audience</span><p>' + esc(strategy.audience || "Not specified") + '</p></section>' +
          '<section><span>Angle</span><p>' + esc(idea.angle || "Not specified") + '</p></section>' +
          '<section class="wide"><span>First frame</span><p>' + esc(idea.first_frame || "Not specified") + '</p></section>' +
          '<section class="wide"><span>Execution</span><p>' + esc(idea.execution || "") + '</p></section>' +
          '<section><span>Proof to show</span><p>' + esc(idea.proof_to_show || "Use documented product proof") + '</p></section>' +
          '<section><span>CTA</span><p>' + esc(idea.cta || "") + '</p></section>' +
        '</div>' +

        '<section class="idea-why"><span>Why test it</span><p>' + esc(idea.why_test || "") + '</p></section>' +
        (strategy.hypothesis ? '<section class="idea-hypothesis"><span>Hypothesis</span><p>' + esc(strategy.hypothesis) + '</p></section>' : '') +
        (strategy.risk ? '<section class="idea-risk"><span>Biggest risk</span><p>' + esc(strategy.risk) + '</p></section>' : '') +
        (overall ? '<div class="idea-score-grid">' +
          '<div><span>Scroll stop</span><strong>' + Number(scores.scroll_stop || 0) + '/10</strong></div>' +
          '<div><span>Specificity</span><strong>' + Number(scores.specificity || 0) + '/10</strong></div>' +
          '<div><span>Product fit</span><strong>' + Number(scores.product_fit || 0) + '/10</strong></div>' +
          '<div><span>Source support</span><strong>' + Number(scores.source_support || 0) + '/10</strong></div>' +
          '<div><span>Producibility</span><strong>' + Number(scores.producibility || 0) + '/10</strong></div>' +
          '<div><span>Compliance</span><strong>' + Number(scores.compliance_safety || 0) + '/10</strong></div>' +
        '</div>' : '') +

        '<div class="idea-research-row">' +
          '<button class="source-link" type="button" data-sources="' + idea.id + '">' +
            '<strong>' + sourceIds.length + '</strong><span>source ads</span>' +
          '</button>' +
          '<p>' + esc(idea.inspiration || "Generated from long-running competitor patterns.") + '</p>' +
        '</div>' +

        '<div class="idea-decision-row">' +
          '<button class="decision-button approve ' + (approved ? "active" : "") + '" type="button" data-approve="' + idea.id + '">✓ Approve</button>' +
          '<button class="decision-button reject ' + (rejected ? "active" : "") + '" type="button" data-reject="' + idea.id + '">× Reject</button>' +
        '</div>' +

        scriptBlock +
      '</article>';
    }).join("");
  }

  function pickPrimarySources(sources, count=5) {
    const chosen = [];
    const seenAdvertisers = new Set();
    for (const ad of sources) {
      const key = String(ad.advertiser_name || "").toLowerCase().trim();
      if (key && !seenAdvertisers.has(key)) {
        chosen.push(ad);
        seenAdvertisers.add(key);
        if (chosen.length >= count) return chosen;
      }
    }
    for (const ad of sources) {
      if (!chosen.includes(ad)) chosen.push(ad);
      if (chosen.length >= count) break;
    }
    return chosen;
  }

  async function generateIdeas() {
    const p = currentProduct();
    if (!p) return;

    const sources = researchSources(sourceAds).slice(0, 8);
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
              competitor_ads: sources
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
            source_adaptation: i.source_adaptation || null,
            source_observations: Array.isArray(i.source_observations) ? i.source_observations : [],
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
    const update = decision === "approve"
      ? { approved: true, status: "Approved", updated_at: new Date().toISOString() }
      : { approved: false, status: "Rejected", updated_at: new Date().toISOString() };

    const r = await db.from("ai_ideas").update(update).eq("id", id);
    if (r.error) throw r.error;
    await loadData();
  }

  async function generateScript(idea) {
    const p = currentProduct();
    if (!p) return;

    const sources = adsForIdea(idea).slice(0, 20);
    $("ideas-status").textContent = "Generating production script for " + (idea.title || "selected idea") + "…";

    const result = await cloud.invoke("creative-ai", {
      task: "script",
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
        source_observations: idea.strategy?.source_observations || [],
        ai_inferences: idea.strategy?.ai_inferences || [],
        product_fact_checks: idea.strategy?.product_fact_checks || [],
        unsupported_claim_checks: idea.strategy?.unsupported_claim_checks || []
      }
    });

    const script = result.result?.script;
    const scriptText = result.text || (script ? [
      script.title, "Duration: " + (script.recommended_duration_seconds || "—") + " seconds",
      ...(Array.isArray(script.beats) ? script.beats.map(b => [b.time, "SAY: " + (b.say || ""), "SHOW: " + (b.show || ""), "ON SCREEN: " + (b.on_screen_text || ""), "FOOTAGE: " + (b.footage_type || "") + " · " + (b.provider || b.video_model || "camera/editor"), ...(b.animation_prompt ? ["AI VIDEO PROMPT: " + b.animation_prompt] : [])].join("\n")) : []),
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

      $("cloud-ideas-grid").onclick = async event => {
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
        const approveId = event.target.getAttribute("data-approve");
        const rejectId = event.target.getAttribute("data-reject");
        const sourceId = event.target.getAttribute("data-sources");
        const scriptId = event.target.getAttribute("data-script");
        const hookId = event.target.getAttribute("data-copy-hook");
        const copyScriptId = event.target.getAttribute("data-copy-script");

        try {
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
            if (idea && idea.ai_script) {
              await navigator.clipboard.writeText(idea.ai_script);
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