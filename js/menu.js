// Portal navigation menu.
// Reads MODULE_REGISTRY (registry.js) + user's access (Auth.getAccessibleModules).
// Renders the sidebar nav (with grouped flyout menus) and handles hash-based routing.
// Requires: auth.js, registry.js

'use strict';

window.Menu = (function () {

  const ICONS = {
    'users':          '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'user':           '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    'home':           '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    'check-square':   '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    'upload':         '<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>',
    'message-square': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'message-circle': '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    'dollar-sign':    '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    'cpu':            '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
    'file-text':      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
    'pen-tool':       '<path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
    'bar-chart-2':    '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    'file':           '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    'settings':       '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    'log-out':        '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    'shield':         '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'calendar':       '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    'briefcase':      '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  };

  function icon(name) {
    const path = ICONS[name] || ICONS['file'];
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }

  // ── Nav group definitions ──────────────────────────────────────────────────
  // Routes listed here are rendered inside a flyout; all others are standalone.

  const NAV_GROUPS = [
    { key: 'clients',       label: 'Clients',       icon: 'users',          routes: ['clients', 'conflict-checker', 'uploads'] },
    { key: 'communication', label: 'Communication',  icon: 'message-circle', routes: ['messaging', 'calendar'] },
    { key: 'documents',     label: 'Documents',      icon: 'file-text',      routes: ['esign', 'sig-stamp', 'settings/doc-templates'] },
    { key: 'finance',       label: 'Finance',        icon: 'dollar-sign',    routes: ['trust', 'billing'] },
    { key: 'tools',         label: 'Tools',          icon: 'cpu',            routes: ['tasks', 'proof-scan', 'ai-brain', 'draft-forms'] },
  ];

  const GROUPED_ROUTES = new Set(NAV_GROUPS.flatMap(g => g.routes));

  async function getEnabledPremiumKeys() {
    try {
      const { data } = await window.db.from('enabled_modules').select('module_key');
      return new Set((data || []).map(r => r.module_key));
    } catch { return new Set(); }
  }

  async function render() {
    const nav     = document.getElementById('sidebar-nav');
    const profile = await Auth.getProfile();
    const [accessible, enabledPremium] = await Promise.all([
      Auth.getAccessibleModules('read'),
      getEnabledPremiumKeys(),
    ]);

    if (!nav || !profile) return;

    const isAdmin  = profile.role?.name === 'Owner';
    const isClient = profile.role?.name === 'Client';

    const items = (window.MODULE_REGISTRY || [])
      .filter(m => accessible.has(m.key))
      .filter(m => !m.staffOnly || !isClient)
      .filter(m => !m.premium || enabledPremium.has(m.key))
      .filter(m => !m.requires || enabledPremium.has(m.requires))
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const itemsByRoute = new Map(items.map(m => [m.route, m]));
    const currentR     = currentRoute();
    const renderedRoutes = new Set();
    let html = '';

    // ── Home (always first) ──────────────────────────────────────────────────
    const homeActive = !currentR || currentR === 'home';
    html += `<a href="#home" class="nav-item" aria-current="${homeActive ? 'page' : 'false'}" data-route="home" data-key="home">
      <span class="nav-icon">${icon('home')}</span><span class="nav-label">Home</span></a>`;
    renderedRoutes.add('home');

    // ── Groups ───────────────────────────────────────────────────────────────
    for (const group of NAV_GROUPS) {
      const groupItems = group.routes.map(r => itemsByRoute.get(r)).filter(Boolean);
      if (!groupItems.length) continue;

      const isGroupActive = groupItems.some(m => currentR === m.route || currentR.startsWith(m.route + '/'));

      const flyoutItems = groupItems.map(m => {
        const isCurrent = currentR === m.route || currentR.startsWith(m.route + '/');
        const soon      = m.comingSoon && !isAdmin;
        const badge     = soon ? '<span class="nav-badge" style="margin-left:auto;font-size:9px;padding:1px 5px">Soon</span>' : '';
        return `<a href="${soon ? '#' : '#' + m.route}"
          class="nav-flyout-item${soon ? ' nav-flyout-item--soon' : ''}"
          aria-current="${isCurrent ? 'page' : 'false'}"
          data-route="${m.route}" data-key="${m.key}">
          <span class="nav-flyout-icon">${icon(m.icon)}</span>${m.name}${badge}</a>`;
      }).join('');

      html += `<div class="nav-group${isGroupActive ? ' active' : ''}" data-group="${group.key}">
        <button class="nav-group-btn" type="button" aria-expanded="false">
          <span class="nav-icon">${icon(group.icon)}</span>
          <span class="nav-label">${group.label}</span>
          <span class="nav-group-arrow">›</span>
        </button>
        <div class="nav-flyout" role="menu">
          <div class="nav-flyout-label">${group.label}</div>
          ${flyoutItems}
        </div>
      </div>`;

      group.routes.forEach(r => renderedRoutes.add(r));
    }

    // ── Standalone items not in any group ────────────────────────────────────
    items.forEach(m => {
      if (renderedRoutes.has(m.route)) return;
      const active = currentR === m.route || currentR.startsWith(m.route + '/');
      const soon   = m.comingSoon && !isAdmin;
      const badge  = soon ? '<span class="nav-badge">Soon</span>' : '';
      html += `<a href="#${m.route}" class="nav-item${soon ? ' nav-item--soon' : ''}"
        aria-current="${active ? 'page' : 'false'}"
        data-route="${m.route}" data-key="${m.key}">
        <span class="nav-icon">${icon(m.icon)}</span>
        <span class="nav-label">${m.name}</span>${badge}</a>`;
    });

    nav.innerHTML = html;

    // Wire flyout hover/focus
    nav.querySelectorAll('.nav-group').forEach(group => {
      let timer;
      const open = () => { clearTimeout(timer); group.classList.add('flyout-open'); group.querySelector('.nav-group-btn').setAttribute('aria-expanded', 'true'); };
      const close = () => { timer = setTimeout(() => { group.classList.remove('flyout-open'); group.querySelector('.nav-group-btn').setAttribute('aria-expanded', 'false'); }, 120); };
      group.addEventListener('mouseenter', open);
      group.addEventListener('mouseleave', close);
      group.addEventListener('focusin',    open);
      group.addEventListener('focusout', e => { if (!group.contains(e.relatedTarget)) close(); });
    });

    // Coming soon clicks in flyouts
    nav.querySelectorAll('.nav-flyout-item--soon').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); showComingSoon(el.dataset.key); });
    });
    nav.querySelectorAll('.nav-item--soon').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); showComingSoon(el.dataset.key); });
    });

    setTimeout(() => { pollUnread(); setInterval(pollUnread, 30000); }, 1000);
  }

  function currentRoute() {
    return window.location.hash.replace('#', '');
  }

  function updateActive(route) {
    // Standalone nav items
    document.querySelectorAll('.nav-item[data-route]').forEach(el => {
      const isActive = el.dataset.route === route || (route.startsWith(el.dataset.route + '/') && el.dataset.route !== 'home');
      el.setAttribute('aria-current', isActive ? 'page' : 'false');
    });
    // Flyout items
    document.querySelectorAll('.nav-flyout-item').forEach(el => {
      el.setAttribute('aria-current', el.dataset.route === route ? 'page' : 'false');
    });
    // Group buttons — active if any sub-item is current
    document.querySelectorAll('.nav-group').forEach(group => {
      const hasActive = !!group.querySelector('.nav-flyout-item[aria-current="page"]');
      group.classList.toggle('active', hasActive);
    });
  }

  // ── Sidebar collapse ─────────────────────────────────────────────────────

  function wireCollapse() {
    const sidebar = document.getElementById('sidebar');
    const btn     = document.getElementById('sidebar-collapse-btn');
    if (!btn || !sidebar) return;

    // Restore saved state
    if (localStorage.getItem('sidebar_collapsed') === '1') {
      sidebar.classList.add('collapsed');
    }

    btn.addEventListener('click', () => {
      const nowCollapsed = sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebar_collapsed', nowCollapsed ? '1' : '0');
      btn.setAttribute('aria-label', nowCollapsed ? 'Expand navigation' : 'Collapse navigation');
    });
  }

  // ── Settings sub-navigation ──────────────────────────────────────────────

  const SETTINGS_NAV = [
    { route: 'settings/users',          name: 'Users' },
    { route: 'settings/permissions',    name: 'Permissions' },
    { route: 'settings/practice-areas', name: 'Practice Areas' },
    { route: 'settings/calendar',       name: 'Calendar Sync' },
    { route: 'settings/signature',      name: 'Attorney Signature' },
  ];

  function buildSettingsNav(activeRoute) {
    const tabs = SETTINGS_NAV.map(item => {
      const isActive = item.route === activeRoute;
      return `<a href="#${item.route}"
        style="padding:var(--space-2) var(--space-4);font-size:var(--text-sm);font-weight:${isActive ? '600' : '500'};
               text-decoration:none;border-bottom:2px solid ${isActive ? 'var(--color-primary)' : 'transparent'};
               color:${isActive ? 'var(--color-primary)' : 'var(--color-text-muted)'};white-space:nowrap;
               transition:color .15s,border-color .15s"
        ${isActive ? 'aria-current="page"' : ''}>${item.name}</a>`;
    }).join('');
    return `<div style="display:flex;gap:0;border-bottom:1px solid var(--color-border);margin-bottom:var(--space-6);overflow-x:auto">${tabs}</div>`;
  }

  // ── Page loader ──────────────────────────────────────────────────────────

  let _currentScript = null;

  async function loadPage(route) {
    const main = document.getElementById('page-content');
    if (!main) return;

    updateActive(route);

    main.innerHTML = '<div class="page-skeleton" aria-busy="true" aria-label="Loading…"></div>';

    try {
      const res = await fetch(`/pages/${route}/index.html`);
      if (!res.ok) throw new Error(`Page not found: ${route}`);
      let pageHtml = await res.text();
      if (route.startsWith('settings/')) pageHtml = buildSettingsNav(route) + pageHtml;
      main.innerHTML = pageHtml;

      const scriptSrc = `/pages/${route}/${route.split('/').pop()}.js`;
      if (_currentScript) _currentScript.remove();
      const s = document.createElement('script');
      s.src = scriptSrc;
      s.onerror = () => {};
      document.body.appendChild(s);
      _currentScript = s;

    } catch (err) {
      main.innerHTML = `<div class="page-error"><h2>Page not found</h2><p>${route} — this module may not be built yet.</p></div>`;
    }
  }

  // ── Router ───────────────────────────────────────────────────────────────

  async function init() {
    wireCollapse();

    window.addEventListener('hashchange', () => loadPage(currentRoute()));

    const route = currentRoute();
    if (route) {
      loadPage(route);
    } else {
      window.location.hash = 'home';
      // hashchange event handles loadPage
    }
  }

  function showComingSoon(key) {
    const m = (window.MODULE_REGISTRY || []).find(m => m.key === key);
    Utils.toast(`${m ? m.name : key} — coming soon`, 'info');
  }

  // ── Unread nav badge ─────────────────────────────────────────────────────

  function setNavBadge(route, count) {
    const item = document.querySelector(`.nav-item[data-route="${route}"], .nav-flyout-item[data-route="${route}"]`);
    if (!item) return;
    let badge = item.querySelector('.nav-badge-unread');
    if (count > 0) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'nav-badge-unread'; item.appendChild(badge); }
      badge.textContent = count;
    } else if (badge) { badge.remove(); }
  }

  async function pollUnread() {
    try {
      const session = await Auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch('/api/get-conversations', { headers: { 'Authorization': `Bearer ${session.access_token}` } });
      if (!res.ok) return;
      const data = await res.json();
      const total = (data.conversations || []).reduce((s, c) => s + (c.unread_count || 0), 0);
      setNavBadge('messaging', total);
    } catch { /* silently ignore */ }
  }

  return { render, init, loadPage, currentRoute, icon, setNavBadge, pollUnread };
})();
