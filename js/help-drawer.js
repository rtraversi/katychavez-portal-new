'use strict';

/* ────────────────────────────────────────────────────────────────────────────
   Help drawer — a shared right-side slide-over that renders the guides declared
   in window.HELP_GUIDES (js/help-guides.js). One instance for the whole portal;
   the DOM is injected into <body> on first open.

     window.HelpDrawer.open()             → guide index (all guides)
     window.HelpDrawer.open('billing-trust') → straight to that guide
     window.HelpDrawer.close()

   Entry points: masthead "Help" buttons on the Trust & Billing pages, and the
   "Help & Guides" item in the top-right avatar menu (wired in portal-init.js).
   This is a separate surface from the floating "Clause" help-chat assistant.
   ──────────────────────────────────────────────────────────────────────────── */

(function () {
  var overlay, panel, bodyEl, kickerEl, titleEl, subEl, backBtn;
  var built = false;

  function guides() { return window.HELP_GUIDES || []; }

  // Fetched guide bodies, keyed by src — a guide's HTML is loaded at most once
  // per session. loadSeq guards against a slow fetch resolving after the user
  // has already navigated to a different guide.
  var htmlCache = {};
  var loadSeq = 0;

  function fetchGuideHtml(src) {
    if (htmlCache[src]) return Promise.resolve(htmlCache[src]);
    // Cache-bust same-origin (repo) assets with the deploy version, exactly like
    // menu.js loads page fragments. Leave absolute URLs (e.g. an R2 resources
    // bucket) untouched so we don't fight their own caching/CORS.
    var isAbsolute = /^https?:\/\//i.test(src);
    var url = src;
    if (!isAbsolute) {
      var v = (window.APP_CONFIG && window.APP_CONFIG.deployVersion) || '';
      url = src + (src.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(v);
    }
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      htmlCache[src] = text;
      return text;
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function build() {
    if (built) return;

    overlay = document.createElement('div');
    overlay.className = 'help-drawer-overlay';
    overlay.id = 'help-drawer-overlay';
    overlay.hidden = true;

    panel = document.createElement('aside');
    panel.className = 'help-drawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Portal help');
    panel.innerHTML =
      '<header class="help-drawer-head">' +
        '<button class="help-drawer-back" id="help-drawer-back" hidden>' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>' +
          'All guides' +
        '</button>' +
        '<div class="help-drawer-heading">' +
          '<div class="help-drawer-kicker" id="help-drawer-kicker"></div>' +
          '<h2 class="help-drawer-title" id="help-drawer-title"></h2>' +
          '<div class="help-drawer-sub" id="help-drawer-sub"></div>' +
        '</div>' +
        '<button class="help-drawer-close" id="help-drawer-close" aria-label="Close help">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</header>' +
      '<div class="help-drawer-body" id="help-drawer-body"></div>';

    document.body.appendChild(overlay);
    document.body.appendChild(panel);

    bodyEl   = panel.querySelector('#help-drawer-body');
    kickerEl = panel.querySelector('#help-drawer-kicker');
    titleEl  = panel.querySelector('#help-drawer-title');
    subEl    = panel.querySelector('#help-drawer-sub');
    backBtn  = panel.querySelector('#help-drawer-back');

    panel.querySelector('#help-drawer-close').addEventListener('click', close);
    overlay.addEventListener('click', close);
    backBtn.addEventListener('click', function () { renderIndex(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) close();
    });

    built = true;
  }

  function renderIndex() {
    var list = guides();
    kickerEl.textContent = 'Portal help';
    titleEl.textContent  = 'Guides';
    subEl.textContent    = list.length === 1 ? '1 guide available' : list.length + ' guides available';
    backBtn.hidden = true;

    if (!list.length) {
      bodyEl.innerHTML = '<div class="help-doc"><p>No guides are available yet.</p></div>';
      return;
    }

    var cards = list.map(function (g) {
      return '' +
        '<button class="help-index-card" data-id="' + esc(g.id) + '">' +
          '<div class="help-index-card-kicker">' + esc(g.kicker || '') + '</div>' +
          '<div class="help-index-card-title">' + esc(g.title) + '</div>' +
          (g.summary ? '<div class="help-index-card-sum">' + esc(g.summary) + '</div>' : '') +
          (g.updated ? '<div class="help-index-card-meta">' + esc(g.updated) + '</div>' : '') +
        '</button>';
    }).join('');

    bodyEl.innerHTML = '<div class="help-index">' + cards + '</div>';
    bodyEl.scrollTop = 0;
    bodyEl.querySelectorAll('.help-index-card').forEach(function (btn) {
      btn.addEventListener('click', function () { renderGuide(btn.getAttribute('data-id')); });
    });
  }

  function renderGuide(id) {
    var g = guides().filter(function (x) { return x.id === id; })[0];
    if (!g) { renderIndex(); return; }

    kickerEl.textContent = g.kicker || '';
    titleEl.textContent  = g.title;
    subEl.textContent    = g.updated || g.subtitle || '';
    // Only offer the back link when there's an index worth going back to.
    backBtn.hidden = guides().length < 2;

    // Inline html (if provided) renders immediately; otherwise fetch the body.
    if (g.html) {
      bodyEl.innerHTML = '<article class="help-doc">' + g.html + '</article>';
      bodyEl.scrollTop = 0;
      return;
    }

    var seq = ++loadSeq;
    bodyEl.innerHTML = '<div class="help-doc-loading" role="status">Loading…</div>';
    bodyEl.scrollTop = 0;

    fetchGuideHtml(g.src).then(function (html) {
      if (seq !== loadSeq) return;   // superseded by a newer navigation
      bodyEl.innerHTML = '<article class="help-doc">' + html + '</article>';
      bodyEl.scrollTop = 0;
    }).catch(function () {
      if (seq !== loadSeq) return;
      bodyEl.innerHTML =
        '<div class="help-doc"><p>Sorry — this guide couldn\'t be loaded. ' +
        'Please check your connection and try again.</p>' +
        '<button type="button" class="dk-help-btn" id="help-doc-retry" style="position:static">Retry</button></div>';
      var retry = bodyEl.querySelector('#help-doc-retry');
      if (retry) retry.addEventListener('click', function () { renderGuide(id); });
    });
  }

  function open(id) {
    build();
    if (id) { renderGuide(id); }
    else if (guides().length === 1) { renderGuide(guides()[0].id); }
    else { renderIndex(); }

    overlay.hidden = false;
    // next frame so the transition runs
    requestAnimationFrame(function () {
      overlay.classList.add('is-open');
      panel.classList.add('is-open');
    });
    document.body.classList.add('help-drawer-lock');
  }

  function close() {
    if (!built) return;
    overlay.classList.remove('is-open');
    panel.classList.remove('is-open');
    document.body.classList.remove('help-drawer-lock');
    var done = function () {
      overlay.hidden = true;
      panel.removeEventListener('transitionend', done);
    };
    panel.addEventListener('transitionend', done);
  }

  window.HelpDrawer = { open: open, close: close };
})();
