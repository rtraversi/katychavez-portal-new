'use strict';

// Wrapped in an IIFE so nothing leaks to the global scope. The router
// (js/menu.js) re-appends this <script> on every navigation to #home, so the
// file must be safe to run more than once per page session. A top-level `const`
// in shared global scope throws "redeclaration of const" on the second visit —
// which surfaced as the "Something went wrong" banner. Matches the pattern every
// other page script (TasksPage, ClientsPage, …) already uses.
(function () {

// HTML-escape DB-sourced strings (client names, activity titles, task titles)
// before they are interpolated into innerHTML. Hoisted so every widget fn below
// can use it regardless of scope.
function esc(s) {
  return window.Utils?.esc
    ? window.Utils.esc(s)
    : String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Section metadata + order come from MODULE_GROUPS in modules/registry.js —
// the single source of truth shared with the sidebar (js/menu.js). `matter`
// is the client view; staff sections skip it.
const HOME_GROUPS = window.MODULE_GROUPS || {};

const HOME_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>';

(async function HomePage() {
  const sectionsEl = document.getElementById('home-sections');
  const greeting   = document.getElementById('home-greeting');
  if (!sectionsEl) return;

  // Dateline kicker + time-of-day greeting
  const dateline = document.getElementById('home-dateline');
  if (dateline) {
    dateline.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  const hour = new Date().getHours();
  const timeGreet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Enabled premium modules — kicked off before the profile await so the two
  // round-trips overlap
  const enabledPromise = window.db.from('enabled_modules').select('module_key')
    .then(r => r, () => ({ data: [] }));

  const profile = await Auth.getProfile();
  const name    = profile?.first_name;
  greeting.innerHTML = name
    ? `${timeGreet}, <span class="home-greet-name">${esc(name)}</span>.`
    : `${timeGreet}.`;

  const { data: enabledData } = await enabledPromise;
  const enabledPremium = new Set((enabledData || []).map(r => r.module_key));

  const accessible = await Auth.getAccessibleModules('read');
  const isAdmin    = profile?.role?.name === 'Owner';
  const isClient   = profile?.role?.name === 'Client';

  if (isClient) {
    const sub = document.getElementById('home-greet-sub');
    if (sub) sub.textContent = 'Your legal team is on it. Here’s your case at a glance.';
  }

  const ICONS = window.Menu ? window.Menu.icon : null;

  const modules = (window.MODULE_REGISTRY || [])
    .filter(m => accessible.has(m.key))
    .filter(m => !m.staffOnly || !isClient)
    .filter(m => !m.premium || enabledPremium.has(m.key))
    .filter(m => !m.requires || enabledPremium.has(m.requires))
    .filter(m => m.route !== 'home')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (!modules.length) {
    sectionsEl.innerHTML = '<p style="color:var(--color-text-muted);text-align:center">No modules available.</p>';
    return;
  }

  // Fetch live badge counts in parallel — failures silently fall back to static badge
  const db          = window.db;
  const badgeTokens = await Promise.allSettled(
    modules.map(m => m.badgeFn ? m.badgeFn(db) : Promise.resolve(null))
  );
  // Per-module pill text + raw count, precomputed once (see badgeFn contract
  // in modules/registry.js: live badges start with "<count> <word>")
  const pills  = new Map();
  const counts = new Map();
  modules.forEach((m, i) => {
    const t = badgeTokens[i];
    if (t.status !== 'fulfilled' || typeof t.value !== 'string') return;
    const match = t.value.match(/^(\d+)\s+([A-Za-z]+)/);
    if (match) {
      pills.set(m.key, `${match[1]} ${match[2].toLowerCase()}`);
      counts.set(m.key, parseInt(match[1], 10));
    }
  });

  let stagger = 0;
  const tileHTML = (m, hue, hero) => {
    const soon    = m.comingSoon && !isAdmin;
    const icoHtml = ICONS ? ICONS(m.icon || 'file') : '';
    const flat    = icoHtml && !icoHtml.includes('currentColor');
    const pill    = pills.get(m.key) || '';
    const badge   = soon ? '<span class="home-soon-badge">Soon</span>'
                  : pill ? `<span class="home-pill">${pill}</span>` : '';
    const goLabel = (m.badge || 'OPEN →').replace('→', '').trim();
    const go      = soon ? '' : `<span class="home-tile-go">${goLabel} ${HOME_ARROW}</span>`;
    const inner   = hero
      ? `<div class="home-tile-ico${flat ? ' flat' : ''}">${icoHtml}</div>
         <div class="home-hero-body">
           <h3 class="home-tile-name">${m.name}</h3>
           ${m.description ? `<p class="home-tile-desc">${m.description}</p>` : ''}
           ${go}
         </div>`
      : `<div class="home-tile-top">
           <div class="home-tile-ico${flat ? ' flat' : ''}">${icoHtml}</div>
           <h3 class="home-tile-name">${m.name}</h3>
         </div>
         ${m.description ? `<p class="home-tile-desc">${m.description}</p>` : ''}
         ${go}`;
    return `<button
      class="home-tile rise${soon ? ' home-tile--soon' : ''}${hero ? ' home-tile--hero' : ''}"
      style="--c:var(--${hue});--c-tint:var(--${hue}-tint);animation-delay:${(0.14 + (stagger++) * 0.035).toFixed(3)}s"
      data-route="${m.route}"
      data-key="${m.key}"
      data-soon="${soon}"
      type="button"
      aria-label="${m.name}${soon ? ' — coming soon' : ''}">
      ${badge}${inner}
    </button>`;
  };

  // Staff: color-coded sections by registry group. Clients: one "Your Matter"
  // section — My Matter as a full-width hero, remaining modules as guided tiles.
  let html = '';
  let sec = 0;
  if (isClient) {
    const g = HOME_GROUPS.matter || { label: 'Your Matter', hue: 'daily' };
    const tiles = modules.map(m => tileHTML(m, g.hue, m.key === 'client_portal')).join('');
    html = `<section class="home-section">
      <div class="home-section-head rise" style="--sec:var(--${g.hue});animation-delay:.1s">
        <h2>${g.label}</h2><span class="home-rule"></span>
      </div>
      <div class="home-tiles">${tiles}</div>
    </section>`;
  } else {
    html = Object.keys(HOME_GROUPS).filter(key => key !== 'matter').map(key => {
      const g = HOME_GROUPS[key];
      const items = modules.filter(m => m.group === key);
      if (!items.length) return '';
      return `<section class="home-section">
        <div class="home-section-head rise" style="--sec:var(--${g.hue});animation-delay:${(0.1 + (sec++) * 0.03).toFixed(2)}s">
          <h2>${g.label}</h2><span class="home-rule"></span>
        </div>
        <div class="home-tiles">${items.map(m => tileHTML(m, g.hue, false)).join('')}</div>
      </section>`;
    }).join('');
  }
  sectionsEl.innerHTML = html;

  sectionsEl.querySelectorAll('.home-tile').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.soon === 'true') {
        Utils.toast(`${btn.querySelector('.home-tile-name').textContent} — coming soon`, 'info');
        return;
      }
      window.location.hash = btn.dataset.route;
    });
  });

  loadDeskChips(modules, isClient, counts);

  // Docket rail — staff only
  if (!isClient) {
    loadActivityWidget(profile.id);
    loadDeadlinesWidget(profile.id, isAdmin);
    // "Recent Payments" — only when the firm actually runs billing/trust.
    if (modules.some(m => m.key === 'billing' || m.key === 'trust_accounting')) loadPaymentsWidget();
  } else {
    document.getElementById('home-docket')?.remove();
    document.getElementById('home-cols')?.classList.add('home-cols--single');
  }
})();

