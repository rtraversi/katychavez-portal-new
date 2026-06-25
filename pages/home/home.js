'use strict';

(async function HomePage() {
  const grid     = document.getElementById('home-grid');
  const greeting = document.getElementById('home-greeting');
  if (!grid) return;

  // Time-of-day greeting
  const hour = new Date().getHours();
  greeting.textContent = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const profile = await Auth.getProfile();
  const name    = profile?.full_name?.split(' ')[0];
  if (name) greeting.textContent += `, ${name}`;

  // Load enabled premium modules
  let enabledPremium = new Set();
  try {
    const { data } = await window.db.from('enabled_modules').select('module_key');
    enabledPremium = new Set((data || []).map(r => r.module_key));
  } catch { /* ignore */ }

  const accessible = await Auth.getAccessibleModules('read');
  const isAdmin    = profile?.role?.name === 'Owner';
  const isClient   = profile?.role?.name === 'Client';

  const ICONS = window.Menu ? window.Menu.icon : null;

  const modules = (window.MODULE_REGISTRY || [])
    .filter(m => accessible.has(m.key))
    .filter(m => !m.staffOnly || !isClient)
    .filter(m => !m.premium || enabledPremium.has(m.key))
    .filter(m => !m.requires || enabledPremium.has(m.requires))
    .filter(m => m.route !== 'home')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (!modules.length) {
    grid.innerHTML = '<p style="color:var(--color-text-muted);grid-column:1/-1;text-align:center">No modules available.</p>';
    return;
  }

  grid.innerHTML = modules.map(m => {
    const soon  = m.comingSoon && !isAdmin;
    const icoHtml = ICONS ? ICONS(m.icon || 'file') : '';
    const badge = soon ? '<span class="home-tile-soon">Soon</span>' : '';
    return `<button
      class="home-tile${soon ? ' home-tile--soon' : ''}"
      data-route="${m.route}"
      data-key="${m.key}"
      data-soon="${soon}"
      type="button"
      aria-label="${m.name}${soon ? ' — coming soon' : ''}">
      <span class="home-tile-icon">${icoHtml}</span>
      <span class="home-tile-name">${m.name}</span>
      ${badge}
    </button>`;
  }).join('');

  grid.querySelectorAll('.home-tile').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.soon === 'true') {
        Utils.toast(`${btn.querySelector('.home-tile-name').textContent} — coming soon`, 'info');
        return;
      }
      window.location.hash = btn.dataset.route;
    });
  });
})();
