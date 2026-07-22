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
        clientRes, openTaskRes, docsWeekRes, msgsWeekRes, apptRes,
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

        // Upcoming appointments (scheduling module; errors if not installed → chip hidden)
        db.from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'booked')
          .gte('starts_at', now),
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
        appts:     apptRes.error ? null : (apptRes.count ?? 0),
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
        title: 'Overdue Tasks',
        route: 'tasks',
        hue:   'var(--color-danger)', tint: 'var(--color-danger-bg)',
        items: overdue,
        empty: 'No overdue tasks',
        row:   t => regRow(
          clientName(t.client), esc(t.title),
          `<span class="dk-tag crit">${overdueLabel(t.due_date)}</span>`,
        ),
      },
      {
        title: 'Missing Documents',
        route: 'uploads',
        hue:   'var(--color-warning)', tint: 'var(--color-warning-bg)',
        items: missing,
        empty: 'All documents received',
        row:   d => regRow(
          clientName(d.matter?.client), esc(d.name),
          `<span class="dk-tag warn">Missing</span>`,
        ),
      },
      {
        title: 'Unread Messages',
        route: 'messaging',
        hue:   'var(--daily)', tint: 'var(--daily-tint)',
        items: unread,
        empty: 'No unread messages',
        row:   m => regRow(
          clientName(m.conversation?.client), esc(truncate(m.body, 55)),
          `<span class="dk-reg-meta" style="margin-top:0;white-space:nowrap;color:var(--ink-faint)">${relTime(m.created_at)}</span>`,
        ),
      },
      {
        title: 'Pending Signatures',
        route: 'esign',
        hue:   'var(--horizon)', tint: 'var(--horizon-tint)',
        items: pending,
        empty: 'No pending signatures',
        row:   s => regRow(
          clientName(s.matter?.client), esc(sigLabel(s.status)),
          `<span class="dk-tag acc">Pending</span>`,
        ),
      },
    ];

    grid.innerHTML = WIDGETS.map(w => card(w)).join('');

    // Wire view-all buttons to route
    grid.querySelectorAll('[data-nav]').forEach(el => {
      el.addEventListener('click', () => { window.location.hash = el.dataset.nav; });
    });
  }

  // One register record: serif client name + supporting line + a right-side status.
  function regRow(title, sub, right) {
    return `
      <div class="dk-reg-row">
        <div style="min-width:0">
          <div class="dk-reg-title"><span>${esc(title)}</span></div>
          <div class="dk-reg-meta"><span>${sub}</span></div>
        </div>
        <div class="dk-reg-act">${right}</div>
      </div>`;
  }

  function card({ title, route, items, empty, row, hue, tint }) {
    const count    = items.length;
    const hasItems = count > 0;

    const head = `
      <div class="dk-sec-head">
        <h2>${title}</h2>
        <span class="dk-sec-rule"></span>
        ${hasItems ? `<span class="dk-sec-count">${count === 5 ? '5+' : count}</span>
          <button class="dk-sec-add" type="button" data-nav="${route}">View all →</button>` : ''}
      </div>`;

    const body = hasItems
      ? `<div class="dk-register">${items.map(row).join('')}</div>`
      : `<div class="dk-register"><div class="dk-empty" style="display:flex;align-items:center;gap:8px;color:var(--ink-soft)">
           <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5" width="15" height="15" style="flex:none" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
           <span>${empty}</span>
         </div></div>`;

    return `<section class="dash-widget" style="--hue:${hue};--hue-tint:${tint}">${head}${body}</section>`;
  }

  // ── At a glance — desk-chip strip ────────────────────────────────────────────

  function renderStats({ clients, openTasks, docsWeek, msgsWeek, appts }) {
    const chips = [
      { n: clients,   label: 'Active Clients',      hue: 'daily'   },
      { n: openTasks, label: 'Open Tasks',          hue: 'money'   },
      { n: docsWeek,  label: 'Docs This Week',      hue: 'docs'    },
      { n: msgsWeek,  label: 'Messages This Week',  hue: 'horizon' },
    ];
    if (appts !== null && appts !== undefined) chips.push({ n: appts, label: 'Upcoming Appointments', hue: 'intake' });
    document.getElementById('dash-stats-row').innerHTML =
      `<div class="dk-deskbar">` +
      chips.map(c => `<span class="dk-chip static"><span class="n" style="background:var(--${c.hue}-tint);color:var(--${c.hue})">${c.n}</span> ${esc(c.label)}</span>`).join('') +
      `</div>`;
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

})();
