'use strict';

// Load in <head> before body renders — applies saved theme immediately (no FOUC).
(function () {

  var THEMES = {

    navy: {
      '--color-primary':       '#1d4ed8',
      '--color-primary-hover': '#1e40af',
      '--color-bg':            '#f1f5f9',
      '--color-bg-subtle':     '#f8fafc',
      '--color-surface':       '#ffffff',
      '--color-border':        '#e2e8f0',
      '--color-border-mid':    '#cbd5e1',
      '--color-text':          '#0f172a',
      '--color-text-muted':    '#64748b',
      '--color-text-light':    '#94a3b8',
      '--sidebar-bg':          '#0f172a',
      '--sidebar-border':      '#1e293b',
      '--sidebar-text':        '#94a3b8',
      '--sidebar-text-active': '#f1f5f9',
      '--sidebar-icon-active': '#60a5fa',
      '--sidebar-accent':      '#1d4ed8',
      '--topbar-gradient':     'linear-gradient(170deg, rgba(52,122,205,.82) 0%, rgba(22,64,125,.84) 50%, rgba(10,30,72,.92) 100%)',
    },

    midnight: {
      '--color-primary':       '#60a5fa',
      '--color-primary-hover': '#93c5fd',
      '--color-bg':            '#0f1117',
      '--color-bg-subtle':     '#181b24',
      '--color-surface':       '#1a1c23',
      '--color-border':        '#2a2d3a',
      '--color-border-mid':    '#363948',
      '--color-text':          '#e2e8f0',
      '--color-text-muted':    '#94a3b8',
      '--color-text-light':    '#64748b',
      '--sidebar-bg':          '#090b0f',
      '--sidebar-border':      '#181a24',
      '--sidebar-text':        '#7a8499',
      '--sidebar-text-active': '#f1f5f9',
      '--sidebar-icon-active': '#60a5fa',
      '--sidebar-accent':      '#60a5fa',
      '--topbar-gradient':     'linear-gradient(170deg, rgba(52,74,148,.92) 0%, rgba(32,50,112,.93) 50%, rgba(14,24,68,.97) 100%)',
    },

    slate: {
      '--color-primary':       '#0f4c81',
      '--color-primary-hover': '#0a3d6e',
      '--color-bg':            '#f8fafc',
      '--color-bg-subtle':     '#f1f5f9',
      '--color-surface':       '#ffffff',
      '--color-border':        '#e2e8f0',
      '--color-border-mid':    '#cbd5e1',
      '--color-text':          '#0f172a',
      '--color-text-muted':    '#475569',
      '--color-text-light':    '#94a3b8',
      '--sidebar-bg':          '#1e293b',
      '--sidebar-border':      '#2d3f52',
      '--sidebar-text':        '#94a3b8',
      '--sidebar-text-active': '#f1f5f9',
      '--sidebar-icon-active': '#7dd3fc',
      '--sidebar-accent':      '#0f4c81',
      '--topbar-gradient':     'linear-gradient(170deg, rgba(50,72,108,.90) 0%, rgba(24,42,72,.91) 50%, rgba(8,16,32,.96) 100%)',
    },

    warm: {
      '--color-primary':       '#9a4a2a',
      '--color-primary-hover': '#7d3a20',
      '--color-bg':            '#faf5ef',
      '--color-bg-subtle':     '#f5ede4',
      '--color-surface':       '#ffffff',
      '--color-border':        '#e8ddd4',
      '--color-border-mid':    '#d4c8bc',
      '--color-text':          '#1c1008',
      '--color-text-muted':    '#6b5040',
      '--color-text-light':    '#a89080',
      '--sidebar-bg':          '#1c1008',
      '--sidebar-border':      '#2e1e0e',
      '--sidebar-text':        '#a89080',
      '--sidebar-text-active': '#f5ede8',
      '--sidebar-icon-active': '#f4a070',
      '--sidebar-accent':      '#9a4a2a',
      '--topbar-gradient':     'linear-gradient(170deg, rgba(135,62,22,.86) 0%, rgba(78,36,12,.87) 50%, rgba(32,13,4,.94) 100%)',
    },

    pink: {
      '--color-primary':       '#be185d',
      '--color-primary-hover': '#9d174d',
      '--color-bg':            '#fdf2f8',
      '--color-bg-subtle':     '#fce7f3',
      '--color-surface':       '#ffffff',
      '--color-border':        '#fce7f3',
      '--color-border-mid':    '#f9a8d4',
      '--color-text':          '#1a0010',
      '--color-text-muted':    '#6b2147',
      '--color-text-light':    '#c48aaa',
      '--sidebar-bg':          '#1a0614',
      '--sidebar-border':      '#2d1025',
      '--sidebar-text':        '#c48aaa',
      '--sidebar-text-active': '#ffe4f0',
      '--sidebar-icon-active': '#f472b6',
      '--sidebar-accent':      '#be185d',
      '--topbar-gradient':     'linear-gradient(170deg, rgba(190,24,93,.86) 0%, rgba(131,24,67,.87) 50%, rgba(82,10,42,.94) 100%)',
    },

    bedazzled: {
      '--color-primary':       '#e91e8c',
      '--color-primary-hover': '#c4126e',
      '--color-bg':            '#fff0f8',
      '--color-bg-subtle':     '#fce8f4',
      '--color-surface':       '#ffffff',
      '--color-border':        '#fdd6ec',
      '--color-border-mid':    '#fba8d6',
      '--color-text':          '#1a0010',
      '--color-text-muted':    '#7a1050',
      '--color-text-light':    '#cc80aa',
      '--sidebar-bg':          '#0d0008',
      '--sidebar-border':      '#200015',
      '--sidebar-text':        '#d070a0',
      '--sidebar-text-active': '#ffd6f0',
      '--sidebar-icon-active': '#ff80c0',
      '--sidebar-accent':      '#e91e8c',
      '--topbar-gradient':     'linear-gradient(170deg, rgba(220,30,130,.90) 0%, rgba(180,14,100,.92) 50%, rgba(120,4,68,.97) 100%)',
    },

  };

  var THEME_META = [
    {
      id: 'sage', name: 'Sage', desc: 'Sage green',
      preview: { sidebar: '#0c1a0b', topbar: '#2d4828', primary: '#42563e', bg: '#f1f5f0' },
    },
    {
      id: 'navy', name: 'Navy', desc: 'Classic deep blue',
      preview: { sidebar: '#0f172a', topbar: '#1e3a6e', primary: '#1d4ed8', bg: '#f1f5f9' },
    },
    {
      id: 'midnight', name: 'Midnight', desc: 'Sleek dark mode',
      preview: { sidebar: '#090b0f', topbar: '#141928', primary: '#60a5fa', bg: '#0f1117' },
    },
    {
      id: 'slate', name: 'Slate', desc: 'Clean professional',
      preview: { sidebar: '#1e293b', topbar: '#253347', primary: '#0f4c81', bg: '#f8fafc' },
    },
    {
      id: 'warm', name: 'Warm', desc: 'Terracotta & earth',
      preview: { sidebar: '#1c1008', topbar: '#5a2d14', primary: '#9a4a2a', bg: '#faf5ef' },
    },
    {
      id: 'pink', name: 'Rose', desc: 'Soft professional pink',
      preview: { sidebar: '#1a0614', topbar: '#9d174d', primary: '#be185d', bg: '#fdf2f8' },
    },
    {
      id: 'bedazzled', name: 'Bedazzled', desc: 'All the pink, all the sparkle',
      preview: { sidebar: '#0d0008', topbar: '#c4126e', primary: '#e91e8c', bg: '#fff0f8' },
    },
  ];

  var ALL_VARS = [];
  Object.keys(THEMES).forEach(function (id) {
    Object.keys(THEMES[id]).forEach(function (k) {
      if (ALL_VARS.indexOf(k) === -1) ALL_VARS.push(k);
    });
  });

  function applyTheme(id, animate) {
    var el = document.documentElement;
    if (animate) {
      el.classList.add('theme-transitioning');
      setTimeout(function () { el.classList.remove('theme-transitioning'); }, 300);
    }
    ALL_VARS.forEach(function (k) { el.style.removeProperty(k); });
    var vars = THEMES[id];
    if (vars) {
      Object.keys(vars).forEach(function (k) { el.style.setProperty(k, vars[k]); });
    }
    el.setAttribute('data-theme', id || 'sage');
  }

  var _saved = 'sage';
  try { _saved = localStorage.getItem('portal-theme') || 'sage'; } catch (_) {}
  applyTheme(_saved, false);

  window.PortalTheme = {
    current: _saved,
    themes:  THEME_META,
    apply: function (id) {
      applyTheme(id, true);
      this.current = id;
      try { localStorage.setItem('portal-theme', id); } catch (_) {}
      document.dispatchEvent(new CustomEvent('portalthemechange', { detail: { theme: id } }));
    },
  };

  document.addEventListener('DOMContentLoaded', function () {
    _initPicker();
  });

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
      var btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'theme-card' + (active ? ' theme-card--active' : '');
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.dataset.themeId = t.id;
      btn.innerHTML =
        '<div class="theme-preview" style="background:' + t.preview.bg + '">' +
          '<div class="theme-preview-bar" style="background:' + t.preview.topbar + '">' +
            '<div class="theme-preview-sidebar" style="background:' + t.preview.sidebar + '"></div>' +
          '</div>' +
          '<div class="theme-preview-body">' +
            '<div class="theme-preview-accent" style="background:' + t.preview.primary + '"></div>' +
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

})();