// ── "On your desk today" chips ───────────────────────────────────────────────
// Chip counts reuse the already-fetched badgeFn counts where possible; only
// the overdue/due-today task splits need their own queries.
async function loadDeskChips(modules, isClient, counts) {
  const el = document.getElementById('home-desk');
  if (!el) return;
  const db  = window.db;
  const has = key => modules.some(m => m.key === key);

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const defs = [];
  if (!isClient) {
    if (has('tasks')) {
      defs.push({
        route: 'tasks', urgent: true,
        label: n => n === 1 ? 'task overdue' : 'tasks overdue',
        q: () => db.from('tasks').select('*', { count: 'exact', head: true })
          .not('due_date', 'is', null).lt('due_date', today)
          .not('status', 'in', '("completed","cancelled")'),
      });
      defs.push({
        route: 'tasks', hue: 'daily',
        label: n => n === 1 ? 'task due today' : 'tasks due today',
        q: () => db.from('tasks').select('*', { count: 'exact', head: true })
          .eq('due_date', today)
          .not('status', 'in', '("completed","cancelled")'),
      });
    }
    if (has('uploads')) {
      defs.push({
        route: 'uploads', hue: 'intake', key: 'uploads',
        label: n => n === 1 ? 'document pending review' : 'documents pending review',
      });
    }
    if (has('messaging')) {
      defs.push({
        route: 'messaging', hue: 'daily', key: 'messaging',
        label: n => n === 1 ? 'unread message' : 'unread messages',
      });
    }
    if (has('billing')) {
      defs.push({
        route: 'billing', hue: 'money', key: 'billing',
        label: n => n === 1 ? 'draft invoice to send' : 'draft invoices to send',
      });
    }
    if (has('scheduling')) {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const dayEnd   = new Date(dayStart.getTime() + 86400000);
      defs.push({
        route: 'scheduling', hue: 'intake',
        label: n => n === 1 ? 'consultation today' : 'consultations today',
        q: () => db.from('appointments').select('*', { count: 'exact', head: true })
          .eq('status', 'booked')
          .gte('starts_at', dayStart.toISOString()).lt('starts_at', dayEnd.toISOString()),
      });
    }
  } else if (has('uploads')) {
    // badgeFn count is RLS-scoped to the client's own matter
    defs.push({
      route: 'uploads', hue: 'intake', key: 'uploads',
      label: n => n === 1 ? 'document requested from you' : 'documents requested from you',
    });
  }
  if (!defs.length) return;

  const results = await Promise.allSettled(defs.map(def => def.q ? def.q() : Promise.resolve(null)));
  const chips = defs.map((def, i) => {
    let n;
    if (def.q) {
      const r = results[i];
      n = (r.status === 'fulfilled' && r.value && !r.value.error) ? (r.value.count || 0) : 0;
    } else {
      n = counts.get(def.key) || 0;
    }
    if (!n) return '';
    return `<button type="button"
      class="home-desk-chip${def.urgent ? ' urgent' : ''}"
      ${def.hue ? `style="--chip:var(--${def.hue})"` : ''}
      data-route="${def.route}"
      aria-label="${n} ${def.label(n)} — open ${def.route}">
      <span class="n">${n}</span> ${def.label(n)}
    </button>`;
  }).join('');

  if (!chips) return;
  el.innerHTML = chips;
  el.hidden = false;
  el.querySelectorAll('.home-desk-chip').forEach(btn => {
    btn.addEventListener('click', () => { window.location.hash = btn.dataset.route; });
  });
}

