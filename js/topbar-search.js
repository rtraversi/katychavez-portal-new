'use strict';

(function TopbarSearch() {
  const wrap    = document.getElementById('topbar-search-wrap');
  const input   = document.getElementById('topbar-search-input');
  const results = document.getElementById('topbar-search-results');
  if (!input || !results) return;

  let debounceTimer = null;
  let profileCache  = null;
  let focusedIdx    = -1;

  // HTML-escape anything DB- or user-sourced before it enters innerHTML.
  const esc = (s) => (window.Utils?.esc
    ? window.Utils.esc(s)
    : String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

  async function profile() {
    if (!profileCache) profileCache = await Auth.getProfile();
    return profileCache;
  }

  function close() {
    results.hidden = true;
    results.innerHTML = '';
    focusedIdx = -1;
  }

  function items() {
    return Array.from(results.querySelectorAll('.topbar-search-item'));
  }

  function setFocus(idx) {
    const all = items();
    all.forEach(el => el.classList.remove('focused'));
    if (idx >= 0 && idx < all.length) {
      all[idx].classList.add('focused');
      focusedIdx = idx;
    } else {
      focusedIdx = -1;
    }
  }

  function navigate(route) {
    if (!route) return;
    window.location.hash = route;
    input.value = '';
    close();
  }

  function render(sections) {
    const hasAny = sections.some(s => s.items.length > 0);
    if (!hasAny) {
      results.innerHTML = '<div class="topbar-search-empty">No results found.</div>';
      results.hidden = false;
      return;
    }

    const ICONS = window.Menu?.icon ?? (() => '');

    const html = sections
      .filter(s => s.items.length)
      .map((s, si) => `
        ${si > 0 ? '<div class="topbar-search-divider"></div>' : ''}
        <div class="topbar-search-section">
          <div class="topbar-search-label">${esc(s.label)}</div>
          ${s.items.map(item => `
            <div class="topbar-search-item" data-route="${esc(item.route)}" role="option">
              <div class="topbar-search-item-icon">${ICONS(item.icon || 'file')}</div>
              <div>
                <div>${esc(item.name)}</div>
                ${item.sub ? `<div class="topbar-search-item-sub">${esc(item.sub)}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `).join('');

    results.innerHTML = html;
    results.hidden = false;
    focusedIdx = -1;

    results.querySelectorAll('.topbar-search-item').forEach(el => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        navigate(el.dataset.route);
      });
    });
  }

  async function search(q) {
    q = q.trim();
    if (!q) { close(); return; }

    const p       = await profile();
    const isClient = p?.role?.name === 'Client';
    const ql      = q.toLowerCase();

    // Module results
    const moduleHits = (window.MODULE_REGISTRY || [])
      .filter(m => m.route !== 'home')
      .filter(m => !m.staffOnly || !isClient)
      .filter(m =>
        m.name.toLowerCase().includes(ql) ||
        (m.description || '').toLowerCase().includes(ql)
      )
      .slice(0, 5)
      .map(m => ({
        icon:  m.navIcon || m.icon || 'file',
        name:  m.name,
        sub:   m.comingSoon ? 'Coming soon' : null,
        route: m.comingSoon ? '' : m.route,
      }));

    // Client results (staff only)
    let clientHits = [];
    if (!isClient) {
      try {
        const { data } = await window.db
          .from('clients')
          .select('id, first_name, last_name')
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
          .eq('active', true)
          .limit(5);
        clientHits = (data || []).map(c => ({
          icon:  'user',
          name:  `${c.first_name} ${c.last_name}`,
          sub:   null,
          route: 'clients',
        }));
      } catch { /* ignore — table RLS or network failure */ }
    }

    render([
      { label: 'Modules', items: moduleHits },
      { label: 'Clients', items: clientHits },
    ]);
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => search(input.value), 280);
  });

  input.addEventListener('keydown', e => {
    const all = items();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocus(Math.min(focusedIdx + 1, all.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus(Math.max(focusedIdx - 1, 0));
    } else if (e.key === 'Enter') {
      if (focusedIdx >= 0 && all[focusedIdx]) {
        e.preventDefault();
        navigate(all[focusedIdx].dataset.route);
      }
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    }
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) search(input.value);
  });

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) close();
  });
})();
