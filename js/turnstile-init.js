// js/turnstile-init.js
// Optional Cloudflare Turnstile CAPTCHA for public auth forms (login, password reset).
// Pairs with Supabase Auth's native CAPTCHA: the token is passed as
// options.captchaToken to signInWithPassword / resetPasswordForEmail.
//
// Fully graceful: if no site key is configured (window.APP_CONFIG.turnstileSiteKey
// is empty) the Turnstile script is never loaded, no widget renders, token() returns
// undefined, and the forms behave exactly as before. Enable per client by setting
// TURNSTILE_SITE_KEY at build time AND turning on Turnstile in Supabase Auth settings.
(function () {
  var cfg = window.APP_CONFIG || {};
  var siteKey = cfg.turnstileSiteKey || '';
  var widgets = {}; // slot element id -> Turnstile widget id

  function enabled() { return !!siteKey; }

  function renderAll() {
    if (!enabled() || !window.turnstile) return;
    var slots = document.querySelectorAll('.cf-turnstile-slot');
    for (var i = 0; i < slots.length; i++) {
      var el = slots[i];
      if (!el.id || el.getAttribute('data-rendered')) continue;
      try {
        widgets[el.id] = window.turnstile.render(el, { sitekey: siteKey });
        el.setAttribute('data-rendered', '1');
      } catch (e) { /* already rendered or invalid — ignore */ }
    }
  }

  // Turnstile's api.js calls this once loaded (explicit-render mode).
  window.onTurnstileLoad = renderAll;

  window.IurisTurnstile = {
    enabled: enabled,
    // Current single-use token for a slot; undefined if disabled or not yet solved.
    token: function (slotId) {
      if (!enabled() || !window.turnstile) return undefined;
      try { return window.turnstile.getResponse(widgets[slotId]); } catch (e) { return undefined; }
    },
    reset: function (slotId) {
      if (!enabled() || !window.turnstile) return;
      try { window.turnstile.reset(widgets[slotId]); } catch (e) {}
    },
  };

  // Load the Turnstile script only when enabled — no external request otherwise.
  if (enabled()) {
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }
})();