// ── Docket rail widgets ──────────────────────────────────────────────────────

// Route → section hue, for activity dots
function hueForRoute(route) {
  if (!route) return 'daily';
  const m = (window.MODULE_REGISTRY || []).find(m => route === m.route || route.startsWith(m.route + '/'));
  return (m && HOME_GROUPS[m.group]) ? HOME_GROUPS[m.group].hue : 'daily';
}

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
      <div class="home-act-item">
        <span class="home-act-dot" style="--dot:var(--${hueForRoute(item.link_route)})"></span>
        <span class="home-act-body">
          <span class="home-act-title">${esc(item.title)}</span>
          <span class="home-act-meta">${timeAgo(item.created_at)}</span>
        </span>
      </div>`
    ).join('');

    const viewAll = showViewAll && data.length === limit
      ? `<button type="button" id="activity-view-all" class="home-view-all">View all recent history</button>`
      : '';

    el.innerHTML = items + viewAll;

    if (showViewAll) {
      document.getElementById('activity-view-all')?.addEventListener('click', () => {
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
      const due  = new Date(task.due_date + 'T00:00:00');
      const days = Math.round((due - today) / 86400000);
      let cls = '', label = `${days}d`;
      if (days < 0)        { cls = 'overdue'; label = 'Overdue'; }
      else if (days === 0) { cls = 'today';   label = 'Today'; }
      else if (days === 1) { cls = 'today';   label = 'Tmrw'; }

      const client = task.matters?.clients;
      const clientLabel = client ? `${client.first_name} ${client.last_name}` : '';

      return `<div class="home-dl-item">
        <span class="home-dl-bar${cls ? ' ' + cls : ''}"></span>
        <span class="home-dl-body">
          <span class="home-dl-title">${esc(task.title)}</span>
          ${clientLabel ? `<span class="home-dl-meta">${esc(clientLabel)}</span>` : ''}
        </span>
        <span class="home-dl-due${cls ? ' ' + cls : ''}">${label}</span>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = '<p class="home-widget-placeholder">Could not load deadlines.</p>';
  }
}

