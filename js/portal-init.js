// Global error handler — catches uncaught errors and unhandled rejections.
// Buttons built with createElement + addEventListener so no onclick attrs are needed
// (which would require unsafe-inline in script-src CSP).
(function () {
  function showErrorBanner(msg) {
    if (document.getElementById('global-error-banner')) return;

    var banner = document.createElement('div');
    banner.id = 'global-error-banner';
    banner.setAttribute('role', 'alert');
    banner.style.cssText = [
      'position:fixed;bottom:72px;left:50%;transform:translateX(-50%)',
      'background:#1e293b;color:#f1f5f9;border-radius:8px;padding:12px 20px',
      'font-size:13px;font-family:var(--font-sans,system-ui)',
      'display:flex;align-items:center;gap:12px;z-index:9998;box-shadow:0 4px 12px rgba(0,0,0,.3)',
      'max-width:480px;width:calc(100% - 48px)',
    ].join(';');

    var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', '#f87171');
    icon.setAttribute('stroke-width', '2');
    icon.style.cssText = 'width:18px;height:18px;flex-shrink:0';
    icon.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';

    var msgSpan = document.createElement('span');
    msgSpan.style.flex = '1';
    msgSpan.textContent = msg || 'Something went wrong on this page.';

    var refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.style.cssText = 'background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;cursor:pointer;white-space:nowrap;font-family:inherit';
    refreshBtn.addEventListener('click', function () { window.location.reload(); });

    var dismissBtn = document.createElement('button');
    dismissBtn.textContent = '×';
    dismissBtn.style.cssText = 'background:transparent;border:none;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1;padding:0 4px';
    dismissBtn.setAttribute('aria-label', 'Dismiss');
    dismissBtn.addEventListener('click', function () { banner.remove(); });

    banner.appendChild(icon);
    banner.appendChild(msgSpan);
    banner.appendChild(refreshBtn);
    banner.appendChild(dismissBtn);
    document.body.appendChild(banner);
    setTimeout(function () { banner.remove(); }, 30000);
  }

  window.addEventListener('error', function (e) {
    if (!e.message || e.message === 'Script error.') return;
    console.error('[global-error]', e.message, e.filename, e.lineno);
    showErrorBanner('Something went wrong. Refresh the page if things look broken.');
  });

  window.addEventListener('unhandledrejection', function (e) {
    console.error('[unhandled-rejection]', e.reason);
    var msg = (e.reason && e.reason.message) ? e.reason.message : String(e.reason || '');
    if (msg.includes('Unauthorized') || msg.includes('Invalid token')) return;
    showErrorBanner('Something went wrong. Refresh the page if things look broken.');
  });
})();

// Auth gate + portal shell init
(async function () {
  var session = await Auth.requireAuth();
  if (!session) return;

  var profile = await Auth.getProfile();
  if (profile) {
    document.getElementById('user-avatar').textContent = Utils.initials(profile);
    document.getElementById('user-name').textContent   = Utils.fullName(profile);
    document.getElementById('user-role').textContent   = (profile.role && profile.role.name) || '';
  }

  if (profile && profile.role && profile.role.name === 'Client') {
    var settingsLink = document.getElementById('topbar-settings-link');
    if (settingsLink) settingsLink.remove();
  }

  await Menu.render();
  document.body.style.visibility = '';
  Menu.init();

  var toggle  = document.getElementById('sidebar-toggle');
  var sidebar = document.getElementById('sidebar');
  toggle.addEventListener('click', function () {
    var open = sidebar.classList.toggle('sidebar--open');
    toggle.setAttribute('aria-expanded', open);
  });

  document.getElementById('sidebar-nav').addEventListener('click', function () {
    sidebar.classList.remove('sidebar--open');
    toggle.setAttribute('aria-expanded', 'false');
  });

  document.getElementById('logout-btn').addEventListener('click', function () { Auth.logout(); });

  var manualLogout = false;
  document.getElementById('logout-btn').addEventListener('click', function () { manualLogout = true; }, true);
  db.auth.onAuthStateChange(function (event) {
    if (event === 'SIGNED_OUT' && !manualLogout) {
      sessionStorage.setItem('login_message', 'Your session expired. Please log in again.');
      window.location.replace('/');
    }
  });

  window.addEventListener('hashchange', updateTitle);
  updateTitle();

  function updateTitle() {
    var route = Menu.currentRoute();
    var mod   = (window.MODULE_REGISTRY || []).find(function (m) {
      return m.route === route || route.startsWith(m.route + '/');
    });
    var label = mod ? mod.name : Utils.titleCase(route.split('/').pop());
    document.title = label + ' — IurisIQ';
    var bc = document.getElementById('breadcrumb');
    if (bc) bc.textContent = label;
  }
})();
