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
    return $("research-product").value || "";
  }

  function product() {
    return products.find(p => p.id === productId()) || null;
  }

  async function loadProducts() {
    const r = await db.from("products").select("*").order("created_at", { ascending: true });
    if (r.error) throw r.error;
    products = r.data || [];
    $("research-product").innerHTML = products.length
      ? products.map(p => '<option value="' + p.id + '">' + esc(p.brand_name || "") + ' — ' + esc(p.name) + '</option>').join("")
      : '<option value="">No cloud products yet</option>';
  }

  async function loadResearch() {
    const id = productId();
    if (!id) {
      watchlist = [];
      ads = [];
      render();
      return;
    }

    const results = await Promise.all([
      db.from("competitor_watchlist").select("*").eq("product_id", id).order("created_at", { ascending: true }),
      db.from("competitor_ads").select("*").eq("product_id", id).order("days_running", { ascending: false }).limit(250)
    ]);

    if (results[0].error) throw results[0].error;
    if (results[1].error) throw results[1].error;
    watchlist = results[0].data || [];
    ads = results[1].data || [];
    render();
  }

  function render() {
    const activeAds = ads.filter(a => a.is_active);
    const longAds = activeAds.filter(a => a.qualifies_long_running);
    const scans = watchlist.map(w => w.last_scanned_at).filter(Boolean).sort().reverse();

    $("stat-watchlist").textContent = String(watchlist.filter(w => w.active).length);
    $("stat-proven").textContent = String(longAds.length);
    $("stat-ads").textContent = String(ads.length);
    $("stat-last-scan").textContent = scans[0] ? niceDate(scans[0]) : "Never";

    if (!watchlist.length) {
      $("watchlist-list").innerHTML = '<div class="empty">No competitors yet. Add one above.</div>';
    } else {
      $("watchlist-list").innerHTML = watchlist.map(w => {
        return '<article class="watch-item">' +
          '<div class="watch-item-main">' +
            '<div><strong>' + esc(w.competitor_name) + '</strong><span>' +
              (w.last_scanned_at ? 'Scanned ' + esc(niceDate(w.last_scanned_at)) : 'Not scanned yet') +
            '</span></div>' +
            '<label class="watch-toggle"><input type="checkbox" data-watch-active="' + w.id + '" ' + (w.active ? 'checked' : '') + '><span>' + (w.active ? 'On' : 'Off') + '</span></label>' +
          '</div>' +
          '<div class="watch-item-controls">' +
            '<label>Threshold<div class="number-field compact"><input type="number" min="1" max="3650" value="' + Number(w.min_days_running || 30) + '" data-watch-days="' + w.id + '"><span>days</span></div></label>' +
            '<button class="text-button danger" type="button" data-watch-delete="' + w.id + '">Remove</button>' +
          '</div>' +
        '</article>';
      }).join("");
    }

    renderAds();
  }

  function renderAds() {
    const mode = $("ad-filter").value;
    let rows = ads.filter(a => a.is_active);
    if (mode === "long") rows = rows.filter(a => a.qualifies_long_running);

    if (!rows.length) {
      $("research-ads").innerHTML = '<div class="empty wide">' + (mode === "long" ? 'No active ads have crossed the threshold yet.' : 'No active ads stored yet.') + '</div>';
      return;
    }

    $("research-ads").innerHTML = rows.map(a => {
      const media = a.media_url
        ? '<div class="source-ad-media">' +
            (a.media_kind === "video"
              ? '<video controls playsinline preload="metadata" src="' + esc(a.media_url) + '"></video>'
              : '<img loading="lazy" src="' + esc(a.media_url) + '" alt="">') +
          '</div>'
        : '';

      const copy = a.primary_text
        ? '<div class="source-copy"><div class="source-copy-head"><span>Primary text</span><button class="copy-inline" type="button" data-copy-text="' + a.id + '">Copy</button></div><p>' + esc(a.primary_text) + '</p></div>'
        : '';

      const actions =
        (a.source_url ? '<a class="button secondary mini" target="_blank" rel="noopener" href="' + esc(a.source_url) + '">Open Meta</a>' : '') +
        (a.landing_url ? '<a class="button secondary mini" target="_blank" rel="noopener" href="' + esc(a.landing_url) + '">Landing page</a>' : '');

      return '<article class="source-ad-card">' +
        '<div class="source-ad-top"><div><span class="pill">' + esc(a.advertiser_name || "Competitor") + '</span><h3>' + esc(a.headline || "Meta ad") + '</h3></div>' +
        '<div class="days-badge ' + (a.qualifies_long_running ? 'qualified' : '') + '"><strong>' + Number(a.days_running || 0) + '</strong><span>days</span></div></div>' +
        media + copy +
        '<div class="source-meta"><span>Started ' + esc(a.started_at || "unknown") + '</span><span>' + (a.is_active ? "Active" : "Inactive") + '</span>' +
        (a.qualifies_long_running ? '<span class="qualified-label">Long-running</span>' : '') + '</div>' +
        '<div class="source-actions">' + actions + '</div>' +
      '</article>';
    }).join("");
  }

  async function addCompetitor(event) {
    event.preventDefault();
    const name = $("competitor-name").value.trim();
    if (!name || !productId()) return;
    $("research-status").textContent = "Adding competitor…";

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
    $("research-status").textContent = "Competitor added.";
    await loadResearch();
  }

  async function scanNow() {
    const btn = $("scan-now");
    btn.disabled = true;
    btn.textContent = "Scanning…";
    $("research-status").textContent = "Opening public Meta Ad Library pages and collecting visible ads…";

    try {
      const result = await cloud.invoke("scan-competitor-ads", {});
      $("research-status").textContent = "Scan finished: " + Number(result.stored || 0) + " ads stored, " + Number(result.long_running || 0) + " long-running.";
      await loadResearch();
    } catch (error) {
      $("research-status").textContent = error.message || String(error);
    } finally {
      btn.disabled = false;
      btn.textContent = "Scan competitors";
    }
  }

  async function generateIdeas() {
    const p = product();
    const sources = ads.filter(a => a.is_active && a.qualifies_long_running).slice(0, 30);
    if (!p) return;
    if (!sources.length) {
      $("research-status").textContent = "There are no long-running source ads for this product yet.";
      return;
    }

    const btn = $("generate-ideas");
    btn.disabled = true;
    btn.textContent = "Generating…";
    $("research-status").textContent = "AI is studying " + sources.length + " long-running source ads…";

    try {
      const result = await cloud.invoke("creative-ai", {
        task: "ideas",
        product: p,
        competitor_ads: sources
      });

      let parsed = result.result || null;
      if (!parsed && result.text) {
        let cleaned = String(result.text).trim();
        if (cleaned.indexOf("~~~json") === 0) cleaned = cleaned.slice(7);
        if (cleaned.lastIndexOf("~~~") === cleaned.length - 3) cleaned = cleaned.slice(0, -3);
        parsed = JSON.parse(cleaned.trim());
      }

      const ideas = Array.isArray(parsed && parsed.ideas) ? parsed.ideas : [];
      if (!ideas.length) throw new Error("AI returned no ideas.");

      const sourceIds = sources.map(a => a.ad_archive_id);
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
        source_ad_ids: sourceIds,
        idea_model: result.model || "",
        generated_for_date: date
      }));

      const insert = await db.from("ai_ideas").insert(rows);
      if (insert.error) throw insert.error;

      $("research-status").textContent = rows.length + " ideas generated and saved.";
      setTimeout(() => { location.href = "creatives.html?cloud=1"; }, 400);
    } catch (error) {
      if (error.data && error.data.setup_required) {
        $("research-status").textContent = "AI is coded, but OPENAI_API_KEY still needs to be added to Supabase.";
      } else {
        $("research-status").textContent = error.message || String(error);
      }
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

      $("research-product").onchange = loadResearch;
      $("competitor-form").onsubmit = addCompetitor;
      $("scan-now").onclick = scanNow;
      $("generate-ideas").onclick = generateIdeas;
      $("ad-filter").onchange = renderAds;

      $("watchlist-list").onchange = async event => {
        const activeId = event.target.getAttribute("data-watch-active");
        const daysId = event.target.getAttribute("data-watch-days");

        if (activeId) {
          const r = await db.from("competitor_watchlist").update({ active: event.target.checked, updated_at: new Date().toISOString() }).eq("id", activeId);
          if (r.error) alert(r.error.message); else await loadResearch();
        }

        if (daysId) {
          const days = Math.max(1, Number(event.target.value || 30));
          const r = await db.from("competitor_watchlist").update({ min_days_running: days, updated_at: new Date().toISOString() }).eq("id", daysId);
          if (r.error) alert(r.error.message); else await loadResearch();
        }
      };

      $("watchlist-list").onclick = async event => {
        const del = event.target.getAttribute("data-watch-delete");
        if (!del) return;
        if (!confirm("Remove this competitor from the watchlist?")) return;
        const r = await db.from("competitor_watchlist").delete().eq("id", del);
        if (r.error) alert(r.error.message); else await loadResearch();
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
    }
  });
})();