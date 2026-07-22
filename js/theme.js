'use strict';

// Load in <head> before body renders — applies saved theme + mode immediately (no FOUC).
// A theme is just five section hues; css/variables.css derives every surface from
// them via color-mix, and dark mode swaps the ground under any theme.
(function () {

  var DEFAULT_THEME = 'lightblue';

  // Shared section hues; each theme overrides only what differs (a section hue
  // is swapped when it would clash with the theme's primary).
  var BASE_HUES = { intake: '#22757c', docs: '#a07a1e', money: '#93402f', horizon: '#6d4f8c' };
  function hues(overrides) { return Object.assign({}, BASE_HUES, overrides); }

  var THEMES = {
    lightblue: { name: 'Light Blue', desc: 'Calm daylight blue',       hues: hues({ daily: '#4a80b8' }) },
    sage:      { name: 'Sage',       desc: 'Sage green',               hues: hues({ daily: '#42563e' }) },
    navy:      { name: 'Navy',       desc: 'Classic deep blue',        hues: hues({ daily: '#0f4c81' }) },
    teal:      { name: 'Teal',       desc: 'Coastal teal',             hues: hues({ daily: '#1f7d84', intake: '#4a6d96' }) },
    brass:     { name: 'Brass',      desc: 'Warm library brass',       hues: hues({ daily: '#9a7420', docs: '#456185' }) },
    pink:      { name: 'Rose',       desc: 'Soft professional pink',   hues: hues({ daily: '#be185d', money: '#445c85' }) },
    bedazzled: {
      name: 'Bedazzled', desc: 'All the pink, all the sparkle',
      hues: { daily: '#e91e8c', intake: '#8b5cf6', docs: '#d4a017', money: '#be123c', horizon: '#6d28d9' },
    },
  };

  var HUE_VARS = {
    daily: '--h-daily', intake: '--h-intake', docs: '--h-docs',
    money: '--h-money', horizon: '--h-horizon',
  };

  // Retired theme ids from the pre-redesign roster → nearest new equivalent.
  // Midnight was a dark theme; it becomes the default theme in dark mode.
  var LEGACY = {
    midnight: { theme: DEFAULT_THEME, mode: 'dark' },
    slate:    { theme: 'navy' },
    warm:     { theme: 'brass' },
  };

  function transition() {
    var el = document.documentElement;
    el.classList.add('theme-transitioning');
    setTimeout(function () { el.classList.remove('theme-transitioning'); }, 300);
  }

  function applyTheme(id, animate) {
    if (!THEMES[id]) id = DEFAULT_THEME;
    var el = document.documentElement;
    if (animate) transition();
    var hues = THEMES[id].hues;
    Object.keys(HUE_VARS).forEach(function (k) { el.style.setProperty(HUE_VARS[k], hues[k]); });
    el.setAttribute('data-theme', id);
    return id;
  }

  function applyMode(mode, animate) {
    mode = mode === 'dark' ? 'dark' : 'light';
    if (animate) transition();
    document.documentElement.setAttribute('data-mode', mode);
    return mode;
  }

  // ── Restore saved theme + mode (with legacy id migration) ────────────────
  var _theme = DEFAULT_THEME, _mode = 'light';
  try {
    var saved = localStorage.getItem('portal-theme') || DEFAULT_THEME;
    var savedMode = localStorage.getItem('portal-mode');
    if (LEGACY[saved]) {
      var mig = LEGACY[saved];
      saved = mig.theme;
      if (mig.mode && !savedMode) savedMode = mig.mode;
      localStorage.setItem('portal-theme', saved);
      if (savedMode) localStorage.setItem('portal-mode', savedMode);
    }
    _theme = THEMES[saved] ? saved : DEFAULT_THEME;
    _mode  = savedMode === 'dark' ? 'dark' : 'light';
  } catch (_) {}
  applyTheme(_theme, false);
  applyMode(_mode, false);

  window.PortalTheme = {
    current: _theme,
    mode:    _mode,
    themes:  Object.keys(THEMES).map(function (id) {
      return { id: id, name: THEMES[id].name, desc: THEMES[id].desc, hues: THEMES[id].hues };
    }),
    apply: function (id) {
      this.current = applyTheme(id, true);
      try { localStorage.setItem('portal-theme', this.current); } catch (_) {}
      document.dispatchEvent(new CustomEvent('portalthemechange', { detail: { theme: this.current } }));
    },
    setMode: function (mode) {
      this.mode = applyMode(mode, true);
      try { localStorage.setItem('portal-mode', this.mode); } catch (_) {}
      document.dispatchEvent(new CustomEvent('portalmodechange', { detail: { mode: this.mode } }));
    },
    toggleMode: function () {
      this.setMode(this.mode === 'dark' ? 'light' : 'dark');
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    _initPicker();
    _initModeToggle();
  });

  // ── Theme picker modal ────────────────────────────────────────────────────
  function _initPicker() {
    var modal   = document.getElementById('theme-modal');
    if (!modal) return;
    var grid    = document.getElementById('theme-picker-grid');
    var trigger = document.getElementById('topbar-theme-btn');
    var closeX  = document.getElementById('theme-modal-close');

    if (grid) _renderGrid(grid);

    function openModal()  { if (grid) _renderGrid(grid); modal.classList.remove('hidden'); }
    function closeModal() { modal.classList.add('hidden'); }

    if (trigger) trigger.addEventListener('click', openModal);
    if (closeX)  closeX.addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('portalthemechange', function () { if (grid) _renderGrid(grid); });
  }

  function _renderGrid(grid) {
    grid.innerHTML = '';
    var current = window.PortalTheme.current;
    window.PortalTheme.themes.forEach(function (t) {
      var active = (current === t.id);
      var d = t.hues.daily;
      var btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'theme-card' + (active ? ' theme-card--active' : '');
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.dataset.themeId = t.id;
      btn.innerHTML =
        '<div class="theme-preview" style="background:color-mix(in srgb, ' + d + ' 3%, #fbfbfa)">' +
          '<div class="theme-preview-bar" style="background:color-mix(in srgb, ' + d + ' 55%, #1c2a44)">' +
            '<div class="theme-preview-sidebar" style="background:color-mix(in srgb, ' + d + ' 18%, #14171f)"></div>' +
          '</div>' +
          '<div class="theme-preview-body">' +
            '<div class="theme-preview-accent" style="background:' + d + '"></div>' +
            '<div class="theme-preview-card"></div>' +
          '</div>' +
          (active ? '<div class="theme-check">&#10003;</div>' : '') +
        '</div>' +
        '<div class="theme-card-info">' +
          '<span class="theme-card-name">' + t.name + '</span>' +
          '<span class="theme-card-desc">' + t.desc + '</span>' +
        '</div>';
      btn.addEventListener('click', function () { window.PortalTheme.apply(t.id); });
      grid.appendChild(btn);
    });
  }

  // ── Sun/moon mode toggle (topbar) ────────────────────────────────────────
  function _initModeToggle() {
    var btn = document.getElementById('topbar-mode-btn');
    if (!btn) return;
    var sun  = document.getElementById('topbar-mode-sun');
    var moon = document.getElementById('topbar-mode-moon');

    function sync() {
      var dark = window.PortalTheme.mode === 'dark';
      if (sun)  sun.style.display  = dark ? '' : 'none';
      if (moon) moon.style.display = dark ? 'none' : '';
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    }

    btn.addEventListener('click', function () { window.PortalTheme.toggleMode(); });
    document.addEventListener('portalmodechange', sync);
    sync();
  }

})();
