(() => {
  "use strict";

  const cloud = window.AVONENT_CLOUD;
  if (!cloud) return;
  const db = cloud.db;
  const $ = id => document.getElementById(id);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

  let session = null;
  let products = [];
  let watchlist = [];
  let ads = [];

  function niceDate(value) {
    if (!value) return "Never";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Never";
    const mins = Math.floor((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return mins + "m ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return d.toLocaleDateString();
  }

  function productId() {
    return $("research-product")?.value || "";
  }

  function currentProduct() {
    return products.find(p => p.id === productId()) || null;
  }

  function activateTab(name) {
    document.querySelectorAll("[data-research-tab]").forEach(btn => {
      const on = btn.dataset.researchTab === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll("[data-research-panel]").forEach(panel => {
      panel.hidden = panel.dataset.researchPanel !== name;
    });
    history.replaceState(null, "", location.pathname + "#" + name);
  }

  async function loadProducts() {
    const r = await db.from("products").select("*").order("created_at", { ascending: true });
    if (r.error) throw r.error;
    products = r.data || [];
    $("research-product").innerHTML = products.length
      ? products.map(p => '<option value="' + esc(p.id) + '">' + esc(p.brand_name || "") + ' — ' + esc(p.name) + '</option>').join("")
      : '<option value="">No products yet</option>';
  }

  async function loadResearch() {
    const id = productId();
    if (!id) {
      watchlist = [];
      ads = [];
      render();
      return;
    }

    const [w, a] = await Promise.all([
      db.from("competitor_watchlist").select("*").eq("product_id", id).order("created_at", { ascending: true }),
      db.from("competitor_ads").select("*").eq("product_id", id).order("days_running", { ascending: false }).limit(500)
    ]);

    if (w.error) throw w.error;
    if (a.error) throw a.error;
    watchlist = w.data || [];
    ads = a.data || [];
    render();
  }

  function render() {
    const activeAds = ads.filter(a => a.is_active);
    const longAds = activeAds.filter(a => a.qualifies_long_running);
    const scans = watchlist.map(w => w.last_scanned_at).filter(Boolean).sort().reverse();

    if ($("stat-watchlist")) $("stat-watchlist").textContent = String(watchlist.filter(w => w.active).length);
    if ($("stat-proven")) $("stat-proven").textContent = String(longAds.length);
    if ($("stat-ads")) $("stat-ads").textContent = String(activeAds.length);
    if ($("stat-analyzed")) $("stat-analyzed").textContent = String(ads.filter(a => a.analyzed_at).length);
    if ($("stat-last-scan")) $("stat-last-scan").textContent = scans[0] ? niceDate(scans[0]) : "Never";

    renderBrands();
    renderBrandFilter();
    renderAds();
  }

  function renderBrands() {
    const box = $("watchlist-list");
    if (!box) return;

    if (!watchlist.length) {
      box.innerHTML = '<div class="empty">No brands tracked yet.</div>';
      return;
    }

    box.innerHTML = watchlist.map(w => {
      const brandAds = ads.filter(a => a.competitor_id === w.id && a.is_active);
      const longCount = brandAds.filter(a => a.qualifies_long_running).length;
      return '<article class="watch-item brand-card" data-brand-card="' + esc(w.id) + '">' +
        '<div class="brand-card-head">' +
          '<div class="brand-card-name"><span class="eyebrow">TRACKED BRAND</span><h3>' + esc(w.competitor_name) + '</h3></div>' +
          '<label class="watch-toggle"><input type="checkbox" data-watch-active="' + esc(w.id) + '" ' + (w.active ? 'checked' : '') + '><span>' + (w.active ? 'On' : 'Off') + '</span></label>' +
        '</div>' +
        '<div class="brand-card-stats">' +
          '<div><span>Ads sampled</span><strong>' + brandAds.length + '</strong></div>' +
          '<div><span>' + Number(w.min_days_running || 30) + '+ day ads found</span><strong>' + longCount + '</strong></div>' +
          '<div><span>Last research</span><strong class="small-value">' + esc(w.last_scanned_at ? niceDate(w.last_scanned_at) : "Never") + '</strong></div>' +
        '</div>' +
        '<div class="brand-card-actions">' +
          '<button class="button mini" type="button" data-research-brand="' + esc(w.id) + '">Research brand</button>' +
          '<button class="button secondary mini" type="button" data-view-brand="' + esc(w.id) + '">View ads</button>' +
          '<button class="text-button danger" type="button" data-watch-delete="' + esc(w.id) + '">Remove</button>' +
        '</div>' +
        '<details class="brand-card-settings"><summary>Settings</summary>' +
          '<label>Long-running threshold<div class="number-field compact"><input type="number" min="1" max="3650" value="' + Number(w.min_days_running || 30) + '" data-watch-days="' + esc(w.id) + '"><span>days</span></div></label>' +
        '</details>' +
      '</article>';
    }).join("");
  }

  function renderBrandFilter() {
    const select = $("brand-filter");
    if (!select) return;
    const previous = select.value || "all";
    select.innerHTML = '<option value="all">All tracked brands</option>' +
      watchlist.map(w => '<option value="' + esc(w.id) + '">' + esc(w.competitor_name) + '</option>').join("");
    select.value = watchlist.some(w => w.id === previous) ? previous : "all";
  }

  function renderAds() {
    const box = $("research-ads");
    if (!box) return;

    const mode = $("ad-filter")?.value || "all";
    const brand = $("brand-filter")?.value || "all";

    let rows = ads.filter(a => a.is_active);
    if (brand !== "all") rows = rows.filter(a => a.competitor_id === brand);
    if (mode === "long") rows = rows.filter(a => a.qualifies_long_running);

    if (!rows.length) {
      box.innerHTML = '<div class="empty wide">' +
        (mode === "long" ? 'No 30+ day ads in the collected sample. This does not mean the brand has none.' : 'No collected ads for this view yet. Research a tracked brand first.') +
      '</div>';
      return;
    }

    box.innerHTML = rows.map(a => {
      const media = a.media_url
        ? '<div class="source-ad-media">' +
            (a.media_kind === "video"
              ? '<video controls playsinline preload="metadata" src="' + esc(a.media_url) + '"></video>'
              : '<img loading="lazy" src="' + esc(a.media_url) + '" alt="">') +
          '</div>'
        : '<div class="ad-media-empty"><span>Creative preview</span><p>Media was not captured by this source yet.</p></div>';

      const primary = a.primary_text
        ? '<div class="source-copy"><div class="source-copy-head"><span>Primary text</span><button class="copy-inline" type="button" data-copy-text="' + esc(a.id) + '">Copy</button></div><p>' + esc(a.primary_text) + '</p></div>'
        : '<div class="source-copy muted-copy"><div class="source-copy-head"><span>Primary text</span></div><p>Not captured yet.</p></div>';

      const headline = a.headline
        ? '<div class="ad-headline-block"><span>Headline</span><strong>' + esc(a.headline) + '</strong></div>'
        : '';

      const actions =
        (a.source_url ? '<a class="button secondary mini" target="_blank" rel="noopener" href="' + esc(a.source_url) + '">Open Meta ad</a>' : '') +
        (a.landing_url ? '<a class="button secondary mini" target="_blank" rel="noopener" href="' + esc(a.landing_url) + '">Landing page</a>' : '');

      return '<article class="source-ad-card">' +
        '<div class="source-ad-top"><div><span class="pill">' + esc(a.advertiser_name || "Tracked brand") + '</span><h3>Ad ' + esc(a.ad_archive_id || "") + '</h3></div>' +
        '<div class="days-badge ' + (a.qualifies_long_running ? 'qualified' : '') + '"><strong>' + Number(a.days_running || 0) + '</strong><span>days</span></div></div>' +
        media + headline + primary +
        '<div class="source-meta"><span>' + (a.started_at ? 'Started ' + esc(a.started_at) : 'Start date unavailable') + '</span>' +
          (a.qualifies_long_running ? '<span class="qualified-label">Long-running</span>' : '') +
          (a.analyzed_at ? '<span class="qualified-label">AI analyzed</span>' : '') +
        '</div>' +
        '<div class="source-actions">' + actions + '</div>' +
      '</article>';
    }).join("");
  }

  async function addCompetitor(event) {
    event.preventDefault();
    const name = $("competitor-name").value.trim().slice(0, 120);
    if (!name || !productId()) return;

    if (/^https?:\/\//i.test(name)) {
      $("research-status").textContent = "Enter the brand name only. Avonent handles Meta links in the background.";
      return;
    }

    if (watchlist.some(w => w.competitor_name.toLowerCase() === name.toLowerCase())) {
      $("research-status").textContent = "That brand is already tracked.";
      return;
    }

    $("research-status").textContent = "Adding brand…";
    const r = await db.from("competitor_watchlist").insert({
      user_id: session.user.id,
      product_id: productId(),
      competitor_name: name,
      min_days_running: Math.max(1, Number($("competitor-days").value || 30)),
      active: true
    });

    if (r.error) {
      $("research-status").textContent = r.error.message;
      return;
    }

    $("competitor-name").value = "";
    $("research-status").textContent = name + " added.";
    await loadResearch();
  }

  async function runResearch(competitorId = null) {
    const btn = competitorId ? document.querySelector('[data-research-brand="' + competitorId + '"]') : $("scan-now");
    if (btn) {
      btn.disabled = true;
      btn.dataset.oldText = btn.textContent;
      btn.textContent = "Researching…";
    }

    const brand = competitorId ? watchlist.find(w => w.id === competitorId) : null;
    $("research-status").textContent = brand
      ? "Researching " + brand.competitor_name + "…"
      : "Researching tracked brands…";

    try {
      const result = await cloud.invoke("scan-competitor-ads", {
        product_id: productId(),
        competitor_id: competitorId || undefined
      });

      if (Array.isArray(result.errors) && result.errors.length) {
        const useful = result.errors.map(e => e.error || "").filter(Boolean);
        if (useful.length) throw new Error(useful.join(" · "));
      }

      await loadResearch();

      if (competitorId && $("brand-filter")) $("brand-filter").value = competitorId;
      if ($("ad-filter")) $("ad-filter").value = "all";
      renderAds();
      activateTab("ads");

      $("research-status").textContent =
        "Research sample updated: " + Number(result.stored || 0) + " ads saved; " + Number(result.long_running || 0) + " older ads found in this scan. This is not the advertiser’s total.";
    } catch (error) {
      const saved = competitorId ? ads.filter(a => a.competitor_id === competitorId && a.is_active) : ads.filter(a => a.is_active);
      if (saved.length) {
        if (competitorId && $("brand-filter")) $("brand-filter").value = competitorId;
        if ($("ad-filter")) $("ad-filter").value = "all";
        renderAds();
        activateTab("ads");
        $("research-status").textContent = "Showing " + saved.length + " previously saved ads, not the full advertiser library. Refresh failed: " + (error.message || String(error));
      } else {
        $("research-status").textContent = error.message || String(error);
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = btn.dataset.oldText || (competitorId ? "Research brand" : "Research all");
      }
    }
  }

  async function analyzeResearch() {
    const btn = $("analyze-ads");
    btn.disabled = true;
    btn.textContent = "Analyzing…";
    try {
      const result = await cloud.invoke("analyze-competitor-ads", { product_id: productId(), limit: 20 });
      $("research-status").textContent = result.analyzed
        ? "Analyzed " + result.analyzed + " ads. Their hooks and patterns are now saved for the strategist."
        : "Nothing new needed analysis.";
      await loadResearch();
    } catch (error) {
      $("research-status").textContent = error.data?.setup_required
        ? "Connect the AI API key to analyze ad patterns."
        : (error.message || String(error));
    } finally {
      btn.disabled = false;
      btn.textContent = "Analyze research";
    }
  }

  async function generateIdeas() {
    const p = currentProduct();
    if (!p) return;

    const longRunning = ads.filter(a => a.is_active && a.qualifies_long_running);
    const sources = (longRunning.length ? longRunning : ads.filter(a => a.is_active)).slice(0, 30);

    if (!sources.length) {
      $("research-status").textContent = "Research at least one tracked brand first.";
      return;
    }

    const btn = $("generate-ideas");
    btn.disabled = true;
    btn.textContent = "Generating…";
    $("research-status").textContent = "Building original concepts from " + sources.length + " source ads…";

    try {
      const result = await cloud.invoke("creative-ai", { task: "ideas", product: p, competitor_ads: sources });
      const parsed = result.result || {};
      const ideas = Array.isArray(parsed.ideas) ? parsed.ideas : [];
      if (!ideas.length) throw new Error("AI returned no ideas.");

      const available = new Set(sources.map(a => String(a.ad_archive_id)));
      const date = new Date().toISOString().slice(0, 10);
      const rows = ideas.slice(0, 5).map(idea => ({
        user_id: session.user.id,
        product_id: p.id,
        title: idea.title || "",
        hook: idea.hook || "",
        angle: idea.angle || "",
        format: idea.format || "",
        first_frame: idea.first_frame || "",
        execution: idea.idea || idea.execution || "",
        proof_to_show: idea.proof_to_show || "",
        cta: idea.cta || "",
        why_test: idea.why_test || "",
        inspiration: idea.inspiration || "",
        source_ad_ids: Array.isArray(idea.source_ad_ids)
          ? idea.source_ad_ids.map(String).filter(id => available.has(id)).slice(0, 4)
          : [],
        strategy: {
          hypothesis: idea.hypothesis || "",
          risk: idea.risk || "",
          scores: idea.scores || {},
          overall_score: Number(idea.overall_score || 0)
        },
        idea_model: result.model || "",
        generated_for_date: date
      }));

      const insert = await db.from("ai_ideas").insert(rows);
      if (insert.error) throw insert.error;
      location.href = "creatives.html?cloud=1";
    } catch (error) {
      $("research-status").textContent = error.data?.setup_required
        ? "Connect the AI API key before generating ideas."
        : (error.message || String(error));
    } finally {
      btn.disabled = false;
      btn.textContent = "Generate ideas";
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      session = await cloud.requireSession();
      await loadProducts();
      await loadResearch();

      const initialTab = ["brands","ads","insights"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "brands";
      activateTab(initialTab);

      document.querySelectorAll("[data-research-tab]").forEach(btn => {
        btn.onclick = () => activateTab(btn.dataset.researchTab);
      });

      $("research-product").onchange = loadResearch;
      $("competitor-form").onsubmit = addCompetitor;
      $("scan-now").onclick = () => runResearch();
      $("analyze-ads").onclick = analyzeResearch;
      $("generate-ideas").onclick = generateIdeas;
      $("ad-filter").onchange = renderAds;
      if ($("brand-filter")) $("brand-filter").onchange = renderAds;

      $("watchlist-list").onchange = async event => {
        const activeId = event.target.getAttribute("data-watch-active");
        const daysId = event.target.getAttribute("data-watch-days");

        if (activeId) {
          const r = await db.from("competitor_watchlist").update({
            active: event.target.checked,
            updated_at: new Date().toISOString()
          }).eq("id", activeId);
          if (r.error) alert(r.error.message); else await loadResearch();
        }

        if (daysId) {
          const days = Math.max(1, Number(event.target.value || 30));
          const r = await db.from("competitor_watchlist").update({
            min_days_running: days,
            updated_at: new Date().toISOString()
          }).eq("id", daysId);
          if (r.error) alert(r.error.message); else await loadResearch();
        }
      };

      $("watchlist-list").onclick = async event => {
        const research = event.target.closest("[data-research-brand]");
        if (research) {
          await runResearch(research.getAttribute("data-research-brand"));
          return;
        }

        const view = event.target.closest("[data-view-brand]");
        if (view) {
          if ($("brand-filter")) $("brand-filter").value = view.getAttribute("data-view-brand");
          if ($("ad-filter")) $("ad-filter").value = "all";
          renderAds();
          activateTab("ads");
          return;
        }

        const del = event.target.closest("[data-watch-delete]");
        if (del) {
          const id = del.getAttribute("data-watch-delete");
          if (!confirm("Remove this brand from the watchlist?")) return;
          const r = await db.from("competitor_watchlist").delete().eq("id", id);
          if (r.error) alert(r.error.message); else await loadResearch();
        }
      };

      $("research-ads").onclick = async event => {
        const id = event.target.getAttribute("data-copy-text");
        if (!id) return;
        const ad = ads.find(a => a.id === id);
        if (!ad) return;
        await navigator.clipboard.writeText(ad.primary_text || "");
        event.target.textContent = "Copied";
      };
    } catch (error) {
      console.error(error);
      if ($("research-status")) $("research-status").textContent = error.message || String(error);
    }
  });
})();