(() => {
  "use strict";

  const cfg = window.AVONENT_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabasePublishableKey) return;

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[ch]);

  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");

  function updateAuth(session) {
    const login = $("login-link");
    const signup = $("signup-link");
    const email = $("account-email");
    const signout = $("signout-button");

    if (session?.user) {
      hide(login); hide(signup); show(email); show(signout);
      if (email) email.textContent = session.user.email || "Account";
    } else {
      show(login); show(signup); hide(email); hide(signout);
    }

    if (signout) {
      signout.onclick = async () => {
        await db.auth.signOut();
        location.reload();
      };
    }
  }

  async function directDownload() {
    const input = $("direct-media-url");
    const result = $("download-result");
    const raw = input.value.trim();

    if (!raw) {
      result.textContent = "Paste a direct image or video URL first.";
      return;
    }

    let url;
    try { url = new URL(raw); }
    catch {
      result.textContent = "That is not a valid URL.";
      return;
    }

    if (url.protocol !== "https:") {
      result.textContent = "Use an HTTPS media URL.";
      return;
    }

    if (/facebook\.com\/ads\/library/i.test(raw)) {
      result.textContent = "That is a Meta Ad Library page, not a direct video file. Save it as a reference below and attach the media file.";
      return;
    }

    result.textContent = "Trying download…";

    try {
      const response = await fetch(raw, { mode: "cors", credentials: "omit" });
      if (!response.ok) throw new Error("HTTP " + response.status);

      const type = (response.headers.get("content-type") || "").toLowerCase();
      if (!(type.startsWith("video/") || type.startsWith("image/"))) {
        throw new Error("URL did not return an image or video file.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = decodeURIComponent(url.pathname.split("/").pop() || "ad-media");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 3000);
      result.textContent = "Download started.";
    } catch (error) {
      window.open(raw, "_blank", "noopener");
      result.textContent = "That host blocks browser downloading, so the direct media URL was opened in a new tab.";
    }
  }

  async function init() {
    const sessionResult = await db.auth.getSession();
    const session = sessionResult.data.session || null;
    updateAuth(session);

    $("download-media").onclick = directDownload;

    if (!session) return;

    hide($("ads-signed-out"));
    show($("ad-form-panel"));

    const grid = $("ad-grid");
    const search = $("ad-search");
    const saveStatus = $("ad-save-status");
    let refs = [];
    let assets = {};

    async function load() {
      const r = await db.from("ad_references")
        .select("id,source_url,advertiser_name,product_name,hook,angle,notes,first_observed_date,media_asset_id,status,created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (r.error) {
        grid.innerHTML = '<div class="empty wide">' + esc(r.error.message) + '</div>';
        return;
      }

      refs = r.data || [];
      assets = {};

      const assetIds = [...new Set(refs.map(x => x.media_asset_id).filter(Boolean))];
      if (assetIds.length) {
        const a = await db.from("creative_assets")
          .select("id,storage_path,original_name,mime_type")
          .in("id", assetIds);

        for (const asset of (a.data || [])) {
          const signed = await db.storage.from("creative-assets")
            .createSignedUrl(asset.storage_path, 3600);
          asset.url = signed.data?.signedUrl || "";
          assets[asset.id] = asset;
        }
      }

      render();
    }

    function mediaHtml(ref) {
      const asset = assets[ref.media_asset_id];
      if (!asset?.url) return "";

      if ((asset.mime_type || "").startsWith("video/")) {
        return '<div class="ad-preview"><video src="' + esc(asset.url) + '" controls playsinline preload="metadata"></video></div>';
      }
      if ((asset.mime_type || "").startsWith("image/")) {
        return '<div class="ad-preview"><img src="' + esc(asset.url) + '" alt=""></div>';
      }
      return "";
    }

    function render() {
      const q = (search.value || "").trim().toLowerCase();
      const rows = refs.filter(ref =>
        [ref.advertiser_name,ref.product_name,ref.hook,ref.angle,ref.notes]
          .join(" ").toLowerCase().includes(q)
      );

      grid.innerHTML = rows.length ? rows.map(ref => {
        const asset = assets[ref.media_asset_id];
        return '<article class="ad-card">' +
          mediaHtml(ref) +
          '<div class="ad-card-top"><span class="pill">' + esc(ref.status || "Saved") + '</span>' +
          '<span class="meta">' + esc(ref.first_observed_date || "") + '</span></div>' +
          '<h3>' + esc(ref.advertiser_name || "Saved ad") + '</h3>' +
          '<div class="meta">' + esc(ref.product_name || "No product set") + '</div>' +
          (ref.hook ? '<p><strong>Hook:</strong> ' + esc(ref.hook) + '</p>' : '') +
          (ref.angle ? '<p><strong>Angle:</strong> ' + esc(ref.angle) + '</p>' : '') +
          (ref.notes ? '<p>' + esc(ref.notes) + '</p>' : '') +
          '<div class="ad-actions">' +
            '<a class="button secondary mini" href="' + esc(ref.source_url) + '" target="_blank" rel="noopener">Open Meta ad</a>' +
            (asset?.url ? '<a class="button secondary mini" href="' + esc(asset.url) + '" download target="_blank" rel="noopener">Download media</a>' : '') +
            '<button class="button secondary mini" type="button" data-delete-ad="' + ref.id + '">Delete</button>' +
          '</div></article>';
      }).join("") : '<div class="empty wide">No matching ad references.</div>';
    }

    search.oninput = render;

    $("ad-form").onsubmit = async event => {
      event.preventDefault();
      saveStatus.textContent = "Saving…";
      let assetId = null;
      let uploadedPath = null;

      try {
        const file = $("ad-file").files[0];
        if (file) {
          if (file.size > 100 * 1024 * 1024) throw new Error("Media must be 100 MB or smaller.");

          const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-140) || "ad-media";
          uploadedPath = session.user.id + "/ad-references/" + crypto.randomUUID() + "-" + safe;

          const upload = await db.storage.from("creative-assets")
            .upload(uploadedPath, file, {
              upsert: false,
              contentType: file.type || "application/octet-stream"
            });
          if (upload.error) throw upload.error;

          const asset = await db.from("creative_assets").insert({
            user_id: session.user.id,
            storage_path: uploadedPath,
            original_name: file.name,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size
          }).select("id").single();

          if (asset.error) throw asset.error;
          assetId = asset.data.id;
        }

        const saved = await db.from("ad_references").insert({
          user_id: session.user.id,
          source: "Meta Ad Library",
          source_url: $("ad-source-url").value.trim(),
          advertiser_name: $("ad-advertiser").value.trim(),
          product_name: $("ad-product").value.trim(),
          hook: $("ad-hook").value.trim(),
          angle: $("ad-angle").value.trim(),
          notes: $("ad-notes").value.trim(),
          first_observed_date: $("ad-date").value || null,
          media_asset_id: assetId,
          status: "Saved"
        });

        if (saved.error) throw saved.error;

        event.target.reset();
        saveStatus.textContent = "Saved to your private Ad Library.";
        await load();
      } catch (error) {
        if (uploadedPath && !assetId) {
          await db.storage.from("creative-assets").remove([uploadedPath]);
        }
        saveStatus.textContent = error.message || String(error);
      }
    };

    grid.onclick = async event => {
      const id = event.target.getAttribute("data-delete-ad");
      if (!id || !confirm("Delete this saved ad reference?")) return;

      const ref = refs.find(x => x.id === id);
      const deleted = await db.from("ad_references").delete().eq("id", id);
      if (deleted.error) return alert(deleted.error.message);

      if (ref?.media_asset_id) {
        const asset = assets[ref.media_asset_id];
        if (asset) {
          await db.storage.from("creative-assets").remove([asset.storage_path]);
          await db.from("creative_assets").delete().eq("id", asset.id);
        }
      }

      await load();
    };

    await load();
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch(error => {
      console.error(error);
      const grid = $("ad-grid");
      if (grid) grid.innerHTML = '<div class="empty wide">' + esc(error.message || String(error)) + '</div>';
    });
  });
})();