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
    var initials = Utils.initials(profile);
    var fullName = Utils.fullName(profile);
    var roleName = (profile.role && profile.role.name) || '';

    // Sidebar user card
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name').textContent   = fullName;
    document.getElementById('user-role').textContent   = roleName;

    // Sidebar popover
    document.getElementById('user-popover-avatar').textContent = initials;
    document.getElementById('user-popover-name').textContent   = fullName;
    document.getElementById('user-popover-role').textContent   = roleName;

    // Topbar avatar button
    document.getElementById('topbar-avatar-initials').textContent = initials;
    document.getElementById('tum-avatar-initials').textContent    = initials;
    document.getElementById('tum-name').textContent               = fullName;
    document.getElementById('tum-role').textContent               = roleName;

    // Show profile photo if one is saved
    if (profile.avatar_url) {
      applyAvatar(profile.avatar_url);
    }

    // Hide Settings menu item for Client role
    if (roleName === 'Client') {
      var settingsItem = document.getElementById('tum-settings-link');
      if (settingsItem) settingsItem.style.display = 'none';
    }

    // MFA suggestion banner for unenrolled clients
    if (roleName === 'Client') {
      var bannerKey = 'mfa_banner_dismissed_' + (profile.id || '');
      if (!localStorage.getItem(bannerKey)) {
        Auth.listMFAFactors().then(function (factors) {
          if (factors.length > 0) return;
          var banner = document.createElement('div');
          banner.id = 'mfa-suggestion-banner';
          banner.style.cssText = 'background:#fffbeb;border-bottom:1px solid #fde68a;padding:10px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:.875rem;color:#78350f;flex-shrink:0';
          banner.innerHTML = '<span style="display:flex;align-items:center;gap:8px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Secure your account with two-factor authentication — protects your legal documents if your password is ever compromised.</span><span style="display:flex;align-items:center;gap:12px;flex-shrink:0"><a href="/account" style="font-weight:600;color:#92400e;text-decoration:underline">Set up 2FA</a><button id="dismiss-mfa-banner" aria-label="Dismiss" style="background:none;border:none;cursor:pointer;color:#92400e;font-size:18px;line-height:1;padding:0">×</button></span>';
          var mainWrapper = document.querySelector('.main-wrapper');
          var topbar = document.getElementById('topbar');
          if (mainWrapper && topbar) mainWrapper.insertBefore(banner, topbar.nextSibling);
          document.getElementById('dismiss-mfa-banner').addEventListener('click', function () {
            banner.remove();
            localStorage.setItem(bannerKey, '1');
          });
        }).catch(function () {});
      }
    }
  }

  // Apply avatar photo to all avatar elements
  function applyAvatar(dataUrl) {
    var topbarImg = document.getElementById('topbar-avatar-img');
    var topbarIni = document.getElementById('topbar-avatar-initials');
    var menuImg   = document.getElementById('tum-avatar-img');
    var menuIni   = document.getElementById('tum-avatar-initials');
    if (topbarImg) { topbarImg.src = dataUrl; topbarImg.style.display = ''; }
    if (topbarIni) topbarIni.style.display = 'none';
    if (menuImg)   { menuImg.src = dataUrl; menuImg.style.display = ''; }
    if (menuIni)   menuIni.style.display = 'none';
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

  // Sidebar user popover flyout (hover)
  (function () {
    var trigger = document.getElementById('sidebar-footer-user');
    var popover = document.getElementById('user-popover');
    if (!trigger || !popover) return;
    var timer;
    var open = function () {
      clearTimeout(timer);
      var rect = trigger.getBoundingClientRect();
      popover.style.left   = (rect.right + 8) + 'px';
      popover.style.bottom = (window.innerHeight - rect.bottom) + 'px';
      popover.style.top    = 'auto';
      popover.classList.add('user-popover--open');
    };
    var close = function () {
      timer = setTimeout(function () { popover.classList.remove('user-popover--open'); }, 150);
    };
    trigger.addEventListener('mouseenter', open);
    trigger.addEventListener('mouseleave', close);
    popover.addEventListener('mouseenter', function () { clearTimeout(timer); });
    popover.addEventListener('mouseleave', close);
    document.getElementById('user-popover-logout').addEventListener('click', function () { Auth.logout(); });
  })();

  // Topbar avatar button — click to open/close user menu
  (function () {
    var btn  = document.getElementById('topbar-avatar-btn');
    var menu = document.getElementById('topbar-user-menu');
    if (!btn || !menu) return;

    function openMenu() {
      var rect = btn.getBoundingClientRect();
      menu.style.top   = (rect.bottom + 6) + 'px';
      menu.style.right = (window.innerWidth - rect.right) + 'px';
      menu.style.left  = 'auto';
      menu.style.display = 'block';
      btn.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
      menu.style.display = 'none';
      btn.setAttribute('aria-expanded', 'false');
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (menu.style.display === 'block') { closeMenu(); } else { openMenu(); }
    });

    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target)) closeMenu();
    });

    document.getElementById('tum-logout').addEventListener('click', function () { Auth.logout(); });

    var myProfileBtn = document.getElementById('tum-my-profile');
    if (myProfileBtn) myProfileBtn.addEventListener('click', function () { closeMenu(); openMyProfileModal(); });

    var helpBtn = document.getElementById('tum-help');
    if (helpBtn) helpBtn.addEventListener('click', function () {
      closeMenu();
      if (window.HelpDrawer) window.HelpDrawer.open();
    });

    // Close menu when navigating via a link inside it
    menu.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', closeMenu);
    });
  })();

  // My Profile — self-service professional info (bar #, licensing authority,
  // USCIS account #, phone, fax). These autofill onto USCIS forms for matters
  // assigned to this attorney; saved via /api/update-my-profile, which
  // whitelists exactly these columns (role/active/email stay admin-only).
  async function openMyProfileModal() {
    var overlay = document.getElementById('my-profile-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'my-profile-modal';
      overlay.className = 'modal-overlay hidden';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      document.body.appendChild(overlay);
    }

    var profile = await Auth.getProfile(true);
    if (!profile) { Utils.toast('Could not load your profile.', 'error'); return; }
    var esc = Utils.esc;

    overlay.innerHTML = '' +
      '<div class="modal">' +
        '<div class="modal-header">' +
          '<h2 class="modal-title">My Profile</h2>' +
          '<button class="modal-close" aria-label="Close">×</button>' +
        '</div>' +
        '<form id="my-profile-form" novalidate>' +
          '<div class="modal-body">' +
            '<p class="text-muted text-sm" style="margin-bottom:var(--space-3)">Your professional info — autofilled onto USCIS forms for matters assigned to you. Name and role changes are handled by an admin in Settings → Users.</p>' +
            '<div class="field-row">' +
              '<div class="field"><label for="mp-phone">Direct phone</label>' +
                '<input type="tel" id="mp-phone" name="phone" value="' + esc(profile.phone || '') + '" placeholder="Digits only"></div>' +
              '<div class="field"><label for="mp-fax">Fax</label>' +
                '<input type="tel" id="mp-fax" name="fax" value="' + esc(profile.fax || '') + '" placeholder="Digits only"></div>' +
            '</div>' +
            '<div class="field-row">' +
              '<div class="field"><label for="mp-bar">Bar number</label>' +
                '<input type="text" id="mp-bar" name="bar_number" value="' + esc(profile.bar_number || '') + '"></div>' +
              '<div class="field"><label for="mp-uscis">USCIS Online Account #</label>' +
                '<input type="text" id="mp-uscis" name="uscis_account_number" value="' + esc(profile.uscis_account_number || '') + '" maxlength="12"></div>' +
            '</div>' +
            '<div class="field"><label for="mp-licensing">Licensing authority</label>' +
              '<input type="text" id="mp-licensing" name="licensing_authority" value="' + esc(profile.licensing_authority || '') + '" placeholder="e.g. State Bar of Texas"></div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<div id="mp-error" class="form-error hidden" style="flex:1;margin:0 var(--space-2)"></div>' +
            '<button type="button" class="btn btn--secondary" id="mp-cancel">Cancel</button>' +
            '<button type="submit" class="btn btn--primary" id="mp-save">Save</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    function close() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }
    overlay.classList.remove('hidden');
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#mp-cancel').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    overlay.querySelector('#my-profile-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var f = e.target;
      var errEl = overlay.querySelector('#mp-error');
      var saveBtn = overlay.querySelector('#mp-save');
      errEl.classList.add('hidden');
      Utils.setLoading(saveBtn, true);
      try {
        var session = await Auth.getSession();
        var res = await fetch('/api/update-my-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
          body: JSON.stringify({
            phone:                f.elements['phone'].value,
            fax:                  f.elements['fax'].value,
            bar_number:           f.elements['bar_number'].value,
            licensing_authority:  f.elements['licensing_authority'].value,
            uscis_account_number: f.elements['uscis_account_number'].value,
          }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Save failed.');
        Utils.toast('Profile saved. New forms will use this information.', 'success');
        close();
      } catch (err) {
        errEl.textContent = err.message || 'Save failed.';
        errEl.classList.remove('hidden');
      } finally {
        Utils.setLoading(saveBtn, false);
      }
    });
  }

  // Profile photo upload
  (function () {
    var fileInput = document.getElementById('tum-avatar-file');
    if (!fileInput) return;

    fileInput.addEventListener('change', async function () {
      var file = this.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) { Utils.toast('Please select an image file.', 'error'); return; }

      try {
        var dataUrl = await resizeImage(file, 128);
        var session = await Auth.getSession();
        var res = await fetch('/api/update-avatar', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
          body:    JSON.stringify({ avatar_data_url: dataUrl }),
        });
        if (!res.ok) throw new Error('Upload failed');
        applyAvatar(dataUrl);
        Utils.toast('Profile photo updated.', 'success');
      } catch (err) {
        Utils.toast('Could not update photo. Please try again.', 'error');
      }
      this.value = '';
    });

    function resizeImage(file, size) {
      return new Promise(function (resolve) {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () {
          var canvas = document.createElement('canvas');
          canvas.width = canvas.height = size;
          var ctx = canvas.getContext('2d');
          var s = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = url;
      });
    }
  })();

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
    var route  = Menu.currentRoute();
    var isHome = !route || route === 'home';
    var mod    = (window.MODULE_REGISTRY || []).find(function (m) {
      return m.route === route || route.startsWith(m.route + '/');
    });
    var label = mod ? mod.name : Utils.titleCase(route.split('/').pop());
    document.title = label + ' — IurisIQ';
    var bc = document.getElementById('breadcrumb');
    if (!bc) return;
    if (isHome) {
      bc.textContent = label;
    } else {
      bc.innerHTML =
        '<a href="#home" class="breadcrumb-home-link">Home</a>' +
        '<span class="breadcrumb-sep"> › </span>' +
        label.replace(/[<>&"]/g, function (c) { return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; });
    }

    // Demo mode: fire module_view event on every navigation (non-home)
    if (!isHome && window.APP_CONFIG && window.APP_CONFIG.demoMode) {
      var sid  = sessionStorage.getItem('demo_sid');
      var role = profile && profile.role ? profile.role.name.toLowerCase() : null;
      if (sid) {
        fetch('/api/demo-event', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ session_id: sid, role: role, event_type: 'module_view', module: route }),
        }).catch(function () {});
      }
    }
  }
})();