// ── "Recent Payments" widget ─────────────────────────────────────────────────
// Clients who have paid — merges paid retainer requests and paid invoices, most
// recent first. Staff-only (gated on billing/trust access by the caller); both
// queries are RLS-scoped, so a firm without the trust module just sees invoices.
async function loadPaymentsWidget() {
  const el = document.getElementById('payments-list');
  if (!el) return;
  const db = window.db;
  const nameOf = (row, fallback) => {
    const c = row.matters?.clients;
    const n = c ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : '';
    return n || fallback || 'Client';
  };
  const money = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    const [retRes, invRes] = await Promise.all([
      db.from('retainer_requests')
        .select('amount, paid_at, client_name, matters(clients(first_name, last_name))')
        .eq('status', 'paid').not('paid_at', 'is', null)
        .order('paid_at', { ascending: false }).limit(8),
      db.from('invoices')
        .select('amount, paid_at, matters(clients(first_name, last_name))')
        .eq('status', 'paid').not('paid_at', 'is', null)
        .order('paid_at', { ascending: false }).limit(8),
    ]);

    const items = [];
    (retRes.data || []).forEach(r => items.push({ name: nameOf(r, r.client_name), amount: r.amount, when: r.paid_at, kind: 'Retainer' }));
    (invRes.data || []).forEach(i => items.push({ name: nameOf(i), amount: i.amount, when: i.paid_at, kind: 'Invoice' }));
    items.sort((a, b) => new Date(b.when) - new Date(a.when));
    const top = items.slice(0, 6);

    document.getElementById('home-payments-panel')?.removeAttribute('hidden');
    if (!top.length) {
      el.innerHTML = '<p class="home-widget-placeholder">No payments yet.</p>';
      return;
    }
    el.innerHTML = top.map(p => `
      <div class="home-act-item">
        <span class="home-act-dot" style="--dot:var(--money)"></span>
        <span class="home-act-body">
          <span class="home-act-title">${esc(p.name)} — ${money(p.amount)}</span>
          <span class="home-act-meta">${p.kind} · ${timeAgo(p.when)}</span>
        </span>
      </div>`).join('');
  } catch {
    document.getElementById('home-payments-panel')?.removeAttribute('hidden');
    el.innerHTML = '<p class="home-widget-placeholder">Could not load payments.</p>';
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

})();
