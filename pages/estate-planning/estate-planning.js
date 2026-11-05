'use strict';

// Estate Planning overview: every questionnaire request, newest first, split into
// "ready to review" (submitted) and "waiting on the client" (open links). Reads
// ep_intake_requests through RLS (can_read('estate_planning')); a row click opens
// the client card, where the Estate Planning tab does the work.
(async function EstatePlanningPage() {
  const esc = (s) => Utils.esc(s == null ? '' : String(s));

  const { data, error } = await db.from('ep_intake_requests')
    .select('id, matter_id, language, sent_at, expires_at, revoked_at, opened_at, draft_saved_at, submitted_at, answers_updated_at, token_hash, matter:matters(id, client_id, client:clients(id, first_name, last_name))')
    .order('sent_at', { ascending: false })
    .limit(500);

  const readyEl = document.getElementById('ep-list-ready');
  const openEl  = document.getElementById('ep-list-open');
  if (error) {
    readyEl.innerHTML = `<p class="dk-empty" style="color:var(--color-danger)">Could not load questionnaires.</p>`;
    openEl.innerHTML = '';
    return;
  }

  // One line per matter: its most recent request.
  const now = new Date();
  const seen = new Set();
  // Staff-entered answers (POST /api/ep-intake/enter) carry 'staff:' in token_hash —
  // see _ep-common.js. Keep only that flag; the hash itself is never needed here.
  const rows = (data || []).map(({ token_hash, ...r }) => ({ ...r, staff: String(token_hash || '').startsWith('staff:') }));
  const latest = rows.filter(r => (seen.has(r.matter_id) ? false : seen.add(r.matter_id)));
  const ready = latest.filter(r => r.submitted_at);
  const open  = latest.filter(r => !r.submitted_at && !r.revoked_at && new Date(r.expires_at) >= now);

  const name = (r) => Utils.fullName(r.matter?.client) || 'Client';
  const row = (r, meta, tag) => `
    <div class="dk-reg-row" data-client="${esc(r.matter?.client_id || '')}" style="cursor:pointer">
      <div><div class="dk-reg-title">${esc(name(r))} ${tag || ''}</div><div class="dk-reg-meta">${meta}</div></div>
      <div class="dk-reg-act"><button class="dk-linkbtn" type="button">Open client</button></div>
    </div>`;

  readyEl.innerHTML = ready.length ? `<div class="dk-register">${ready.map(r => row(r,
    `${r.staff ? 'Entered by staff' : 'Submitted'} ${esc(Utils.formatDateTime(r.submitted_at))}${r.answers_updated_at ? '<span class="sep">·</span>edited by staff' : ''}`,
    r.staff || r.answers_updated_at ? DK.tag('Reviewed', 'ok') : DK.tag('New', 'acc'))).join('')}</div>`
    : '<p class="dk-empty">No submitted questionnaires yet.</p>';

  openEl.innerHTML = open.length ? `<div class="dk-register">${open.map(r => row(r,
    [`Sent ${esc(Utils.formatDate(r.sent_at))}`,
     r.draft_saved_at ? `saved progress ${esc(Utils.formatDate(r.draft_saved_at))}` : r.opened_at ? 'opened, nothing saved yet' : 'not opened yet',
     `expires ${esc(Utils.formatDate(r.expires_at))}`, r.language === 'es' ? 'Español' : ''].filter(Boolean).join('<span class="sep">·</span>'),
    r.draft_saved_at ? DK.tag('In progress', 'warn') : '')).join('')}</div>`
    : '<p class="dk-empty">No open links.</p>';

  document.getElementById('ep-count-ready').textContent = ready.length ? String(ready.length) : '';
  document.getElementById('ep-count-open').textContent = open.length ? String(open.length) : '';
  document.getElementById('ep-deskbar').innerHTML = DK.deskbar([
    { n: ready.filter(r => !r.staff && !r.answers_updated_at).length, label: 'new submissions', jump: 'ep-sec-ready' },
    { n: open.length, label: 'waiting on clients', jump: 'ep-sec-open', tone: open.length ? 'warn' : '' },
  ]);
  DK.wireDeskbar && DK.wireDeskbar();

  document.querySelectorAll('[data-client]').forEach(el => el.addEventListener('click', () => {
    if (!el.dataset.client) return;
    window._clientDetailId = el.dataset.client;
    window.location.hash = '#clients/detail';
  }));
})();
