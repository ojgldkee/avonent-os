(function () {
  "use strict";

  const config = window.AVONENT_CONFIG || {};
  if (!window.supabase || !config.supabaseUrl || !config.supabasePublishableKey) {
    console.error("Avonent Supabase configuration is missing.");
    return;
  }

  const db = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
  );

  const STATUS_FLOW = ["Idea","Research","Brief","Editing","Review","Approved","Launched","Winner","Loser","Retest"];

  function $(id) { return document.getElementById(id); }
  function query() { return new URLSearchParams(window.location.search); }
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch];
    });
  }
  function formatDate(value) {
    if (!value) return "";
    try { return new Date(value).toLocaleString(); } catch (_) { return ""; }
  }
  function shortText(value, length) {
    const v = String(value || "");
    return v.length > length ? v.slice(0, length - 1) + "…" : v;
  }
  function show(el) { if (el) el.classList.remove("hidden"); }
  function hide(el) { if (el) el.classList.add("hidden"); }
  function setText(id, value) { const el = $(id); if (el) el.textContent = String(value); }
  function niceKind(kind) {
    return String(kind || "").replace(/_/g, " ").replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }
  function itemTitleFromContent(kind, content) {
    const base = shortText(String(content || "").replace(/\s+/g, " ").trim(), 68);
    return base || niceKind(kind || "idea");
  }

  async function getSession() {
    const result = await db.auth.getSession();
    if (result.error) throw result.error;
    return result.data.session || null;
  }

  function updateAuthNav(session) {
    const login = $("login-link");
    const signup = $("signup-link");
    const email = $("account-email");
    const signout = $("signout-button");

    if (session && session.user) {
      hide(login); hide(signup); show(email); show(signout);
      if (email) email.textContent = session.user.email || "Account";
    } else {
      show(login); show(signup); hide(email); hide(signout);
    }

    if (signout) {
      signout.onclick = async function () {
        await db.auth.signOut();
        window.location.href = "index.html";
      };
    }
  }

  async function initDashboard(session) {
    const globalSearch = $("global-search");
    if (globalSearch) {
      globalSearch.onsubmit = function (event) {
        event.preventDefault();
        const value = $("global-search-input").value.trim();
        window.location.href = "creatives.html?q=" + encodeURIComponent(value);
      };
    }

    if (!session) return;
    hide($("signed-out-banner"));

    const [chatsResult, itemsResult] = await Promise.all([
      db.from("creative_chats")
        .select("id,title,product_name,updated_at", { count: "exact" })
        .order("updated_at", { ascending: false })
        .limit(8),
      db.from("creative_items")
        .select("id,kind,title,content,status,favorite,updated_at")
        .order("updated_at", { ascending: false })
        .limit(1000)
    ]);

    if (chatsResult.error) console.error(chatsResult.error);
    if (itemsResult.error) console.error(itemsResult.error);

    const chats = chatsResult.data || [];
    const items = itemsResult.data || [];

    const countKind = function (kind) { return items.filter(function (x) { return x.kind === kind; }).length; };
    const countStatus = function (status) { return items.filter(function (x) { return x.status === status; }).length; };

    setText("stat-chats", chatsResult.count == null ? chats.length : chatsResult.count);
    setText("stat-ideas", countKind("idea"));
    setText("stat-hooks", countKind("hook"));
    setText("stat-scripts", countKind("script"));
    setText("stat-briefs", countKind("brief"));

    ["Idea","Brief","Editing","Review","Approved","Launched","Winner"].forEach(function (status) {
      setText("flow-" + status.toLowerCase(), countStatus(status));
    });

    const recentChats = $("recent-chats");
    if (recentChats) {
      recentChats.innerHTML = chats.length ? chats.slice(0,5).map(function (chat) {
        return '<a class="list-item" href="chat.html?id=' + encodeURIComponent(chat.id) + '">' +
          '<h3>' + escapeHtml(chat.title) + '</h3>' +
          '<div class="meta">' + escapeHtml(chat.product_name || "Creative chat") + ' · ' + escapeHtml(formatDate(chat.updated_at)) + '</div>' +
          '</a>';
      }).join("") : '<div class="empty">No chats yet. Start your first creative conversation.</div>';
    }

    const recentItems = $("recent-items");
    if (recentItems) {
      recentItems.innerHTML = items.length ? items.slice(0,5).map(function (item) {
        return '<a class="list-item" href="creatives.html?q=' + encodeURIComponent(item.title || item.content.slice(0,30)) + '">' +
          '<div class="meta">' + escapeHtml(niceKind(item.kind)) + ' · ' + escapeHtml(item.status) + '</div>' +
          '<h3>' + escapeHtml(item.title || niceKind(item.kind)) + '</h3>' +
          '<p>' + escapeHtml(shortText(item.content, 130)) + '</p>' +
          '</a>';
      }).join("") : '<div class="empty">Nothing saved yet. Save an idea, hook, script or brief.</div>';
    }

  }

  async function initAuth(session) {
    if (session) {
      window.location.replace("index.html");
      return;
    }

    const params = query();
    let mode = params.get("mode") === "signup" ? "signup" : "login";
    const form = $("auth-form");
    const displayNameLabel = $("display-name-label");
    const title = $("auth-title");
    const subtitle = $("auth-subtitle");
    const submit = $("auth-submit");
    const switchText = $("auth-switch-text");
    const switchLink = $("auth-switch-link");
    const message = $("auth-message");
    const password = $("auth-password");

    function renderMode() {
      const signupMode = mode === "signup";
      title.textContent = signupMode ? "Create account" : "Log in";
      subtitle.textContent = signupMode
        ? "Create a private Avonent creative workspace."
        : "Access your private creative workspace.";
      submit.textContent = signupMode ? "Sign up" : "Log in";
      switchText.textContent = signupMode ? "Already have an account?" : "Need an account?";
      switchLink.textContent = signupMode ? "Log in" : "Sign up";
      switchLink.href = "auth.html?mode=" + (signupMode ? "login" : "signup");
      password.autocomplete = signupMode ? "new-password" : "current-password";
      signupMode ? show(displayNameLabel) : hide(displayNameLabel);
    }

    renderMode();

    form.onsubmit = async function (event) {
      event.preventDefault();
      hide(message);
      submit.disabled = true;
      submit.textContent = mode === "signup" ? "Creating…" : "Logging in…";

      const email = $("auth-email").value.trim();
      const pass = $("auth-password").value;

      try {
        if (mode === "signup") {
          const displayName = $("display-name").value.trim();
          const result = await db.auth.signUp({
            email: email,
            password: pass,
            options: { data: { display_name: displayName } }
          });
          if (result.error) throw result.error;

          if (result.data.session) {
            window.location.href = "index.html";
            return;
          }

          message.innerHTML = "<strong>Account created.</strong><p>Check your email to verify the address, then return here and log in.</p>";
          show(message);
        } else {
          const result = await db.auth.signInWithPassword({ email: email, password: pass });
          if (result.error) throw result.error;
          window.location.href = "index.html";
          return;
        }
      } catch (error) {
        message.innerHTML = "<strong>Could not continue.</strong><p>" + escapeHtml(error.message || String(error)) + "</p>";
        show(message);
      } finally {
        submit.disabled = false;
        submit.textContent = mode === "signup" ? "Sign up" : "Log in";
      }
    };
  }

  async function initChat(session) {
    const list = $("chat-list");
    const messages = $("messages");
    const form = $("chat-form");
    const input = $("chat-input");
    const title = $("chat-title");
    const rename = $("rename-chat");
    const signedOut = $("chat-signed-out");
    const newChat = $("new-chat");
    const params = query();
    let activeChatId = params.get("id") || "";
    let chats = [];

    const presetPrompt = params.get("prompt");
    if (presetPrompt && input) input.value = presetPrompt;

    document.querySelectorAll("[data-prompt]").forEach(function (button) {
      button.addEventListener("click", function () {
        input.value = button.getAttribute("data-prompt") || "";
        input.focus();
      });
    });

    function messageHtml(role, content) {
      return '<div class="message ' + escapeHtml(role) + '">' + escapeHtml(content) + '</div>';
    }

    function renderWelcome() {
      messages.innerHTML =
        '<div class="welcome-message">' +
        '<p class="eyebrow">START HERE</p>' +
        '<h2>What are we making?</h2>' +
        '<p>Give the strategist a product, audience, angle, problem, offer, ad reference, or rough idea.</p>' +
        '<div class="prompt-chips">' +
        '<button type="button" data-fill="Give me 10 original ad angles for this product">10 ad angles</button>' +
        '<button type="button" data-fill="Write 15 strong hooks for this product">Write hooks</button>' +
        '<button type="button" data-fill="Build a 30-second UGC ad script">UGC script</button>' +
        '<button type="button" data-fill="Turn this idea into a production-ready creative brief">Creative brief</button>' +
        '</div></div>';

      messages.querySelectorAll("[data-fill]").forEach(function (button) {
        button.onclick = function () {
          input.value = button.getAttribute("data-fill") || "";
          input.focus();
        };
      });
    }

    async function loadChats() {
      if (!session) return;
      const result = await db.from("creative_chats")
        .select("id,title,product_name,updated_at")
        .order("updated_at", { ascending: false })
        .limit(100);
      if (result.error) {
        list.innerHTML = '<div class="empty">Could not load chats.</div>';
        return;
      }
      chats = result.data || [];
      list.innerHTML = chats.length ? chats.map(function (chat) {
        const active = chat.id === activeChatId ? " active" : "";
        return '<button class="chat-row' + active + '" data-chat-id="' + chat.id + '">' +
          '<strong>' + escapeHtml(chat.title) + '</strong>' +
          '<span>' + escapeHtml(formatDate(chat.updated_at)) + '</span>' +
          '</button>';
      }).join("") : '<div class="empty">No chats yet.</div>';
    }

    async function loadActiveChat() {
      if (!session || !activeChatId) {
        title.textContent = "New creative chat";
        hide(rename);
        renderWelcome();
        return;
      }

      const chat = chats.find(function (x) { return x.id === activeChatId; });
      if (chat) title.textContent = chat.title;
      show(rename);

      const result = await db.from("chat_messages")
        .select("id,role,content,created_at")
        .eq("chat_id", activeChatId)
        .order("created_at", { ascending: true });

      if (result.error) {
        messages.innerHTML = '<div class="empty">Could not load this chat.</div>';
        return;
      }

      const rows = result.data || [];
      if (!rows.length) {
        renderWelcome();
        return;
      }

      messages.innerHTML = rows.map(function (row) {
        return messageHtml(row.role, row.content);
      }).join("");
      messages.scrollTop = messages.scrollHeight;
    }

    async function createChat(firstMessage) {
      const chatTitle = shortText(firstMessage.replace(/\s+/g, " ").trim(), 58) || "New creative chat";
      const result = await db.from("creative_chats")
        .insert({
          user_id: session.user.id,
          title: chatTitle,
          product_name: "",
          context: {}
        })
        .select("id,title,product_name,updated_at")
        .single();
      if (result.error) throw result.error;
      activeChatId = result.data.id;
      history.replaceState(null, "", "chat.html?id=" + encodeURIComponent(activeChatId));
      await loadChats();
      title.textContent = result.data.title;
      show(rename);
      return result.data;
    }

    if (!session) {
      show(signedOut);
      list.innerHTML = '<div class="empty">Log in to save chats.</div>';
      newChat.onclick = function () { input.value = ""; input.focus(); };
      form.onsubmit = function (event) {
        event.preventDefault();
        const content = input.value.trim();
        if (!content) return;
        if (messages.querySelector(".welcome-message")) messages.innerHTML = "";
        messages.insertAdjacentHTML("beforeend", messageHtml("user", content));
        messages.insertAdjacentHTML("beforeend", messageHtml("system", "Preview only — log in to save this conversation. AI generation is not connected yet."));
        input.value = "";
      };
      return;
    }

    hide(signedOut);
    await loadChats();
    await loadActiveChat();

    list.onclick = function (event) {
      const button = event.target.closest("[data-chat-id]");
      if (!button) return;
      window.location.href = "chat.html?id=" + encodeURIComponent(button.getAttribute("data-chat-id"));
    };

    newChat.onclick = function () {
      window.location.href = "chat.html";
    };

    rename.onclick = async function () {
      if (!activeChatId) return;
      const current = chats.find(function (x) { return x.id === activeChatId; });
      const next = prompt("Chat name", current ? current.title : title.textContent);
      if (next == null || !next.trim()) return;
      const result = await db.from("creative_chats")
        .update({ title: next.trim() })
        .eq("id", activeChatId);
      if (result.error) return alert(result.error.message);
      title.textContent = next.trim();
      await loadChats();
    };

    form.onsubmit = async function (event) {
      event.preventDefault();
      const content = input.value.trim();
      if (!content) return;

      try {
        if (!activeChatId) {
          await createChat(content);
          messages.innerHTML = "";
        } else if (messages.querySelector(".welcome-message")) {
          messages.innerHTML = "";
        }

        const messageResult = await db.from("chat_messages").insert({
          chat_id: activeChatId,
          user_id: session.user.id,
          role: "user",
          content: content,
          metadata: {}
        });
        if (messageResult.error) throw messageResult.error;

        const saveKind = $("save-kind").value;
        if (saveKind) {
          const itemResult = await db.from("creative_items").insert({
            user_id: session.user.id,
            chat_id: activeChatId,
            kind: saveKind,
            title: itemTitleFromContent(saveKind, content),
            content: content,
            status: "Idea",
            metadata: { source: "creative_chat" }
          });
          if (itemResult.error) throw itemResult.error;
        }

        await db.from("creative_chats")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", activeChatId);

        messages.insertAdjacentHTML("beforeend", messageHtml("user", content));
        if (saveKind) {
          messages.insertAdjacentHTML("beforeend", messageHtml("system", "Saved to your " + niceKind(saveKind) + " library."));
        }
        messages.insertAdjacentHTML("beforeend", messageHtml("system", "Conversation saved. AI generation will activate after we connect a model."));
        input.value = "";
        $("save-kind").value = "";
        messages.scrollTop = messages.scrollHeight;
        await loadChats();
      } catch (error) {
        alert(error.message || String(error));
      }
    };
  }

  async function initLibrary(session) {
    const signedOut = $("library-signed-out");
    const grid = $("library-grid");
    const search = $("library-search");
    const kindFilter = $("kind-filter");
    const statusFilter = $("status-filter");
    const addButton = $("add-item");
    const panel = $("new-item-panel");
    const closeButton = $("close-new-item");
    const form = $("item-form");
    const params = query();
    let items = [];

    if (!session) return;
    hide(signedOut);

    if (params.get("q")) search.value = params.get("q");
    if (params.get("kind")) kindFilter.value = params.get("kind");
    if (params.get("status")) statusFilter.value = params.get("status");
    if (params.get("new")) {
      show(panel);
      const requestedKind = params.get("new");
      if ([...$("item-kind").options].some(function (x) { return x.value === requestedKind; })) {
        $("item-kind").value = requestedKind;
      }
    }

    async function fetchItems() {
      const result = await db.from("creative_items")
        .select("id,chat_id,kind,title,content,angle,format,status,favorite,created_at,updated_at")
        .order("favorite", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (result.error) throw result.error;
      items = result.data || [];
      render();
    }

    function render() {
      const q = (search.value || "").trim().toLowerCase();
      const kind = kindFilter.value;
      const status = statusFilter.value;

      const rows = items.filter(function (item) {
        if (kind && item.kind !== kind) return false;
        if (status && item.status !== status) return false;
        if (!q) return true;
        return [item.title,item.content,item.angle,item.format,item.kind,item.status]
          .join(" ").toLowerCase().includes(q);
      });

      grid.innerHTML = rows.length ? rows.map(function (item) {
        return '<article class="library-card">' +
          '<div class="card-top"><div><span class="pill">' + escapeHtml(niceKind(item.kind)) + '</span>' +
          '<h3>' + escapeHtml(item.title || niceKind(item.kind)) + '</h3></div>' +
          '<button class="text-button mini" data-favorite="' + item.id + '">' + (item.favorite ? "★" : "☆") + '</button></div>' +
          '<div class="meta">' + escapeHtml(item.angle || "No angle") + (item.format ? " · " + escapeHtml(item.format) : "") + '</div>' +
          '<p class="content">' + escapeHtml(item.content || "") + '</p>' +
          '<label>Status<select data-item-status="' + item.id + '">' +
            STATUS_FLOW.map(function (s) { return '<option' + (s === item.status ? " selected" : "") + '>' + escapeHtml(s) + '</option>'; }).join("") +
          '</select></label>' +
          '<div class="card-actions">' +
          '<button class="button secondary mini" data-edit="' + item.id + '">Edit</button>' +
          '<button class="button secondary mini" data-delete="' + item.id + '">Delete</button>' +
          '</div></article>';
      }).join("") : '<div class="empty wide">No matching creative items.</div>';
    }

    addButton.onclick = function () { show(panel); $("item-title").focus(); };
    closeButton.onclick = function () { hide(panel); };
    search.oninput = render;
    kindFilter.onchange = render;
    statusFilter.onchange = render;

    form.onsubmit = async function (event) {
      event.preventDefault();
      const result = await db.from("creative_items").insert({
        user_id: session.user.id,
        kind: $("item-kind").value,
        title: $("item-title").value.trim(),
        content: $("item-content").value.trim(),
        angle: $("item-angle").value.trim(),
        format: $("item-format").value.trim(),
        status: $("item-status").value,
        metadata: { source: "manual_library" }
      });
      if (result.error) return alert(result.error.message);
      form.reset();
      hide(panel);
      await fetchItems();
    };

    grid.addEventListener("click", async function (event) {
      const favoriteId = event.target.getAttribute("data-favorite");
      if (favoriteId) {
        const item = items.find(function (x) { return x.id === favoriteId; });
        const result = await db.from("creative_items").update({ favorite: !item.favorite }).eq("id", favoriteId);
        if (result.error) return alert(result.error.message);
        return fetchItems();
      }

      const deleteId = event.target.getAttribute("data-delete");
      if (deleteId) {
        if (!confirm("Delete this creative item?")) return;
        const result = await db.from("creative_items").delete().eq("id", deleteId);
        if (result.error) return alert(result.error.message);
        return fetchItems();
      }

      const editId = event.target.getAttribute("data-edit");
      if (editId) {
        const item = items.find(function (x) { return x.id === editId; });
        const nextTitle = prompt("Title", item.title || "");
        if (nextTitle == null) return;
        const nextContent = prompt("Content", item.content || "");
        if (nextContent == null) return;
        const nextAngle = prompt("Angle", item.angle || "");
        if (nextAngle == null) return;
        const nextFormat = prompt("Format", item.format || "");
        if (nextFormat == null) return;
        const result = await db.from("creative_items").update({
          title: nextTitle.trim(),
          content: nextContent,
          angle: nextAngle.trim(),
          format: nextFormat.trim()
        }).eq("id", editId);
        if (result.error) return alert(result.error.message);
        return fetchItems();
      }
    });

    grid.addEventListener("change", async function (event) {
      const id = event.target.getAttribute("data-item-status");
      if (!id) return;
      const result = await db.from("creative_items").update({ status: event.target.value }).eq("id", id);
      if (result.error) return alert(result.error.message);
      const item = items.find(function (x) { return x.id === id; });
      if (item) item.status = event.target.value;
    });

    try {
      await fetchItems();
    } catch (error) {
      grid.innerHTML = '<div class="empty wide">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  async function initPipeline(session) {
    const signedOut = $("pipeline-signed-out");
    const board = $("pipeline-board");
    if (!session) {
      board.innerHTML = "";
      return;
    }
    hide(signedOut);

    async function renderBoard() {
      const result = await db.from("creative_items")
        .select("id,kind,title,content,status,angle,format,updated_at")
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (result.error) {
        board.innerHTML = '<div class="empty">' + escapeHtml(result.error.message) + '</div>';
        return;
      }
      const items = result.data || [];

      board.innerHTML = STATUS_FLOW.map(function (status) {
        const rows = items.filter(function (item) { return item.status === status; });
        return '<section class="pipeline-column">' +
          '<h2>' + escapeHtml(status) + '<span>' + rows.length + '</span></h2>' +
          '<div class="pipeline-stack">' +
          (rows.length ? rows.map(function (item) {
            return '<article class="pipeline-card">' +
              '<span class="pill">' + escapeHtml(niceKind(item.kind)) + '</span>' +
              '<h3>' + escapeHtml(item.title || niceKind(item.kind)) + '</h3>' +
              '<p>' + escapeHtml(shortText(item.content, 150)) + '</p>' +
              '<select data-move-item="' + item.id + '">' +
                STATUS_FLOW.map(function (s) { return '<option' + (s === item.status ? " selected" : "") + '>' + escapeHtml(s) + '</option>'; }).join("") +
              '</select></article>';
          }).join("") : '<div class="empty">Empty</div>') +
          '</div></section>';
      }).join("");
    }

    board.addEventListener("change", async function (event) {
      const id = event.target.getAttribute("data-move-item");
      if (!id) return;
      const result = await db.from("creative_items").update({ status: event.target.value }).eq("id", id);
      if (result.error) return alert(result.error.message);
      await renderBoard();
    });

    await renderBoard();
  }

  async function initAssets(session) {
    const signedOut = $("assets-signed-out");
    const uploadPanel = $("upload-panel");
    const form = $("asset-form");
    const fileInput = $("asset-files");
    const uploadStatus = $("upload-status");
    const search = $("asset-search");
    const grid = $("asset-grid");
    let assets = [];

    if (!session) {
      grid.innerHTML = '<div class="empty">Log in to load assets.</div>';
      return;
    }

    hide(signedOut);
    show(uploadPanel);

    async function fetchAssets() {
      const result = await db.from("creative_assets")
        .select("id,storage_path,original_name,mime_type,size_bytes,created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (result.error) throw result.error;
      assets = result.data || [];

      await Promise.all(assets.map(async function (asset) {
        const signed = await db.storage.from("creative-assets").createSignedUrl(asset.storage_path, 3600);
        asset.signedUrl = signed.data ? signed.data.signedUrl : "";
      }));

      render();
    }

    function formatBytes(bytes) {
      const n = Number(bytes || 0);
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
      return (n / (1024 * 1024)).toFixed(1) + " MB";
    }

    function preview(asset) {
      const url = escapeHtml(asset.signedUrl || "");
      const mime = String(asset.mime_type || "");
      if (!url) return '<div class="asset-placeholder">Preview unavailable</div>';
      if (mime.startsWith("image/")) {
        return '<a href="' + url + '" target="_blank" rel="noopener"><img src="' + url + '" alt=""></a>';
      }
      if (mime.startsWith("video/")) {
        return '<video src="' + url + '" controls preload="metadata"></video>';
      }
      return '<a class="asset-file-link" href="' + url + '" target="_blank" rel="noopener">Open file</a>';
    }

    function render() {
      const q = (search.value || "").trim().toLowerCase();
      const rows = assets.filter(function (asset) {
        return [asset.original_name, asset.mime_type].join(" ").toLowerCase().includes(q);
      });

      grid.innerHTML = rows.length ? rows.map(function (asset) {
        return '<article class="asset-card">' +
          '<div class="asset-preview">' + preview(asset) + '</div>' +
          '<h3>' + escapeHtml(asset.original_name) + '</h3>' +
          '<div class="meta">' + escapeHtml(asset.mime_type || "file") + ' · ' + formatBytes(asset.size_bytes) + '</div>' +
          '<div class="card-actions"><button class="button secondary mini" data-delete-asset="' + asset.id + '">Delete</button></div>' +
          '</article>';
      }).join("") : '<div class="empty wide">No matching assets.</div>';
    }

    search.oninput = render;

    form.onsubmit = async function (event) {
      event.preventDefault();
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;

      uploadStatus.textContent = "Uploading…";
      const maxBytes = 100 * 1024 * 1024;

      try {
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i];
          if (file.size > maxBytes) throw new Error(file.name + " is larger than 100 MB.");

          const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-140) || "asset";
          const randomPart = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + "-" + i;
          const path = session.user.id + "/" + randomPart + "-" + safeName;

          uploadStatus.textContent = "Uploading " + (i + 1) + " of " + files.length + ": " + file.name;

          const uploaded = await db.storage.from("creative-assets").upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || "application/octet-stream"
          });
          if (uploaded.error) throw uploaded.error;

          const inserted = await db.from("creative_assets").insert({
            user_id: session.user.id,
            storage_path: path,
            original_name: file.name,
            mime_type: file.type || "application/octet-stream",
            size_bytes: file.size
          });

          if (inserted.error) {
            await db.storage.from("creative-assets").remove([path]);
            throw inserted.error;
          }
        }

        fileInput.value = "";
        uploadStatus.textContent = "Upload complete.";
        await fetchAssets();
      } catch (error) {
        uploadStatus.textContent = "Upload failed: " + (error.message || String(error));
      }
    };

    grid.addEventListener("click", async function (event) {
      const id = event.target.getAttribute("data-delete-asset");
      if (!id) return;
      const asset = assets.find(function (x) { return x.id === id; });
      if (!asset || !confirm("Delete " + asset.original_name + "?")) return;

      const removed = await db.storage.from("creative-assets").remove([asset.storage_path]);
      if (removed.error) return alert(removed.error.message);

      const deleted = await db.from("creative_assets").delete().eq("id", id);
      if (deleted.error) return alert(deleted.error.message);

      await fetchAssets();
    });

    try {
      await fetchAssets();
    } catch (error) {
      grid.innerHTML = '<div class="empty">' + escapeHtml(error.message || String(error)) + '</div>';
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    let session = null;
    try {
      session = await getSession();
    } catch (error) {
      console.error(error);
    }

    updateAuthNav(session);

    const page = document.body.getAttribute("data-page");
    try {
      if (page === "dashboard") await initDashboard(session);
      if (page === "auth") await initAuth(session);
      if (page === "chat") await initChat(session);
      if (page === "library") await initLibrary(session);
      if (page === "pipeline") await initPipeline(session);\n      if (page === "assets") await initAssets(session);
    } catch (error) {
      console.error(error);
      alert(error.message || String(error));
    }
  });
})();
