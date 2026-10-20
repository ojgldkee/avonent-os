(() => {
  "use strict";

  const cfg = window.AVONENT_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabasePublishableKey) {
    document.addEventListener("DOMContentLoaded", () => {
      const box = document.getElementById("auth-message");
      box.textContent = "Account services could not load. Check your connection and reload this page.";
      box.classList.remove("hidden");
      document.getElementById("auth-submit").disabled = true;
    });
    return;
  }

  const db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const $ = id => document.getElementById(id);
  const show = el => el && el.classList.remove("hidden");
  const hide = el => el && el.classList.add("hidden");
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[ch]);

  function message(title, body, error=false) {
    const box = $("auth-message");
    box.innerHTML = "<strong>" + esc(title) + "</strong><p>" + esc(body) + "</p>";
    box.dataset.error = error ? "true" : "false";
    show(box);
  }

  async function init() {
    const p = new URLSearchParams(location.search);
    let mode = new URLSearchParams(location.hash.slice(1)).get("type") === "recovery" ? "recovery" : p.get("mode") || "login";
    if (!["login","signup","recovery"].includes(mode)) mode = "login";

    const sessionResult = await db.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    let session = sessionResult.data.session || null;
    db.auth.onAuthStateChange((event, next) => {
      session = next;
      if (event === "PASSWORD_RECOVERY") { mode = "recovery"; render(); }
    });

    if (session && mode !== "recovery") {
      location.replace("index.html");
      return;
    }

    const form = $("auth-form");
    const title = $("auth-title");
    const subtitle = $("auth-subtitle");
    const submit = $("auth-submit");
    const nameLabel = $("display-name-label");
    const emailLabel = $("email-label");
    const emailInput = $("auth-email");
    const passwordInput = $("auth-password");
    const switchRow = $("auth-switch-row");
    const switchText = $("auth-switch-text");
    const switchLink = $("auth-switch-link");
    const forgot = $("forgot-password");
    const togglePassword = $("toggle-password");
    const inlineCreate = $("create-account-inline");

    if (togglePassword) {
      togglePassword.onclick = () => {
        const revealing = passwordInput.type === "password";
        passwordInput.type = revealing ? "text" : "password";
        togglePassword.textContent = revealing ? "Hide" : "Show";
        togglePassword.setAttribute("aria-label", revealing ? "Hide password" : "Show password");
      };
    }

    function render() {
      hide($("auth-message"));
      hide(inlineCreate);
      emailInput.required = mode !== "recovery";
      emailInput.disabled = mode === "recovery";
      passwordInput.minLength = mode === "login" ? 1 : 8;

      if (mode === "signup") {
        title.textContent = "Create account";
        subtitle.textContent = "Create your private Avonent creative workspace.";
        submit.textContent = "Sign up";
        passwordInput.placeholder = "At least 8 characters";
        passwordInput.autocomplete = "new-password";
        show(nameLabel); show(emailLabel); show(switchRow); hide(forgot);
        switchText.textContent = "Already have an account?";
        switchLink.textContent = "Log in";
        switchLink.href = "auth.html?mode=login";
        return;
      }

      if (mode === "recovery") {
        title.textContent = "Set new password";
        subtitle.textContent = "Choose a new password for your Avonent account.";
        submit.textContent = "Update password";
        passwordInput.placeholder = "New password";
        passwordInput.autocomplete = "new-password";
        hide(nameLabel); hide(emailLabel); hide(switchRow); hide(forgot);
        return;
      }

      title.textContent = "Log in";
      subtitle.textContent = "Access your private creative workspace.";
      submit.textContent = "Log in";
      passwordInput.placeholder = "Your password";
      passwordInput.autocomplete = "current-password";
      hide(nameLabel); show(emailLabel); show(switchRow); show(forgot);
      switchText.textContent = "Need an account?";
      switchLink.textContent = "Sign up";
      switchLink.href = "auth.html?mode=signup";
    }

    render();

    form.onsubmit = async event => {
      event.preventDefault();
      hide($("auth-message"));
      submit.disabled = true;

      try {
        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (mode === "signup") {
          const redirect = location.origin + location.pathname + "?mode=login";
          let result = await db.auth.signUp({
            email,
            password,
            options: {
              data: { display_name: $("display-name").value.trim() },
              emailRedirectTo: redirect
            }
          });

          if (result.error) throw result.error;

          if (result.data.session) {
            location.href = "index.html";
            return;
          }

          message("Check your email", "If signup was accepted, a confirmation link was sent to your email. Open it before logging in. If you already have an account, use Log in or Forgot password.");
          return;
        }

        if (mode === "recovery") {
          if (!session) {
            message("Open the reset link again", "The password-recovery session is missing or expired.", true);
            return;
          }

          const result = await db.auth.updateUser({ password });
          if (result.error) throw result.error;
          message("Password updated", "Your password was changed. Returning to the dashboard.");
          setTimeout(() => location.replace("index.html"), 900);
          return;
        }

        const result = await db.auth.signInWithPassword({ email, password });
        if (result.error) {
          if (/invalid login credentials/i.test(result.error.message || "")) {
            message("Login unsuccessful", "The email or password is incorrect. Try again, reset your password, or sign up if you have not created an account.", true);
            show(inlineCreate);
            return;
          }
          throw result.error;
        }
        location.href = "index.html";
      } catch (error) {
        message("Could not continue", error.message || String(error), true);
      } finally {
        submit.disabled = false;
        renderButtonOnly();
      }
    };

    function renderButtonOnly() {
      submit.textContent = mode === "signup" ? "Sign up" : mode === "recovery" ? "Update password" : "Log in";
    }

    if (inlineCreate) {
      inlineCreate.onclick = () => {
        mode = "signup";
        history.replaceState(null, "", "auth.html?mode=signup");
        hide(inlineCreate);
        render();
        $("display-name").value = $("display-name").value || "Avonent Owner";
        passwordInput.focus();
      };
    }

    forgot.onclick = async () => {
      const email = emailInput.value.trim();
      if (!email) {
        message("Enter your email", "Type the email address for your account first.", true);
        emailInput.focus();
        return;
      }

      const redirect = location.origin + location.pathname + "?mode=recovery";
      forgot.disabled = true;
      try {
      const result = await db.auth.resetPasswordForEmail(email, { redirectTo: redirect });

      if (result.error) {
        message("Reset failed", result.error.message, true);
      } else {
        message("Check your email", "If this email has an account, you will receive a password-reset link.");
      }
      } catch (error) {
        message("Reset failed", error.message || "Please try again.", true);
      } finally { forgot.disabled = false; }
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch(error => message("Account error", error.message || String(error), true));
  });
})();