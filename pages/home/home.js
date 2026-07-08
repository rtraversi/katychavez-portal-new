'use strict';

(async function HomePage() {
  const grid     = document.getElementById('home-grid');
  const greeting = document.getElementById('home-greeting');
  if (!grid) return;

  // Time-of-day greeting
  const hour = new Date().getHours();
  greeting.textContent = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const profile = await Auth.getProfile();
  const name    = profile?.first_name;
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

  // Fetch live badge counts in parallel — failures silently fall back to static badge
  const db          = window.db;
  const badgeTokens = await Promise.allSettled(
    modules.map(m => m.badgeFn ? m.badgeFn(db) : Promise.resolve(null))
  );

  grid.innerHTML = modules.map((m, i) => {
    const soon    = m.comingSoon && !isAdmin;
    const icoHtml = ICONS ? ICONS(m.icon || 'file') : '';
    const token   = badgeTokens[i];
    const label   = !soon && ((token.status === 'fulfilled' && token.value) || m.badge);

    return `<button
      class="home-card${soon ? ' home-card--soon' : ''}"
      data-route="${m.route}"
      data-key="${m.key}"
      data-soon="${soon}"
      type="button"
      aria-label="${m.name}${soon ? ' — coming soon' : ''}">
      <div class="home-card-header">
        <div class="home-card-icon">${icoHtml}</div>
        <div class="home-card-name">${m.name}</div>
      </div>
      ${m.description ? `<div class="home-card-desc">${m.description}</div>` : ''}
      ${label        ? `<div class="home-card-action">${label}</div>` : ''}
      ${soon         ? '<span class="home-card-soon">Soon</span>' : ''}
    </button>`;
  }).join('');

  grid.querySelectorAll('.home-card').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.soon === 'true') {
        Utils.toast(`${btn.querySelector('.home-card-name').textContent} — coming soon`, 'info');
        return;
      }
      window.location.hash = btn.dataset.route;
    });
  });

  // Sidebar widgets — hide both for clients
  if (!isClient) {
    loadActivityWidget(profile.id);
    loadDeadlinesWidget(profile.id, isAdmin);
  } else {
    document.getElementById('activity-list')?.closest('.home-widget')?.remove();
    document.getElementById('deadlines-list')?.closest('.home-widget')?.remove();
  }
})();

async function loadActivityWidget(userId, { limit = 4, showViewAll = true } = {}) {
  const el = document.getElementById('activity-list');
  if (!el) return;
  try {
    const { data, error } = await window.db
      .from('activity_log')
      .select('title, created_at, link_route')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    if (!data || !data.length) {
      el.innerHTML = '<p class="home-widget-placeholder">No recent activity.</p>';
      return;
    }

    const items = data.map(item => `
      <div class="activity-item">
        <span class="activity-title">${item.title}</span>
        <span class="activity-meta">${timeAgo(item.created_at)}</span>
      </div>`
    ).join('');

    const viewAll = showViewAll && data.length === limit
      ? `<a id="activity-view-all" href="#" style="display:block;margin-top:8px;font-size:var(--text-sm);color:var(--color-primary);text-align:center;text-decoration:none">View all recent history</a>`
      : '';

    el.innerHTML = items + viewAll;

    if (showViewAll) {
      document.getElementById('activity-view-all')?.addEventListener('click', e => {
        e.preventDefault();
        loadActivityWidget(userId, { limit: 100, showViewAll: false });
      });
    }
  } catch {
    el.innerHTML = '<p class="home-widget-placeholder">Could not load activity.</p>';
  }
}

async function loadDeadlinesWidget(userId, isOwner) {
  const el = document.getElementById('deadlines-list');
  if (!el) return;
  try {
    let q = window.db
      .from('tasks')
      .select('id, title, due_date, matter_id, matters(case_type, clients(first_name, last_name))')
      .not('due_date', 'is', null)
      .not('status', 'in', '("completed","cancelled")')
      .order('due_date', { ascending: true })
      .limit(7);

    if (!isOwner) {
      q = q.eq('assigned_to', userId);
    }

    const { data, error } = await q;
    if (error) throw error;

    if (!data || !data.length) {
      el.innerHTML = '<p class="home-widget-placeholder">No upcoming deadlines.</p>';
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    el.innerHTML = data.map(task => {
      const due = new Date(task.due_date + 'T00:00:00');
      const days = Math.round((due - today) / 86400000);
      let cls = '', label = `${days}d`;
      if (days < 0)      { cls = 'overdue'; label = 'Overdue'; }
      else if (days === 0) { cls = 'today'; label = 'Today'; }
      else if (days === 1) { label = 'Tmrw'; cls = 'soon'; }
      else if (days <= 3)  { cls = 'soon'; }

      const client = task.matters?.clients;
      const clientLabel = client ? `${client.first_name} ${client.last_name}` : '';

      return `<div class="deadline-item${cls ? ' deadline-item--' + cls : ''}">
        <div class="deadline-info">
          <div class="deadline-title">${task.title}</div>
          ${clientLabel ? `<div class="deadline-client">${clientLabel}</div>` : ''}
        </div>
        <span class="deadline-badge">${label}</span>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = '<p class="home-widget-placeholder">Could not load deadlines.</p>';
  }
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
