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

  function render() {
    $("ideas-today-count").textContent = String(ideas.filter(i => i.generated_for_date === today()).length);
    $("ideas-approved-count").textContent = String(ideas.filter(i => i.approved || i.status === "Approved").length);
    $("ideas-script-count").textContent = String(ideas.filter(i => i.ai_script).length);
    $("ideas-source-count").textContent = String(sourceAds.length);

    const rows = filteredIdeas();
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

        '<details class="idea-copy-pack"><summary>Hook variations & ad copy</summary>' +
        (Array.isArray(strategy.hooks) ? strategy.hooks.map((hook,n) => '<p><strong>Hook ' + (n+1) + '</strong><br>' + esc(hook) + '</p>').join("") : '') +
        (strategy.primary_text ? '<h4>Primary text</h4><p style="white-space:pre-wrap">' + esc(strategy.primary_text) + '</p>' : '') +
        (strategy.headline ? '<h4>Headline</h4><p>' + esc(strategy.headline) + '</p>' : '') +
        (strategy.description ? '<h4>Description</h4><p>' + esc(strategy.description) + '</p>' : '') +
        (strategy.video_structure ? '<h4>Video plan</h4><p>' + esc(typeof strategy.video_structure === "string" ? strategy.video_structure : JSON.stringify(strategy.video_structure)) + '</p>' : '') +
        '<button type="button" class="button secondary mini" data-copy-pack="' + idea.id + '">Copy creative brief</button></details>' +
        '<div class="idea-execution-grid">' +
          '<section><span>First frame</span><p>' + esc(idea.first_frame || "Not specified") + '</p></section>' +
          '<section><span>Angle</span><p>' + esc(idea.angle || "Not specified") + '</p></section>' +
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

  async function generateIdeas() {
    const p = currentProduct();
    if (!p) return;

    const sources = researchSources(sourceAds);
    if (!sources.length) {
      $("ideas-status").textContent = "No captured ad copy yet. Open Research and collect a brand’s ads first. Ads of any age can be used.";
      return;
    }

    const btn = $("generate-more-ideas");
    btn.disabled = true;
    btn.textContent = "Generating…";
    $("ideas-status").textContent = "Studying " + sources.length + " source ads (all ages eligible)…";

    try {
      const result = await cloud.invoke("creative-ai", { task: "ideas", product: p, competitor_ads: sources });
      let parsed = result.result || null;

      if (!parsed && result.text) {
        let cleaned = String(result.text).trim();
        if (cleaned.indexOf("~~~json") === 0) cleaned = cleaned.slice(7);
        if (cleaned.lastIndexOf("~~~") === cleaned.length - 3) cleaned = cleaned.slice(0, -3);
        parsed = JSON.parse(cleaned.trim());
      }

      const generated = Array.isArray(parsed && parsed.ideas) ? parsed.ideas : [];
      if (!generated.length) throw new Error("AI returned no ideas.");

      const availableSourceIds = new Set(sources.map(a => String(a.ad_archive_id)));
      const rows = generated.slice(0, 5).map(i => {
        const requestedSources = Array.isArray(i.source_ad_ids) ? i.source_ad_ids.map(String).filter(id => availableSourceIds.has(id)).slice(0,4) : [];
        return ({
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
          hooks:i.hooks || [], primary_text:i.primary_text || "", headline:i.headline || "", description:i.description || "", video_structure:i.video_structure || "",
          hypothesis:i.hypothesis || "",
          scores:i.scores || {},
          overall_score:Number(i.overall_score || 0),
          risk:i.risk || ""
        },
        idea_model: result.model || "",
        generated_for_date: today()
      });
      });

      const insert = await db.from("ai_ideas").insert(rows);
      if (insert.error) throw insert.error;
      $("ideas-status").textContent = rows.length + " new ideas generated.";
      await loadData();
    } catch (error) {
      if (error.data && error.data.setup_required) {
        $("ideas-status").textContent = "AI setup required: add OPENAI_API_KEY in Supabase → Edge Functions → Secrets using the AI setup link.";
      } else {
        $("ideas-status").textContent = error.message || String(error);
      }
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
          '<div class="drawer-source-top"><span class="pill">' + esc(a.advertiser_name || "Competitor") + '</span><div class="days-badge qualified"><strong>' + Number(a.days_running || 0) + '</strong><span>days</span></div></div>' +
          (a.headline ? '<h3>' + esc(a.headline) + '</h3>' : '') +
          (a.primary_text ? '<p>' + esc(a.primary_text) + '</p>' : '') +
          (a.ai_analysis && a.ai_analysis.reusable_pattern ? '<div class="drawer-analysis"><span>AI pattern</span><p>' + esc(a.ai_analysis.reusable_pattern) + '</p></div>' : '') +
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
        why_test: idea.why_test
      }
    });

    const script = result.result?.script;
    const scriptText = result.text || (script ? [
      script.title, "Duration: " + (script.recommended_duration_seconds || "—") + " seconds",
      ...(Array.isArray(script.beats) ? script.beats.map(b => [b.time, "SAY: " + (b.spoken || ""), "SHOW: " + (b.shot || ""), "ON SCREEN: " + (b.on_screen_text || "")].join("\n")) : []),
      "CTA: " + (script.cta || ""), "Alternative openings: " + JSON.stringify(script.three_alt_openings || []),
      "Editor notes: " + JSON.stringify(script.editor_notes || ""), "Claims check: " + JSON.stringify(script.compliance_notes || "")
    ].join("\n\n") : result.result ? JSON.stringify(result.result,null,2) : "");
    if (!scriptText) throw new Error("AI returned no script.");

    const r = await db.from("ai_ideas").update({
      ai_script: scriptText,
      script_model: result.model || "",
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

      document.querySelectorAll("[data-close-sources]").forEach(el => el.onclick = closeSources);

      $("cloud-ideas-grid").onclick = async event => {
        const packId = event.target.getAttribute("data-copy-pack");
        if (packId) {
          const idea = ideas.find(i => i.id === packId), pack = idea?.strategy || {};
          try { await navigator.clipboard.writeText([idea?.title, "Hooks", ...(pack.hooks || [idea?.hook]), "Primary text", pack.primary_text, "Headline", pack.headline, "Description",pack.description,"Video plan",typeof pack.video_structure === "string" ? pack.video_structure : JSON.stringify(pack.video_structure || "")].filter(Boolean).join("\n\n")); event.target.textContent = "Copied"; }
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
            $("ideas-status").textContent = "AI setup required: add OPENAI_API_KEY in Supabase → Edge Functions → Secrets using the AI setup link.";
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