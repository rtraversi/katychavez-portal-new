'use strict';

// Dashboard — morning triage view.
// Widgets are defined in WIDGETS array; order here = display order.
// Future: read widget order/visibility from user preferences table.

(async function DashboardPage() {

  const profile = await Auth.getProfile();
  const firstName = profile?.first_name || 'there';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('dash-greeting').textContent = `${greeting}, ${firstName}.`;
  document.getElementById('dash-date').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const btn = document.getElementById('btn-refresh-dash');
  btn.addEventListener('click', () => load());

  await load();

  async function load() {
    btn.disabled = true;
    try {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const now     = new Date().toISOString();

      const [
        overdueRes, missingRes, unreadRes, pendingRes,
        clientRes, openTaskRes, docsWeekRes, msgsWeekRes,
      ] = await Promise.all([

        // Overdue tasks
        db.from('tasks')
          .select('id,title,due_date,priority,client:clients(first_name,last_name)')
          .in('status', ['pending', 'in_progress'])
          .not('due_date', 'is', null)
          .lt('due_date', now)
          .order('due_date', { ascending: true })
          .limit(5),

        // Missing docs (checklist placeholders not yet uploaded)
        db.from('documents')
          .select('id,name,matter:matters(id,client:clients(first_name,last_name))')
          .like('r2_key', 'pending/%')
          .is('deleted_at', null)
          .order('created_at', { ascending: true })
          .limit(5),

        // Unread inbound messages (from clients, not yet read by staff)
        db.from('messages')
          .select('id,body,created_at,conversation:conversations(id,client:clients(first_name,last_name))')
          .eq('direction', 'inbound')
          .is('read_at', null)
          .order('created_at', { ascending: false })
          .limit(5),

        // Pending signature requests
        db.from('signature_requests')
          .select('id,status,created_at,matter:matters(id,client:clients(first_name,last_name))')
          .in('status', ['pending_client', 'pending_attorney'])
          .order('created_at', { ascending: false })
          .limit(5),

        // Active clients (count)
        db.from('clients').select('id', { count: 'exact', head: true }).eq('active', true),

        // Open tasks (count)
        db.from('tasks').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']),

        // Docs uploaded this week (real uploads only, not placeholders)
        db.from('documents')
          .select('id', { count: 'exact', head: true })
          .not('r2_key', 'like', 'pending/%')
          .is('deleted_at', null)
          .gte('created_at', weekAgo),

        // Messages this week
        db.from('messages').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
      ]);

      renderGrid(
        overdueRes.data  || [],
        missingRes.data  || [],
        unreadRes.data   || [],
        pendingRes.data  || [],
      );

      renderStats({
        clients:   clientRes.count   ?? 0,
        openTasks: openTaskRes.count ?? 0,
        docsWeek:  docsWeekRes.count ?? 0,
        msgsWeek:  msgsWeekRes.count ?? 0,
      });
    } finally {
      btn.disabled = false;
    }
  }

  // ── Attention grid ───────────────────────────────────────────────────────────

  function renderGrid(overdue, missing, unread, pending) {
    const grid = document.getElementById('dash-attention-grid');

    const WIDGETS = [
      {
        accent: 'var(--color-danger)',
        icon:   iconPath('<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'),
        title:  'Overdue Tasks',
        route:  'tasks',
        items:  overdue,
        empty:  'No overdue tasks',
        row:    t => `
          <div class="dash-item">
            <div class="dash-item-main">
              <span class="dash-item-name">${esc(clientName(t.client))}</span>
              <span class="dash-item-sub">${esc(t.title)}</span>
            </div>
            <span class="dash-badge dash-badge--danger">${overdueLabel(t.due_date)}</span>
          </div>`,
      },
      {
        accent: 'var(--color-warning)',
        icon:   iconPath('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
        title:  'Missing Documents',
        route:  'uploads',
        items:  missing,
        empty:  'All documents received',
        row:    d => `
          <div class="dash-item">
            <div class="dash-item-main">
              <span class="dash-item-name">${esc(clientName(d.matter?.client))}</span>
              <span class="dash-item-sub">${esc(d.name)}</span>
            </div>
          </div>`,
      },
      {
        accent: 'var(--color-primary)',
        icon:   iconPath('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
        title:  'Unread Messages',
        route:  'messaging',
        items:  unread,
        empty:  'No unread messages',
        row:    m => `
          <div class="dash-item">
            <div class="dash-item-main">
              <span class="dash-item-name">${esc(clientName(m.conversation?.client))}</span>
              <span class="dash-item-sub">${esc(truncate(m.body, 55))}</span>
            </div>
            <span class="dash-time">${relTime(m.created_at)}</span>
          </div>`,
      },
      {
        accent: '#7c3aed',
        icon:   iconPath('<path d="m12 19 7-7 3 3-7 7-3-3z"/><path d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="m2 2 7.586 7.586"/><circle cx="11" cy="11" r="2"/>'),
        title:  'Pending Signatures',
        route:  'esign',
        items:  pending,
        empty:  'No pending signatures',
        row:    s => `
          <div class="dash-item">
            <div class="dash-item-main">
              <span class="dash-item-name">${esc(clientName(s.matter?.client))}</span>
              <span class="dash-item-sub">${sigLabel(s.status)}</span>
            </div>
          </div>`,
      },
    ];

    grid.innerHTML = WIDGETS.map(w => card(w)).join('');

    // Wire header clicks + view-all buttons to route
    grid.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', () => { window.location.hash = el.dataset.nav; });
    });
  }

  function card({ accent, icon, title, route, items, empty, row }) {
    const count    = items.length;
    const hasItems = count > 0;
    const body     = hasItems
      ? items.map(row).join('') +
        `<button class="dash-view-all" data-nav="${route}">View all →</button>`
      : `<div class="dash-empty">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="color:var(--color-success);flex-shrink:0" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
           <span>${empty}</span>
         </div>`;

    return `
      <div class="dash-card" style="--card-accent:${accent}">
        <div class="dash-card-header" data-nav="${route}" title="Go to ${title}">
          <span class="dash-card-icon">${icon}</span>
          <span class="dash-card-title">${title}</span>
          ${hasItems ? `<span class="dash-card-count" style="background:${accent}">${count === 5 ? '5+' : count}</span>` : ''}
        </div>
        <div class="dash-card-body">${body}</div>
      </div>`;
  }

  // ── Stats row ────────────────────────────────────────────────────────────────

  function renderStats({ clients, openTasks, docsWeek, msgsWeek }) {
    document.getElementById('dash-stats-row').innerHTML = [
      { value: clients,   label: 'Active Clients',    sub: 'total in system' },
      { value: openTasks, label: 'Open Tasks',         sub: 'pending or in progress' },
      { value: docsWeek,  label: 'Docs This Week',     sub: 'uploaded last 7 days' },
      { value: msgsWeek,  label: 'Messages This Week', sub: 'sent & received' },
    ].map(s => `
      <div class="dash-stat">
        <span class="dash-stat-value">${s.value}</span>
        <span class="dash-stat-label">${s.label}</span>
        <span class="dash-stat-sub">${s.sub}</span>
      </div>`).join('');
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function clientName(c) {
    if (!c) return 'Unknown client';
    return `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown client';
  }

  function overdueLabel(due) {
    if (!due) return 'Overdue';
    const days = Math.floor((Date.now() - new Date(due).getTime()) / 86400000);
    if (days <= 0) return 'Today';
    return days === 1 ? '1 day' : `${days} days`;
  }

  function sigLabel(status) {
    return status === 'pending_client' ? 'Awaiting client signature' : 'Awaiting attorney counter-sign';
  }

  function relTime(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  function truncate(str, n) {
    return str && str.length > n ? str.slice(0, n) + '…' : (str || '');
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function iconPath(path) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true">${path}</svg>`;
  }

})();
