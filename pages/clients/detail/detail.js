// Client detail page — loaded via #clients/detail route.
// Requires window._clientDetailId set by clients.js before navigation.
'use strict';

(async function ClientDetailPage() {

  const clientId = window._clientDetailId;
  if (!clientId) { window.location.hash = '#clients'; return; }

  // ── State ───────────────────────────────────────────────────────────────────
  let client  = null;
  let matter  = null;
  let oppParty = null;
  let jointSponsor = null; // second opposing_parties row, party_role='joint_sponsor' (immigration, I-864)
  let children = [];
  let otherPeople = [];   // client_contacts — guarantors / additional payers
  let financial = null;
  let keyDates          = [];
  let users             = [];
  let clientRates       = [];    // billing_rates rows for this client (hero "Rates" strip)
  let trustBalance      = 0;     // current trust/retainer balance (hero green pill)
  let _calPendingDateId = null;  // tracks which key_date is being added to calendar

  let practiceAreas    = [];
  let caseTypesData    = [];
  let practiceAreaMap  = new Map();  // id → practice_area row
  let caseTypeMap      = new Map();  // id → case_type row
  let piDetails        = null;       // client_personal_injury row
  let criminalDetails  = null;       // client_criminal row
  let immigrationData  = null;       // client_immigration row
  let immigrationFamilyMembers = []; // client_immigration_family_members rows
  let enabledImmCaseTypes = new Set(); // enabled_immigration_case_types keys
  let storageSyncEnabled  = false;   // enabled_modules row for 'storage_sync'
  let officeEditEnabled   = false;   // enabled_modules row for 'office_edit' (Edit in Word)

  // "Import from Storage" modal state (Files tab)
  let _siCandidates = [];   // candidates from the last GET /api/storage-sync-import-client
  let _siMatters    = [];   // matters from the same response
  let _siPollTimer  = null; // in-flight continueJob poll timeout
  let _siRunning    = false; // true while an import job is in flight (blocks outside-click close)

  let _stageList    = [];   // workflow_stages for this matter's practice area
  let _currentStage = null; // the stage object matching matter.current_stage_id

  const DATE_TYPES = [
    ['marriage',     'Marriage'],
    ['separation',   'Separation'],
    ['divorce_final','Divorce Final'],
    ['filing',       'Filing'],
    ['hearing',      'Hearing'],
    ['mediation',    'Mediation'],
    ['deposition',   'Deposition'],
    ['trial',        'Trial'],
    ['deadline',     'Deadline'],
    ['custom',       'Custom'],
    ['service',      'Respondent Served'],
  ];

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function val(v, fmt) {
    if (v == null || v === '') return '<span class="val empty">—</span>';
    if (fmt === 'date') return `<span class="val">${Utils.formatDate(v)}</span>`;
    if (fmt === 'bool') return `<span class="val">${v ? 'Yes' : 'No'}</span>`;
    if (fmt === 'money') return `<span class="val">$${Number(v).toLocaleString('en-US', {minimumFractionDigits:2})}</span>`;
    if (fmt === 'phone') return `<span class="val"><a href="tel:${Utils.esc(v)}">${Utils.esc(v)}</a></span>`;
    return `<span class="val">${Utils.esc(String(v))}</span>`;
  }

  function field(label, v, fmt) {
    return `<div class="detail-field"><label>${Utils.esc(label)}</label>${val(v, fmt)}</div>`;
  }

  function caseTypeLabel(id) {
    if (!id) return null;
    const ct = caseTypeMap.get(id);
    if (ct) return ct.name;
    // Fallback for old text enum values stored in matter.case_type
    const LEGACY = {
      divorce: 'Divorce', sapcr_original: 'SAPCR – Original', sapcr_modification: 'SAPCR – Modification',
      enforcement: 'Enforcement', custody: 'Custody', custody_modification: 'Custody Modification',
      child_support: 'Child Support', child_support_modification: 'Child Support Modification',
      paternity: 'Paternity', prenuptial_agreement: 'Prenuptial Agreement',
      postnuptial_agreement: 'Postnuptial Agreement', protective_order: 'Protective Order',
      adoption: 'Adoption', other: 'Other',
    };
    return LEGACY[id] || Utils.titleCase(id);
  }

  function practiceAreaLabel(id) {
    if (!id) return null;
    return practiceAreaMap.get(id)?.name || null;
  }

  function matterCaseTypeKey() {
    if (matter?.case_type_id) return caseTypeMap.get(matter.case_type_id)?.key || matter?.case_type;
    return matter?.case_type || null;
  }

  function isPF() { return matterCaseTypeKey() === 'parenting_facilitation'; }
  // In immigration matters the client is the beneficiary; the second person on
  // the matter is the petitioner (sponsor), not an adversary.
  function isImmMatter() { return matterPracticeAreaKey() === 'immigration'; }
  function party2Label() {
    if (isImmMatter()) return 'Petitioner';
    return isPF() ? 'Party 2' : 'Opposing Party';
  }

  function matterPracticeAreaKey() {
    if (matter?.practice_area_id) return practiceAreaMap.get(matter.practice_area_id)?.key || null;
    return null;
  }

  function userName(id) {
    const u = users.find(u => u.id === id);
    return u ? Utils.fullName(u) : null;
  }

  function setGrid(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  // ── Function caller (Netlify functions) ──────────────────────────────────────

  async function callFunction(endpoint, body) {
    let res;
    try {
      const session = await Auth.getSession();
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      });
    } catch { throw new Error('Network error — check your connection and try again.'); }

    if (res.status === 401) {
      sessionStorage.setItem('login_message', 'Your session expired. Please log in again.');
      setTimeout(() => window.location.replace('/'), 1200);
      throw new Error('Your session has expired. Redirecting to login…');
    }

    const rawText = await res.text();
    if (res.status >= 500 && !rawText.trimStart().startsWith('{')) {
      throw new Error('A temporary service interruption occurred. Please wait a moment and try again.');
    }
    let data;
    try { data = JSON.parse(rawText); }
    catch { throw new Error(`Unexpected server response (${res.status}). Please try again.`); }
    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
    return data;
  }

  // ── SSN field helper ─────────────────────────────────────────────────────────

  function ssnField(entityType, entityId, last4, entityLabel) {
    const displayId = `ssn-val-${entityId}`;
    const eyeSvg  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const editSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    return `<div class="detail-field">
      <label>SSN</label>
      <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
        <span id="${displayId}">${last4 ? `<span class="val">●●●–●●–${Utils.esc(last4)}</span>` : `<span class="val empty">—</span>`}</span>
        ${last4 ? `<button class="btn btn--ghost btn--sm btn-reveal-ssn" data-entity-type="${entityType}" data-entity-id="${entityId}" data-display-id="${displayId}" title="Reveal full SSN (access is logged)">${eyeSvg}</button>` : ''}
        <button class="btn btn--ghost btn--sm btn-edit-ssn" data-entity-type="${entityType}" data-entity-id="${entityId}" data-entity-label="${Utils.esc(entityLabel || '')}" title="${last4 ? 'Update SSN' : 'Enter SSN'}">${editSvg}</button>
      </div>
    </div>`;
  }

  // ── Load data ────────────────────────────────────────────────────────────────

  async function loadAll() {
    // Loading a (new) client's matter — drop any cached trust-tab state so the
    // Trust Ledger doesn't show the previously-viewed matter's balance/retainers.
    // (The trust subtab caches on _trustLoaded; action handlers reset it, but a
    // client switch must too — otherwise e.g. "Firm Admin Time" retainers linger
    // on the next client's card.)
    _trustLoaded    = false;
    _trustRetainers = [];
    _trustInvoices  = [];

    const [
      { data: c },
      { data: u },
      { data: pa },
      { data: ct },
      { data: enabledPa },
      { data: immEnabled },
      { data: ssRow },
      { data: oeRow },
    ] = await Promise.all([
      db.from('clients').select('*').eq('id', clientId).single(),
      db.from('users').select('id, first_name, last_name, roles(name)').eq('active', true).order('first_name'),
      db.from('practice_areas').select('*').order('sort_order'),
      db.from('case_types').select('*').order('sort_order'),
      db.from('enabled_practice_areas').select('practice_area_key'),
      db.from('enabled_immigration_case_types').select('sub_tab_key'),
      db.from('enabled_modules').select('module_key').eq('module_key', 'storage_sync').maybeSingle(),
      db.from('enabled_modules').select('module_key').eq('module_key', 'office_edit').maybeSingle(),
    ]);
    enabledImmCaseTypes = new Set((immEnabled || []).map(r => r.sub_tab_key));
    storageSyncEnabled  = !!ssRow;
    officeEditEnabled   = !!oeRow;

    client        = c;
    users         = u || [];
    const enabledPaKeys = new Set((enabledPa || []).map(r => r.practice_area_key));
    practiceAreas = (pa || []).filter(p => enabledPaKeys.has(p.key));
    caseTypesData = ct || [];
    practiceAreaMap = new Map(practiceAreas.map(p => [p.id, p]));
    caseTypeMap     = new Map(caseTypesData.map(t => [t.id, t]));

    if (!client) { Utils.toast('Client not found.', 'error'); return; }

    const { data: m } = await db
      .from('matters')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at')
      .limit(1)
      .maybeSingle();

    matter = m;

    if (matter) {
      const [
        { data: op },
        { data: ch },
        { data: fi },
        { data: kd },
        { data: pi },
        { data: crim },
        { data: imm },
        { data: immFam },
      ] = await Promise.all([
        db.from('opposing_parties').select('*').eq('matter_id', matter.id).order('created_at'),
        db.from('children').select('*').eq('matter_id', matter.id).order('dob'),
        db.from('financial_info').select('*').eq('matter_id', matter.id).maybeSingle(),
        db.from('key_dates').select('*').eq('matter_id', matter.id).order('date_value'),
        db.from('client_personal_injury').select('*').eq('matter_id', matter.id).maybeSingle(),
        db.from('client_criminal').select('*').eq('matter_id', matter.id).maybeSingle(),
        db.from('client_immigration').select('*').eq('matter_id', matter.id).maybeSingle(),
        db.from('client_immigration_family_members').select('*').eq('matter_id', matter.id).order('created_at'),
      ]);
      const opRows             = op || [];
      oppParty                 = opRows.find(r => (r.party_role || 'primary') !== 'joint_sponsor') || null;
      jointSponsor             = opRows.find(r => r.party_role === 'joint_sponsor') || null;
      children                 = ch || [];
      financial                = fi;
      keyDates                 = kd || [];
      piDetails                = pi;
      criminalDetails          = crim;
      immigrationData          = imm;
      immigrationFamilyMembers = immFam || [];

      const paKey = matterPracticeAreaKey();
      if (paKey) {
        const { data: stagesData } = await db
          .from('workflow_stages')
          .select('id, name, color, order_index, is_terminal')
          .eq('practice_area', paKey)
          .order('order_index');
        _stageList    = stagesData || [];
        _currentStage = _stageList.find(s => s.id === matter.current_stage_id) || null;
      }
    }

    // Per-client billing rates for the hero "Rates" strip. RLS (can_read
    // 'billing') returns nothing for staff without billing permission, and the
    // strip stays hidden when a client has no rates set.
    const { data: rateRows } = await db
      .from('billing_rates').select('user_id, role, rate').eq('client_id', clientId);
    clientRates = rateRows || [];

    // Other people (guarantors / additional payers) attached to this client.
    const { data: contactRows } = await db
      .from('client_contacts').select('*').eq('client_id', clientId).order('created_at');
    otherPeople = contactRows || [];

    // Current trust/retainer balance for the hero green pill. Prefers the live
    // trust-ledger balance (matter_trust_balances, gated by trust-read); falls
    // back to the editable retainer_balance field for firms not on the ledger.
    if (matter) {
      const { data: bal } = await db
        .from('matter_trust_balances').select('balance').eq('matter_id', matter.id).maybeSingle();
      trustBalance = Number(bal?.balance) || Number(matter.retainer_balance) || 0;
    }

    renderAll();
    initClientRates(); // async, non-blocking — hides itself without billing access
  }

  // ── Render hero ──────────────────────────────────────────────────────────────

  function renderHero() {
    document.getElementById('detail-avatar').textContent = Utils.initials(client);
    document.getElementById('detail-name').textContent   = Utils.fullName(client);

    const dvBadge = document.getElementById('detail-dv-badge');
    if (client.is_dv_confidential) dvBadge.classList.remove('hidden');

    const metaParts = [];
    if (matter) {
      const statusOpts = [['intake','Intake'],['active','Active'],['on_hold','On Hold'],['closed','Closed']];
      metaParts.push(`<select id="status-quick-select" class="status-quick-select status-quick-select--${matter.status}">${statusOpts.map(([v,l]) => `<option value="${v}"${matter.status===v?' selected':''}>${l}</option>`).join('')}</select>`);
      metaParts.push(`<span>${caseTypeLabel(matter.case_type_id) || caseTypeLabel(matter.case_type) || ''}</span>`);
      if (matter.case_number) metaParts.push(`<span>Case #${Utils.esc(matter.case_number)}</span>`);
      const atty = userName(matter.assigned_attorney_id);
      if (atty) metaParts.push(`<span>${Utils.esc(atty)}</span>`);
      if (_currentStage) {
        const c = _currentStage.color || 'gray';
        metaParts.push(`<span class="stage-badge stage-badge-${c}"><span class="stage-dot-sm stage-dot-sm-${c}"></span>${Utils.esc(_currentStage.name)}</span>`);
      }
    }
    document.getElementById('detail-meta').innerHTML = metaParts.join('<span style="color:var(--color-border-mid)">·</span>');

    renderRates();
    renderRetainer();

    const statusSel = document.getElementById('status-quick-select');
    if (statusSel) {
      statusSel.addEventListener('change', async () => {
        const newStatus = statusSel.value;
        statusSel.className = `status-quick-select status-quick-select--${newStatus}`;
        const { error } = await db.from('matters').update({ status: newStatus }).eq('id', matter.id);
        if (error) {
          Utils.toast('Failed to update status', 'error');
          statusSel.value = matter.status;
          statusSel.className = `status-quick-select status-quick-select--${matter.status}`;
        } else {
          matter.status = newStatus;
          Utils.toast('Status updated', 'success');
        }
      });
    }

    document.getElementById('btn-open-docs').addEventListener('click', () => {
      if (matter) window._uploadsMatterId = matter.id;
      window.location.hash = '#uploads';
    });

    if (matter) {
      const draftBtn = document.getElementById('btn-draft-doc');
      draftBtn.classList.remove('hidden');
      draftBtn.addEventListener('click', openDraftModal);
    }

    // ── Send Intake — email the client a pre-portal intake link (no account) ─────
    const sendIntakeBtn = document.getElementById('btn-send-intake');
    const sendSvg   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9 22 2z"/></svg>`;
    const checkSvg  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
    const fmtDate   = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (matter && matter.intake_submitted_at) {
      sendIntakeBtn.classList.remove('hidden');
      sendIntakeBtn.disabled = true;
      sendIntakeBtn.innerHTML = `${checkSvg} Intake completed`;
      sendIntakeBtn.title = `Intake completed ${fmtDate(matter.intake_submitted_at)}`;
    } else if (matter && client.email) {
      sendIntakeBtn.classList.remove('hidden');
      const paintSent = () => {
        sendIntakeBtn.innerHTML = `${sendSvg} Resend Intake`;
        sendIntakeBtn.title = `Intake link sent ${fmtDate(matter.intake_sent_at)} — not yet completed. Click to send a fresh link (the old one stops working).`;
      };
      if (matter.intake_sent_at) paintSent();
      sendIntakeBtn.addEventListener('click', async () => {
        if (matter.intake_sent_at &&
            !await Utils.confirm('Resend the intake form? A new link is created and the previous one will stop working.', { confirmLabel: 'Resend' })) return;
        sendIntakeBtn.disabled = true;
        const prev = sendIntakeBtn.innerHTML;
        sendIntakeBtn.textContent = 'Sending…';
        try {
          const res = await callFunction('/api/send-intake', { matter_id: matter.id });
          matter.intake_sent_at = res?.sent_at || new Date().toISOString();
          sendIntakeBtn.disabled = false;
          paintSent();
          Utils.toast(`Intake form sent to ${client.email}`, 'success');
        } catch (err) {
          sendIntakeBtn.disabled = false;
          sendIntakeBtn.innerHTML = prev;
          Utils.toast(err.message, 'error');
        }
      });
    }

    const inviteBtn = document.getElementById('btn-invite-portal');
    if (client.email && !client.auth_id) {
      inviteBtn.classList.remove('hidden');
      inviteBtn.addEventListener('click', async () => {
        inviteBtn.disabled = true;
        inviteBtn.textContent = 'Sending…';
        try {
          await callFunction('/api/invite-client', { client_id: clientId });
          client.auth_id = '__invited__';
          inviteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Portal active`;
          Utils.toast(`Invite sent to ${client.email}`, 'success');
        } catch (err) {
          inviteBtn.disabled = false;
          inviteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg> Invite to portal`;
          Utils.toast(err.message, 'error');
        }
      });
    } else if (client.auth_id) {
      inviteBtn.classList.remove('hidden');
      inviteBtn.disabled = true;
      inviteBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Portal active`;

      // Resend access email link — covers expired invites, forgotten passwords, never-completed setup
      const resendLink = document.createElement('button');
      resendLink.className = 'btn btn--ghost btn--sm';
      resendLink.style.marginLeft = 'var(--space-2)';
      resendLink.textContent = 'Resend access email';
      inviteBtn.insertAdjacentElement('afterend', resendLink);

      resendLink.addEventListener('click', async () => {
        resendLink.disabled = true;
        resendLink.textContent = 'Sending…';
        try {
          await callFunction('/api/resend-client-access', { client_id: clientId });
          Utils.toast(`Access email sent to ${client.email}`, 'success');
          resendLink.textContent = 'Resend access email';
          resendLink.disabled = false;
        } catch (err) {
          Utils.toast(err.message, 'error');
          resendLink.textContent = 'Resend access email';
          resendLink.disabled = false;
        }
      });
    }
  }

  // ── Render client tab ────────────────────────────────────────────────────────

  // Colored per-person/role rate pills in the hero. Attorneys/owners show as
  // their initials; paralegals collapse to "PL". Each distinct label gets a
  // stable color (hashed from the label) so a given biller keeps one signature
  // color across every client card. Identical (label, rate) pairs de-dup, so two
  // paralegals sharing a rate render as a single "PL" chip.
  const RATE_PALETTE = [
    { bg:'#eef2ff', badge:'#6366f1', text:'#4338ca' }, // indigo
    { bg:'#f0fdfa', badge:'#0d9488', text:'#0f766e' }, // teal
    { bg:'#fffbeb', badge:'#f59e0b', text:'#b45309' }, // amber
    { bg:'#fff1f2', badge:'#f43f5e', text:'#be123c' }, // rose
    { bg:'#faf5ff', badge:'#a855f7', text:'#7e22ce' }, // violet
    { bg:'#f0f9ff', badge:'#0ea5e9', text:'#0369a1' }, // sky
  ];
  function rateColor(label) {
    let h = 0;
    for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
    return RATE_PALETTE[h % RATE_PALETTE.length];
  }

  function renderRates() {
    const box = document.getElementById('detail-rates');
    if (!box) return;
    if (!clientRates.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }

    const userMap = new Map(users.map(u => [u.id, u]));
    const seen = new Map();  // "label|amount" → { label, amt, isPara }
    for (const r of clientRates) {
      const amt = Number(r.rate);
      if (!Number.isFinite(amt)) continue;
      const u = r.user_id ? userMap.get(r.user_id) : null;
      const roleName = u ? (u.roles?.name || '') : (r.role || '');
      const isPara = /paralegal/i.test(roleName);
      let label;
      if (isPara)   label = 'PL';
      else if (u)   label = ((u.first_name?.[0] || '') + (u.last_name?.[0] || '')).toUpperCase() || '—';
      else          label = r.role || '—';
      const key = `${label}|${amt}`;
      if (!seen.has(key)) seen.set(key, { label, amt, isPara });
    }
    if (!seen.size) { box.classList.add('hidden'); box.innerHTML = ''; return; }

    const chips = [...seen.values()]
      .sort((a, b) => (a.isPara - b.isPara) || (b.amt - a.amt))
      .map(c => {
        const col = rateColor(c.label);
        return `<span class="rate-chip" style="background:${col.bg};color:${col.text};border-color:${col.badge}33" title="$${c.amt.toLocaleString()}/hr">`
             + `<span class="rc-who" style="background:${col.badge}">${Utils.esc(c.label)}</span>`
             + `<span class="rc-amt">$${c.amt.toLocaleString()}</span></span>`;
      });

    box.innerHTML = `<span class="rates-label">Rates</span>${chips.join('')}`;
    box.classList.remove('hidden');
  }

  // ── Billing rates & admin fee editor (Financial tab) ─────────────────────────
  // Same data + API as the old Settings ▸ Billing Rates page, scoped to this
  // client. The section stays hidden for viewers without billing access (the
  // API 403s and we bail quietly).
  async function initClientRates() {
    const section = document.getElementById('client-rates-section');
    if (!section) return;

    let boot;
    try {
      const session = await Auth.getSession();
      const res = await fetch(`/api/billing-rates?client_id=${encodeURIComponent(clientId)}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!res.ok) { section.classList.add('hidden'); return; }
      boot = await res.json();
    } catch { return; }

    const rowsEl     = document.getElementById('client-rates-rows');
    const feeActive  = document.getElementById('client-fee-active');
    const feeDetails = document.getElementById('client-fee-details');
    const feeAmount  = document.getElementById('client-fee-amount');
    const feeDay     = document.getElementById('client-fee-day');
    const feeAccount = document.getElementById('client-fee-account');
    const saveBtn    = document.getElementById('btn-save-client-rates');
    const statusEl   = document.getElementById('client-rates-status');

    const staff      = boot.staff || [];
    const rateByUser = new Map((boot.rates || []).filter(r => r.user_id).map(r => [r.user_id, r.rate]));

    rowsEl.innerHTML = staff.length ? staff.map(s => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)">
        <div>
          <div style="font-weight:500">${Utils.esc(`${s.first_name || ''} ${s.last_name || ''}`.trim() || '(unnamed)')}</div>
          <div class="text-muted text-sm">${s.role ? Utils.esc(s.role) : '—'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <span class="text-muted text-sm">$</span>
          <input type="number" class="client-rate-input" data-user="${Utils.esc(s.id)}" min="0" step="0.01"
                 value="${rateByUser.get(s.id) != null ? rateByUser.get(s.id) : ''}" placeholder="—"
                 style="width:110px;text-align:right">
          <span class="text-muted text-sm">/hr</span>
        </div>
      </div>`).join('')
      : '<p class="text-muted text-sm">No staff members to set rates for.</p>';

    const rc = boot.recurring_charge;
    feeActive.checked = !!(rc && rc.active);
    feeAmount.value   = rc && rc.amount != null ? rc.amount : 100;
    feeDay.value      = rc && rc.day_of_month  ? rc.day_of_month : 1;
    feeAccount.value  = rc && rc.account_type === 'trust' ? 'trust' : 'operating';

    function syncFee() {
      feeDetails.style.opacity       = feeActive.checked ? '1' : '0.45';
      feeDetails.style.pointerEvents = feeActive.checked ? 'auto' : 'none';
    }
    syncFee();

    // Listeners wire once; re-runs of initClientRates only refresh the data.
    if (!section.dataset.wired) {
      section.dataset.wired = '1';
      feeActive.addEventListener('change', syncFee);

      saveBtn.addEventListener('click', async () => {
        const rates = [...rowsEl.querySelectorAll('.client-rate-input')].map(inp => ({
          user_id: inp.dataset.user,
          rate:    inp.value.trim() === '' ? null : Number(inp.value),
        }));
        saveBtn.disabled = true;
        statusEl.textContent = 'Saving…';
        try {
          await callFunction('/api/billing-rates', {
            client_id: clientId,
            rates,
            recurring_charge: {
              active:       feeActive.checked,
              amount:       Number(feeAmount.value),
              day_of_month: Number(feeDay.value),
              account_type: feeAccount.value,
            },
          });
          statusEl.textContent = 'Saved ✓';
          Utils.toast('Billing rates saved.', 'success');
          // Refresh the hero "Rates" chips to match what was just saved.
          const { data: rateRows } = await db
            .from('billing_rates').select('user_id, role, rate').eq('client_id', clientId);
          clientRates = rateRows || [];
          renderRates();
        } catch (err) {
          statusEl.textContent = '';
          Utils.toast(err.message || 'Failed to save rates.', 'error');
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    section.classList.remove('hidden');
  }

  // Green retainer pill — only when the balance is positive.
  function renderRetainer() {
    const box = document.getElementById('detail-retainer');
    if (!box) return;
    const bal = Number(trustBalance);
    if (!(bal > 0)) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    const amt = bal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    box.innerHTML = `<span class="balance-chip" title="Current trust / retainer balance"><span class="bc-dot"></span>Retainer <b>$${amt}</b></span>`;
    box.classList.remove('hidden');
  }

  function renderClientInfo() {
    const c = client;
    const phones = [
      c.cell_phone  && `Cell: ${c.cell_phone}`,
      c.home_phone  && `Home: ${c.home_phone}`,
      c.work_phone  && `Work: ${c.work_phone}`,
      c.fax         && `Fax: ${c.fax}`,
    ].filter(Boolean).join(' · ') || null;

    setGrid('grid-client-info', [
      field('First name',      c.first_name),
      field('Middle name',     c.middle_name),
      field('Last name',       c.last_name),
      field('Former/maiden',   c.former_maiden_name),
      field('Date of birth',   c.dob,  'date'),
      field('Place of birth',  c.place_of_birth),
      ssnField('clients', clientId, c.ssn_last4, Utils.fullName(c)),
      field('Driver\'s license', c.driver_license_number
        ? `${c.driver_license_number}${c.driver_license_state ? ' (' + c.driver_license_state + ')' : ''}`
        : null),
      field('Phone(s)',        phones),
      field('Email',           c.email),
      field('Preferred contact', c.preferred_contact ? Utils.titleCase(c.preferred_contact) : null),
      field('Address',         [c.address_line1, c.address_line2, c.city, c.state, c.zip].filter(Boolean).join(', ') || null),
      field('County',          c.county),
      field('Residence (length)', c.length_of_residence),
      field('Employer',        c.employer),
      field('Employer address',c.employer_address_line1
        ? [c.employer_address_line1, c.employer_city, c.employer_state, c.employer_zip].filter(Boolean).join(', ')
        : null),
      field('Employment length', c.length_of_employment),
      field('Gross annual income', c.gross_annual_income, 'money'),
      field('Education',       c.education),
      field('Living with others', c.living_with_others),
      field('Name restoration', c.name_restoration_requested ? (c.name_restored_to ? `Yes — to ${c.name_restored_to}` : 'Yes') : 'No'),
    ].join(''));
  }

  function renderEmergencyIntake() {
    const c = client;
    setGrid('grid-client-emrg', [
      field('Emergency contact', c.emergency_contact_name),
      field('Emergency phone',   c.emergency_contact_phone, 'phone'),
      field('Referral source',   c.referral_source ? Utils.titleCase(c.referral_source) : null),
      field('Referral name',     c.referral_name),
      field('Intake date',       c.intake_date, 'date'),
      field('Notes',             c.notes),
    ].join(''));
  }

  function renderCompliance() {
    const c = client;
    setGrid('grid-compliance', [
      field('Conflict check notes', c.conflict_check_notes),
      field('DV / Protective order', c.is_dv_confidential, 'bool'),
    ].join(''));
  }

  // ── Render case tab ──────────────────────────────────────────────────────────

  function renderCase() {
    if (!matter) {
      document.getElementById('view-case').innerHTML = '<p class="text-muted text-sm">No matter on record.</p>';
      return;
    }
    const m = matter;
    setGrid('grid-case', [
      field('Practice area',   practiceAreaLabel(m.practice_area_id)),
      field('Case type',       caseTypeLabel(m.case_type_id) || caseTypeLabel(m.case_type)),
      field('Status',          Utils.titleCase(m.status)),
      field('Case number',     m.case_number),
      field('Court / County',  m.court_county),
      field('Judge',           m.judge_name),
      field('Date filed',      m.date_filed, 'date'),
      field('Assigned attorney', userName(m.assigned_attorney_id)),
      field('Billing type',    m.billing_type ? Utils.titleCase(m.billing_type) : null),
      field('Retainer requested', m.retainer_requested, 'money'),
      // Live trust/retainer balance — same ledger-derived value as the hero pill
      // (matter_trust_balances, with legacy retainer_balance fallback baked into
      // trustBalance). null when zero so it shows "—" like the pill hiding at 0.
      field('Retainer balance', trustBalance > 0 ? trustBalance : null, 'money'),
      field('Suit filed',      m.suit_filed, 'bool'),
      field('Been served',     m.been_served != null ? (m.been_served ? 'Yes' : 'No') : null),
      field('Prior attorney consulted', m.prior_attorney_consulted),
      field('Prior attorney retained',  m.prior_attorney_retained),
      field('Notes',           m.notes),
    ].join(''));
  }

  function renderMarriage() {
    if (!matter) return;
    const m = matter;

    const circumstances = [
      m.involves_adultery        && 'Adultery',
      m.involves_physical_abuse  && 'Physical abuse',
      m.involves_cruelty         && 'Cruelty',
      m.involves_insupportibility && 'Insupportibility',
      m.involves_mental_health   && 'Mental health',
      m.involves_felony          && 'Felony conviction',
      m.involves_std             && 'STD',
    ].filter(Boolean).join(', ') || null;

    setGrid('grid-marriage', [
      field('Date of marriage',   matter.date_of_marriage, 'date'),
      field('Place of marriage',  m.place_of_marriage),
      field('Separation status',  m.separation_status ? Utils.titleCase(m.separation_status) : null),
      field('Separation date',    m.separation_date, 'date'),
      field('Has prenup',         m.has_prenup, 'bool'),
      field('Prior divorce filed',m.prior_divorce_filed != null ? (m.prior_divorce_filed ? 'Yes' : 'No') : null),
      field('Prior protective order', m.prior_protective_order != null ? (m.prior_protective_order ? 'Yes' : 'No') : null),
      field('Counselor',          m.marriage_counselor),
      field('Separation agreement', m.separation_agreement ? Utils.titleCase(m.separation_agreement) : null),
      field('Circumstances',      circumstances),
      field('Marital difficulties notes', m.marital_difficulties),
    ].join(''));
  }

  function renderCircumstances() {
    // Rendered within marriage section already; this container holds extra case-type-specific fields
    if (!matter) { document.getElementById('grid-circumstances').innerHTML = ''; return; }
    const m = matter;
    const rows = [];

    const ctKey = matterCaseTypeKey();
    const paKey = matterPracticeAreaKey();

    // ── Family Law case-type-specific fields ──────────────────────────────────
    if (['sapcr_modification','custody_modification','child_support_modification'].includes(ctKey)) {
      rows.push(field('Child support (monthly)', m.child_support_monthly, 'money'));
      rows.push(field('CS current?', m.child_support_current, 'bool'));
      rows.push(field('CS via state office', m.child_support_via_office, 'bool'));
      rows.push(field('CS withheld from paycheck', m.child_support_withheld, 'bool'));
      rows.push(field('Modification — possession notes', m.modification_possession_notes));
      rows.push(field('Modification — conservatorship notes', m.modification_conservatorship_notes));
      rows.push(field('Modification — support notes', m.modification_support_notes));
      rows.push(field('Modification — medical notes', m.modification_medical_notes));
      rows.push(field('Children\'s county changed', m.children_county_changed, 'bool'));
      rows.push(field('Prior county', m.children_county_previous));
      rows.push(field('Primary custody rationale', m.primary_custody_rationale));
    }
    if (ctKey === 'enforcement') {
      rows.push(field('Order title', m.enforcement_order_title));
      rows.push(field('Order date',  m.enforcement_order_date, 'date'));
      rows.push(field('Court number', m.enforcement_court_number));
      rows.push(field('Violations', (m.enforcement_violations || []).map(Utils.titleCase).join(', ') || null));
    }
    if (ctKey === 'prenuptial_agreement' || ctKey === 'postnuptial_agreement') {
      rows.push(field('Expected marriage date', m.expected_marriage_date, 'date'));
      rows.push(field('Expected marriage place', m.expected_marriage_place));
      rows.push(field('Client has will', m.client_has_will, 'bool'));
      rows.push(field('Will date', m.client_will_date, 'date'));
    }

    // ── Personal Injury ───────────────────────────────────────────────────────
    if (paKey === 'personal_injury') {
      const pi = piDetails || {};
      rows.push(field('Incident date',        pi.incident_date,        'date'));
      rows.push(field('Incident location',    pi.incident_location));
      rows.push(field('Description',          pi.incident_description));
      rows.push(field('At-fault party',       pi.at_fault_party));
      rows.push(field('Insurance carrier',    pi.insurance_carrier));
      rows.push(field('Claim number',         pi.claim_number));
      rows.push(field('Policy limits',        pi.policy_limits,        'money'));
      rows.push(field('Treating physician',   pi.treating_physician));
      rows.push(field('Medical provider',     pi.medical_provider));
      rows.push(field('SOL date',             pi.sol_date,             'date'));
      rows.push(field('Demand amount',        pi.demand_amount,        'money'));
    }

    // ── Criminal ──────────────────────────────────────────────────────────────
    if (paKey === 'criminal') {
      const cr = criminalDetails || {};
      const BOND = { personal_recognizance: 'Personal Recognizance', cash: 'Cash', surety: 'Surety', no_bond: 'No Bond' };
      rows.push(field('Arrest date',       cr.arrest_date,       'date'));
      rows.push(field('Offense date',      cr.offense_date,      'date'));
      rows.push(field('Cause number',      cr.cause_number));
      rows.push(field('Charges',           cr.charges));
      rows.push(field('Arresting agency',  cr.arresting_agency));
      rows.push(field('Bond amount',       cr.bond_amount,       'money'));
      rows.push(field('Bond type',         cr.bond_type ? (BOND[cr.bond_type] || cr.bond_type) : null));
      rows.push(field('Prosecutor',        cr.prosecutor));
      rows.push(field('Next hearing type', cr.next_hearing_type));
    }

    const html = rows.length
      ? `<div class="detail-grid">${rows.join('')}</div>`
      : '<p class="text-muted text-sm">No case-specific fields for this case type.</p>';
    document.getElementById('grid-circumstances').innerHTML = html;
  }

  // ── Render opposing party tab ────────────────────────────────────────────────

  function renderOpposing() {
    const container = document.getElementById('opposing-container');
    if (!matter) {
      container.innerHTML = '<div class="detail-section"><p class="text-muted text-sm">No matter on record.</p></div>';
      return;
    }
    if (!oppParty) {
      container.innerHTML = `
        <div class="detail-section" style="text-align:center;padding:var(--space-10)">
          <p class="text-muted" style="margin-bottom:var(--space-4)">No ${party2Label().toLowerCase()} recorded yet.</p>
          <button class="btn btn--primary btn--sm" id="btn-add-opposing">Add ${party2Label().toLowerCase()}</button>
        </div>`;
      document.getElementById('btn-add-opposing').addEventListener('click', () => openOpposingModal());
      return;
    }

    const op = oppParty;
    const opAddr = [op.address_line1, op.address_line2, op.city, op.state, op.zip].filter(Boolean).join(', ');
    const opMailAddr = [op.mailing_address_line1, op.mailing_city, op.mailing_state, op.mailing_zip].filter(Boolean).join(', ');
    const opEmployerAddr = [op.employer_address_line1, op.employer_city, op.employer_state, op.employer_zip].filter(Boolean).join(', ');
    const opCounselAddr  = [op.opposing_counsel_address, op.opposing_counsel_city, op.opposing_counsel_state, op.opposing_counsel_zip].filter(Boolean).join(', ');

    container.innerHTML = `
      <div class="detail-section">
        <div class="detail-section-header">
          <h2 class="detail-section-title">${party2Label()} — ${Utils.esc(op.first_name)} ${Utils.esc(op.last_name || '')}</h2>
          <button class="btn btn--secondary btn--sm" id="btn-edit-opposing">Edit</button>
        </div>
        ${op.is_address_restricted ? '<div class="badge badge--dv" style="margin-bottom:var(--space-4)">Address Restricted</div>' : ''}
        <div class="detail-grid">
          ${field('Name', [op.first_name, op.middle_name, op.last_name, op.former_maiden_name ? '(née '+op.former_maiden_name+')' : ''].filter(Boolean).join(' '))}
          ${isImmMatter() ? field('Relationship to client', op.relationship_to_client) : ''}
          ${isImmMatter() ? field('Immigration status', op.immigration_status) : ''}
          ${isImmMatter() ? field('A-Number', op.a_number) : ''}
          ${field('Date of birth', op.dob, 'date')}
          ${field('Place of birth', op.place_of_birth)}
          ${ssnField('opposing_parties', op.id, op.ssn_last4, [op.first_name, op.last_name].filter(Boolean).join(' '))}
          ${field('DL number', op.driver_license_number ? `${op.driver_license_number}${op.driver_license_state ? ' ('+op.driver_license_state+')' : ''}` : null)}
          ${field('Cell', op.cell_phone, 'phone')}
          ${field('Home', op.home_phone, 'phone')}
          ${field('Work', op.work_phone, 'phone')}
          ${field('Fax', op.fax)}
          ${field('Email', op.email)}
          ${field('Address', opAddr || null)}
          ${op.is_address_restricted ? '<div class="detail-field"><label>Address status</label><span class="val" style="color:var(--color-danger)">RESTRICTED — do not share</span></div>' : ''}
          ${field('Mailing address', opMailAddr || null)}
          ${field('County', op.county)}
          ${field('Residence length', op.length_of_residence)}
          ${field('Employer', op.employer)}
          ${field('Employer address', opEmployerAddr || null)}
          ${field('Employment length', op.length_of_employment)}
          ${field('Gross annual income', op.gross_annual_income, 'money')}
          ${field('Education', op.education)}
          ${field('Living with others', op.living_with_others)}
          ${!isPF() && !isImmMatter() ? field('Physically separated', op.physically_separated, 'bool') : ''}
          ${!isPF() && !isImmMatter() ? field('Financial arrangement', op.financial_arrangement ? Utils.titleCase(op.financial_arrangement) : null) : ''}
          ${!isPF() && !isImmMatter() ? field('Financial arrangement notes', op.financial_arrangement_notes) : ''}
        </div>
      </div>
      ${isImmMatter() ? jointSponsorSection() : `
      <div class="detail-section">
        <div class="detail-section-header">
          <h2 class="detail-section-title">${isPF() ? "Party 2's Attorney" : 'Opposing Counsel'}</h2>
        </div>
        <div class="detail-grid">
          ${field('Name', op.opposing_counsel_name)}
          ${field('Firm', op.opposing_counsel_firm)}
          ${field('Phone', op.opposing_counsel_phone, 'phone')}
          ${field('Email', op.opposing_counsel_email)}
          ${field('Address', opCounselAddr || null)}
        </div>
      </div>`}`;

    document.getElementById('btn-edit-opposing').addEventListener('click', () => openOpposingModal(op));
    wireJointSponsorButtons();
  }

  // I-864 joint financial sponsor — second opposing_parties row
  // (party_role='joint_sponsor'), immigration matters only. Optional: used
  // when the petitioner lacks the financial means to sponsor alone.
  function jointSponsorSection() {
    const js = jointSponsor;
    if (!js) {
      return `
      <div class="detail-section">
        <div class="detail-section-header">
          <h2 class="detail-section-title">Joint Sponsor</h2>
          <button class="btn btn--secondary btn--sm" id="btn-add-joint-sponsor">Add joint sponsor</button>
        </div>
        <p class="text-muted text-sm">None — only needed for the I-864 when the petitioner can't meet the income requirement alone.</p>
      </div>`;
    }
    const addr     = [js.address_line1, js.address_line2, js.city, js.state, js.zip].filter(Boolean).join(', ');
    const mailAddr = [js.mailing_address_line1, js.mailing_city, js.mailing_state, js.mailing_zip].filter(Boolean).join(', ');
    const empAddr  = [js.employer_address_line1, js.employer_city, js.employer_state, js.employer_zip].filter(Boolean).join(', ');
    return `
      <div class="detail-section">
        <div class="detail-section-header">
          <h2 class="detail-section-title">Joint Sponsor — ${Utils.esc(js.first_name)} ${Utils.esc(js.last_name || '')}</h2>
          <button class="btn btn--secondary btn--sm" id="btn-edit-joint-sponsor">Edit</button>
        </div>
        <div class="detail-grid">
          ${field('Name', [js.first_name, js.middle_name, js.last_name].filter(Boolean).join(' '))}
          ${field('Immigration status', js.immigration_status)}
          ${field('A-Number', js.a_number)}
          ${field('Date of birth', js.dob, 'date')}
          ${field('Place of birth', js.place_of_birth)}
          ${ssnField('opposing_parties', js.id, js.ssn_last4, [js.first_name, js.last_name].filter(Boolean).join(' '))}
          ${field('Cell', js.cell_phone, 'phone')}
          ${field('Home', js.home_phone, 'phone')}
          ${field('Work', js.work_phone, 'phone')}
          ${field('Email', js.email)}
          ${field('Address', addr || null)}
          ${field('Mailing address', mailAddr || null)}
          ${field('County', js.county)}
          ${field('Employer', js.employer)}
          ${field('Employer address', empAddr || null)}
          ${field('Employment length', js.length_of_employment)}
          ${field('Gross annual income', js.gross_annual_income, 'money')}
        </div>
      </div>`;
  }

  function wireJointSponsorButtons() {
    document.getElementById('btn-add-joint-sponsor')?.addEventListener('click', () => openOpposingModal(null, 'joint_sponsor'));
    document.getElementById('btn-edit-joint-sponsor')?.addEventListener('click', () => openOpposingModal(jointSponsor, 'joint_sponsor'));
  }

  // ── Render children tab ──────────────────────────────────────────────────────

  function renderChildren() {
    const container = document.getElementById('children-container');
    const addBtn = `
      <div style="text-align:right;margin-bottom:var(--space-4)">
        <button class="btn btn--primary btn--sm" id="btn-add-child">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add child
        </button>
      </div>`;

    if (!matter) {
      container.innerHTML = '<div class="detail-section"><p class="text-muted text-sm">No matter on record.</p></div>';
      return;
    }

    if (!children.length) {
      container.innerHTML = `
        ${addBtn}
        <div class="detail-section" style="text-align:center;padding:var(--space-10)">
          <p class="text-muted">No children recorded for this matter.</p>
        </div>`;
    } else {
      const cards = children.map(ch => {
        const insured = ch.health_ins_company ? `${ch.health_ins_company}${ch.health_ins_id ? ' #'+ch.health_ins_id : ''}` : null;
        return `
          <div class="child-card">
            <div class="child-card-header">
              <strong>${Utils.esc(ch.first_name)} ${Utils.esc(ch.last_name || '')}</strong>
              <div style="display:flex;gap:var(--space-2)">
                ${ch.paternity_dispute ? '<span class="badge badge--urgent" title="Paternity disputed">Paternity</span>' : ''}
                ${ch.custody_dispute   ? '<span class="badge badge--warning" title="Custody disputed">Custody</span>'   : ''}
                <button class="btn btn--ghost btn--sm btn-edit-child" data-id="${ch.id}">Edit</button>
                <button class="btn btn--ghost btn--sm btn-del-child" data-id="${ch.id}" style="color:var(--color-danger)">Delete</button>
              </div>
            </div>
            <div class="detail-grid">
              ${field('Date of birth', ch.dob, 'date')}
              ${field('Sex', ch.sex ? Utils.titleCase(ch.sex) : null)}
              ${field('Place of birth', ch.place_of_birth)}
              ${ssnField('children', ch.id, ch.ssn_last4, [ch.first_name, ch.last_name].filter(Boolean).join(' '))}
              ${field('Current residence', ch.current_residence)}
              ${field('Custody arrangement', ch.custody_arrangement)}
              ${field('Special needs / medical', ch.special_needs)}
              ${field('Health insurance', insured)}
              ${ch.health_ins_premium ? field('Premium', ch.health_ins_premium, 'money') : ''}
              ${field('Premium payer', ch.health_ins_premium_payer)}
              ${field('Third-party custody notes', ch.third_party_custody_notes)}
            </div>
          </div>`;
      }).join('');
      container.innerHTML = `${addBtn}<div class="children-list">${cards}</div>`;
    }

    container.querySelector('#btn-add-child')?.addEventListener('click', () => openChildModal());
    container.querySelectorAll('.btn-edit-child').forEach(btn =>
      btn.addEventListener('click', () => {
        const ch = children.find(c => c.id === btn.dataset.id);
        if (ch) openChildModal(ch);
      })
    );
    container.querySelectorAll('.btn-del-child').forEach(btn =>
      btn.addEventListener('click', () => deleteChild(btn.dataset.id))
    );
  }

  // ── Other People (client_contacts: guarantors / additional payers) ────────────

  function renderOtherPeople() {
    const container = document.getElementById('other-people-container');
    if (!container) return;

    // Wire the (static) Add button once.
    const addBtn = document.getElementById('btn-add-other-person');
    if (addBtn && !addBtn.dataset.wired) {
      addBtn.addEventListener('click', () => openOtherPersonModal());
      addBtn.dataset.wired = '1';
    }

    if (!otherPeople.length) {
      container.innerHTML = `<p class="text-muted text-sm" style="padding:var(--space-2) 0">No other people on file.</p>`;
    } else {
      container.innerHTML = otherPeople.map(p => {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ');
        return `
          <div class="child-card">
            <div class="child-card-header">
              <strong>${Utils.esc(name)}</strong>
              <div style="display:flex;gap:var(--space-2)">
                ${p.relationship ? `<span class="badge">${Utils.esc(p.relationship)}</span>` : ''}
                <button class="btn btn--ghost btn--sm btn-edit-person" data-id="${p.id}">Edit</button>
                <button class="btn btn--ghost btn--sm btn-del-person" data-id="${p.id}" style="color:var(--color-danger)">Delete</button>
              </div>
            </div>
            <div class="detail-grid">
              ${field('Phone', p.phone, 'phone')}
              ${field('Email', p.email)}
            </div>
          </div>`;
      }).join('');
    }

    container.querySelectorAll('.btn-edit-person').forEach(btn =>
      btn.addEventListener('click', () => {
        const p = otherPeople.find(x => x.id === btn.dataset.id);
        if (p) openOtherPersonModal(p);
      })
    );
    container.querySelectorAll('.btn-del-person').forEach(btn =>
      btn.addEventListener('click', () => deleteOtherPerson(btn.dataset.id))
    );
  }

  function openOtherPersonModal(existing = null) {
    const modalEl = document.getElementById('other-person-modal');
    if (!modalEl) return;
    const p = existing || {};
    modalEl.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <h2 class="modal-title">${existing ? 'Edit person' : 'Add person'}</h2>
          <button class="modal-close">×</button>
        </div>
        <form id="other-person-form" novalidate>
          <div class="modal-body">
            ${row2(inp('first_name','First name *',p.first_name||'','text','required'), inp('last_name','Last name',p.last_name||''))}
            ${row2(inp('phone','Phone',p.phone||'','tel'), inp('email','Email',p.email||'','email'))}
            ${inp('relationship','Relationship (e.g. Parent, Guarantor)',p.relationship||'')}
          </div>
          <div class="modal-footer">
            <div id="other-person-err" class="form-error hidden" style="flex:1;margin-right:auto"></div>
            <button type="button" class="btn btn--secondary btn--sm modal-cancel">Cancel</button>
            <button type="submit" class="btn btn--primary btn--sm">${existing ? 'Save' : 'Add person'}</button>
          </div>
        </form>
      </div>`;
    modalEl.classList.remove('hidden');
    modalEl.querySelector('.modal-close').addEventListener('click', () => closeModal(modalEl));
    modalEl.querySelector('.modal-cancel').addEventListener('click', () => closeModal(modalEl));
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(modalEl); });

    modalEl.querySelector('#other-person-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = modalEl.querySelector('#other-person-err');
      errEl.classList.add('hidden');
      const fd    = new FormData(e.target);
      const first = (fd.get('first_name') || '').toString().trim();
      if (!first) { errEl.textContent = 'First name is required.'; errEl.classList.remove('hidden'); return; }
      const saveBtn = e.target.querySelector('[type=submit]');
      Utils.setLoading(saveBtn, true);
      const payload = {
        client_id:    clientId,
        first_name:   first,
        last_name:    (fd.get('last_name') || '').toString().trim() || null,
        phone:        (fd.get('phone') || '').toString().trim() || null,
        email:        (fd.get('email') || '').toString().trim() || null,
        relationship: (fd.get('relationship') || '').toString().trim() || null,
      };
      try {
        if (existing) {
          const { error } = await db.from('client_contacts').update(payload).eq('id', existing.id);
          if (error) throw error;
          Object.assign(existing, payload);
        } else {
          const { data, error } = await db.from('client_contacts').insert(payload).select().single();
          if (error) throw error;
          otherPeople.push(data);
        }
        Utils.setLoading(saveBtn, false);
        closeModal(modalEl);
        renderOtherPeople();
        Utils.toast(existing ? 'Person updated.' : 'Person added.', 'success');
      } catch (err) {
        Utils.setLoading(saveBtn, false);
        errEl.textContent = err.message || 'Failed to save.';
        errEl.classList.remove('hidden');
      }
    });
  }

  async function deleteOtherPerson(id) {
    if (!await Utils.confirm('Remove this person? This cannot be undone.', { confirmLabel: 'Remove', danger: true })) return;
    const { error } = await db.from('client_contacts').delete().eq('id', id);
    if (error) { Utils.toast(error.message, 'error'); return; }
    otherPeople = otherPeople.filter(p => p.id !== id);
    renderOtherPeople();
    Utils.toast('Person removed.', 'success');
  }

  // ── Render financial tab ─────────────────────────────────────────────────────

  function renderFinancial() {
    if (!matter) { setGrid('grid-financial', '<p class="text-muted text-sm">No matter on record.</p>'); return; }
    const f = financial || {};
    const m = matter;
    setGrid('grid-financial', [
      field('Retainer requested',      m.retainer_requested, 'money'),
      // Live trust/retainer balance — matches the hero pill (see renderCase note).
      field('Retainer balance',        trustBalance > 0 ? trustBalance : null, 'money'),
      field('Financial affidavit',     f.financial_affidavit_status ? Utils.titleCase(f.financial_affidavit_status) : null),
      field('Client monthly income',   f.client_monthly_income, 'money'),
      field('Opposing monthly income', f.opposing_monthly_income, 'money'),
      field('Gross annual income (client)', client.gross_annual_income, 'money'),
      field('Real estate (gross value)', f.real_estate_gross_value, 'money'),
      field('Liquid assets',           f.liquid_assets_value, 'money'),
      field('Retirement',              f.retirement_description),
      field('Retirement value',        f.retirement_estimated_value, 'money'),
      field('Vehicles',                f.vehicles_description),
      field('Other assets',            f.other_assets_description),
      field('Total liabilities',       f.total_liabilities, 'money'),
      field('Frequent flyer miles',    f.frequent_flyer_miles),
      field('Weapons',                 f.weapons_description),
      field('Client — assets in a trust', f.client_has_trust_assets, 'bool'),
      field('Client — trust explanation', f.client_trust_assets_explain),
      field('Opposing party — assets in a trust', f.opposing_has_trust_assets, 'bool'),
      field('Opposing party — trust explanation', f.opposing_trust_assets_explain),
      field('Notes',                   f.notes),
    ].join(''));
  }

  // ── Render key dates ─────────────────────────────────────────────────────────

  function renderDates() {
    const list = document.getElementById('dates-list');
    if (!keyDates.length) {
      list.innerHTML = '<p class="text-muted text-sm" style="padding:var(--space-4)">No key dates recorded.</p>';
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    list.innerHTML = keyDates.map(d => {
      const past    = d.date_value < today;
      const dateLabel = DATE_TYPES.find(([k]) => k === d.date_type)?.[1] || Utils.titleCase(d.date_type);
      const calBtn = d.google_event_id
        ? `<span style="display:flex;align-items:center;gap:4px">
             <span style="font-size:11px;color:var(--color-success,#22c55e);white-space:nowrap">✓ On Calendar</span>
             <button class="btn btn--ghost btn--sm btn-remove-cal-date" data-id="${d.id}" data-event-id="${Utils.esc(d.google_event_id)}" style="font-size:10px;padding:1px 5px;color:var(--color-text-muted)" title="Remove from calendar">×</button>
           </span>`
        : `<button class="btn btn--ghost btn--sm btn-cal-date" data-id="${d.id}" style="font-size:11px;white-space:nowrap">+ Calendar</button>`;

      return `
        <div class="date-row">
          <span class="date-type">${Utils.esc(dateLabel)}</span>
          <span class="date-val" style="${!past && d.date_type === 'hearing' ? 'color:var(--color-primary);font-weight:500' : ''}">${Utils.formatDate(d.date_value)}${d.time_value ? ` at ${Utils.esc(d.time_value)}` : ''}</span>
          <span class="date-desc">${Utils.esc(d.description || '')}</span>
          <div style="display:flex;gap:var(--space-2);margin-left:auto;flex-shrink:0;align-items:center">
            ${calBtn}
            <button class="btn btn--ghost btn--sm btn-edit-date" data-id="${d.id}">Edit</button>
            <button class="btn btn--ghost btn--sm btn-del-date" data-id="${d.id}" style="color:var(--color-danger)">Delete</button>
          </div>
        </div>`;
    }).join('');

    list.querySelectorAll('.btn-edit-date').forEach(btn =>
      btn.addEventListener('click', () => {
        const d = keyDates.find(x => x.id === btn.dataset.id);
        if (d) openDateModal(d);
      })
    );
    list.querySelectorAll('.btn-del-date').forEach(btn =>
      btn.addEventListener('click', () => deleteDate(btn.dataset.id))
    );
    list.querySelectorAll('.btn-cal-date').forEach(btn =>
      btn.addEventListener('click', () => openCalDateModal(btn.dataset.id))
    );
    list.querySelectorAll('.btn-remove-cal-date').forEach(btn =>
      btn.addEventListener('click', () => removeFromCalendar(btn.dataset.id, btn.dataset.eventId))
    );

    renderDeadlines();
  }

  function renderDeadlines() {
    const el = document.getElementById('deadlines-body');
    if (!el) return;

    function parseLocalDate(s) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    function safeSide(d) {
      const r = new Date(d.getTime());
      if (r.getDay() === 6) r.setDate(r.getDate() - 1);
      if (r.getDay() === 0) r.setDate(r.getDate() - 2);
      return r;
    }
    function fmtDate(d) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    const trialKD   = keyDates.find(d => d.date_type === 'trial');
    const serviceKD = keyDates.find(d => d.date_type === 'service');

    if (!trialKD) {
      el.innerHTML = `<p class="text-muted text-sm" style="padding:var(--space-3) 0">Add a <strong>Trial</strong> key date above to see auto-calculated pre-trial deadlines.</p>`;
      return;
    }

    const trialDate = parseLocalDate(trialKD.date_value);
    const today     = new Date(); today.setHours(0, 0, 0, 0);

    const RULES = [
      ['Designate Experts — Furnish Report (seeking aff. rel.)',    120, 'TRCP 195.2'],
      ['Designate Experts — Furnish Report (not seeking aff. rel.)', 90, 'TRCP 195.2'],
      ['Trial Retainer',                                             60, '60 days before trial'],
      ['Serve Discovery Requests',                                   60, 'TRCP 194.1, 196.1, 197.1, 198.1, 204, 205.3'],
      ['Obtain Trial Setting',                                       45, 'TRCP 245'],
      ['File Affidavit — Translation of Foreign Language Doc',       45, 'TRE 1009'],
      ['Supplement Discovery Responses & Interrogatories',           30, 'TRCP 193.5(b)'],
      ['Level 2 Discovery Period Ends',                              30, 'TRCP 190.3(b)(1)(A)'],
      ['File Affidavit — Reasonable Costs & Necessary Services',     30, 'CPRC 18.001'],
      ['File Final Parenting Plan',                                  30, 'TFC 153.603(d)'],
      ['Jury Request',                                               30, 'TRCP 216'],
      ['Hearings on Due Order of Pleading Items',                    30, '30 days before trial'],
      ['Motion for Summary Judgment',                                21, 'TRCP 166a(c)'],
      ['Send OC Notice — Any and All Discovery',                    15, 'TRCP 193.7'],
      ['File Business Records Affidavit',                           14, 'TRE 902(10)'],
      ['Motion to Recuse/Disqualify Judge',                         10, 'TRCP 18a'],
      ['Amend Pleadings',                                            7, 'TRCP 63'],
    ];

    const rows = RULES.map(([label, days, cite]) => {
      const d = new Date(trialDate.getTime());
      d.setDate(d.getDate() - days);
      return { label, cite, date: safeSide(d) };
    });

    if (serviceKD) {
      const svc = parseLocalDate(serviceKD.date_value);
      const exp = new Date(svc.getTime());
      exp.setDate(exp.getDate() + 20);
      const dow = exp.getDay();
      const daysToMon = dow === 1 ? 7 : (8 - dow) % 7 || 7;
      exp.setDate(exp.getDate() + daysToMon);
      rows.push({ label: 'Answer (10am)', cite: 'TRCP 99b — first Monday after 20 days from service', date: exp });
    }

    rows.sort((a, b) => a.date - b.date);

    function daysUntil(d) { return Math.round((d - today) / 86400000); }
    function urgencyStyle(days) {
      if (days < 0)   return 'color:var(--color-text-muted)';
      if (days <= 7)  return 'color:var(--color-danger);font-weight:600';
      if (days <= 30) return 'color:var(--color-warning,#f59e0b);font-weight:600';
      return 'color:var(--color-success,#22c55e)';
    }

    el.innerHTML = `
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:var(--text-sm)">
          <thead>
            <tr style="border-bottom:2px solid var(--color-border)">
              <th style="text-align:left;padding:var(--space-2) var(--space-3);font-weight:600">Deadline</th>
              <th style="text-align:left;padding:var(--space-2) var(--space-3);font-weight:600;white-space:nowrap">Safe-Side Date</th>
              <th style="text-align:left;padding:var(--space-2) var(--space-3);font-weight:600;white-space:nowrap">Days</th>
              <th style="text-align:left;padding:var(--space-2) var(--space-3);font-weight:600">Rule</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const days = daysUntil(r.date);
              const past = days < 0;
              return `
                <tr style="border-bottom:1px solid var(--color-border);${past ? 'opacity:0.45' : ''}">
                  <td style="padding:var(--space-2) var(--space-3)">${Utils.esc(r.label)}</td>
                  <td style="padding:var(--space-2) var(--space-3);white-space:nowrap">${fmtDate(r.date)}</td>
                  <td style="padding:var(--space-2) var(--space-3);white-space:nowrap;${urgencyStyle(days)}">${past ? `${Math.abs(days)}d ago` : `${days}d`}</td>
                  <td style="padding:var(--space-2) var(--space-3);color:var(--color-text-muted);font-size:var(--text-xs)">${Utils.esc(r.cite)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <p style="padding:var(--space-3) 0 0;font-size:var(--text-xs);color:var(--color-text-muted)">
        Trial: ${fmtDate(trialDate)}${serviceKD ? ` · Served: ${fmtDate(parseLocalDate(serviceKD.date_value))}` : ' · Add a <strong>Respondent Served</strong> key date to include the Answer deadline.'}
        · Sat/Sun deadlines shift to preceding Friday.
      </p>`;
  }

  async function removeFromCalendar(dateId, eventId) {
    if (!await Utils.confirm('Remove this date from your calendar?', { confirmLabel: 'Remove' })) return;
    try {
      const session = await Auth.getSession();
      // Best-effort delete from calendar provider (don't block if it fails)
      fetch(`/api/calendar/events?eventId=${encodeURIComponent(eventId)}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${session.access_token}` },
      }).catch(() => {});
      const { error } = await db.from('key_dates').update({ google_event_id: null }).eq('id', dateId);
      if (error) throw error;
      const idx = keyDates.findIndex(kd => kd.id === dateId);
      if (idx !== -1) keyDates[idx].google_event_id = null;
      renderDates();
      Utils.toast('Removed from calendar.', 'success');
    } catch (err) {
      Utils.toast(err.message || 'Failed to remove from calendar.', 'error');
    }
  }

  // ── Render all ───────────────────────────────────────────────────────────────

  function renderAll() {
    renderHero();
    renderClientInfo();
    renderEmergencyIntake();
    renderCompliance();
    renderOtherPeople();
    renderCase();
    renderMarriage();
    renderCircumstances();
    renderOpposing();
    renderChildren();
    renderFinancial();
    renderDates();
    updateTabVisibility();
    renderImmigration();
    wireEdits();
    wireTabs();
    wireSubtabs();
    wireEsignTab();
    wireMessagesTab();
    wireTrustTab();
    wireDraftsTab();
    wireFormFillerTab();
    wireFilesTab();
    normalizeSubtabDefaults();
    wireStageTracker();
    wireCalDateModal();
  }

  // ── E-Signatures tab (lazy-loaded on first click) ───────────────────────────

  const SIG_STATUS_LABEL = {
    pending_client:   'Awaiting client',
    pending_attorney: 'Awaiting attorney',
    completed:        'Completed',
    declined:         'Declined',
    expired:          'Expired',
  };
  const SIG_STATUS_BADGE = {
    pending_client: 'pending', pending_attorney: 'pending',
    completed: 'active', declined: 'inactive', expired: 'inactive',
  };

  let _esignLoaded = false;
  let _esignDocs   = [];

  function wireEsignTab() {
    const reqBtn = document.getElementById('btn-request-sig-esign');
    _subtabLoaders.esign = async () => {
      if (_esignLoaded) return;
      _esignLoaded = true;
      await loadEsign();
    };
    if (reqBtn) reqBtn.addEventListener('click', () => openSigRequestModal(_esignDocs));

    // Persistent delegate for Details — wired once; survives renderEsign innerHTML rebuilds.
    const container = document.getElementById('esign-tab-container');
    if (container) {
      container.addEventListener('click', e => {
        const btn = e.target.closest('.btn-esign-details');
        if (btn) openEsignDetailsModal(btn.dataset.reqId);
      });
    }
  }

  async function loadEsign() {
    const container = document.getElementById('esign-tab-container');
    if (!container) return;

    if (!matter) {
      container.innerHTML = '<p class="text-muted text-sm">No active matter — e-signatures require a matter.</p>';
      return;
    }

    container.innerHTML = '<div style="padding:var(--space-6);text-align:center;color:var(--color-text-muted)">Loading…</div>';

    try {
      const [{ data: requests, error }, { data: docs }] = await Promise.all([
        db.from('signature_requests')
          .select('id, status, created_at, expires_at, document:documents(file_name)')
          .eq('matter_id', matter.id)
          .order('created_at', { ascending: false }),
        db.from('documents')
          .select('id, name, file_name')
          .eq('matter_id', matter.id)
          .neq('status', 'pending')
          .order('created_at', { ascending: false }),
      ]);
      if (error) throw error;
      _esignDocs = docs || [];
      renderEsign(requests || []);
    } catch {
      container.innerHTML = '<p class="text-sm" style="color:var(--color-danger)">Could not load signature requests. Confirm the E-Sign module is enabled for your role.</p>';
    }
  }

  function renderEsign(requests) {
    const container = document.getElementById('esign-tab-container');
    if (!container) return;

    if (!requests.length) {
      container.innerHTML = '<p class="text-muted text-sm" style="padding:var(--space-4) 0">No signature requests have been sent for this matter yet.</p>';
      return;
    }

    container.innerHTML = `
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead>
            <tr><th>Document</th><th>Status</th><th>Sent</th><th>Expires</th><th></th></tr>
          </thead>
          <tbody>
            ${requests.map(r => {
              const expired = r.status.startsWith('pending') && new Date(r.expires_at) < new Date();
              return `<tr>
                <td style="font-weight:500">${Utils.esc(r.document?.file_name || '—')}</td>
                <td><span class="badge badge--${SIG_STATUS_BADGE[r.status] || 'normal'}">${SIG_STATUS_LABEL[r.status] || r.status}</span></td>
                <td class="text-sm text-muted">${Utils.formatDate(r.created_at)}</td>
                <td class="text-sm ${expired ? '' : 'text-muted'}" ${expired ? 'style="color:var(--color-danger)"' : ''}>${Utils.formatDate(r.expires_at)}</td>
                <td><button class="btn btn--ghost btn--sm btn-esign-details" data-req-id="${r.id}">Details</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function openSigRequestModal(docs) {
    const overlay = document.getElementById('esign-modal');
    if (!docs.length) {
      Utils.toast('No uploaded documents found for this matter. Upload a document first.', 'error');
      return;
    }
    overlay.innerHTML = `
      <div class="modal" style="max-width:540px;padding:var(--space-6)">
        <h2 class="modal-title" style="margin-bottom:var(--space-5)">Request E-Signature</h2>
        <div class="field" style="margin-bottom:var(--space-4)">
          <label>Document <span class="required">*</span></label>
          <select id="esign-doc-select">
            <option value="">Select a document…</option>
            ${docs.map(d => `<option value="${d.id}">${Utils.esc(d.name || d.file_name)}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="margin-bottom:var(--space-4)">
          <label style="display:flex;align-items:center;gap:var(--space-3);font-weight:400;cursor:pointer">
            <input type="checkbox" id="esign-countersign" checked style="width:auto">
            Require attorney counter-signature after client signs
          </label>
        </div>
        <div class="field" style="margin-bottom:var(--space-5)">
          <label>Message to client <span style="font-weight:400;color:var(--color-text-muted)">(optional)</span></label>
          <textarea id="esign-message" rows="4" placeholder="E.g. Please review and sign your retainer agreement."></textarea>
        </div>
        <div id="esign-req-err" class="form-error hidden" style="margin-bottom:var(--space-3)"></div>
        <div style="display:flex;gap:var(--space-3);justify-content:flex-end">
          <button class="btn btn--secondary btn--sm" id="esign-req-cancel">Cancel</button>
          <button class="btn btn--primary btn--sm" id="esign-req-send">Send signature request</button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.querySelector('#esign-req-cancel').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    overlay.querySelector('#esign-req-send').addEventListener('click', async () => {
      const sendBtn     = overlay.querySelector('#esign-req-send');
      const errEl       = overlay.querySelector('#esign-req-err');
      const docId       = overlay.querySelector('#esign-doc-select').value;
      const countersign = overlay.querySelector('#esign-countersign').checked;
      const message     = overlay.querySelector('#esign-message').value.trim();

      if (!docId) { errEl.textContent = 'Please select a document.'; errEl.classList.remove('hidden'); return; }

      errEl.classList.add('hidden');
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending…';

      try {
        await callFunction('/api/create-signature-request', {
          document_id:          docId,
          requires_countersign: countersign,
          message:              message || null,
        });
        overlay.classList.add('hidden');
        Utils.toast('Signature request sent to client.', 'success');
        _esignLoaded = false;
        await loadEsign();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send signature request';
      }
    });
  }

  async function openEsignDetailsModal(reqId) {
    const overlay = document.getElementById('esign-modal');
    overlay.innerHTML = `
      <div class="modal" style="max-width:640px">
        <h2 class="modal-title" style="padding:var(--space-5) var(--space-6) var(--space-4)">Signature Audit Trail</h2>
        <div id="esign-audit-loading" style="padding:var(--space-8);text-align:center;color:var(--color-text-muted)">Loading…</div>
        <div id="esign-audit-content"></div>
        <div style="display:flex;justify-content:flex-end;padding:var(--space-4) var(--space-6)">
          <button class="btn btn--secondary btn--sm" id="esign-audit-close">Close</button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');
    overlay.querySelector('#esign-audit-close').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

    try {
      const session = await Auth.getSession();
      const res  = await fetch(`/api/get-signature-request?id=${reqId}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      renderEsignAudit(data);
    } catch {
      document.getElementById('esign-audit-loading').textContent = 'Failed to load audit trail. Please try again.';
    }
  }

  function renderEsignAudit(data) {
    document.getElementById('esign-audit-loading').classList.add('hidden');
    const content = document.getElementById('esign-audit-content');
    const sigs = data.signatures || [];
    const requestedBy = data.requested_by
      ? `${data.requested_by.first_name} ${data.requested_by.last_name}`.trim() : '—';

    const hashBlock = (label, hash) => hash ? `
      <div style="margin-top:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--color-bg);border-radius:var(--radius-md)">
        <div style="font-size:10px;font-weight:700;color:var(--color-text-muted);letter-spacing:.06em;margin-bottom:2px">${label}</div>
        <code style="font-size:9.5px;word-break:break-all;color:var(--color-text-muted)">${Utils.esc(hash)}</code>
      </div>` : '';

    const sigBlocks = sigs.length === 0
      ? `<p class="text-sm text-muted">No signatures recorded yet.</p>`
      : sigs.map(s => {
          const roleLabel = s.signer_role === 'attorney' ? 'Attorney Counter-Signature' : 'Client Signature';
          const signerName = s.audit_log?.signer_name || '—';
          const ua = s.user_agent ? s.user_agent.slice(0, 100) + (s.user_agent.length > 100 ? '…' : '') : null;
          return `
          <div style="padding:var(--space-4);border:1px solid var(--color-border);border-radius:var(--radius-md);margin-bottom:var(--space-3)">
            <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-3)">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" stroke-width="2.5" style="width:15px;height:15px;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>
              <span style="font-weight:600;font-size:var(--text-sm)">${roleLabel}</span>
              <span class="text-muted text-sm">— ${Utils.esc(signerName)}</span>
            </div>
            <div style="display:grid;gap:var(--space-1);font-size:var(--text-sm)">
              <div><span class="text-muted">Signed:</span> ${Utils.formatDateTime(s.signed_at)} (CT)</div>
              ${s.ip_address ? `<div><span class="text-muted">IP:</span> <code style="font-size:var(--text-xs)">${Utils.esc(s.ip_address)}</code></div>` : ''}
              ${ua ? `<div><span class="text-muted">Browser:</span> <span style="font-size:var(--text-xs);color:var(--color-text-muted)">${Utils.esc(ua)}</span></div>` : ''}
            </div>
            ${hashBlock('SHA-256 BEFORE SIGNING', s.document_hash_before)}
            ${hashBlock('SHA-256 AFTER SIGNING',  s.document_hash_after)}
          </div>`;
        }).join('');

    content.innerHTML = `
      <div style="padding:var(--space-4) var(--space-6);border-top:1px solid var(--color-border);border-bottom:1px solid var(--color-border);background:var(--color-bg)">
        <div style="display:grid;gap:var(--space-3);grid-template-columns:1fr 1fr">
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Document</div>
            <div style="font-weight:600">${Utils.esc(data.document?.file_name || '—')}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Status</div>
            <span class="badge badge--${SIG_STATUS_BADGE[data.status] || 'normal'}">${SIG_STATUS_LABEL[data.status] || data.status}</span>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Requested by</div>
            <div>${Utils.esc(requestedBy)}</div>
          </div>
          <div>
            <div class="text-xs text-muted" style="text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Requested</div>
            <div>${Utils.formatDateTime(data.created_at)}</div>
          </div>
        </div>
        ${data.message ? `<div style="margin-top:var(--space-3);padding:var(--space-3);background:var(--color-surface);border-radius:var(--radius-md);font-size:var(--text-sm);font-style:italic">"${Utils.esc(data.message)}"</div>` : ''}
      </div>
      <div style="padding:var(--space-5) var(--space-6)">
        <div style="font-weight:600;margin-bottom:var(--space-4)">Signature Chain</div>
        ${sigBlocks}
      </div>
      ${data.download_url ? `
      <div style="padding:0 var(--space-6) var(--space-4)">
        <a href="${data.download_url}" target="_blank" class="btn btn--secondary btn--sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;margin-right:var(--space-2)"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download signed document
        </a>
      </div>` : ''}`;
  }

  // ── Messages tab (lazy-loaded on first click, same pattern as E-Signatures) ──

  function wireMessagesTab() {
    const tab = document.querySelector('[data-tab="messages"]');
    if (!tab) return;

    let msgLoaded    = false;
    let msgPollTimer = null;
    let msgConvoId   = null;

    function detailRelTime(iso) {
      const diff = (Date.now() - new Date(iso)) / 1000;
      if (diff < 60)    return 'just now';
      if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return new Date(iso).toLocaleDateString();
    }

    async function loadDetailMessages() {
      const bubblesEl = document.getElementById('detail-msg-bubbles');
      if (!bubblesEl) return;
      try {
        const session = await Auth.getSession();
        const qs  = msgConvoId
          ? `conversation_id=${msgConvoId}`
          : `client_id=${clientId}`;
        const res  = await fetch(`/api/get-messages?${qs}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        });
        const data = await res.json();
        if (data.conversation_id) msgConvoId = data.conversation_id;

        if (!data.messages?.length) {
          bubblesEl.innerHTML = '<div class="msg-loading">No messages yet — send the first one below.</div>';
          return;
        }

        const msgs = data.messages;
        const lastReadIdx = msgs.reduce((acc, m, i) =>
          m.direction === 'outbound' && m.client_read_at ? i : acc, -1);

        bubblesEl.innerHTML = msgs.map((m, i) => {
          const senderLabel = m.direction === 'outbound' && m.sender_name
            ? Utils.esc(m.sender_name) + ' · ' : '';
          const isRead     = m.direction === 'outbound' && m.client_read_at;
          const extraClass = isRead ? ' client-read' : '';
          return `<div class="msg-bubble ${Utils.esc(m.direction)}${extraClass}">
            <div class="msg-bubble-body">${Utils.esc(m.body).replace(/\n/g, '<br>')}</div>
            <div class="msg-bubble-meta">${senderLabel}${detailRelTime(m.created_at)}</div>
            ${i === lastReadIdx ? '<div class="msg-read-receipt">Read</div>' : ''}
          </div>`;
        }).join('');
        bubblesEl.scrollTop = bubblesEl.scrollHeight;
      } catch (err) {
        console.error('[detail-messages]', err);
      }
    }

    async function sendDetailMessage() {
      const inputEl = document.getElementById('detail-msg-input');
      const btnEl   = document.getElementById('detail-msg-send-btn');
      const body    = inputEl?.value.trim();
      if (!body) return;
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Sending…'; }
      try {
        const session = await Auth.getSession();
        const res = await fetch('/api/send-message', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body:    JSON.stringify({ client_id: clientId, body }),
        });
        const data = await res.json();
        if (data.message) {
          if (data.conversation_id) msgConvoId = data.conversation_id;
          if (inputEl) inputEl.value = '';
          const charsEl = document.getElementById('detail-msg-chars');
          if (charsEl) charsEl.textContent = '0 / 2000';
          await loadDetailMessages();
        } else {
          Utils.toast(data.error || 'Failed to send message.', 'error');
        }
      } catch { Utils.toast('Failed to send. Please try again.', 'error'); }
      finally { if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Send'; } }
    }

    tab.addEventListener('click', () => {
      if (!msgLoaded) {
        msgLoaded = true;
        document.getElementById('detail-msg-send-btn')?.addEventListener('click', sendDetailMessage);
        document.getElementById('detail-msg-input')?.addEventListener('keydown', e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendDetailMessage();
        });
        document.getElementById('detail-msg-input')?.addEventListener('input', function () {
          const c = document.getElementById('detail-msg-chars');
          if (c) c.textContent = `${this.value.length} / 2000`;
        });
      }
      loadDetailMessages();
      clearInterval(msgPollTimer);
      msgPollTimer = setInterval(loadDetailMessages, 15000);
    });

    // Stop poll when switching to another tab
    document.querySelectorAll('.detail-tab').forEach(b => {
      if (b.dataset.tab !== 'messages') {
        b.addEventListener('click', () => { clearInterval(msgPollTimer); msgPollTimer = null; });
      }
    });
  }

  // ── Tab switching ────────────────────────────────────────────────────────────

  function wireTabs() {
    document.querySelectorAll('.detail-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.detail-tab').forEach(b => b.classList.remove('detail-tab--active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('tab-panel--active'));
        btn.classList.add('detail-tab--active');
        const panel = document.getElementById('tab-' + btn.dataset.tab);
        if (panel) panel.classList.add('tab-panel--active');
        // Documents/Financial hold lazy sub-tabs — load whichever pill is active
        if (btn.dataset.tab === 'documents') ensureActiveSubtabLoaded('doc');
        if (btn.dataset.tab === 'financial') ensureActiveSubtabLoaded('fin');
      });
    });
  }

  // ── Pill sub-tabs (Documents, Financial) ────────────────────────────────────
  // Lazy loaders keyed by data-subtab; registered by the wire*Tab functions.

  const _subtabLoaders = {};

  function wireSubtabs() {
    document.querySelectorAll('.subtab').forEach(btn => {
      btn.addEventListener('click', () => activateSubtab(btn.dataset.group, btn.dataset.subtab));
    });
  }

  function activateSubtab(group, key, opts = {}) {
    document.querySelectorAll(`.subtab[data-group="${group}"]`).forEach(b =>
      b.classList.toggle('subtab--active', b.dataset.subtab === key));
    document.querySelectorAll(`.subtab-panel[data-group="${group}"]`).forEach(p =>
      p.classList.toggle('subtab-panel--active', p.id === 'subpanel-' + key));
    if (!opts.skipLoad && _subtabLoaders[key]) _subtabLoaders[key]();
  }

  function ensureActiveSubtabLoaded(group) {
    const btn = document.querySelector(`.subtab[data-group="${group}"].subtab--active:not(.hidden)`);
    if (btn && _subtabLoaders[btn.dataset.subtab]) _subtabLoaders[btn.dataset.subtab]();
  }

  // If a group's default pill ended up hidden (e.g. no matter), fall back to
  // the first visible one so an empty panel is never the active view.
  function normalizeSubtabDefaults() {
    ['doc', 'fin'].forEach(group => {
      const active = document.querySelector(`.subtab[data-group="${group}"].subtab--active`);
      if (!active || !active.classList.contains('hidden')) return;
      const firstVisible = document.querySelector(`.subtab[data-group="${group}"]:not(.hidden)`);
      if (firstVisible) activateSubtab(group, firstVisible.dataset.subtab, { skipLoad: true });
    });
  }

  // ── Inline edit wiring ───────────────────────────────────────────────────────

  function wireSection(sectionKey, viewId, formId, editBtnId, cancelBtnId, buildFields, onSave) {
    const editBtn   = document.getElementById(editBtnId);
    const cancelBtn = document.getElementById(cancelBtnId);
    const viewEl    = document.getElementById(viewId);
    const formEl    = document.getElementById(formId);
    if (!editBtn || !viewEl || !formEl) return;

    editBtn.addEventListener('click', () => {
      buildFields();
      viewEl.classList.add('hidden-by-edit');
      formEl.classList.add('open');
      editBtn.classList.add('hidden');
    });

    function close() {
      viewEl.classList.remove('hidden-by-edit');
      formEl.classList.remove('open');
      editBtn.classList.remove('hidden');
    }

    cancelBtn?.addEventListener('click', close);

    formEl.addEventListener('submit', async e => {
      e.preventDefault();
      const saveBtn = formEl.querySelector('[type=submit]');
      Utils.setLoading(saveBtn, true);
      try {
        await onSave(new FormData(formEl), formEl);
        close();
        Utils.toast('Saved.', 'success');
      } catch (err) {
        const errEl = formEl.querySelector('.form-error');
        if (errEl) { errEl.textContent = err.message || 'Save failed.'; errEl.classList.remove('hidden'); }
        else Utils.toast(err.message || 'Save failed.', 'error');
      } finally {
        Utils.setLoading(saveBtn, false);
      }
    });
  }

  function wireEdits() {
    // ── Client info ──
    wireSection('client-info', 'view-client-info', 'form-client-info',
      'btn-edit-client-info', 'btn-cancel-client-info',
      buildClientInfoFields,
      async (fd) => {
        const payload = {
          first_name:              fd.get('first_name')?.trim() || null,
          middle_name:             fd.get('middle_name')?.trim() || null,
          last_name:               fd.get('last_name')?.trim() || null,
          former_maiden_name:      fd.get('former_maiden_name')?.trim() || null,
          dob:                     fd.get('dob') || null,
          place_of_birth:          fd.get('place_of_birth')?.trim() || null,
          driver_license_number:   fd.get('driver_license_number')?.trim() || null,
          driver_license_state:    fd.get('driver_license_state')?.trim()?.toUpperCase() || null,
          cell_phone:              fd.get('cell_phone')?.trim() || null,
          home_phone:              fd.get('home_phone')?.trim() || null,
          work_phone:              fd.get('work_phone')?.trim() || null,
          fax:                     fd.get('fax')?.trim() || null,
          email:                   fd.get('email')?.trim() || null,
          preferred_contact:       fd.get('preferred_contact') || null,
          address_line1:           fd.get('address_line1')?.trim() || null,
          address_line2:           fd.get('address_line2')?.trim() || null,
          city:                    fd.get('city')?.trim() || null,
          state:                   fd.get('state')?.trim()?.toUpperCase() || 'TX',
          zip:                     fd.get('zip')?.trim() || null,
          county:                  fd.get('county')?.trim() || null,
          length_of_residence:     fd.get('length_of_residence')?.trim() || null,
          employer:                fd.get('employer')?.trim() || null,
          employer_address_line1:  fd.get('employer_address_line1')?.trim() || null,
          employer_city:           fd.get('employer_city')?.trim() || null,
          employer_state:          fd.get('employer_state')?.trim()?.toUpperCase() || null,
          employer_zip:            fd.get('employer_zip')?.trim() || null,
          length_of_employment:    fd.get('length_of_employment')?.trim() || null,
          gross_annual_income:     fd.get('gross_annual_income') ? parseFloat(fd.get('gross_annual_income')) : null,
          education:               fd.get('education')?.trim() || null,
          living_with_others:      fd.get('living_with_others')?.trim() || null,
          name_restoration_requested: fd.get('name_restoration_requested') === 'on',
          name_restored_to:        fd.get('name_restored_to')?.trim() || null,
        };
        if (!payload.first_name || !payload.last_name) throw new Error('First and last name are required.');
        const { error } = await db.from('clients').update(payload).eq('id', clientId);
        if (error) throw error;
        Object.assign(client, payload);
        renderClientInfo();
        renderHero();
      }
    );

    // ── Emergency / intake ──
    wireSection('client-emrg', 'view-client-emrg', 'form-client-emrg',
      'btn-edit-client-emrg', 'btn-cancel-client-emrg',
      buildEmrgFields,
      async (fd) => {
        const payload = {
          emergency_contact_name:  fd.get('emergency_contact_name')?.trim() || null,
          emergency_contact_phone: fd.get('emergency_contact_phone')?.trim() || null,
          referral_source:         fd.get('referral_source') || null,
          referral_name:           fd.get('referral_name')?.trim() || null,
          intake_date:             fd.get('intake_date') || null,
          notes:                   fd.get('notes')?.trim() || null,
        };
        const { error } = await db.from('clients').update(payload).eq('id', clientId);
        if (error) throw error;
        Object.assign(client, payload);
        renderEmergencyIntake();
      }
    );

    // ── Compliance ──
    wireSection('compliance', 'view-compliance', 'form-compliance',
      'btn-edit-compliance', 'btn-cancel-compliance',
      buildComplianceFields,
      async (fd) => {
        const payload = {
          conflict_check_notes: fd.get('conflict_check_notes')?.trim() || null,
          is_dv_confidential:   fd.get('is_dv_confidential') === 'on',
        };
        const { error } = await db.from('clients').update(payload).eq('id', clientId);
        if (error) throw error;
        if (matter) {
          await db.from('matters').update({ is_dv_confidential: payload.is_dv_confidential }).eq('id', matter.id);
          matter.is_dv_confidential = payload.is_dv_confidential;
        }
        Object.assign(client, payload);
        renderCompliance();
        renderHero();
      }
    );

    // ── Case details ──
    wireSection('case', 'view-case', 'form-case',
      'btn-edit-case', 'btn-cancel-case',
      buildCaseFields,
      async (fd) => {
        if (!matter) return;
        const paId  = fd.get('practice_area_id') || null;
        const ctId  = fd.get('case_type_id')     || null;
        const payload = {
          practice_area_id: paId,
          case_type_id:     ctId,
          case_type:        ctId ? (caseTypeMap.get(ctId)?.key || null) : null,
          status:           fd.get('status') || 'intake',
          case_number:          fd.get('case_number')?.trim() || null,
          court_county:         fd.get('court_county')?.trim() || null,
          judge_name:           fd.get('judge_name')?.trim() || null,
          date_filed:           fd.get('date_filed') || null,
          assigned_attorney_id: fd.get('assigned_attorney_id') || null,
          billing_type:         fd.get('billing_type') || 'hourly',
          retainer_balance:     fd.get('retainer_balance') ? parseFloat(fd.get('retainer_balance')) : null,
          retainer_requested:   fd.get('retainer_requested') ? parseFloat(fd.get('retainer_requested')) : null,
          suit_filed:           fd.get('suit_filed') === 'on',
          been_served:          fd.get('been_served') ? fd.get('been_served') === 'true' : null,
          prior_attorney_consulted: fd.get('prior_attorney_consulted')?.trim() || null,
          prior_attorney_retained:  fd.get('prior_attorney_retained')?.trim() || null,
          notes:                fd.get('notes')?.trim() || null,
        };
        const { error } = await db.from('matters').update(payload).eq('id', matter.id);
        if (error) throw error;
        Object.assign(matter, payload);
        renderCase();
        renderHero();
        renderFinancial();
      }
    );

    // ── Marriage / separation ──
    wireSection('marriage', 'view-marriage', 'form-marriage',
      'btn-edit-marriage', 'btn-cancel-marriage',
      buildMarriageFields,
      async (fd) => {
        if (!matter) return;
        const payload = {
          date_of_marriage:     fd.get('date_of_marriage') || null,
          place_of_marriage:    fd.get('place_of_marriage')?.trim() || null,
          separation_status:    fd.get('separation_status') || null,
          separation_date:      fd.get('separation_date') || null,
          has_prenup:           fd.get('has_prenup') === 'on',
          prior_divorce_filed:  fd.get('prior_divorce_filed') ? fd.get('prior_divorce_filed') === 'true' : null,
          prior_protective_order: fd.get('prior_protective_order') ? fd.get('prior_protective_order') === 'true' : null,
          marriage_counselor:   fd.get('marriage_counselor')?.trim() || null,
          separation_agreement: fd.get('separation_agreement') || null,
          involves_adultery:          fd.get('involves_adultery') === 'on',
          involves_physical_abuse:    fd.get('involves_physical_abuse') === 'on',
          involves_cruelty:           fd.get('involves_cruelty') === 'on',
          involves_insupportibility:  fd.get('involves_insupportibility') === 'on',
          involves_mental_health:     fd.get('involves_mental_health') === 'on',
          involves_felony:            fd.get('involves_felony') === 'on',
          involves_std:               fd.get('involves_std') === 'on',
          marital_difficulties:       fd.get('marital_difficulties')?.trim() || null,
        };
        const { error } = await db.from('matters').update(payload).eq('id', matter.id);
        if (error) throw error;
        Object.assign(matter, payload);
        renderMarriage();
      }
    );

    // ── Financial ──
    wireSection('financial', 'view-financial', 'form-financial',
      'btn-edit-financial', 'btn-cancel-financial',
      buildFinancialFields,
      async (fd) => {
        if (!matter) return;
        const mPayload = {
          retainer_balance:   fd.get('retainer_balance') ? parseFloat(fd.get('retainer_balance')) : null,
          retainer_requested: fd.get('retainer_requested') ? parseFloat(fd.get('retainer_requested')) : null,
        };
        const fPayload = {
          financial_affidavit_status: fd.get('financial_affidavit_status') || 'not_started',
          client_monthly_income:      fd.get('client_monthly_income') ? parseFloat(fd.get('client_monthly_income')) : null,
          opposing_monthly_income:    fd.get('opposing_monthly_income') ? parseFloat(fd.get('opposing_monthly_income')) : null,
          real_estate_gross_value:    fd.get('real_estate_gross_value') ? parseFloat(fd.get('real_estate_gross_value')) : null,
          liquid_assets_value:        fd.get('liquid_assets_value') ? parseFloat(fd.get('liquid_assets_value')) : null,
          retirement_description:     fd.get('retirement_description')?.trim() || null,
          retirement_estimated_value: fd.get('retirement_estimated_value') ? parseFloat(fd.get('retirement_estimated_value')) : null,
          vehicles_description:       fd.get('vehicles_description')?.trim() || null,
          other_assets_description:   fd.get('other_assets_description')?.trim() || null,
          total_liabilities:          fd.get('total_liabilities') ? parseFloat(fd.get('total_liabilities')) : null,
          frequent_flyer_miles:       fd.get('frequent_flyer_miles')?.trim() || null,
          weapons_description:        fd.get('weapons_description')?.trim() || null,
          client_has_trust_assets:        fd.get('client_has_trust_assets') === '' ? null : fd.get('client_has_trust_assets') === 'true',
          client_trust_assets_explain:    fd.get('client_trust_assets_explain')?.trim() || null,
          opposing_has_trust_assets:      fd.get('opposing_has_trust_assets') === '' ? null : fd.get('opposing_has_trust_assets') === 'true',
          opposing_trust_assets_explain:  fd.get('opposing_trust_assets_explain')?.trim() || null,
          notes:                      fd.get('financial_notes')?.trim() || null,
        };
        const cPayload = {
          gross_annual_income: fd.get('gross_annual_income') ? parseFloat(fd.get('gross_annual_income')) : null,
        };

        const { error: mErr } = await db.from('matters').update(mPayload).eq('id', matter.id);
        if (mErr) throw mErr;
        const { error: cErr } = await db.from('clients').update(cPayload).eq('id', clientId);
        if (cErr) throw cErr;

        if (financial) {
          const { error: fErr } = await db.from('financial_info').update(fPayload).eq('id', financial.id);
          if (fErr) throw fErr;
          Object.assign(financial, fPayload);
        } else {
          const { data: newFi, error: fErr } = await db.from('financial_info')
            .insert({ ...fPayload, matter_id: matter.id }).select().single();
          if (fErr) throw fErr;
          financial = newFi;
        }
        Object.assign(matter, mPayload);
        Object.assign(client, cPayload);
        renderFinancial();
      }
    );

    // Circumstances: PI and Criminal get real inline edit; family law still defers to Case section
    wireSection('circumstances', 'view-circumstances', 'form-circumstances',
      'btn-edit-circumstances', 'btn-cancel-circumstances',
      buildCircumstancesFields,
      async (fd) => {
        if (!matter) return;
        const paKey = matterPracticeAreaKey();

        if (paKey === 'personal_injury') {
          const payload = {
            matter_id:            matter.id,
            incident_date:        fd.get('incident_date')        || null,
            incident_location:    fd.get('incident_location')?.trim()    || null,
            incident_description: fd.get('incident_description')?.trim() || null,
            at_fault_party:       fd.get('at_fault_party')?.trim()       || null,
            insurance_carrier:    fd.get('insurance_carrier')?.trim()    || null,
            claim_number:         fd.get('claim_number')?.trim()         || null,
            policy_limits:        fd.get('policy_limits')    ? parseFloat(fd.get('policy_limits'))    : null,
            treating_physician:   fd.get('treating_physician')?.trim()   || null,
            medical_provider:     fd.get('medical_provider')?.trim()     || null,
            sol_date:             fd.get('sol_date')             || null,
            demand_amount:        fd.get('demand_amount')   ? parseFloat(fd.get('demand_amount'))   : null,
            updated_at:           new Date().toISOString(),
          };
          if (piDetails?.id) {
            const { error } = await db.from('client_personal_injury').update(payload).eq('id', piDetails.id);
            if (error) throw error;
            piDetails = { ...piDetails, ...payload };
          } else {
            const { data, error } = await db.from('client_personal_injury').insert(payload).select().single();
            if (error) throw error;
            piDetails = data;
          }
          renderCircumstances();
          return;
        }

        if (paKey === 'criminal') {
          const payload = {
            matter_id:         matter.id,
            arrest_date:       fd.get('arrest_date')       || null,
            offense_date:      fd.get('offense_date')      || null,
            cause_number:      fd.get('cause_number')?.trim()      || null,
            charges:           fd.get('charges')?.trim()           || null,
            arresting_agency:  fd.get('arresting_agency')?.trim()  || null,
            bond_amount:       fd.get('bond_amount')  ? parseFloat(fd.get('bond_amount'))  : null,
            bond_type:         fd.get('bond_type')         || null,
            prosecutor:        fd.get('prosecutor')?.trim()        || null,
            next_hearing_type: fd.get('next_hearing_type')?.trim() || null,
            updated_at:        new Date().toISOString(),
          };
          if (criminalDetails?.id) {
            const { error } = await db.from('client_criminal').update(payload).eq('id', criminalDetails.id);
            if (error) throw error;
            criminalDetails = { ...criminalDetails, ...payload };
          } else {
            const { data, error } = await db.from('client_criminal').insert(payload).select().single();
            if (error) throw error;
            criminalDetails = data;
          }
          renderCircumstances();
          return;
        }

        // Family law: no extra editable fields here (submit button is hidden in buildCircumstancesFields)
      }
    );

    // Key dates wire
    document.getElementById('btn-add-date')?.addEventListener('click', () => openDateModal());
  }

  // ── Form builders ────────────────────────────────────────────────────────────

  function inp(name, label, value, type = 'text', extra = '') {
    return `
      <div class="field">
        <label>${Utils.esc(label)}</label>
        <input type="${type}" name="${name}" value="${Utils.esc(value ?? '')}" ${extra}>
      </div>`;
  }
  function sel(name, label, options, current) {
    const opts = options.map(([v, l]) => `<option value="${v}"${current === v ? ' selected' : ''}>${Utils.esc(l)}</option>`).join('');
    return `<div class="field"><label>${Utils.esc(label)}</label><select name="${name}"><option value="">—</option>${opts}</select></div>`;
  }
  function ck(name, label, checked, description = '') {
    return `
      <div class="flag-row" style="margin-bottom:var(--space-2)">
        <input type="checkbox" id="ck-${name}" name="${name}" ${checked ? 'checked' : ''}>
        <label for="ck-${name}" style="font-weight:400;font-size:var(--text-sm);cursor:pointer">
          ${Utils.esc(label)}
          ${description ? `<span style="display:block;font-size:var(--text-xs);color:var(--color-text-muted)">${Utils.esc(description)}</span>` : ''}
        </label>
      </div>`;
  }
  function ta(name, label, value, rows = 3) {
    return `<div class="field"><label>${Utils.esc(label)}</label><textarea name="${name}" rows="${rows}">${Utils.esc(value ?? '')}</textarea></div>`;
  }
  function row2(...cols) { return `<div class="field-row">${cols.join('')}</div>`; }
  function row3(...cols) { return `<div class="field-row thirds">${cols.join('')}</div>`; }

  function buildClientInfoFields() {
    const c = client;
    document.getElementById('fields-client-info').innerHTML = `
      ${row2(inp('first_name','First name',c.first_name,'text','required'), inp('last_name','Last name',c.last_name,'text','required'))}
      ${row2(inp('middle_name','Middle name',c.middle_name), inp('former_maiden_name','Former/maiden name',c.former_maiden_name))}
      ${row2(inp('dob','Date of birth',c.dob,'date'), inp('place_of_birth','Place of birth',c.place_of_birth))}
      ${row2(inp('driver_license_number','Driver\'s license #',c.driver_license_number), inp('driver_license_state','DL state',c.driver_license_state,'text','maxlength="2"'))}
      <p class="section-divider">Contact</p>
      ${row2(inp('cell_phone','Cell phone',c.cell_phone,'tel'), inp('home_phone','Home phone',c.home_phone,'tel'))}
      ${row2(inp('work_phone','Work phone',c.work_phone,'tel'), inp('fax','Fax',c.fax,'tel'))}
      ${row2(inp('email','Email',c.email,'email'), sel('preferred_contact','Preferred contact',[['phone','Phone'],['email','Email'],['portal','Portal message'],['text','Text']],c.preferred_contact))}
      <p class="section-divider">Address</p>
      ${row2(inp('address_line1','Street address',c.address_line1), inp('address_line2','Apt / Suite',c.address_line2))}
      ${row3(inp('city','City',c.city), inp('state','State',c.state||'TX','text','maxlength="2"'), inp('zip','ZIP',c.zip))}
      ${row2(inp('county','County (TX)',c.county), inp('length_of_residence','Length of residence',c.length_of_residence))}
      <p class="section-divider">Employment</p>
      ${row2(inp('employer','Employer',c.employer), inp('employer_address_line1','Employer address',c.employer_address_line1))}
      ${row3(inp('employer_city','City',c.employer_city), inp('employer_state','State',c.employer_state,'text','maxlength="2"'), inp('employer_zip','ZIP',c.employer_zip))}
      ${row2(inp('length_of_employment','Length of employment',c.length_of_employment), inp('gross_annual_income','Gross annual income',c.gross_annual_income,'number','min="0" step="0.01"'))}
      <p class="section-divider">Background</p>
      ${row2(inp('education','Education level',c.education), inp('living_with_others','Living with others (who)',c.living_with_others))}
      <p class="section-divider">Name restoration</p>
      ${ck('name_restoration_requested','Name restoration requested',c.name_restoration_requested)}
      ${inp('name_restored_to','Name to restore to',c.name_restored_to)}
    `;
  }

  function buildEmrgFields() {
    const c = client;
    document.getElementById('fields-client-emrg').innerHTML = `
      ${row2(inp('emergency_contact_name','Emergency contact name',c.emergency_contact_name), inp('emergency_contact_phone','Emergency contact phone',c.emergency_contact_phone,'tel'))}
      ${sel('referral_source','Referral source',[['advertisement','Advertisement'],['attorney','Attorney'],['client','Client'],['financial_advisor','Financial advisor'],['internet','Internet'],['other','Other']],c.referral_source)}
      ${inp('referral_name','Referral name',c.referral_name)}
      ${inp('intake_date','Intake date',c.intake_date,'date')}
      ${ta('notes','Internal notes',c.notes)}
    `;
  }

  function buildComplianceFields() {
    const c = client;
    document.getElementById('fields-compliance').innerHTML = `
      ${ta('conflict_check_notes','Conflict check notes',c.conflict_check_notes)}
      ${ck('is_dv_confidential','DV / Protective order — address confidential',c.is_dv_confidential,'Restricts address visibility per Texas DV confidentiality rules')}
    `;
  }

  function buildCircumstancesFields() {
    const paKey   = matterPracticeAreaKey();
    const fieldsEl  = document.getElementById('fields-circumstances');
    const submitBtn = document.querySelector('#form-circumstances [type=submit]');

    if (paKey === 'personal_injury') {
      const pi = piDetails || {};
      if (submitBtn) submitBtn.style.display = '';
      fieldsEl.innerHTML =
        inp('incident_date',        'Incident date',        pi.incident_date,        'date') +
        inp('incident_location',    'Incident location',    pi.incident_location) +
        `<div class="field"><label>Description</label><textarea name="incident_description" rows="3" style="width:100%;resize:vertical">${Utils.esc(pi.incident_description || '')}</textarea></div>` +
        inp('at_fault_party',       'At-fault party',       pi.at_fault_party) +
        inp('insurance_carrier',    'Insurance carrier',    pi.insurance_carrier) +
        inp('claim_number',         'Claim number',         pi.claim_number) +
        inp('policy_limits',        'Policy limits ($)',     pi.policy_limits,       'number') +
        inp('treating_physician',   'Treating physician',   pi.treating_physician) +
        inp('medical_provider',     'Medical provider',     pi.medical_provider) +
        inp('sol_date',             'SOL date',             pi.sol_date,            'date') +
        inp('demand_amount',        'Demand amount ($)',     pi.demand_amount,       'number') +
        '<div class="form-error hidden"></div>';
      return;
    }

    if (paKey === 'criminal') {
      const cr = criminalDetails || {};
      const bondOpts = [
        ['personal_recognizance', 'Personal Recognizance'],
        ['cash',  'Cash'],
        ['surety','Surety'],
        ['no_bond','No Bond'],
      ];
      if (submitBtn) submitBtn.style.display = '';
      fieldsEl.innerHTML =
        inp('arrest_date',       'Arrest date',       cr.arrest_date,      'date') +
        inp('offense_date',      'Offense date',      cr.offense_date,     'date') +
        inp('cause_number',      'Cause number',      cr.cause_number) +
        `<div class="field"><label>Charges</label><textarea name="charges" rows="3" style="width:100%;resize:vertical">${Utils.esc(cr.charges || '')}</textarea></div>` +
        inp('arresting_agency',  'Arresting agency',  cr.arresting_agency) +
        inp('bond_amount',       'Bond amount ($)',    cr.bond_amount,      'number') +
        sel('bond_type',         'Bond type',         bondOpts,            cr.bond_type) +
        inp('prosecutor',        'Prosecutor',        cr.prosecutor) +
        inp('next_hearing_type', 'Next hearing type', cr.next_hearing_type) +
        '<div class="form-error hidden"></div>';
      return;
    }

    // Family law or unknown — no editable fields here
    if (submitBtn) submitBtn.style.display = 'none';
    fieldsEl.innerHTML = '<p class="text-sm text-muted" style="padding:var(--space-2) 0">Family law case-specific details are captured in the Case Details section above.</p>';
  }

  function buildCaseFields() {
    const m        = matter;
    const statusOpts  = [['intake','Intake'],['active','Active'],['on_hold','On Hold'],['closed','Closed']];
    const billingOpts = [['hourly','Hourly'],['flat_fee','Flat Fee'],['contingency','Contingency'],['hybrid','Hybrid']];
    const ATTY_ROLES  = new Set(['Owner', 'Attorney', 'Partner Attorney']);
    const attyOpts    = users.filter(u => ATTY_ROLES.has(u.roles?.name)).map(u => [u.id, Utils.fullName(u)]);

    const paOpts   = practiceAreas.map(p => [p.id, p.name]);
    const selPaId  = m?.practice_area_id || '';
    const ctOpts   = caseTypesData
      .filter(ct => ct.practice_area_id === selPaId)
      .map(ct => [ct.id, ct.name]);

    const fieldsEl = document.getElementById('fields-case');
    fieldsEl.innerHTML = `
      ${row2(sel('practice_area_id','Practice area',paOpts,selPaId), sel('case_type_id','Case type',ctOpts,m?.case_type_id))}
      ${row2(inp('case_number','Case number',m?.case_number), sel('status','Status',statusOpts,m?.status))}
      ${row2(inp('court_county','Court / County',m?.court_county), inp('judge_name','Judge',m?.judge_name))}
      ${row2(inp('date_filed','Date filed',m?.date_filed,'date'), sel('assigned_attorney_id','Assigned attorney',attyOpts,m?.assigned_attorney_id))}
      ${row2(sel('billing_type','Billing type',billingOpts,m?.billing_type), inp('retainer_balance','Retainer balance ($)',m?.retainer_balance,'number','min="0" step="0.01"'))}
      ${inp('retainer_requested','Retainer requested ($)',m?.retainer_requested,'number','min="0" step="0.01"')}
      <p class="section-divider">Suit status</p>
      ${ck('suit_filed','Suit filed',m?.suit_filed)}
      ${sel('been_served','Been served',[['true','Yes'],['false','No']],m?.been_served == null ? '' : String(m.been_served))}
      ${row2(inp('prior_attorney_consulted','Prior attorney consulted',m?.prior_attorney_consulted), inp('prior_attorney_retained','Prior attorney retained',m?.prior_attorney_retained))}
      ${ta('notes','Notes',m?.notes)}
    `;

    // Dynamically filter case types when practice area changes
    fieldsEl.querySelector('[name=practice_area_id]')?.addEventListener('change', e => {
      const paId  = e.target.value;
      const ctSel = fieldsEl.querySelector('[name=case_type_id]');
      const opts  = caseTypesData
        .filter(ct => ct.practice_area_id === paId)
        .map(ct => `<option value="${Utils.esc(ct.id)}">${Utils.esc(ct.name)}</option>`);
      ctSel.innerHTML = `<option value="">— Select —</option>${opts.join('')}`;
    });
  }

  function buildMarriageFields() {
    const m = matter;
    document.getElementById('fields-marriage').innerHTML = `
      ${row2(inp('date_of_marriage','Date of marriage',m?.date_of_marriage,'date'), inp('place_of_marriage','Place of marriage',m?.place_of_marriage))}
      ${sel('separation_status','Separation status',[['not_separated','Not separated'],['separated','Separated'],['counseling','In counseling']],m?.separation_status)}
      ${row2(inp('separation_date','Separation date',m?.separation_date,'date'), inp('marriage_counselor','Counselor',m?.marriage_counselor))}
      ${sel('separation_agreement','Separation agreement',[['none','None'],['written','Written'],['oral','Oral']],m?.separation_agreement)}
      ${ck('has_prenup','Has prenuptial agreement',m?.has_prenup)}
      ${sel('prior_divorce_filed','Prior divorce filed',[['true','Yes'],['false','No']],m?.prior_divorce_filed == null ? '' : String(m.prior_divorce_filed))}
      ${sel('prior_protective_order','Prior protective order',[['true','Yes'],['false','No']],m?.prior_protective_order == null ? '' : String(m.prior_protective_order))}
      <p class="section-divider">Circumstances (check all that apply)</p>
      ${ck('involves_adultery','Adultery',m?.involves_adultery)}
      ${ck('involves_physical_abuse','Physical abuse',m?.involves_physical_abuse)}
      ${ck('involves_cruelty','Cruelty',m?.involves_cruelty)}
      ${ck('involves_insupportibility','Insupportibility',m?.involves_insupportibility)}
      ${ck('involves_mental_health','Mental health issue',m?.involves_mental_health)}
      ${ck('involves_felony','Felony conviction',m?.involves_felony)}
      ${ck('involves_std','STD',m?.involves_std)}
      ${ta('marital_difficulties','Marital difficulties — additional notes',m?.marital_difficulties)}
    `;
  }

  function buildFinancialFields() {
    const f = financial || {};
    const m = matter;
    const c = client;
    document.getElementById('fields-financial').innerHTML = `
      ${row2(inp('retainer_requested','Retainer requested ($)',m?.retainer_requested,'number','min="0" step="0.01"'), inp('retainer_balance','Retainer balance ($)',m?.retainer_balance,'number','min="0" step="0.01"'))}
      ${sel('financial_affidavit_status','Financial affidavit status',[['not_started','Not started'],['draft','Draft'],['filed','Filed']],f.financial_affidavit_status)}
      <p class="section-divider">Income</p>
      ${row2(inp('gross_annual_income','Client gross annual income ($)',c.gross_annual_income,'number','min="0" step="0.01"'), inp('client_monthly_income','Client monthly income ($)',f.client_monthly_income,'number','min="0" step="0.01"'))}
      ${inp('opposing_monthly_income','Opposing party monthly income ($)',f.opposing_monthly_income,'number','min="0" step="0.01"')}
      <p class="section-divider">Assets</p>
      ${row2(inp('real_estate_gross_value','Real estate gross value ($)',f.real_estate_gross_value,'number','min="0" step="0.01"'), inp('liquid_assets_value','Liquid assets ($)',f.liquid_assets_value,'number','min="0" step="0.01"'))}
      ${row2(inp('retirement_description','Retirement (description)',f.retirement_description), inp('retirement_estimated_value','Retirement estimated value ($)',f.retirement_estimated_value,'number','min="0" step="0.01"'))}
      ${ta('vehicles_description','Vehicles (make/model/value)',f.vehicles_description,2)}
      ${ta('other_assets_description','Other assets',f.other_assets_description,2)}
      ${ta('weapons_description','Weapons',f.weapons_description,2)}
      ${row2(inp('total_liabilities','Total liabilities ($)',f.total_liabilities,'number','min="0" step="0.01"'), inp('frequent_flyer_miles','Frequent flyer miles',f.frequent_flyer_miles))}
      <p class="section-divider">Trust Assets</p>
      ${row2(sel('client_has_trust_assets','Client — assets in a trust?',[['true','Yes'],['false','No']], f.client_has_trust_assets == null ? '' : String(f.client_has_trust_assets)), inp('client_trust_assets_explain','If yes, explain',f.client_trust_assets_explain))}
      ${row2(sel('opposing_has_trust_assets',"Opposing party — assets in a trust?",[['true','Yes'],['false','No']], f.opposing_has_trust_assets == null ? '' : String(f.opposing_has_trust_assets)), inp('opposing_trust_assets_explain','If yes, explain',f.opposing_trust_assets_explain))}
      ${ta('financial_notes','Notes',f.notes,2)}
    `;
  }

  // ── Date modal ───────────────────────────────────────────────────────────────

  function openDateModal(existing = null) {
    if (!matter) { Utils.toast('No matter loaded.', 'error'); return; }
    const modalEl = document.getElementById('date-modal');
    const dateTypeOpts = DATE_TYPES.map(([v, l]) =>
      `<option value="${v}"${existing?.date_type === v ? ' selected' : ''}>${Utils.esc(l)}</option>`
    ).join('');

    modalEl.innerHTML = `
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <h2 class="modal-title">${existing ? 'Edit' : 'Add'} key date</h2>
          <button class="modal-close">×</button>
        </div>
        <form id="date-form" novalidate>
          <div class="modal-body">
            <div class="field"><label>Date type <span class="required">*</span></label>
              <select name="date_type" required><option value="">— Select —</option>${dateTypeOpts}</select>
            </div>
            ${inp('date_value','Date','','date')}
            ${inp('time_value','Time (optional)',existing?.time_value || '','text','placeholder="e.g. 9:00 AM"')}
            ${inp('description','Description / notes',existing?.description || '')}
            ${ck('is_milestone','Is milestone (triggers reminder engine)',existing?.is_milestone || false)}
          </div>
          <div class="modal-footer">
            <div id="date-err" class="form-error hidden" style="flex:1;margin-right:auto"></div>
            <button type="button" class="btn btn--secondary btn--sm modal-cancel">Cancel</button>
            <button type="submit" class="btn btn--primary btn--sm">${existing ? 'Save' : 'Add date'}</button>
          </div>
        </form>
      </div>`;

    // Pre-fill date value after HTML is set
    if (existing?.date_value) modalEl.querySelector('[name=date_value]').value = existing.date_value;

    modalEl.classList.remove('hidden');
    modalEl.querySelector('.modal-close').addEventListener('click', () => closeModal(modalEl));
    modalEl.querySelector('.modal-cancel').addEventListener('click', () => closeModal(modalEl));
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(modalEl); });

    modalEl.querySelector('#date-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = modalEl.querySelector('#date-err');
      errEl.classList.add('hidden');
      const saveBtn = e.target.querySelector('[type=submit]');
      Utils.setLoading(saveBtn, true);
      try {
        const payload = {
          matter_id:    matter.id,
          date_type:    fd.get('date_type'),
          date_value:   fd.get('date_value'),
          time_value:   fd.get('time_value')?.trim() || null,
          description:  fd.get('description')?.trim() || null,
          is_milestone: fd.get('is_milestone') === 'on',
        };
        if (!payload.date_type || !payload.date_value) throw new Error('Date type and date are required.');

        if (existing) {
          const { error } = await db.from('key_dates').update(payload).eq('id', existing.id);
          if (error) throw error;
          const idx = keyDates.findIndex(d => d.id === existing.id);
          if (idx !== -1) keyDates[idx] = { ...keyDates[idx], ...payload };

          // Sync to calendar if already pushed
          if (existing.google_event_id) {
            const dateLabel  = DATE_TYPES.find(([k]) => k === payload.date_type)?.[1] || Utils.titleCase(payload.date_type);
            const session    = await Auth.getSession();
            fetch('/api/calendar/events', {
              method:  'PATCH',
              headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
              body:    JSON.stringify({
                eventId:     existing.google_event_id,
                title:       `${dateLabel} — ${Utils.fullName(client)}`,
                description: payload.description || '',
                date:        payload.date_value !== existing.date_value ? payload.date_value : undefined,
              }),
            }).catch(err => console.warn('[cal sync]', err.message));
          }
        } else {
          const { data, error } = await db.from('key_dates').insert(payload).select().single();
          if (error) throw error;
          keyDates.push(data);
          keyDates.sort((a, b) => a.date_value.localeCompare(b.date_value));
        }

        closeModal(modalEl);
        renderDates();
        Utils.toast('Date saved.', 'success');
      } catch (err) {
        errEl.textContent = err.message || 'Save failed.';
        errEl.classList.remove('hidden');
        Utils.setLoading(saveBtn, false);
      }
    });
  }

  // Date types that usually have a specific time (prompt for start/end)
  const TIME_SENSITIVE = new Set(['hearing', 'trial', 'deposition', 'mediation']);

  function openCalDateModal(dateId) {
    const d = keyDates.find(kd => kd.id === dateId);
    if (!d) return;

    const dateLabel  = DATE_TYPES.find(([k]) => k === d.date_type)?.[1] || Utils.titleCase(d.date_type);
    const clientName = Utils.fullName(client);
    const isTimed    = TIME_SENSITIVE.has(d.date_type);
    const fmtDate    = new Date(d.date_value + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    _calPendingDateId = dateId;

    document.getElementById('cal-date-title').value    = `${dateLabel} — ${clientName}`;
    document.getElementById('cal-date-display').textContent = fmtDate;
    document.getElementById('cal-date-location').value = '';
    document.getElementById('cal-date-form-error').classList.add('hidden');

    const startEl  = document.getElementById('cal-date-start');
    const endEl    = document.getElementById('cal-date-end');
    const startLbl = document.getElementById('cal-date-start-lbl');
    const endLbl   = document.getElementById('cal-date-end-lbl');

    if (isTimed) {
      startEl.value    = '09:00';
      endEl.value      = '10:00';
      startEl.required = true;
      endEl.required   = true;
      startLbl.innerHTML = 'Start time <span class="required">*</span>';
      endLbl.innerHTML   = 'End time <span class="required">*</span>';
    } else {
      startEl.value    = '';
      endEl.value      = '';
      startEl.required = false;
      endEl.required   = false;
      startLbl.innerHTML = 'Start time <span style="color:var(--color-text-muted);font-weight:400">(optional)</span>';
      endLbl.innerHTML   = 'End time <span style="color:var(--color-text-muted);font-weight:400">(optional)</span>';
    }

    document.getElementById('cal-date-save-btn').disabled    = false;
    document.getElementById('cal-date-save-btn').textContent = 'Add to Calendar';
    document.getElementById('cal-date-modal').classList.remove('hidden');
    document.getElementById('cal-date-title').focus();
  }

  function wireCalDateModal() {
    const modalEl  = document.getElementById('cal-date-modal');
    const formEl   = document.getElementById('cal-date-form');
    const errEl    = document.getElementById('cal-date-form-error');
    const saveBtn  = document.getElementById('cal-date-save-btn');

    function closeCalModal() { modalEl.classList.add('hidden'); _calPendingDateId = null; }

    document.getElementById('cal-date-modal-close').addEventListener('click', closeCalModal);
    document.getElementById('cal-date-modal-cancel').addEventListener('click', closeCalModal);
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeCalModal(); });

    formEl.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.classList.add('hidden');
      const dateId = _calPendingDateId;
      if (!dateId) return;
      const d = keyDates.find(kd => kd.id === dateId);
      if (!d) return;

      const title    = document.getElementById('cal-date-title').value.trim();
      const startVal = document.getElementById('cal-date-start').value;
      const endVal   = document.getElementById('cal-date-end').value;
      const location = document.getElementById('cal-date-location').value.trim();
      const isTimed  = TIME_SENSITIVE.has(d.date_type);

      if (!title) { errEl.textContent = 'Title is required.'; errEl.classList.remove('hidden'); return; }
      if (isTimed && (!startVal || !endVal)) {
        errEl.textContent = 'Start and end time are required for this event type.';
        errEl.classList.remove('hidden');
        return;
      }
      if (startVal && !endVal) {
        errEl.textContent = 'Please enter an end time.';
        errEl.classList.remove('hidden');
        return;
      }

      saveBtn.disabled    = true;
      saveBtn.textContent = 'Adding…';

      const payload = { title, description: d.description || '' };
      if (location) payload.location = location;

      if (startVal && endVal) {
        payload.startDateTime = `${d.date_value}T${startVal}:00`;
        payload.endDateTime   = `${d.date_value}T${endVal}:00`;
        payload.timeZone      = 'America/Chicago';
      } else {
        payload.allDay     = true;
        payload.startDate  = d.date_value;
      }

      try {
        const session = await Auth.getSession();
        const res     = await fetch('/api/calendar/events', {
          method:  'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) {
          if (data.notConnected) {
            errEl.innerHTML = 'No calendar connected — <a href="#settings/calendar" style="color:inherit;text-decoration:underline;cursor:pointer">connect in Settings → Calendar</a>.';
            errEl.classList.remove('hidden');
          } else {
            errEl.textContent = data.error || 'Failed to create event.';
            errEl.classList.remove('hidden');
          }
          saveBtn.disabled    = false;
          saveBtn.textContent = 'Add to Calendar';
          return;
        }

        const { error } = await db.from('key_dates').update({ google_event_id: data.event.id }).eq('id', dateId);
        if (error) throw error;

        const idx = keyDates.findIndex(kd => kd.id === dateId);
        if (idx !== -1) keyDates[idx].google_event_id = data.event.id;

        Utils.toast('Added to Google Calendar.', 'success');
        closeCalModal();
        renderDates();
      } catch (err) {
        errEl.textContent   = err.message || 'Failed to add to calendar.';
        errEl.classList.remove('hidden');
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Add to Calendar';
      }
    });
  }

  async function deleteDate(id) {
    if (!await Utils.confirm('Delete this date?', { confirmLabel: 'Delete', danger: true })) return;
    const { error } = await db.from('key_dates').delete().eq('id', id);
    if (error) { Utils.toast(error.message, 'error'); return; }
    keyDates = keyDates.filter(d => d.id !== id);
    renderDates();
    Utils.toast('Date deleted.', 'success');
  }

  // ── Child modal ──────────────────────────────────────────────────────────────

  function openChildModal(existing = null) {
    if (!matter) { Utils.toast('No matter loaded.', 'error'); return; }
    const modalEl = document.getElementById('child-modal');
    modalEl.innerHTML = `
      <div class="modal" style="max-width:600px">
        <div class="modal-header">
          <h2 class="modal-title">${existing ? 'Edit' : 'Add'} child</h2>
          <button class="modal-close">×</button>
        </div>
        <form id="child-form" novalidate>
          <div class="modal-body">
            ${row2(inp('first_name','First name *',existing?.first_name||'','text','required'), inp('last_name','Last name',existing?.last_name||''))}
            ${row2(inp('dob','Date of birth',existing?.dob||'','date'), sel('sex','Sex',[['M','Male'],['F','Female'],['other','Other']],existing?.sex))}
            ${row2(inp('place_of_birth','Place of birth',existing?.place_of_birth||''), inp('current_residence','Current residence',existing?.current_residence||''))}
            ${ta('custody_arrangement','Custody arrangement',existing?.custody_arrangement||'',2)}
            ${ta('special_needs','Special needs / medical conditions',existing?.special_needs||'',2)}
            <p class="section-divider">Health Insurance</p>
            ${row2(inp('health_ins_company','Insurance company',existing?.health_ins_company||''), inp('health_ins_id','Member ID',existing?.health_ins_id||''))}
            ${row2(inp('health_ins_group','Group #',existing?.health_ins_group||''), sel('health_ins_type','Type',[['employer','Employer'],['individual','Individual'],['other','Other']],existing?.health_ins_type))}
            ${row2(inp('health_ins_premium','Monthly premium ($)',existing?.health_ins_premium||'','number','min="0" step="0.01"'), inp('health_ins_premium_payer','Premium payer',existing?.health_ins_premium_payer||''))}
            <p class="section-divider">Disputes</p>
            ${ck('paternity_dispute','Paternity disputed',existing?.paternity_dispute||false)}
            ${ck('custody_dispute','Custody disputed',existing?.custody_dispute||false)}
            ${ta('third_party_custody_notes','Third-party custody / visitation notes',existing?.third_party_custody_notes||'',2)}
          </div>
          <div class="modal-footer">
            <div id="child-err" class="form-error hidden" style="flex:1;margin-right:auto"></div>
            <button type="button" class="btn btn--secondary btn--sm modal-cancel">Cancel</button>
            <button type="submit" class="btn btn--primary btn--sm">${existing ? 'Save' : 'Add child'}</button>
          </div>
        </form>
      </div>`;

    modalEl.classList.remove('hidden');
    modalEl.querySelector('.modal-close').addEventListener('click', () => closeModal(modalEl));
    modalEl.querySelector('.modal-cancel').addEventListener('click', () => closeModal(modalEl));
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(modalEl); });

    modalEl.querySelector('#child-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = modalEl.querySelector('#child-err');
      errEl.classList.add('hidden');
      const saveBtn = e.target.querySelector('[type=submit]');
      Utils.setLoading(saveBtn, true);
      try {
        const payload = {
          matter_id:              matter.id,
          first_name:             fd.get('first_name')?.trim(),
          last_name:              fd.get('last_name')?.trim() || null,
          dob:                    fd.get('dob') || null,
          sex:                    fd.get('sex') || null,
          place_of_birth:         fd.get('place_of_birth')?.trim() || null,
          current_residence:      fd.get('current_residence')?.trim() || null,
          custody_arrangement:    fd.get('custody_arrangement')?.trim() || null,
          special_needs:          fd.get('special_needs')?.trim() || null,
          health_ins_company:     fd.get('health_ins_company')?.trim() || null,
          health_ins_id:          fd.get('health_ins_id')?.trim() || null,
          health_ins_group:       fd.get('health_ins_group')?.trim() || null,
          health_ins_type:        fd.get('health_ins_type') || null,
          health_ins_premium:     fd.get('health_ins_premium') ? parseFloat(fd.get('health_ins_premium')) : null,
          health_ins_premium_payer: fd.get('health_ins_premium_payer')?.trim() || null,
          paternity_dispute:      fd.get('paternity_dispute') === 'on',
          custody_dispute:        fd.get('custody_dispute') === 'on',
          third_party_custody_notes: fd.get('third_party_custody_notes')?.trim() || null,
        };
        if (!payload.first_name) throw new Error('First name is required.');

        if (existing) {
          const { error } = await db.from('children').update(payload).eq('id', existing.id);
          if (error) throw error;
          const idx = children.findIndex(c => c.id === existing.id);
          if (idx !== -1) children[idx] = { ...children[idx], ...payload };
        } else {
          const { data, error } = await db.from('children').insert(payload).select().single();
          if (error) throw error;
          children.push(data);
        }
        closeModal(modalEl);
        renderChildren();
        Utils.toast('Child saved.', 'success');
      } catch (err) {
        errEl.textContent = err.message || 'Save failed.';
        errEl.classList.remove('hidden');
        Utils.setLoading(saveBtn, false);
      }
    });
  }

  async function deleteChild(id) {
    if (!await Utils.confirm('Remove this child from the matter? This cannot be undone.', { confirmLabel: 'Remove', danger: true })) return;
    const { error } = await db.from('children').delete().eq('id', id);
    if (error) { Utils.toast(error.message, 'error'); return; }
    children = children.filter(c => c.id !== id);
    renderChildren();
    Utils.toast('Child removed.', 'success');
  }

  // ── Opposing party modal ─────────────────────────────────────────────────────

  function openOpposingModal(existing = null, role = 'primary') {
    if (!matter) { Utils.toast('No matter loaded.', 'error'); return; }
    const isJointSponsor = role === 'joint_sponsor';
    const roleLabel = isJointSponsor ? 'joint sponsor' : party2Label().toLowerCase();
    const modalEl = document.getElementById('opposing-modal');
    const op = existing || {};
    modalEl.innerHTML = `
      <div class="modal" style="max-width:680px">
        <div class="modal-header">
          <h2 class="modal-title">${existing ? 'Edit' : 'Add'} ${roleLabel}</h2>
          <button class="modal-close">×</button>
        </div>
        <form id="opposing-form" novalidate>
          <div class="modal-body">
            <p class="section-divider">Identity</p>
            ${row2(inp('first_name','First name *',op.first_name||'','text','required'), inp('last_name','Last name',op.last_name||''))}
            ${row2(inp('middle_name','Middle name',op.middle_name||''), inp('former_maiden_name','Former/maiden',op.former_maiden_name||''))}
            ${row2(inp('dob','Date of birth',op.dob||'','date'), inp('place_of_birth','Place of birth',op.place_of_birth||''))}
            ${row2(inp('driver_license_number','DL number',op.driver_license_number||''), inp('driver_license_state','DL state',op.driver_license_state||'','text','maxlength="2"'))}
            ${isImmMatter() ? `
            <p class="section-divider">${isJointSponsor ? 'Sponsor details' : 'Petitioner details'}</p>
            ${isJointSponsor
              ? sel('immigration_status','Immigration status',[['U.S. Citizen','U.S. Citizen'],['Lawful Permanent Resident','Lawful Permanent Resident'],['Other','Other']],op.immigration_status)
              : row2(
                  sel('relationship_to_client','Relationship to client',[['Spouse','Spouse'],['Parent','Parent'],['Child','Child'],['Sibling','Sibling'],['Fiance(e)','Fiancé(e)'],['Other','Other']],op.relationship_to_client),
                  sel('immigration_status','Immigration status',[['U.S. Citizen','U.S. Citizen'],['Lawful Permanent Resident','Lawful Permanent Resident'],['Other','Other']],op.immigration_status)
                )}
            ${inp('a_number','A-Number (if any)',op.a_number||'')}` : ''}
            <p class="section-divider">Contact</p>
            ${row2(inp('cell_phone','Cell phone',op.cell_phone||'','tel'), inp('home_phone','Home phone',op.home_phone||'','tel'))}
            ${row2(inp('work_phone','Work phone',op.work_phone||'','tel'), inp('email','Email',op.email||'','email'))}
            <p class="section-divider">Address</p>
            ${ck('is_address_restricted','Address restricted (DV)',op.is_address_restricted||false)}
            ${row2(inp('address_line1','Street address',op.address_line1||''), inp('address_line2','Apt/Suite',op.address_line2||''))}
            ${row3(inp('city','City',op.city||''), inp('state','State',op.state||'TX','text','maxlength="2"'), inp('zip','ZIP',op.zip||''))}
            ${row2(inp('county','County',op.county||''), inp('length_of_residence','Residence length',op.length_of_residence||''))}
            <p class="section-divider">Employment</p>
            ${row2(inp('employer','Employer',op.employer||''), inp('gross_annual_income','Gross annual income ($)',op.gross_annual_income||'','number','min="0" step="0.01"'))}
            ${row2(inp('education','Education',op.education||''), inp('living_with_others','Living with others',op.living_with_others||''))}
            ${!isPF() && !isImmMatter() ? `
            <p class="section-divider">Financial separation</p>
            ${sel('financially_separated','Physically separated',[['true','Yes'],['false','No']],op.physically_separated == null ? '' : String(op.physically_separated))}
            ${sel('financial_arrangement','Financial arrangement',[['joint_account','Joint account'],['separate','Separate'],['other','Other']],op.financial_arrangement)}
            ${ta('financial_arrangement_notes','Notes on arrangement',op.financial_arrangement_notes||'',2)}` : ''}
            ${isImmMatter() ? '' : `
            <p class="section-divider">${isPF() ? "Party 2's Attorney" : 'Opposing Counsel'}</p>
            ${row2(inp('opposing_counsel_name','Attorney name',op.opposing_counsel_name||''), inp('opposing_counsel_firm','Firm',op.opposing_counsel_firm||''))}
            ${row2(inp('opposing_counsel_phone','Phone',op.opposing_counsel_phone||'','tel'), inp('opposing_counsel_email','Email',op.opposing_counsel_email||'','email'))}
            ${inp('opposing_counsel_address','Counsel address',op.opposing_counsel_address||'')}
            ${row3(inp('opposing_counsel_city','City',op.opposing_counsel_city||''), inp('opposing_counsel_state','State',op.opposing_counsel_state||'','text','maxlength="2"'), inp('opposing_counsel_zip','ZIP',op.opposing_counsel_zip||''))}`}
          </div>
          <div class="modal-footer">
            <div id="opposing-err" class="form-error hidden" style="flex:1;margin-right:auto"></div>
            <button type="button" class="btn btn--secondary btn--sm modal-cancel">Cancel</button>
            <button type="submit" class="btn btn--primary btn--sm">${existing ? 'Save' : `Add ${party2Label().toLowerCase()}`}</button>
          </div>
        </form>
      </div>`;

    modalEl.classList.remove('hidden');
    modalEl.querySelector('.modal-close').addEventListener('click', () => closeModal(modalEl));
    modalEl.querySelector('.modal-cancel').addEventListener('click', () => closeModal(modalEl));
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(modalEl); });

    modalEl.querySelector('#opposing-form').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errEl = modalEl.querySelector('#opposing-err');
      errEl.classList.add('hidden');
      const saveBtn = e.target.querySelector('[type=submit]');
      Utils.setLoading(saveBtn, true);
      try {
        const payload = {
          matter_id:            matter.id,
          first_name:           fd.get('first_name')?.trim(),
          last_name:            fd.get('last_name')?.trim() || null,
          middle_name:          fd.get('middle_name')?.trim() || null,
          former_maiden_name:   fd.get('former_maiden_name')?.trim() || null,
          dob:                  fd.get('dob') || null,
          place_of_birth:       fd.get('place_of_birth')?.trim() || null,
          ...(isImmMatter() ? {
            ...(isJointSponsor ? {} : { relationship_to_client: fd.get('relationship_to_client') || null }),
            immigration_status:     fd.get('immigration_status') || null,
            a_number:               fd.get('a_number')?.trim()?.toUpperCase() || null,
          } : {}),
          ...(existing ? {} : { party_role: role }),
          driver_license_number: fd.get('driver_license_number')?.trim() || null,
          driver_license_state:  fd.get('driver_license_state')?.trim()?.toUpperCase() || null,
          cell_phone:           fd.get('cell_phone')?.trim() || null,
          home_phone:           fd.get('home_phone')?.trim() || null,
          work_phone:           fd.get('work_phone')?.trim() || null,
          email:                fd.get('email')?.trim() || null,
          is_address_restricted: fd.get('is_address_restricted') === 'on',
          address_line1:        fd.get('address_line1')?.trim() || null,
          address_line2:        fd.get('address_line2')?.trim() || null,
          city:                 fd.get('city')?.trim() || null,
          state:                fd.get('state')?.trim()?.toUpperCase() || null,
          zip:                  fd.get('zip')?.trim() || null,
          county:               fd.get('county')?.trim() || null,
          length_of_residence:  fd.get('length_of_residence')?.trim() || null,
          employer:             fd.get('employer')?.trim() || null,
          gross_annual_income:  fd.get('gross_annual_income') ? parseFloat(fd.get('gross_annual_income')) : null,
          education:            fd.get('education')?.trim() || null,
          living_with_others:   fd.get('living_with_others')?.trim() || null,
          physically_separated: fd.get('financially_separated') ? fd.get('financially_separated') === 'true' : null,
          financial_arrangement: fd.get('financial_arrangement') || null,
          financial_arrangement_notes: fd.get('financial_arrangement_notes')?.trim() || null,
          opposing_counsel_name:  fd.get('opposing_counsel_name')?.trim() || null,
          opposing_counsel_firm:  fd.get('opposing_counsel_firm')?.trim() || null,
          opposing_counsel_phone: fd.get('opposing_counsel_phone')?.trim() || null,
          opposing_counsel_email: fd.get('opposing_counsel_email')?.trim() || null,
          opposing_counsel_address: fd.get('opposing_counsel_address')?.trim() || null,
          opposing_counsel_city:  fd.get('opposing_counsel_city')?.trim() || null,
          opposing_counsel_state: fd.get('opposing_counsel_state')?.trim()?.toUpperCase() || null,
          opposing_counsel_zip:   fd.get('opposing_counsel_zip')?.trim() || null,
        };
        if (!payload.first_name) throw new Error('First name is required.');

        let savedRow;
        if (existing) {
          const { error } = await db.from('opposing_parties').update(payload).eq('id', existing.id);
          if (error) throw error;
          savedRow = { ...existing, ...payload };
        } else {
          const { data, error } = await db.from('opposing_parties').insert(payload).select().single();
          if (error) throw error;
          savedRow = data;
        }
        if (isJointSponsor) jointSponsor = savedRow; else oppParty = savedRow;
        closeModal(modalEl);
        renderOpposing();
        Utils.toast(`${isJointSponsor ? 'Joint sponsor' : party2Label()} saved.`, 'success');
      } catch (err) {
        errEl.textContent = err.message || 'Save failed.';
        errEl.classList.remove('hidden');
        Utils.setLoading(saveBtn, false);
      }
    });
  }

  // ── Drafts tab ───────────────────────────────────────────────────────────────

  let _draftsLoaded = false;

  function wireDraftsTab() {
    if (!matter) return;
    document.getElementById('subtab-btn-drafts')?.classList.remove('hidden');
    _subtabLoaders.drafts = async () => {
      if (_draftsLoaded) return;
      _draftsLoaded = true;
      await loadDrafts();
    };
  }

  async function loadDrafts() {
    const container = document.getElementById('drafts-panel-content');
    if (!container || !matter) return;

    container.innerHTML = `<p style="color:var(--color-text-muted);font-size:var(--text-sm);padding:var(--space-4) 0">Loading drafts…</p>`;

    const { data: docs, error } = await db
      .from('draft_documents')
      .select('id, file_name, current_version_num, is_final, created_at, locked_by')
      .eq('matter_id', matter.id)
      .order('created_at', { ascending: false });

    if (error) {
      container.innerHTML = `<p style="color:var(--color-danger);font-size:var(--text-sm)">Failed to load drafts.</p>`;
      return;
    }

    if (!docs || docs.length === 0) {
      container.innerHTML = `<p style="color:var(--color-text-muted);font-size:var(--text-sm);padding:var(--space-4) 0">No drafts yet. Use the "Draft Document" button above to generate one.</p>`;
      return;
    }

    const rows = docs.map(doc => {
      const date = new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const badge = doc.is_final
        ? `<span class="badge badge--active">Final</span>`
        : doc.locked_by
          ? `<span class="badge badge--pending">In Use</span>`
          : `<span class="badge badge--inactive">Draft</span>`;
      const openBtn = !doc.is_final
        ? `<button class="btn btn--secondary btn--sm draft-open-btn" data-doc-id="${Utils.esc(doc.id)}">Open in Word</button>`
        : '';
      const finalBtn = `<button class="btn btn--ghost btn--sm draft-finalize-btn" data-doc-id="${Utils.esc(doc.id)}" data-is-final="${doc.is_final}">
        ${doc.is_final ? 'Un-finalize' : 'Finalize'}
      </button>`;

      return `<tr>
        <td style="font-weight:500">${Utils.esc(doc.file_name)}</td>
        <td style="color:var(--color-text-muted)">v${doc.current_version_num}</td>
        <td style="color:var(--color-text-muted);font-size:var(--text-sm)">${date}</td>
        <td>${badge}</td>
        <td style="text-align:right;white-space:nowrap;display:flex;gap:var(--space-2);justify-content:flex-end">${openBtn}${finalBtn}</td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <table class="data-table" style="margin-top:var(--space-2)">
        <thead><tr>
          <th>Document</th><th>Ver.</th><th>Created</th><th>Status</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

    container.querySelectorAll('.draft-open-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Opening…';
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/drafting/open', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body:    JSON.stringify({ doc_id: btn.dataset.docId }),
          });
          if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Error ${res.status}`);
          const data = await res.json();
          window.location.href = data.word_url;
          Utils.toast(`Opening "${data.file_name}" in Word…`, 'success');
        } catch (err) {
          Utils.toast(err.message || 'Failed to open document.', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
      });
    });

    container.querySelectorAll('.draft-finalize-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const isFinal = btn.dataset.isFinal === 'true';
        const msg = isFinal
          ? 'Remove Final status from this document?'
          : 'Mark as Final? The document will become visible in the client portal.';
        if (!await Utils.confirm(msg, { confirmLabel: isFinal ? 'Remove Final' : 'Mark as Final' })) return;
        btn.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/drafting/toggle-final', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body:    JSON.stringify({ doc_id: btn.dataset.docId }),
          });
          if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Error ${res.status}`);
          const d = await res.json();
          Utils.toast(`Document ${d.is_final ? 'finalized' : 'un-finalized'}.`, 'success');
          _draftsLoaded = false;
          await loadDrafts();
        } catch (err) {
          Utils.toast(err.message || 'Failed.', 'error');
          btn.disabled = false;
        }
      });
    });
  }

  // ── USCIS Forms tab ──────────────────────────────────────────────────────────

  let _formFillerLoaded = false;

  function wireFormFillerTab() {
    if (!matter) return;
    document.getElementById('subtab-btn-uscis-forms')?.classList.remove('hidden');
    _subtabLoaders['uscis-forms'] = async () => {
      if (_formFillerLoaded) return;
      _formFillerLoaded = true;
      await loadFormFiller();
    };
  }

  // Docket kit tags (DESIGN-SYSTEM.md) — token-driven, so light/dark is free.
  const FORM_FILLER_STATUS_TAG = {
    draft:        () => DK.tag('Draft', 'acc'),
    needs_review: () => DK.tag('Needs review', 'warn'),
    finalized:    () => DK.tag('Finalized', 'ok'),
  };

  async function loadFormFiller() {
    const container = document.getElementById('uscis-forms-panel-content');
    if (!container || !matter) return;

    container.innerHTML = `<div class="dk-empty">Loading forms…</div>`;

    let data;
    try {
      const session = await Auth.getSession();
      const res = await fetch(`/api/form-filler/package?matter_id=${encodeURIComponent(matter.id)}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Error ${res.status}`);
      data = await res.json();
    } catch (err) {
      container.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">Failed to load: ${Utils.esc(err.message)}</div>`;
      return;
    }

    // No early return for a missing package any more. Since migration 1605 the
    // case type only supplies a STARTING SET — a matter with no case type, or a
    // case type with no package, still gets a working tab it can add forms to.
    renderFormFillerPanel(container, data);
  }

  // POST/DELETE against /api/form-filler/matter-forms, then reload the tab.
  async function matterFormsRequest(method, template_id) {
    const session = await Auth.getSession();
    const res = await fetch('/api/form-filler/matter-forms', {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body:    JSON.stringify({ matter_id: matter.id, template_id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
    return body;
  }

  async function resetFormFiller({ template_ids = null, label = null } = {}) {
    const session = await Auth.getSession();
    const res = await fetch('/api/form-filler/reset', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body:    JSON.stringify({ matter_id: matter.id, ...(template_ids ? { template_ids } : {}) }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Error ${res.status}`);
    Utils.toast(label ? `${label} reset — back to Not Generated.` : 'All forms reset — back to Not Generated.', 'success');
    _formFillerLoaded = false;
    await loadFormFiller();
  }

  function renderFormFillerPanel(container, data) {
    const rows = data.forms.map(f => {
      const tag = f.status
        ? (FORM_FILLER_STATUS_TAG[f.status]?.() || '')
        : DK.tag('Not generated', 'mut');

      // Meta line: autofill coverage, then why the form can't be generated.
      const meta = [];
      if (f.fields_filled != null && f.fields_total != null) {
        meta.push(`<span>${f.fields_filled}/${f.fields_total} autofilled</span>`);
      }
      if (!f.template_ready) {
        meta.push(`<span class="danger">Template not yet uploaded</span>`);
      }

      const t   = Utils.esc(f.template_id);
      const lbl = Utils.esc(f.label);
      const act = [];

      if (f.generated_form_id && f.status !== 'finalized') {
        act.push(`<button class="dk-linkbtn ff-edit-btn" data-id="${Utils.esc(f.generated_form_id)}" data-template-id="${t}" data-label="${lbl}">Edit</button>`);
      }
      if (f.generated_form_id) {
        act.push(`<button class="dk-linkbtn ff-download-btn" data-id="${Utils.esc(f.generated_form_id)}" data-final="${f.status === 'finalized' ? '1' : '0'}">Open</button>`);
      }
      if (f.generated_form_id && f.status !== 'finalized') {
        act.push(`<button class="dk-linkbtn ff-finalize-btn" data-id="${Utils.esc(f.generated_form_id)}">Finalize</button>`);
      }
      if (f.template_ready) {
        act.push(`<button class="dk-linkbtn ff-regen-btn" data-template-id="${t}" data-has-final="${f.status === 'finalized'}">${f.generated_form_id ? 'Regenerate' : 'Generate'}</button>`);
      }

      // Destructive actions sit after a hairline divider so they never read as
      // part of the routine Edit/Open/Generate run.
      const destructive = [];
      if (f.generated_form_id) {
        destructive.push(`<button class="dk-linkbtn d ff-reset-form-btn" data-template-id="${t}" data-label="${lbl}" data-final="${f.status === 'finalized' ? '1' : '0'}">Reset</button>`);
      }
      // A finalized form is part of a real filing — the API refuses to remove
      // it, so say so here rather than letting the click fail.
      destructive.push(f.status === 'finalized'
        ? `<button class="dk-linkbtn" disabled title="Finalized forms can't be removed. Reset this form first if you really need to." style="opacity:.4;cursor:not-allowed">Remove</button>`
        : `<button class="dk-linkbtn d ff-remove-form-btn" data-template-id="${t}" data-label="${lbl}" data-generated="${f.generated_form_id ? '1' : '0'}">Remove</button>`);

      const divider = act.length
        ? `<span aria-hidden="true" style="width:1px;align-self:stretch;margin:0 2px;background:var(--line)"></span>`
        : '';

      return `
        <div class="dk-reg-row">
          <div style="min-width:0">
            <div class="dk-reg-title"><span>${lbl}</span>${tag}</div>
            ${meta.length ? `<div class="dk-reg-meta">${meta.join('<span class="sep">·</span>')}</div>` : ''}
          </div>
          <div class="dk-reg-act">${act.join('')}${divider}${destructive.join('')}</div>
        </div>`;
    }).join('');

    const anyGenerated = data.forms.some(f => f.generated_form_id);
    const anyFinalized = data.forms.some(f => f.status === 'finalized');
    const canAdd       = (data.available || []).length > 0;

    // The case-type package is now just the heading — the matter owns its list.
    const heading = data.package ? Utils.esc(data.package.name) : 'USCIS Forms';

    const body = data.forms.length
      ? `<div class="dk-register">${rows}</div>`
      : `<div class="dk-empty">No forms on this matter yet.${canAdd ? ' Use <strong>Add form</strong> to start building the package.' : ''}</div>`;

    // Footer actions are package-wide and deliberately quiet: per-form generate
    // is the primary path now, so "Generate all" is no longer a primary button.
    const footer = data.forms.length
      ? `<div style="display:flex;justify-content:flex-end;gap:var(--space-2);margin-top:var(--space-3)">
           ${anyGenerated ? '<button id="ff-reset-package-btn" class="dk-linkbtn d">Reset all</button>' : ''}
           <button id="ff-generate-package-btn" class="btn btn--secondary btn--sm">Generate all</button>
         </div>`
      : '';

    container.innerHTML = `
      <div class="dk-sec">
        <div class="dk-sec-head">
          <h2>${heading}</h2>
          <span class="dk-sec-count">${data.forms.length} form${data.forms.length === 1 ? '' : 's'}</span>
          <span class="dk-sec-rule"></span>
          ${canAdd ? '<button id="ff-add-form-btn" class="dk-sec-add">+ Add form</button>' : ''}
        </div>
        ${body}
        ${footer}
      </div>`;

    document.getElementById('ff-generate-package-btn')?.addEventListener('click', async (e) => {
      await runFormFillerGenerate({ matter_id: matter.id }, e.currentTarget);
    });

    document.getElementById('ff-add-form-btn')?.addEventListener('click', () => {
      openAddFormPicker(data.available);
    });

    document.getElementById('ff-reset-package-btn')?.addEventListener('click', async () => {
      const warning = anyFinalized
        ? 'Reset every form on this matter? All generated forms will be deleted — including manual edits AND finalized PDFs — and each returns to Not Generated. The list of forms itself, client data, and template defaults are not affected.'
        : 'Reset every form on this matter? All generated forms and any manual edits will be deleted, and each returns to Not Generated. The list of forms itself, client data, and template defaults are not affected.';
      if (!await Utils.confirm(warning, { confirmLabel: 'Reset all', danger: true })) return;
      const btn = document.getElementById('ff-reset-package-btn');
      btn.disabled = true;
      try {
        await resetFormFiller();
      } catch (err) {
        Utils.toast(err.message || 'Failed to reset forms.', 'error');
        btn.disabled = false;
      }
    });

    container.querySelectorAll('.ff-reset-form-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const label = btn.dataset.label;
        const warning = btn.dataset.final === '1'
          ? `Reset ${label}? Its finalized PDF, draft, and manual edits will be deleted and it returns to Not Generated. Other forms on this matter are not affected.`
          : `Reset ${label}? Its generated draft and manual edits will be deleted and it returns to Not Generated. Other forms on this matter are not affected.`;
        if (!await Utils.confirm(warning, { confirmLabel: 'Reset form', danger: true })) return;
        btn.disabled = true;
        try {
          await resetFormFiller({ template_ids: [btn.dataset.templateId], label });
        } catch (err) {
          Utils.toast(err.message || 'Failed to reset the form.', 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.ff-remove-form-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const label = btn.dataset.label;
        const warning = btn.dataset.generated === '1'
          ? `Remove ${label} from this matter? Its generated draft and manual edits will be deleted too. You can add the form back later, but the filled-in work will be gone.`
          : `Remove ${label} from this matter? You can add it back later.`;
        if (!await Utils.confirm(warning, { confirmLabel: 'Remove form', danger: true })) return;
        btn.disabled = true;
        try {
          await matterFormsRequest('DELETE', btn.dataset.templateId);
          Utils.toast(`${label} removed from this matter.`, 'success');
          _formFillerLoaded = false;
          await loadFormFiller();
        } catch (err) {
          Utils.toast(err.message || 'Failed to remove the form.', 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.ff-regen-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const force = btn.dataset.hasFinal === 'true'
          ? await Utils.confirm('This form was already finalized. Regenerate a new draft version anyway?', { confirmLabel: 'Regenerate' })
          : true;
        if (!force) return;
        await runFormFillerGenerate(
          { matter_id: matter.id, template_ids: [btn.dataset.templateId], force: btn.dataset.hasFinal === 'true' },
          btn,
        );
      });
    });

    container.querySelectorAll('.ff-finalize-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Utils.confirm('Finalize this form? It will be flattened to a static PDF; the fillable draft stays available separately.', { confirmLabel: 'Finalize' })) return;
        btn.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/form-filler/finalize', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body:    JSON.stringify({ generated_form_id: btn.dataset.id }),
          });
          if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Error ${res.status}`);
          Utils.toast('Form finalized.', 'success');
          _formFillerLoaded = false;
          await loadFormFiller();
        } catch (err) {
          Utils.toast(err.message || 'Failed to finalize.', 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.ff-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        openFormEditor(btn.dataset.templateId, btn.dataset.id, btn.dataset.label);
      });
    });

    container.querySelectorAll('.ff-download-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Opening…';
        try {
          const session = await Auth.getSession();
          const finalParam = btn.dataset.final === '1' ? '&final=1' : '';
          const res = await fetch(`/api/form-filler/download?id=${encodeURIComponent(btn.dataset.id)}${finalParam}`, {
            headers: { 'Authorization': `Bearer ${session.access_token}` },
          });
          if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Error ${res.status}`);
          const blob = await res.blob();
          const url  = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (err) {
          Utils.toast(err.message || 'Failed to open document.', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = orig;
        }
      });
    });
  }

  // "Add form" picker — every active, uploaded template not already on the
  // matter. Filtered, because this list grows with each USCIS form added
  // (see USCIS-FORM-PREP-PROCESS.md); it is not a short list for long.
  function openAddFormPicker(available) {
    let overlay = document.getElementById('ff-add-form-modal');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'ff-add-form-modal';
      overlay.className = 'modal-overlay hidden';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">Add a form</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <input type="search" id="ff-add-filter" placeholder="Filter by form number or name…" autocomplete="off">
          </div>
          <div id="ff-add-results" style="max-height:340px;overflow-y:auto"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn--secondary" id="ff-add-cancel">Cancel</button>
        </div>
      </div>`;

    const results = overlay.querySelector('#ff-add-results');
    const filter  = overlay.querySelector('#ff-add-filter');

    function close() { overlay.classList.add('hidden'); overlay.innerHTML = ''; }

    function draw(term) {
      const q = (term || '').trim().toLowerCase();
      const matches = q
        ? available.filter(a => a.form_key.toLowerCase().includes(q) || a.label.toLowerCase().includes(q))
        : available;

      if (!matches.length) {
        results.innerHTML = `<div class="dk-empty">No forms match “${Utils.esc(term)}”.</div>`;
        return;
      }

      results.innerHTML = `<div class="dk-register">${matches.map(a => `
        <div class="dk-reg-row">
          <div style="min-width:0"><div class="dk-reg-title"><span>${Utils.esc(a.label)}</span></div></div>
          <div class="dk-reg-act">
            <button class="dk-linkbtn ff-add-pick" data-template-id="${Utils.esc(a.template_id)}" data-label="${Utils.esc(a.label)}">Add</button>
          </div>
        </div>`).join('')}</div>`;

      results.querySelectorAll('.ff-add-pick').forEach(btn => {
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Adding…';
          try {
            await matterFormsRequest('POST', btn.dataset.templateId);
            Utils.toast(`${btn.dataset.label} added to this matter.`, 'success');
            close();
            _formFillerLoaded = false;
            await loadFormFiller();
          } catch (err) {
            Utils.toast(err.message || 'Failed to add the form.', 'error');
            btn.disabled = false;
            btn.textContent = 'Add';
          }
        });
      });
    }

    draw('');
    overlay.classList.remove('hidden');
    filter.addEventListener('input', () => draw(filter.value));
    overlay.querySelector('.modal-close').addEventListener('click', close);
    overlay.querySelector('#ff-add-cancel').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    filter.focus();
  }

  // trigger: the button that was actually clicked — the per-form Generate or
  // the footer Generate all. Falls back to the footer button so a caller that
  // doesn't pass one still shows progress somewhere.
  async function runFormFillerGenerate(body, trigger = null) {
    const btn  = trigger || document.getElementById('ff-generate-package-btn');
    const orig = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/form-filler/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body:    JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || `Error ${res.status}`);

      const errors = (result.results || []).filter(r => r.status === 'error' || r.status === 'skipped');
      if (errors.length) {
        Utils.toast(`Generated with ${errors.length} issue(s) — see console.`, 'error');
        console.warn('[form-filler] generate issues:', errors);
      } else {
        Utils.toast('Forms generated.', 'success');
      }
      _formFillerLoaded = false;
      await loadFormFiller();
    } catch (err) {
      Utils.toast(err.message || 'Failed to generate forms.', 'error');
    } finally {
      // The tab re-renders on success, so this only matters on the error path —
      // restore whatever the button actually said rather than a fixed label.
      if (btn) { btn.disabled = false; if (orig != null) btn.textContent = orig; }
    }
  }

  // ── USCIS form editor — Prima-style in-app editing + reverse autofill ───────
  //
  // Renders the generated draft with pdf.js (same CDN build sig-stamp uses)
  // with live AcroForm widgets. Edits autosave to /api/form-filler/fields as
  // per-matter manual edits (win over autofill on every regenerate); edits to
  // data-mapped fields can be written back to the client card / immigration
  // record / petitioner so every other form picks them up.

  let _pdfjsLoadPromise = null;
  function loadPdfJsLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (_pdfjsLoadPromise) return _pdfjsLoadPromise;
    _pdfjsLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => { _pdfjsLoadPromise = null; reject(new Error('Failed to load the PDF viewer library.')); };
      document.body.appendChild(s);
    });
    return _pdfjsLoadPromise;
  }

  function injectFormEditorStyles() {
    if (document.getElementById('ffe-styles')) return;
    const style = document.createElement('style');
    style.id = 'ffe-styles';
    style.textContent = `
      .ffe-overlay { position:fixed; inset:0; z-index:1000; background:var(--color-bg,#f4f4f5); display:flex; flex-direction:column; }
      .ffe-topbar { display:flex; align-items:center; gap:var(--space-3); padding:var(--space-2) var(--space-4); background:var(--color-surface,#fff); border-bottom:1px solid var(--color-border,#e4e4e7); flex-wrap:wrap; }
      .ffe-scroll { flex:1; overflow:auto; padding:var(--space-4); }
      .ffe-page { position:relative; margin:0 auto var(--space-4); box-shadow:0 1px 4px rgba(0,0,0,.28); width:fit-content; background:#fff; }
      .ffe-page canvas { display:block; }
      .ffe-status { font-size:var(--text-sm); color:var(--color-text-muted); min-width:130px; }
      .annotationLayer { position:absolute; top:0; left:0; width:100%; height:100%; transform-origin:0 0; }
      .annotationLayer section { position:absolute; text-align:initial; pointer-events:auto; box-sizing:border-box; transform-origin:0 0; }
      .annotationLayer .linkAnnotation > a { position:absolute; width:100%; height:100%; }
      .annotationLayer .textWidgetAnnotation input,
      .annotationLayer .textWidgetAnnotation textarea,
      .annotationLayer .choiceWidgetAnnotation select {
        background-color: rgba(0, 84, 232, 0.10); border: 1px solid transparent; box-sizing: border-box;
        font: calc(9px * var(--scale-factor, 1)) sans-serif; height: 100%; width: 100%;
        margin: 0; padding: 0 2px; vertical-align: top; resize: none;
      }
      .annotationLayer .buttonWidgetAnnotation.checkBox input,
      .annotationLayer .buttonWidgetAnnotation.radioButton input {
        appearance: auto; display: block; width: 100%; height: 100%; margin: 0; accent-color: var(--color-primary, #2563eb);
      }
      .annotationLayer .textWidgetAnnotation input:focus,
      .annotationLayer .textWidgetAnnotation textarea:focus,
      .annotationLayer .choiceWidgetAnnotation select:focus { outline: 2px solid var(--color-primary,#2563eb); background-color:#fff; }
      .annotationLayer section.ffe-dirty { outline: 2px solid var(--color-warning,#f59e0b); }
      .annotationLayer section.ffe-saved { outline: 2px solid var(--color-success,#16a34a); }
    `;
    document.head.appendChild(style);
  }

  async function openFormEditor(templateId, generatedFormId, label) {
    if (!matter) return;
    injectFormEditorStyles();

    const overlay = document.createElement('div');
    overlay.className = 'ffe-overlay';
    overlay.innerHTML = `
      <div class="ffe-topbar">
        <strong style="font-size:var(--text-base)">${Utils.esc(label)}</strong>
        <span class="ffe-status" id="ffe-status">Loading…</span>
        <span style="flex:1"></span>
        <button class="btn btn--ghost btn--sm" id="ffe-zoom-out" title="Zoom out">−</button>
        <button class="btn btn--ghost btn--sm" id="ffe-zoom-in" title="Zoom in">+</button>
        <button class="btn btn--secondary btn--sm hidden" id="ffe-writeback-btn"></button>
        <button class="btn btn--primary btn--sm" id="ffe-close">Save &amp; Close</button>
      </div>
      <div class="ffe-scroll" id="ffe-scroll"><p style="text-align:center;color:var(--color-text-muted);padding:var(--space-10)">Loading form…</p></div>`;
    document.body.appendChild(overlay);

    const statusEl = () => overlay.querySelector('#ffe-status');
    const setStatus = (t) => { const el = statusEl(); if (el) el.textContent = t; };

    // Editor state
    const pendingEdits = {};        // fieldName -> value, not yet POSTed
    const wbCandidates = {};        // fieldName -> { value, writeback:{bucket,column} }
    const sectionsByField = {};     // fieldName -> [section elements]
    let fieldInfo = {};             // fieldName -> map row from GET fields
    let anythingSaved = false;
    let saveTimer = null;
    let saving = false;
    let scale = 1.35;
    let pdfDoc = null;

    const close = async (skipRegen = false) => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      while (saving) await new Promise(r => setTimeout(r, 150));
      if (Object.keys(pendingEdits).length) await flushSaves();
      overlay.remove();
      if (anythingSaved && !skipRegen) {
        // Re-burn the draft PDF so Open/Download reflects the edits.
        await runFormFillerGenerate({ matter_id: matter.id, template_ids: [templateId] });
      }
    };
    overlay.querySelector('#ffe-close').addEventListener('click', () => close());

    async function apiFields(method, body) {
      const session = await Auth.getSession();
      const url = method === 'GET'
        ? `/api/form-filler/fields?matter_id=${encodeURIComponent(matter.id)}&template_id=${encodeURIComponent(templateId)}`
        : '/api/form-filler/fields';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: method === 'GET' ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      return data;
    }

    async function flushSaves() {
      if (saving) return;
      const entries = Object.entries(pendingEdits);
      if (!entries.length) return;
      saving = true;
      setStatus('Saving…');
      const batch = entries.map(([field_name, value]) => ({ field_name, value }));
      entries.forEach(([k]) => delete pendingEdits[k]);
      try {
        const result = await apiFields('POST', { matter_id: matter.id, template_id: templateId, edits: batch });
        if (result.errors?.length) console.warn('[form-editor] save issues:', result.errors);
        anythingSaved = true;
        batch.forEach(e => (sectionsByField[e.field_name] || []).forEach(s => { s.classList.remove('ffe-dirty'); s.classList.add('ffe-saved'); }));
        setStatus(Object.keys(pendingEdits).length ? 'Saving…' : 'All changes saved');
      } catch (err) {
        batch.forEach(e => { if (!(e.field_name in pendingEdits)) pendingEdits[e.field_name] = e.value; });
        setStatus('Save failed — retrying on next edit');
        Utils.toast(err.message || 'Failed to save edits.', 'error');
      } finally {
        saving = false;
        if (Object.keys(pendingEdits).length) scheduleSave();
      }
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveTimer = null; flushSaves(); }, 900);
    }

    function updateWritebackBtn() {
      const btn = overlay.querySelector('#ffe-writeback-btn');
      const n = Object.keys(wbCandidates).length;
      btn.classList.toggle('hidden', n === 0);
      btn.textContent = `Update client record (${n})`;
    }

    function recordEdit(fieldName, value, section) {
      pendingEdits[fieldName] = value;
      if (section) { section.classList.remove('ffe-saved'); section.classList.add('ffe-dirty'); }
      const info = fieldInfo[fieldName];
      if (info?.writeback) {
        if (value !== '' && value !== (info.autofill_value ?? '')) {
          wbCandidates[fieldName] = { value, writeback: info.writeback };
        } else {
          delete wbCandidates[fieldName];
        }
        updateWritebackBtn();
      }
      setStatus('Unsaved changes…');
      scheduleSave();
    }

    overlay.querySelector('#ffe-writeback-btn').addEventListener('click', async () => {
      const entries = Object.entries(wbCandidates);
      if (!entries.length) return;
      const WB_LABELS = { client: 'Client', petitioner: 'Petitioner', joint_sponsor: 'Joint Sponsor', immigration: 'Immigration' };
      const lines = entries.map(([f, c]) =>
        `• ${WB_LABELS[c.writeback.bucket] || c.writeback.bucket} — ${c.writeback.column.replace(/_/g, ' ')}: “${c.value}”`).join('\n');
      const ok = await Utils.confirm(
        `Save these values back to the record so every form uses them?\n\n${lines}`,
        { confirmLabel: 'Update record' });
      if (!ok) return;
      try {
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
        const result = await apiFields('POST', {
          matter_id: matter.id, template_id: templateId,
          edits: entries.map(([field_name, c]) => ({ field_name, value: c.value, write_back: true })),
        });
        if (result.errors?.length) {
          Utils.toast(`Some updates failed: ${result.errors[0]}`, 'error');
          console.warn('[form-editor] write-back issues:', result.errors);
        } else {
          Utils.toast('Record updated — other forms will pick this up on regenerate.', 'success');
        }
        anythingSaved = true;
        entries.forEach(([f]) => { delete wbCandidates[f]; delete pendingEdits[f]; });
        updateWritebackBtn();
      } catch (err) {
        Utils.toast(err.message || 'Failed to update record.', 'error');
      }
    });

    // Minimal link service — widget annotations don't navigate, but the
    // AnnotationLayer constructor expects one for Link annotations.
    const linkServiceStub = {
      externalLinkEnabled: false, externalLinkTarget: 0, externalLinkRel: 'noopener',
      getDestinationHash: () => '#', getAnchorUrl: () => '#',
      isInPresentationMode: false, addLinkAttributes: () => {},
      executeNamedAction: () => {}, executeSetOCGState: () => {}, goToDestination: async () => {},
    };

    async function renderAllPages() {
      const scrollEl = overlay.querySelector('#ffe-scroll');
      scrollEl.innerHTML = '';
      for (let n = 1; n <= pdfDoc.numPages; n++) {
        const page = await pdfDoc.getPage(n);
        const viewport = page.getViewport({ scale });

        const pageDiv = document.createElement('div');
        pageDiv.className = 'ffe-page';
        pageDiv.style.width  = `${viewport.width}px`;
        pageDiv.style.height = `${viewport.height}px`;
        pageDiv.style.setProperty('--scale-factor', String(scale));

        const canvas = document.createElement('canvas');
        canvas.width  = Math.floor(viewport.width  * devicePixelRatio);
        canvas.height = Math.floor(viewport.height * devicePixelRatio);
        canvas.style.width  = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        pageDiv.appendChild(canvas);
        scrollEl.appendChild(pageDiv);

        await page.render({
          canvasContext: canvas.getContext('2d'),
          viewport,
          transform: devicePixelRatio !== 1 ? [devicePixelRatio, 0, 0, devicePixelRatio, 0, 0] : undefined,
          // ENABLE_FORMS: widget appearances are drawn only by the HTML
          // annotation layer — ENABLE would also paint them on the canvas,
          // doubling every checkbox/value slightly offset from the widget.
          annotationMode: window.pdfjsLib.AnnotationMode.ENABLE_FORMS,
        }).promise;

        const annotations = await page.getAnnotations({ intent: 'display' });
        const layerDiv = document.createElement('div');
        layerDiv.className = 'annotationLayer';
        layerDiv.style.setProperty('--scale-factor', String(scale));
        pageDiv.appendChild(layerDiv);

        // pdf.js 3.x instance API (AnnotationLayer.render is no longer static)
        const annotationLayer = new window.pdfjsLib.AnnotationLayer({
          div: layerDiv,
          accessibilityManager: null,
          annotationCanvasMap: null,
          l10n: null,
          page,
          viewport: viewport.clone({ dontFlip: true }),
        });
        await annotationLayer.render({
          annotations,
          linkService: linkServiceStub,
          downloadManager: null,
          annotationStorage: pdfDoc.annotationStorage,
          renderForms: true,
        });

        // Wire edit capture: map DOM widgets back to AcroForm field names.
        for (const ann of annotations) {
          if (!ann.fieldName) continue;
          const section = layerDiv.querySelector(`[data-annotation-id="${ann.id}"]`);
          if (!section) continue;
          (sectionsByField[ann.fieldName] ||= []).push(section);
          const input = section.querySelector('input, select, textarea');
          if (!input) continue;

          if (input.matches('input[type=checkbox]')) {
            input.addEventListener('change', () => recordEdit(ann.fieldName, input.checked ? 'Yes' : 'No', section));
          } else if (input.matches('input[type=radio]')) {
            input.addEventListener('change', () => {
              if (input.checked) recordEdit(ann.fieldName, String(ann.buttonValue ?? input.value ?? ''), section);
            });
          } else if (input.matches('select')) {
            input.addEventListener('change', () => recordEdit(ann.fieldName, input.value, section));
          } else {
            input.addEventListener('input', () => recordEdit(ann.fieldName, input.value, section));
          }
        }
      }
    }

    overlay.querySelector('#ffe-zoom-in').addEventListener('click', async () => {
      scale = Math.min(2.2, scale + 0.2); await renderAllPages();
    });
    overlay.querySelector('#ffe-zoom-out').addEventListener('click', async () => {
      scale = Math.max(0.7, scale - 0.2); await renderAllPages();
    });

    try {
      const session = await Auth.getSession();
      const [pdfjs, fieldsData, pdfRes] = await Promise.all([
        loadPdfJsLib(),
        apiFields('GET'),
        fetch(`/api/form-filler/download?id=${encodeURIComponent(generatedFormId)}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` },
        }),
      ]);
      if (!pdfRes.ok) throw new Error(((await pdfRes.json().catch(() => ({}))).error) || `Error ${pdfRes.status}`);
      const bytes = await pdfRes.arrayBuffer();

      fieldInfo = {};
      for (const f of fieldsData.fields || []) fieldInfo[f.name] = f;

      pdfDoc = await pdfjs.getDocument({ data: bytes }).promise;
      await renderAllPages();
      setStatus('All changes saved');
    } catch (err) {
      console.error('[form-editor]', err);
      Utils.toast(err.message || 'Failed to open the form editor.', 'error');
      await close(true);
    }
  }

  // ── Files tab ────────────────────────────────────────────────────────────────

  const MATTER_FOLDERS = [
    { key: 'all',            label: 'All Files' },
    { key: 'client_uploads', label: 'Client Uploads' },
    { key: 'pleadings',      label: 'Pleadings' },
    { key: 'agreements',     label: 'Agreements' },
    { key: 'correspondence', label: 'Correspondence' },
    { key: 'financial',      label: 'Financial' },
    { key: 'attorney_notes', label: 'Attorney Notes' },
    { key: 'court_orders',   label: 'Court Orders' },
    { key: 'trial_docs',     label: 'Trial Docs' },
    { key: 'admin',          label: 'Admin' },
    { key: 'other',          label: 'Other' },
  ];

  const FOLDER_DOC_TYPE = {
    pleadings:      'pleading',
    agreements:     'agreement',
    correspondence: 'correspondence',
    financial:      'financial',
    client_uploads: 'id',
    court_orders:   'court_order',
  };

  const EXT_MIME = {
    pdf:  'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc:  'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls:  'application/vnd.ms-excel',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    png:  'image/png',
    tiff: 'image/tiff',
    tif:  'image/tiff',
    webp: 'image/webp',
  };

  const ALLOWED_MIME = new Set(Object.values(EXT_MIME));

  function resolveContentType(file) {
    if (file.type && ALLOWED_MIME.has(file.type)) return file.type;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return EXT_MIME[ext] || null;
  }

  let _filesLoaded  = false;
  let _filesFolder  = 'all';
  let _filesAllDocs = [];
  let _filesTrash    = [];        // soft-deleted docs (deleted_at NOT NULL) — the Trash view
  let _filesFolders  = [];        // matter_folders rows (custom folders, may be empty)
  let _filesCollapsed = new Set(); // custom-folder tree nodes collapsed in the sidebar (by full path)
  let _filesPanelRoot = null;      // panel root el — lets the file list trigger a full panel re-render on subfolder nav
  let _filesSidebarW  = (() => {   // folder-tree width, drag-resizable, persisted per browser
    const w = parseInt(localStorage.getItem('files_sidebar_w'), 10);
    return Number.isFinite(w) ? Math.min(520, Math.max(150, w)) : 215;
  })();
  let _filesHiddenBuiltins = new Set(); // firm_settings.hidden_builtin_folders — hidden while empty
  let _filesSelected = new Set(); // multi-select: document ids
  let _filesSort     = { key: 'created_at', dir: 'desc' };
  let _filesQuery    = '';        // name filter box

  function wireFilesTab() {
    if (!matter) return;
    document.getElementById('subtab-btn-files')?.classList.remove('hidden');
    _subtabLoaders.files = async () => {
      if (_filesLoaded) return;
      _filesLoaded = true;
      await loadFiles();
    };
  }

  async function loadFiles() {
    const root = document.getElementById('files-panel-root');
    if (!root || !matter) return;
    root.innerHTML = `<p style="color:var(--color-text-muted);font-size:var(--text-sm);padding:var(--space-4) 0">Loading files…</p>`;

    const [{ data: docs, error }, { data: folders }, { data: trashed }, { data: firmSettings }] = await Promise.all([
      db.from('documents')
        .select('id, name, file_name, file_size, content_type, folder_path, doc_type, status, created_at, uploaded_by, deleted_at, client_visible, source')
        .eq('matter_id', matter.id)
        .is('deleted_at', null)
        .neq('status', 'pending')
        .order('created_at', { ascending: false }),
      db.from('matter_folders')
        .select('path')
        .eq('matter_id', matter.id)
        .order('path'),
      // Trash: soft-deleted docs. Staff RLS (docs_select via can_read('core'))
      // has no deleted_at filter, so these are readable directly.
      db.from('documents')
        .select('id, name, file_name, file_size, content_type, folder_path, deleted_at')
        .eq('matter_id', matter.id)
        .not('deleted_at', 'is', null)
        .neq('status', 'pending')
        .order('deleted_at', { ascending: false }),
      // Firm-level folder prefs (authenticated read RLS) — hidden built-ins.
      db.from('firm_settings')
        .select('hidden_builtin_folders')
        .limit(1)
        .maybeSingle(),
    ]);

    if (error) {
      root.innerHTML = `<p style="color:var(--color-danger);font-size:var(--text-sm)">Failed to load files.</p>`;
      return;
    }

    _filesAllDocs  = docs || [];
    _filesTrash    = trashed || [];
    _filesFolders  = (folders || []).map(r => r.path);
    _filesHiddenBuiltins = new Set(
      Array.isArray(firmSettings?.hidden_builtin_folders) ? firmSettings.hidden_builtin_folders : []
    );
    _filesSelected = new Set();
    renderFilesPanel(root);
  }

  function renderFilesPanel(root) {
    _filesPanelRoot = root;
    const counts = {};
    for (const doc of _filesAllDocs) {
      const fp = doc.folder_path || 'other';
      counts[fp] = (counts[fp] || 0) + 1;
    }
    const total = _filesAllDocs.length;

    // Built-ins render alphabetically by label, with "All Files" pinned to the top
    // (it's a view-all, not a real folder).
    const orderedBuiltins = [
      ...MATTER_FOLDERS.filter(f => f.key === 'all'),
      ...MATTER_FOLDERS.filter(f => f.key !== 'all').sort((a, b) => a.label.localeCompare(b.label)),
    ];

    // Built-ins on the firm's hidden list stay out of the sidebar while empty —
    // they reappear as soon as a file lands in them (nothing is ever orphaned).
    const sidebarItems = orderedBuiltins.filter(f => {
      if (!_filesHiddenBuiltins.has(f.key)) return true;
      return (counts[f.key] || 0) > 0 || _filesFolder === f.key;
    }).map(f => {
      const cnt = f.key === 'all' ? total : (counts[f.key] || 0);
      const active = _filesFolder === f.key ? 'files-folder-btn--active' : '';
      return `<button class="files-folder-btn ${active}" data-folder="${Utils.esc(f.key)}">
        <span>${Utils.esc(f.label)}</span>
        <span class="folder-count">${cnt}</span>
      </button>`;
    }).join('');

    // Custom folders: matter_folders rows (may be empty) merged with any paths
    // still carried only by documents (e.g. legacy storage-sync pulls), rendered
    // as a nested tree. Nesting is encoded in the slash-separated path; keys carry
    // a "dyn:" prefix + the FULL path so they can't collide with the built-in slugs.
    const knownKeys = new Set(MATTER_FOLDERS.map(f => f.key));

    // Exact per-folder doc counts (custom folders only), then every folder path we
    // know about — from docs and from matter_folders rows.
    const exactCounts = {};
    const allPaths = new Set();
    for (const doc of _filesAllDocs) {
      const fp = doc.folder_path || 'other';
      if (knownKeys.has(fp)) continue;
      exactCounts[fp] = (exactCounts[fp] || 0) + 1;
      allPaths.add(fp);
    }
    for (const path of _filesFolders) {
      if (!knownKeys.has(path.split('/')[0])) allPaths.add(path);
    }
    // Materialize ancestors so "Discovery/Inventories" always has a "Discovery"
    // node above it, even when no row/doc sits directly in the parent.
    for (const p of [...allPaths]) {
      const segs = p.split('/');
      for (let i = 1; i < segs.length; i++) allPaths.add(segs.slice(0, i).join('/'));
    }
    // Aggregate count = docs in the folder plus everything nested beneath it.
    const nodeCount = (path) => {
      let n = exactCounts[path] || 0;
      const prefix = path + '/';
      for (const fp in exactCounts) if (fp.startsWith(prefix)) n += exactCounts[fp];
      return n;
    };
    // Parent → sorted children map ('' = roots).
    const childrenOf = {};
    for (const p of allPaths) {
      const idx = p.lastIndexOf('/');
      const parent = idx === -1 ? '' : p.slice(0, idx);
      (childrenOf[parent] = childrenOf[parent] || []).push(p);
    }
    for (const k in childrenOf) childrenOf[k].sort((a, b) => a.localeCompare(b));

    const folderIcon = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px"><path d="${p}"/></svg>`;
    const renderNode = (path, depth) => {
      const name = path.split('/').pop();
      const key = `dyn:${path}`;
      const kids = childrenOf[path] || [];
      const hasKids = kids.length > 0;
      const collapsed = _filesCollapsed.has(path);
      const active = _filesFolder === key ? 'files-folder-btn--active' : '';
      const caret = hasKids
        ? `<span class="ff-caret" data-caret="${Utils.esc(path)}" title="${collapsed ? 'Expand' : 'Collapse'}">${collapsed ? '▸' : '▾'}</span>`
        : `<span class="ff-caret"></span>`;
      const canDelete = !hasKids && nodeCount(path) === 0;
      const folderGlyph = folderIcon('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z');
      const row = `<button class="files-folder-btn ${active} ${depth > 0 ? 'is-sub' : ''}" data-folder="${Utils.esc(key)}" style="padding-left:${depth * 14 + 8}px">
        <span class="ff-left">${caret}<span class="ff-icon">${folderGlyph}</span><span class="ff-label" title="${Utils.esc(name)}">${Utils.esc(name)}</span></span>
        <span class="ff-right">
          <span class="ff-act ff-act--add" data-act="addsub" data-path="${Utils.esc(path)}" title="Add subfolder">${folderIcon('M12 5v14M5 12h14')}</span>
          <span class="ff-act" data-act="rename" data-path="${Utils.esc(path)}" title="Rename folder">${folderIcon('M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z')}</span>
          ${canDelete ? `<span class="ff-act" data-act="delete" data-path="${Utils.esc(path)}" title="Delete folder">${folderIcon('M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2')}</span>` : ''}
          <span class="folder-count">${nodeCount(path)}</span>
        </span>
      </button>`;
      const childHtml = (hasKids && !collapsed) ? kids.map(k => renderNode(k, depth + 1)).join('') : '';
      return row + childHtml;
    };
    const dynamicItems = (childrenOf[''] || []).map(p => renderNode(p, 0)).join('');
    const dynamicSection = dynamicItems
      ? `<div class="files-sidebar-title" style="margin-top:var(--space-3)">Custom Folders</div>${dynamicItems}`
      : '';
    const newFolderBtn = `<button class="btn btn--ghost btn--sm" id="files-new-folder-btn" style="margin-top:var(--space-3);width:100%">+ New Folder</button>`;

    // Trash pseudo-folder — soft-deleted docs, restorable until the 30-day purge.
    const trashActive = _filesFolder === 'trash' ? 'files-folder-btn--active' : '';
    const trashBtn = `<button class="files-folder-btn ${trashActive}" data-folder="trash" style="margin-top:var(--space-3)">
        <span>🗑 Trash</span>
        <span class="folder-count">${_filesTrash.length}</span>
      </button>`;

    root.innerHTML = `
      <div class="detail-section" style="padding:var(--space-5)">
      <div class="files-layout">
        <nav class="files-sidebar" style="width:${_filesSidebarW}px">
          <div class="files-sidebar-title">Folders</div>
          ${sidebarItems}
          ${dynamicSection}
          ${newFolderBtn}
          ${trashBtn}
        </nav>
        <div class="files-resizer" id="files-sidebar-resizer" title="Drag to resize the folder list"></div>
        <div class="files-main">
          <div class="files-drop-zone" id="files-drop-zone">
            <div class="files-upload-row">
              <button class="btn btn--secondary btn--sm" id="files-upload-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload Files
              </button>
              <button class="btn btn--ghost btn--sm" id="files-folder-upload-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                Upload Folder
              </button>
              <button class="btn btn--ghost btn--sm" id="files-new-from-template-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                New from Template
              </button>
              ${storageSyncEnabled ? `
              <button class="btn btn--ghost btn--sm" id="files-import-storage-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/></svg>
                Import from Storage
              </button>` : ''}
            </div>
            <p>or drag &amp; drop files here</p>
          </div>
          <input type="file" id="files-input-multi" multiple style="display:none">
          <input type="file" id="files-input-folder" multiple webkitdirectory style="display:none">
          <div id="files-upload-queue" class="upload-queue"></div>
          <div id="files-list-container"></div>
        </div>
      </div>
      </div>`;

    renderFilesList();
    wireFilesActions(root);

    // Sidebar resizer — pointer-capture drag, clamped, width persisted
    const resizer = root.querySelector('#files-sidebar-resizer');
    const sidebarEl = root.querySelector('.files-sidebar');
    if (resizer && sidebarEl) {
      resizer.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        resizer.setPointerCapture(e.pointerId);
        resizer.classList.add('dragging');
        const startX = e.clientX;
        const startW = sidebarEl.getBoundingClientRect().width;
        const onMove = (ev) => {
          _filesSidebarW = Math.min(520, Math.max(150, Math.round(startW + ev.clientX - startX)));
          sidebarEl.style.width = `${_filesSidebarW}px`;
        };
        const onUp = () => {
          resizer.classList.remove('dragging');
          resizer.removeEventListener('pointermove', onMove);
          resizer.removeEventListener('pointerup', onUp);
          try { localStorage.setItem('files_sidebar_w', String(_filesSidebarW)); } catch { /* private mode */ }
        };
        resizer.addEventListener('pointermove', onMove);
        resizer.addEventListener('pointerup', onUp);
      });
    }
  }

  // Self-contained folder picker for the Move action. Resolves to the chosen
  // folder_path, or null if cancelled. Targets = fixed matter folders + any synced
  // folder paths already present on this matter's docs (minus the current folder).
  function pickFolder(currentFolder) {
    return new Promise((resolve) => {
      // Same hidden-while-empty rule as the sidebar: don't offer hidden
      // built-ins as move targets unless they already hold files.
      const docCounts = {};
      for (const d of _filesAllDocs) {
        const fp = d.folder_path || 'other';
        docCounts[fp] = (docCounts[fp] || 0) + 1;
      }
      const fixed = MATTER_FOLDERS.filter(f => f.key !== 'all'
        && (!_filesHiddenBuiltins.has(f.key) || (docCounts[f.key] || 0) > 0));
      const fixedKeys = new Set(MATTER_FOLDERS.map(f => f.key));
      const synced = [...new Set([
        ..._filesAllDocs.map(d => d.folder_path),
        ..._filesFolders,
      ].filter(fp => fp && !fixedKeys.has(fp)))].sort();
      const opt = (val, label) => val === currentFolder ? '' : `<option value="${Utils.esc(val)}">${Utils.esc(label)}</option>`;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:var(--space-4)';
      overlay.innerHTML = `
        <div class="card" style="max-width:420px;width:100%" role="dialog" aria-modal="true">
          <h3 style="font-size:var(--text-base);font-weight:600;margin-bottom:var(--space-3)">Move file to folder</h3>
          <select id="move-folder-select" style="width:100%;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius);font-size:var(--text-sm);font-family:inherit;box-sizing:border-box;margin-bottom:var(--space-4)">
            <optgroup label="Folders">${fixed.map(f => opt(f.key, f.label)).join('')}</optgroup>
            ${synced.length ? `<optgroup label="Synced folders">${synced.map(fp => opt(fp, fp)).join('')}</optgroup>` : ''}
          </select>
          <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
            <button class="btn btn--ghost" data-move-cancel>Cancel</button>
            <button class="btn btn--primary" data-move-confirm>Move</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = (val) => { overlay.remove(); resolve(val); };
      overlay.querySelector('[data-move-cancel]').addEventListener('click', () => close(null));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      overlay.querySelector('[data-move-confirm]').addEventListener('click', () => {
        close(overlay.querySelector('#move-folder-select').value || null);
      });
    });
  }

  // "New from template" — pure copy: pick a firm .docx template, drop a fresh
  // copy into the current folder as a normal document, then open it in Word
  // (if office_edit is on) for manual completion. No merge-fill, no wizard.
  async function openNewFromTemplateModal() {
    if (_filesFolder === 'trash') {
      Utils.toast('Choose a folder first — new documents can’t go in the trash.', 'error');
      return;
    }
    const targetFolder = _filesFolder === 'all' ? 'other'
      : _filesFolder.startsWith('dyn:') ? _filesFolder.slice(4)
      : _filesFolder;
    const folderLabel = MATTER_FOLDERS.find(f => f.key === targetFolder)?.label || targetFolder;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:var(--space-4)';
    overlay.innerHTML = `
      <div class="card" style="max-width:520px;width:100%" role="dialog" aria-modal="true">
        <h3 style="font-size:var(--text-base);font-weight:600;margin-bottom:2px">New document from template</h3>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3)">A copy will be created in <strong>${Utils.esc(folderLabel)}</strong>${officeEditEnabled ? ' and opened in Word' : ''}.</p>
        <div id="tmpl-body" style="max-height:56vh;overflow:auto">
          <p style="font-size:var(--text-sm);color:var(--color-text-muted)">Loading templates…</p>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:var(--space-4)">
          <button class="btn btn--ghost" data-close>Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const body = overlay.querySelector('#tmpl-body');
    const { data: templates, error } = await db
      .from('draft_templates')
      .select('id, name, doc_category, case_types')
      .eq('active', true)
      .not('template_docx_r2_key', 'is', null)
      .order('sort_order');

    if (error) {
      body.innerHTML = `<p style="color:var(--color-danger);font-size:var(--text-sm)">Failed to load templates.</p>`;
      return;
    }
    if (!templates || !templates.length) {
      body.innerHTML = `<p style="font-size:var(--text-sm);color:var(--color-text-muted)">No Word templates are available yet. Upload .docx templates under <strong>Settings → Doc Templates</strong>, then they’ll appear here.</p>`;
      return;
    }

    body.innerHTML = templates.map(t => `
      <button class="btn btn--ghost tmpl-pick" data-template-id="${Utils.esc(t.id)}" data-template-name="${Utils.esc(t.name)}"
        style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:var(--space-2) var(--space-3);margin-bottom:6px">
        <span style="font-weight:500">${Utils.esc(t.name)}</span>
        <span style="font-size:var(--text-xs);color:var(--color-text-muted)">${Utils.esc(t.doc_category || 'other')}${Array.isArray(t.case_types) && t.case_types.length ? ' · ' + Utils.esc(t.case_types.join(', ')) : ''}</span>
      </button>`).join('');

    body.querySelectorAll('.tmpl-pick').forEach(btn => {
      btn.addEventListener('click', async () => {
        body.querySelectorAll('.tmpl-pick').forEach(b => b.disabled = true);
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/new-document-from-template', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({
              matter_id:   matter.id,
              template_id: btn.dataset.templateId,
              folder_path: targetFolder,
              doc_type:    FOLDER_DOC_TYPE[targetFolder] || 'other',
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
          close();
          await loadFiles();
          if (officeEditEnabled) {
            Utils.toast(`Created “${data.file_name}” — opening in Word…`, 'success');
            await openDocInWord(data.document_id);
          } else {
            Utils.toast(`Created “${data.file_name}” in ${folderLabel}.`, 'success');
          }
        } catch (err) {
          Utils.toast(err.message || 'Could not create document.', 'error');
          body.querySelectorAll('.tmpl-pick').forEach(b => b.disabled = false);
        }
      });
    });
  }

  // Open a Files document in desktop Word via the office_edit WebDAV bridge.
  async function openDocInWord(docId) {
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/office-edit/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ document_id: docId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
      const { word_url } = await res.json();
      window.location.href = word_url;
    } catch (err) {
      Utils.toast(err.message || 'Could not open in Word.', 'error');
    }
  }

  // Version history modal for one document: list every saved version (newest
  // first) with download + non-destructive restore. Versions are written at the
  // Word-save (WebDAV PUT) and storage-pull points; restore adds a new version.
  async function openVersionsModal(docId, fileName) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:var(--space-4)';
    overlay.innerHTML = `
      <div class="card" style="max-width:560px;width:100%" role="dialog" aria-modal="true">
        <h3 style="font-size:var(--text-base);font-weight:600;margin-bottom:2px">Version history</h3>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3)">${Utils.esc(fileName)}</p>
        <div id="versions-body" style="max-height:60vh;overflow:auto">
          <p style="font-size:var(--text-sm);color:var(--color-text-muted)">Loading…</p>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:var(--space-4)">
          <button class="btn btn--ghost" data-close>Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const SOURCE_LABELS = { portal: 'Portal', dropbox: 'Dropbox', google_drive: 'Google Drive', onedrive: 'OneDrive', idrive: 'iDrive' };
    const formatSize = (bytes) => !bytes ? '' : bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
    const userName = (id) => { const u = users.find(x => x.id === id); return u ? `${u.first_name}${u.last_name ? ' ' + u.last_name : ''}` : ''; };

    async function renderBody() {
      const body = overlay.querySelector('#versions-body');
      if (!body) return;
      const { data: versions, error } = await db
        .from('document_versions')
        .select('id, version_no, file_size, source, created_at, created_by')
        .eq('document_id', docId)
        .order('version_no', { ascending: false });

      if (error) {
        body.innerHTML = `<p style="color:var(--color-danger);font-size:var(--text-sm)">Failed to load history.</p>`;
        return;
      }
      if (!versions || !versions.length) {
        body.innerHTML = `<p style="font-size:var(--text-sm);color:var(--color-text-muted)">No saved versions yet. Versions are recorded when a file is edited in Word or synced from storage.</p>`;
        return;
      }

      const currentNo = versions[0].version_no;
      body.innerHTML = `
        <table class="data-table" style="width:100%">
          <thead><tr><th>Version</th><th>Saved</th><th>By</th><th>Size</th><th></th></tr></thead>
          <tbody>${versions.map(v => {
            const date = new Date(v.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
            const who = userName(v.created_by);
            const src = SOURCE_LABELS[v.source] || v.source || '';
            const isCurrent = v.version_no === currentNo;
            return `<tr>
              <td style="font-weight:500">v${v.version_no}${isCurrent ? ' <span style="font-size:var(--text-xs);color:var(--color-success,#16a34a)">· current</span>' : ''}<div style="font-size:var(--text-xs);color:var(--color-text-muted)">${Utils.esc(src)}</div></td>
              <td style="font-size:var(--text-sm);color:var(--color-text-muted)">${date}</td>
              <td style="font-size:var(--text-sm);color:var(--color-text-muted)">${Utils.esc(who)}</td>
              <td style="font-size:var(--text-sm);color:var(--color-text-muted)">${formatSize(v.file_size)}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--ghost btn--sm ver-dl" data-version-id="${Utils.esc(v.id)}">Download</button>
                ${isCurrent ? '' : `<button class="btn btn--ghost btn--sm ver-restore" data-version-id="${Utils.esc(v.id)}" data-version-no="${v.version_no}">Restore</button>`}
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>`;

      body.querySelectorAll('.ver-dl').forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/get-version-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ version_id: b.dataset.versionId }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
          const { download_url, file_name } = await res.json();
          const a = document.createElement('a');
          a.href = download_url; a.download = file_name || fileName; a.target = '_blank';
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        } catch (err) {
          Utils.toast(err.message || 'Download failed.', 'error');
        } finally {
          b.disabled = false;
        }
      }));

      body.querySelectorAll('.ver-restore').forEach(b => b.addEventListener('click', async () => {
        if (!await Utils.confirm(`Restore v${b.dataset.versionNo} as the current version? This adds a new version at the top — nothing is lost.`, { confirmLabel: 'Restore' })) return;
        b.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/restore-version', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ version_id: b.dataset.versionId }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
          Utils.toast(`Restored v${b.dataset.versionNo} as the current version.`, 'success');
          await loadFiles();
          await renderBody();
        } catch (err) {
          Utils.toast(err.message || 'Restore failed.', 'error');
          b.disabled = false;
        }
      }));
    }

    await renderBody();
  }

  // Trash view: soft-deleted docs with Restore / Delete-forever, plus Empty
  // trash. Kept separate from renderFilesList — no folders, sort, bulk-select,
  // publish/push/move or drag here; just recovery and permanent deletion.
  function renderTrashList(container) {
    const iconFor = (ct) => {
      if (!ct) return '📄';
      if (ct === 'application/pdf') return '🗒';
      if (ct.includes('word')) return '📝';
      if (ct.includes('sheet') || ct.includes('excel')) return '📊';
      if (ct.startsWith('image/')) return '🖼';
      return '📄';
    };
    const formatSize = (bytes) => {
      if (!bytes) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / 1048576).toFixed(1)} MB`;
    };

    const q = _filesQuery.trim().toLowerCase();
    const visible = q
      ? _filesTrash.filter(d => (d.name || '').toLowerCase().includes(q) || (d.file_name || '').toLowerCase().includes(q))
      : _filesTrash;

    const rows = visible.map(doc => {
      const delMs   = doc.deleted_at ? new Date(doc.deleted_at).getTime() : Date.now();
      const delDate = new Date(delMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - delMs) / 86400000));
      const tfpRaw = doc.folder_path || 'other';
      const tBuiltIn = MATTER_FOLDERS.find(f => f.key === tfpRaw)?.label;
      const folderLeaf = tBuiltIn || tfpRaw.split('/').pop();
      const folderFull = tBuiltIn || tfpRaw.replace(/\//g, ' / ');
      const dispName = doc.name || doc.file_name;
      const purgeNote = daysLeft <= 7
        ? ` <span style="color:var(--color-danger)" title="Permanently deleted in ${daysLeft} day(s)">· ${daysLeft}d left</span>` : '';
      return `<tr data-doc-id="${Utils.esc(doc.id)}">
        <td style="font-weight:500"><div class="files-name-wrap"><span style="flex-shrink:0">${iconFor(doc.content_type)}</span><span class="fname" title="${Utils.esc(dispName)}">${Utils.esc(dispName)}</span></div></td>
        <td class="files-td-ellip" title="${Utils.esc(folderFull)}" style="color:var(--color-text-muted);font-size:var(--text-sm)">${Utils.esc(folderLeaf)}</td>
        <td style="color:var(--color-text-muted);font-size:var(--text-sm);white-space:nowrap">${formatSize(doc.file_size)}</td>
        <td style="color:var(--color-text-muted);font-size:var(--text-sm);white-space:nowrap">${delDate}${purgeNote}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn--ghost btn--sm files-restore-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.name || doc.file_name)}" title="Restore to its folder">↩ Restore</button>
          <button class="btn btn--ghost btn--sm files-purge-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.name || doc.file_name)}" title="Delete permanently" style="color:var(--color-danger)">Delete forever</button>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <input type="search" id="files-filter-input" placeholder="Filter trash by name…" value="${Utils.esc(_filesQuery)}"
        style="width:100%;box-sizing:border-box;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius);font-size:var(--text-sm);font-family:inherit;margin-bottom:var(--space-2)">
      <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;margin-bottom:var(--space-2)">
        <span style="font-size:var(--text-sm);color:var(--color-text-muted)">Deleted files are removed permanently after 30 days.</span>
        ${_filesTrash.length ? `<button class="btn btn--ghost btn--sm" id="files-empty-trash" style="color:var(--color-danger);margin-left:auto">Empty trash</button>` : ''}
      </div>
      <div class="files-list-card">
        ${visible.length === 0
          ? `<div class="files-empty">${q ? 'No files match your filter.' : 'Trash is empty.'}</div>`
          : `<table class="data-table">
          <thead><tr>
            <th>File</th><th style="width:18%">Folder</th><th style="width:84px">Size</th><th style="width:150px">Deleted</th><th style="width:220px"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`}
      </div>`;

    const filterInput = container.querySelector('#files-filter-input');
    filterInput?.addEventListener('input', () => {
      _filesQuery = filterInput.value;
      renderFilesList();
      const fresh = document.getElementById('files-filter-input');
      if (fresh) { fresh.focus(); fresh.setSelectionRange(fresh.value.length, fresh.value.length); }
    });

    container.querySelectorAll('.files-restore-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/restore-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ document_id: btn.dataset.docId }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
          Utils.toast(`Restored "${btn.dataset.fileName}".`, 'success');
          await loadFiles();
        } catch (err) {
          Utils.toast(err.message || 'Restore failed.', 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.files-purge-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Utils.confirm(`Permanently delete "${btn.dataset.fileName}"? This removes the file and all its versions for good — it cannot be undone.`, { confirmLabel: 'Delete Forever', danger: true })) return;
        btn.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/purge-trash', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ matter_id: matter.id, document_ids: [btn.dataset.docId] }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
          Utils.toast('Permanently deleted.', 'success');
          await loadFiles();
        } catch (err) {
          Utils.toast(err.message || 'Delete failed.', 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelector('#files-empty-trash')?.addEventListener('click', async () => {
      if (!await Utils.confirm(`Empty the trash? All ${_filesTrash.length} file(s) and their versions will be permanently deleted — this cannot be undone.`, { confirmLabel: 'Empty Trash', danger: true })) return;
      const btn = document.getElementById('files-empty-trash');
      if (btn) btn.disabled = true;
      try {
        const session = await Auth.getSession();
        const res = await fetch('/api/purge-trash', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ matter_id: matter.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
        Utils.toast(`Trash emptied — ${data.purged || 0} file(s) removed.`, 'success');
        await loadFiles();
      } catch (err) {
        Utils.toast(err.message || 'Empty trash failed.', 'error');
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderFilesList() {
    const container = document.getElementById('files-list-container');
    if (!container) return;

    if (_filesFolder === 'trash') { renderTrashList(container); return; }

    const isDyn  = _filesFolder.startsWith('dyn:');
    const dynTop = isDyn ? _filesFolder.slice(4) : null;

    // Immediate child subfolders of the selected custom folder. File-explorer
    // semantics: selecting a folder shows the subfolder itself (as a navigable
    // row) plus this folder's OWN files — not a flattened dump of everything
    // nested inside the children.
    let childFolders = [];
    if (isDyn) {
      const prefix = dynTop + '/';
      const seen = new Set();
      const addChild = (fp) => {
        if (fp && fp.startsWith(prefix)) seen.add(prefix + fp.slice(prefix.length).split('/')[0]);
      };
      _filesAllDocs.forEach(d => addChild(d.folder_path || ''));
      (_filesFolders || []).forEach(addChild);
      childFolders = [...seen].sort((a, b) => a.localeCompare(b));
    }
    // Aggregate count for a folder path = its own docs plus everything nested.
    const aggCount = (p) => _filesAllDocs.filter(d => {
      const fp = d.folder_path || '';
      return fp === p || fp.startsWith(p + '/');
    }).length;

    const inFolder = _filesFolder === 'all'
      ? _filesAllDocs
      : isDyn
        ? _filesAllDocs.filter(d => (d.folder_path || '') === dynTop)   // OWN files only
        : _filesAllDocs.filter(d => (d.folder_path || 'other') === _filesFolder);

    const q = _filesQuery.trim().toLowerCase();
    const filtered = q
      ? inFolder.filter(d => (d.name || '').toLowerCase().includes(q) || (d.file_name || '').toLowerCase().includes(q))
      : inFolder;

    const sortDir = _filesSort.dir === 'asc' ? 1 : -1;
    const sortVal = (d) => {
      switch (_filesSort.key) {
        case 'name':   return (d.name || d.file_name || '').toLowerCase();
        case 'folder': return d.folder_path || 'other';
        case 'size':   return d.file_size || 0;
        default:       return d.created_at || '';
      }
    };
    const visible = [...filtered].sort((a, b) => {
      const av = sortVal(a), bv = sortVal(b);
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });

    const folderLabel = MATTER_FOLDERS.find(f => f.key === _filesFolder)?.label
      || (_filesFolder.startsWith('dyn:') ? _filesFolder.slice(4).replace(/\//g, ' / ') : _filesFolder);

    const iconFor = (ct) => {
      if (!ct) return '📄';
      if (ct === 'application/pdf') return '🗒';
      if (ct.includes('word')) return '📝';
      if (ct.includes('sheet') || ct.includes('excel')) return '📊';
      if (ct.startsWith('image/')) return '🖼';
      return '📄';
    };

    const formatSize = (bytes) => {
      if (!bytes) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / 1048576).toFixed(1)} MB`;
    };

    const rows = visible.map(doc => {
      const date = new Date(doc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const fpRaw = doc.folder_path || 'other';
      const builtIn = MATTER_FOLDERS.find(f => f.key === fpRaw)?.label;
      const folderLeaf = builtIn || fpRaw.split('/').pop();          // last segment only — full path in tooltip
      const folderFull = builtIn || fpRaw.replace(/\//g, ' / ');
      const size = formatSize(doc.file_size);
      const dispName = doc.name || doc.file_name;
      const staffOnly = doc.client_visible === false
        ? `<span title="Not visible to the client until published" style="flex-shrink:0;font-size:var(--text-xs);background:var(--color-warning,#f59e0b);color:#fff;border-radius:999px;padding:1px 8px">Staff only</span>`
        : '';
      const isWordDoc = /\.(docx|docm)$/i.test(doc.file_name || '');
      return `<tr draggable="true" data-doc-id="${Utils.esc(doc.id)}">
        <td style="width:28px"><input type="checkbox" class="files-row-check" data-doc-id="${Utils.esc(doc.id)}" ${_filesSelected.has(doc.id) ? 'checked' : ''}></td>
        <td style="font-weight:500">
          <div class="files-name-wrap"><span style="flex-shrink:0">${iconFor(doc.content_type)}</span><span class="fname" title="${Utils.esc(dispName)}">${Utils.esc(dispName)}</span>${staffOnly}</div>
        </td>
        ${_filesFolder === 'all' ? `<td class="files-td-ellip" title="${Utils.esc(folderFull)}" style="color:var(--color-text-muted);font-size:var(--text-sm)">${Utils.esc(folderLeaf)}</td>` : ''}
        <td style="color:var(--color-text-muted);font-size:var(--text-sm);white-space:nowrap">${size}</td>
        <td style="color:var(--color-text-muted);font-size:var(--text-sm);white-space:nowrap">${date}</td>
        <td style="text-align:right;white-space:nowrap">
          ${doc.client_visible === false ? `
          <button class="btn btn--ghost btn--sm files-publish-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.name || doc.file_name)}" title="Publish to client">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>` : ''}
          ${officeEditEnabled && isWordDoc ? `
          <button class="btn btn--ghost btn--sm files-word-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.file_name)}" title="Edit in Word">
            <img src="/assets/icons/word.svg" alt="" style="width:14px;height:14px;vertical-align:middle">
          </button>` : ''}
          <button class="btn btn--ghost btn--sm files-history-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.name || doc.file_name)}" title="Version history">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>
          </button>
          <button class="btn btn--ghost btn--sm files-download-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.file_name)}" title="Download">
            <img src="/assets/icons/download.svg" alt="" style="width:14px;height:14px;vertical-align:middle">
          </button>
          <button class="btn btn--ghost btn--sm files-rename-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.file_name)}" data-name="${Utils.esc(doc.name || doc.file_name)}" title="Rename">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          </button>
          ${storageSyncEnabled ? `
          <button class="btn btn--ghost btn--sm files-push-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.name || doc.file_name)}" title="Push to storage">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/></svg>
          </button>` : ''}
          <button class="btn btn--ghost btn--sm files-move-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.name || doc.file_name)}" data-folder="${Utils.esc(doc.folder_path || 'other')}" title="Move to another folder">
            <img src="/assets/icons/move-folder.svg" alt="" style="width:14px;height:14px;vertical-align:middle">
          </button>
          <button class="btn btn--ghost btn--sm files-delete-btn" data-doc-id="${Utils.esc(doc.id)}" data-file-name="${Utils.esc(doc.name || doc.file_name)}" title="Delete">
            <img src="/assets/icons/delete.svg" alt="" style="width:14px;height:14px;vertical-align:middle">
          </button>
        </td>
      </tr>`;
    }).join('');

    const showFolderCol = _filesFolder === 'all';
    const sortArrow = (key) => _filesSort.key === key ? (_filesSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    const sortTh = (key, label, w) => `<th class="files-sort-th" data-sort="${key}" style="cursor:pointer;user-select:none${w ? `;width:${w}` : ''}">${label}${sortArrow(key)}</th>`;
    // Fixed table layout: reserve just enough for the action buttons actually enabled
    const actionsW = 200 + (storageSyncEnabled ? 30 : 0) + (officeEditEnabled ? 30 : 0);
    const allChecked = visible.length > 0 && visible.every(d => _filesSelected.has(d.id));

    const bulkBar = _filesSelected.size ? `
      <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap;padding:var(--space-2) var(--space-3);background:var(--color-bg-subtle,#f3f4f6);border:1px solid var(--color-border);border-radius:var(--radius);margin-bottom:var(--space-2)">
        <span style="font-size:var(--text-sm);font-weight:600">${_filesSelected.size} selected</span>
        <button class="btn btn--ghost btn--sm" id="files-bulk-move">Move</button>
        ${storageSyncEnabled ? '<button class="btn btn--ghost btn--sm" id="files-bulk-push">Push to storage</button>' : ''}
        <button class="btn btn--ghost btn--sm" id="files-bulk-publish">Publish to client</button>
        <button class="btn btn--ghost btn--sm" id="files-bulk-delete" style="color:var(--color-danger)">Delete</button>
        <button class="btn btn--ghost btn--sm" id="files-bulk-clear" style="margin-left:auto">Clear selection</button>
      </div>` : '';

    const subfolderRows = childFolders.map(path => {
      const nm = path.split('/').pop();
      return `<button class="files-subfolder-row" data-subfolder="dyn:${Utils.esc(path)}" title="Open ${Utils.esc(nm)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;flex-shrink:0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="sf-name">${Utils.esc(nm)}</span>
        <span class="folder-count">${aggCount(path)}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;flex-shrink:0;opacity:.5"><polyline points="9 18 15 12 9 6"/></svg>
      </button>`;
    }).join('');
    const subfoldersBlock = subfolderRows ? `<div class="files-subfolders">${subfolderRows}</div>` : '';

    container.innerHTML = `
      <input type="search" id="files-filter-input" placeholder="Filter files by name…" value="${Utils.esc(_filesQuery)}"
        style="width:100%;box-sizing:border-box;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius);font-size:var(--text-sm);font-family:inherit;margin-bottom:var(--space-2)">
      ${bulkBar}
      <div class="files-list-card">
        ${subfoldersBlock}
        ${visible.length === 0
          ? `<div class="files-empty">${q ? 'No files match your filter.'
              : childFolders.length ? 'No files directly in this folder — open a subfolder above.'
              : `No files in ${Utils.esc(folderLabel)} yet.`}</div>`
          : `<table class="data-table">
          <thead><tr>
            <th style="width:28px"><input type="checkbox" id="files-check-all" ${allChecked ? 'checked' : ''}></th>
            ${sortTh('name', 'File')}
            ${showFolderCol ? sortTh('folder', 'Folder', '18%') : ''}
            ${sortTh('size', 'Size', '84px')}
            ${sortTh('date', 'Date', '120px')}
            <th style="width:${actionsW}px"></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`}
      </div>`;

    // Subfolder rows — navigate into the child folder, expanding its ancestors
    // in the sidebar so the selection stays visible in the tree.
    container.querySelectorAll('.files-subfolder-row').forEach(row => {
      row.addEventListener('click', () => {
        const key = row.dataset.subfolder;
        _filesFolder = key;
        const segs = key.slice(4).split('/');
        for (let i = 1; i < segs.length; i++) _filesCollapsed.delete(segs.slice(0, i).join('/'));
        if (_filesPanelRoot) renderFilesPanel(_filesPanelRoot); else renderFilesList();
      });
    });

    // ── Toolbar wiring (filter / selection / sort / drag) ─────────────────────
    const filterInput = container.querySelector('#files-filter-input');
    filterInput?.addEventListener('input', () => {
      _filesQuery = filterInput.value;
      renderFilesList();
      const fresh = document.getElementById('files-filter-input');
      if (fresh) { fresh.focus(); fresh.setSelectionRange(fresh.value.length, fresh.value.length); }
    });

    container.querySelector('#files-check-all')?.addEventListener('change', (e) => {
      for (const d of visible) e.target.checked ? _filesSelected.add(d.id) : _filesSelected.delete(d.id);
      renderFilesList();
    });
    container.querySelectorAll('.files-row-check').forEach(cb => {
      cb.addEventListener('change', () => {
        cb.checked ? _filesSelected.add(cb.dataset.docId) : _filesSelected.delete(cb.dataset.docId);
        renderFilesList();
      });
    });

    container.querySelectorAll('.files-sort-th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        _filesSort = _filesSort.key === key
          ? { key, dir: _filesSort.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: key === 'date' || key === 'size' ? 'desc' : 'asc' };
        renderFilesList();
      });
    });

    // Drag rows onto sidebar folders to move. Dragging a selected row carries
    // the whole selection.
    container.querySelectorAll('tbody tr[data-doc-id]').forEach(tr => {
      tr.addEventListener('dragstart', (e) => {
        const id = tr.dataset.docId;
        const ids = _filesSelected.has(id) ? [..._filesSelected] : [id];
        e.dataTransfer.setData('text/plain', JSON.stringify(ids));
        e.dataTransfer.effectAllowed = 'move';
      });
    });

    // ── Bulk actions ──────────────────────────────────────────────────────────
    container.querySelector('#files-bulk-clear')?.addEventListener('click', () => {
      _filesSelected = new Set();
      renderFilesList();
    });
    container.querySelector('#files-bulk-move')?.addEventListener('click', async () => {
      const target = await pickFolder('');
      if (target) await moveDocs([..._filesSelected], target);
    });
    container.querySelector('#files-bulk-push')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      await pushDocs([..._filesSelected]);
      e.target.disabled = false;
    });
    container.querySelector('#files-bulk-publish')?.addEventListener('click', async () => {
      if (!await Utils.confirm(`Publish ${_filesSelected.size} file(s) to the client? They will see them in their portal.`, { confirmLabel: 'Publish' })) return;
      const { error } = await db.from('documents')
        .update({ client_visible: true })
        .in('id', [..._filesSelected]);
      if (error) { Utils.toast(error.message, 'error'); return; }
      Utils.toast('Published to client.', 'success');
      await loadFiles();
    });
    container.querySelector('#files-bulk-delete')?.addEventListener('click', async () => {
      if (!await Utils.confirm(`Move ${_filesSelected.size} file(s) to the trash? You can restore them for 30 days.`, { confirmLabel: 'Delete Files', danger: true })) return;
      const session = await Auth.getSession();
      let failed = 0;
      for (const id of [..._filesSelected]) {
        const res = await fetch('/api/delete-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ document_id: id }),
        }).catch(() => null);
        if (!res || !res.ok) failed++;
      }
      Utils.toast(failed ? `Moved to trash with ${failed} failure(s).` : 'Moved to trash.', failed ? 'error' : 'success');
      await loadFiles();
    });

    container.querySelectorAll('.files-rename-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const current = btn.dataset.name;
        const value = await Utils.prompt('Rename file', { defaultValue: current, confirmLabel: 'Rename' });
        if (!value || value === current) return;
        // Keep the real extension — Word/preview/type detection all key off it.
        const ext = (btn.dataset.fileName.match(/\.[^.]+$/) || [''])[0];
        const newFileName = ext && !value.toLowerCase().endsWith(ext.toLowerCase()) ? value + ext : value;
        const { error } = await db.from('documents')
          .update({ name: value, file_name: newFileName })
          .eq('id', btn.dataset.docId);
        if (error) { Utils.toast(error.message, 'error'); return; }
        Utils.toast('File renamed.', 'success');
        await loadFiles();
      });
    });

    container.querySelectorAll('.files-push-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await pushDocs([btn.dataset.docId]);
        btn.disabled = false;
      });
    });

    container.querySelectorAll('.files-publish-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Utils.confirm(`Publish "${btn.dataset.fileName}" to the client? They will see it in their portal.`, { confirmLabel: 'Publish' })) return;
        btn.disabled = true;
        try {
          const { error } = await db.from('documents')
            .update({ client_visible: true })
            .eq('id', btn.dataset.docId);
          if (error) throw new Error(error.message);
          Utils.toast('Published to client.', 'success');
          await loadFiles();
        } catch (err) {
          Utils.toast(err.message || 'Publish failed.', 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.files-word-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/office-edit/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ document_id: btn.dataset.docId }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
          const { word_url } = await res.json();
          Utils.toast('Opening in Word — saving there sends the file back to the portal.', 'success');
          // Trigger the ms-word: URI — opens the doc in native Word via WebDAV
          window.location.href = word_url;
        } catch (err) {
          Utils.toast(err.message || 'Could not open in Word.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.files-history-btn').forEach(btn => {
      btn.addEventListener('click', () => openVersionsModal(btn.dataset.docId, btn.dataset.fileName));
    });

    container.querySelectorAll('.files-download-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/get-download-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ document_id: btn.dataset.docId }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
          const { download_url } = await res.json();
          const a = document.createElement('a');
          a.href = download_url;
          a.download = btn.dataset.fileName;
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } catch (err) {
          Utils.toast(err.message || 'Download failed.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.files-move-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const current = btn.dataset.folder || 'other';
        const target = await pickFolder(current);
        if (!target || target === current) return;
        btn.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/move-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ document_id: btn.dataset.docId, folder_path: target }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
          Utils.toast('File moved.', 'success');
          await loadFiles();
        } catch (err) {
          Utils.toast(err.message || 'Move failed.', 'error');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.files-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Utils.confirm(`Move "${btn.dataset.fileName}" to the trash? You can restore it for 30 days.`, { confirmLabel: 'Delete File', danger: true })) return;
        btn.disabled = true;
        try {
          const session = await Auth.getSession();
          const res = await fetch('/api/delete-document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ document_id: btn.dataset.docId }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
          Utils.toast('Moved to trash.', 'success');
          // Full reload so the file leaves its folder AND lands in the Trash
          // count in one pass.
          await loadFiles();
        } catch (err) {
          Utils.toast(err.message || 'Delete failed.', 'error');
          btn.disabled = false;
        }
      });
    });
  }

  // Move a set of documents to a folder (metadata-only; R2 keys unchanged).
  async function moveDocs(ids, folderPath) {
    const session = await Auth.getSession();
    let failed = 0;
    for (const id of ids) {
      const res = await fetch('/api/move-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ document_id: id, folder_path: folderPath }),
      }).catch(() => null);
      if (!res || !res.ok) failed++;
    }
    Utils.toast(failed ? `Moved with ${failed} failure(s).` : `Moved ${ids.length} file(s).`, failed ? 'error' : 'success');
    await loadFiles();
  }

  // Push documents to the firm's configured storage provider(s) on demand.
  async function pushDocs(ids) {
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/storage-push-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ document_ids: ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      const failures = (data.results || []).filter(r => !r.ok);
      if (failures.length) {
        Utils.toast(`Pushed ${data.pushed}/${data.total}. Failed: ${failures.map(f => f.file_name || f.document_id).join(', ')}`, 'error', 7000);
      } else {
        Utils.toast(`Pushed ${data.pushed} file(s) to storage.`, 'success');
      }
    } catch (err) {
      Utils.toast(err.message || 'Push failed.', 'error');
    }
  }

  // Folder create/rename/delete via the Worker (rename cascades across docs).
  async function folderAction(payload, okMsg) {
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/matter-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ matter_id: matter.id, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
      Utils.toast(okMsg, 'success');
      await loadFiles();
    } catch (err) {
      Utils.toast(err.message || 'Folder action failed.', 'error');
    }
  }

  function wireFilesActions(root) {
    // Folder nav — plus rename/delete affordances and drag-drop move targets
    root.querySelectorAll('.files-folder-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Caret toggles the subtree open/closed — pure UI state, re-render the panel.
        const caret = e.target.closest('.ff-caret');
        if (caret && caret.dataset.caret) {
          e.stopPropagation();
          const p = caret.dataset.caret;
          if (_filesCollapsed.has(p)) _filesCollapsed.delete(p); else _filesCollapsed.add(p);
          renderFilesPanel(root);
          return;
        }
        const act = e.target.closest('.ff-act');
        if (act) {
          e.stopPropagation();
          const path = act.dataset.path;              // full path of the folder
          const leaf = path.split('/').pop();
          const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
          if (act.dataset.act === 'addsub') {
            Utils.prompt(`New subfolder inside "${leaf}"`, { confirmLabel: 'Create', placeholder: 'e.g. Motions' }).then(value => {
              const v = (value || '').trim();
              if (v) folderAction({ action: 'create', path: `${path}/${v}` }, 'Subfolder created.');
            });
          } else if (act.dataset.act === 'rename') {
            Utils.prompt(`Rename folder "${leaf}"`, { defaultValue: leaf, confirmLabel: 'Rename' }).then(value => {
              const v = (value || '').trim();
              if (v && v !== leaf) {
                const newPath = parent ? `${parent}/${v}` : v;
                folderAction({ action: 'rename', old_path: path, new_path: newPath }, 'Folder renamed.');
              }
            });
          } else {
            Utils.confirm(`Delete folder "${leaf}"? It must be empty.`, { confirmLabel: 'Delete Folder', danger: true }).then(ok => {
              if (ok) folderAction({ action: 'delete', path }, 'Folder deleted.');
            });
          }
          return;
        }
        _filesFolder = btn.dataset.folder;
        root.querySelectorAll('.files-folder-btn').forEach(b => b.classList.remove('files-folder-btn--active'));
        btn.classList.add('files-folder-btn--active');
        renderFilesList();
      });

      // Drop target: move dragged file(s) into this folder ('all' and 'trash'
      // are not real folders, so they can't receive dropped files).
      const targetKey = btn.dataset.folder;
      if (targetKey !== 'all' && targetKey !== 'trash') {
        btn.addEventListener('dragover', (e) => { e.preventDefault(); btn.classList.add('drag-over'); });
        btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
        btn.addEventListener('drop', (e) => {
          e.preventDefault();
          btn.classList.remove('drag-over');
          let ids;
          try { ids = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
          if (!Array.isArray(ids) || !ids.length) return;
          const folderPath = targetKey.startsWith('dyn:') ? targetKey.slice(4) : targetKey;
          moveDocs(ids, folderPath);
        });
      }
    });

    // New folder
    root.querySelector('#files-new-folder-btn')?.addEventListener('click', async () => {
      const value = await Utils.prompt('New folder name (use "parent/child" to nest)', { confirmLabel: 'Create', placeholder: 'e.g. Discovery' });
      if (value) await folderAction({ action: 'create', path: value }, 'Folder created.');
    });

    // Upload buttons → hidden file inputs
    const multiInput  = document.getElementById('files-input-multi');
    const folderInput = document.getElementById('files-input-folder');
    document.getElementById('files-upload-btn')?.addEventListener('click', () => multiInput?.click());
    document.getElementById('files-folder-upload-btn')?.addEventListener('click', () => folderInput?.click());
    document.getElementById('files-new-from-template-btn')?.addEventListener('click', openNewFromTemplateModal);
    document.getElementById('files-import-storage-btn')?.addEventListener('click', openStorageImportModal);

    multiInput?.addEventListener('change', e => {
      if (e.target.files?.length) handleFileUpload(Array.from(e.target.files));
      e.target.value = '';
    });
    folderInput?.addEventListener('change', e => {
      if (e.target.files?.length) handleFileUpload(Array.from(e.target.files));
      e.target.value = '';
    });

    // Drag and drop
    const dropZone = document.getElementById('files-drop-zone');
    if (dropZone) {
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
      dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        if (files.length) handleFileUpload(files);
      });
    }
  }

  async function handleFileUpload(files) {
    const queue  = document.getElementById('files-upload-queue');
    if (!queue || !matter) return;

    // A selected "Synced Folders" entry carries the dyn: sidebar-key prefix —
    // store the real folder name, never the key.
    const targetFolder = _filesFolder === 'all' ? 'other'
      : _filesFolder.startsWith('dyn:') ? _filesFolder.slice(4)
      : _filesFolder;
    const session = await Auth.getSession();

    // Build initial queue UI
    const items = files.map((f, i) => ({ file: f, id: `uq-${i}`, status: 'pending', msg: '' }));
    queue.innerHTML = items.map(it => `
      <div class="upload-queue-item uploading" id="${it.id}">
        <span class="uq-name">${Utils.esc(it.file.name)}</span>
        <span class="uq-msg">Waiting…</span>
      </div>`).join('');

    let anyUploaded = false;

    for (const item of items) {
      const el = document.getElementById(item.id);

      const ct = resolveContentType(item.file);
      if (!ct) {
        if (el) {
          el.className = 'upload-queue-item skipped';
          el.querySelector('.uq-msg').textContent = 'Skipped — unsupported type';
        }
        continue;
      }

      if (el) el.querySelector('.uq-msg').textContent = 'Uploading…';

      try {
        // 1. Get upload URL
        const urlRes = await fetch('/api/get-upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            matter_id:    matter.id,
            file_name:    item.file.name,
            file_size:    item.file.size,
            content_type: ct,
            name:         item.file.name,
            doc_type:     FOLDER_DOC_TYPE[targetFolder] || 'other',
            folder_path:  targetFolder,
          }),
        });
        if (!urlRes.ok) {
          const err = await urlRes.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${urlRes.status}`);
        }
        const { upload_url, document_id } = await urlRes.json();

        // 2. PUT to R2
        const putRes = await fetch(upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': ct },
          body: item.file,
        });
        if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

        // 3. Confirm
        if (el) el.querySelector('.uq-msg').textContent = 'Scanning…';
        const cfRes = await fetch('/api/confirm-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ document_id }),
        });
        if (!cfRes.ok) {
          const cerr = await cfRes.json().catch(() => ({}));
          throw new Error(cerr.error || 'Scan failed');
        }

        if (el) {
          el.className = 'upload-queue-item done';
          el.querySelector('.uq-msg').textContent = 'Done';
        }

        // Add to local state immediately
        _filesAllDocs.unshift({
          id: document_id,
          name: item.file.name,
          file_name: item.file.name,
          file_size: item.file.size,
          content_type: ct,
          folder_path: targetFolder,
          doc_type: FOLDER_DOC_TYPE[targetFolder] || 'other',
          status: 'received',
          created_at: new Date().toISOString(),
          uploaded_by: null,
          deleted_at: null,
        });
        anyUploaded = true;

      } catch (err) {
        if (el) {
          el.className = 'upload-queue-item error';
          el.querySelector('.uq-msg').textContent = err.message || 'Failed';
        }
      }
    }

    if (anyUploaded) {
      const root = document.getElementById('files-panel-root');
      if (root) renderFilesPanel(root);
    }

    // Auto-clear queue after 4s
    setTimeout(() => {
      const q = document.getElementById('files-upload-queue');
      if (q) q.innerHTML = '';
    }, 4000);
  }

  // ── Import from Storage modal (on-demand per-client Dropbox/Drive backfill) ──

  const SI_PROVIDER_LABELS = {
    dropbox: 'Dropbox', google_drive: 'Google Drive', onedrive: 'OneDrive', idrive: 'iDrive',
  };
  const SI_VIA_LABELS = {
    alias: 'linked folder', exact: 'exact match', fuzzy: 'fuzzy match',
  };

  function siMatterLabel(m) {
    const type = Utils.titleCase(m.case_type || 'Matter');
    return m.case_number ? `${type} — ${m.case_number}` : type;
  }

  async function openStorageImportModal() {
    const btn = document.getElementById('files-import-storage-btn');
    if (btn) Utils.setLoading(btn, true);
    try {
      const session = await Auth.getSession();
      const res = await fetch(`/api/storage-sync-import-client?client_id=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

      _siMatters    = data.matters || [];
      _siCandidates = data.candidates || [];

      if (!_siCandidates.length) {
        Utils.toast('No matching Dropbox/Drive folder found for this client.', 'info');
        return;
      }
      renderStorageImportForm();
    } catch (err) {
      Utils.toast(err.message || 'Failed to check storage folders.', 'error');
    } finally {
      if (btn) Utils.setLoading(btn, false);
    }
  }

  function renderStorageImportForm() {
    const overlay = document.getElementById('storage-import-modal');
    if (!overlay) return;

    const candidateItems = _siCandidates.map((c, i) => `
      <label style="display:flex;align-items:flex-start;gap:var(--space-2);padding:var(--space-2) 0;cursor:pointer">
        <input type="radio" name="si-candidate" value="${i}" ${i === 0 ? 'checked' : ''} style="margin-top:3px">
        <span>${Utils.esc(SI_PROVIDER_LABELS[c.provider] || c.provider)} — <strong>${Utils.esc(c.folder_name)}</strong>
          <span class="text-muted text-sm">(${SI_VIA_LABELS[c.via] || c.via})</span></span>
      </label>`).join('');

    const matterOpts = _siMatters.map(m =>
      `<option value="${Utils.esc(m.id)}">${Utils.esc(siMatterLabel(m))}</option>`).join('');

    overlay.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <h2 class="modal-title">Import from Storage</h2>
          <button class="modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="field" style="margin-bottom:var(--space-4)">
            <label>Matching folder${_siCandidates.length > 1 ? 's' : ''}</label>
            ${candidateItems}
          </div>
          <div class="field">
            <label>Import into matter <span class="required">*</span></label>
            <select id="si-matter-select">
              <option value="">Select a matter…</option>
              ${matterOpts}
            </select>
          </div>
          <div id="si-err" class="form-error hidden" style="margin-top:var(--space-3)"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn--secondary btn--sm" id="si-cancel">Cancel</button>
          <button type="button" class="btn btn--primary btn--sm" id="si-confirm">Import</button>
        </div>
      </div>`;
    overlay.classList.remove('hidden');

    overlay.querySelector('.modal-close').addEventListener('click', () => closeStorageImportModal());
    overlay.querySelector('#si-cancel').addEventListener('click', () => closeStorageImportModal());
    overlay.addEventListener('click', e => { if (e.target === overlay && !_siRunning) closeStorageImportModal(); });

    overlay.querySelector('#si-confirm').addEventListener('click', () => {
      const errEl     = overlay.querySelector('#si-err');
      const candIdx   = overlay.querySelector('input[name="si-candidate"]:checked')?.value;
      const matterId  = overlay.querySelector('#si-matter-select').value;
      if (candIdx == null) { errEl.textContent = 'Please select a folder.'; errEl.classList.remove('hidden'); return; }
      if (!matterId)       { errEl.textContent = 'Please select a matter.'; errEl.classList.remove('hidden'); return; }
      errEl.classList.add('hidden');
      startStorageImportJob(_siCandidates[Number(candIdx)], matterId);
    });
  }

  async function startStorageImportJob(candidate, matterId) {
    const overlay     = document.getElementById('storage-import-modal');
    const errEl       = overlay.querySelector('#si-err');
    const confirmBtn  = overlay.querySelector('#si-confirm');
    _siRunning = true;
    Utils.setLoading(confirmBtn, true);
    try {
      const result = await callFunction('/api/storage-sync-import-client', {
        client_id:    clientId,
        matter_id:    matterId,
        provider:     candidate.provider,
        folder_name:  candidate.folder_name,
        folder_lower: candidate.folder_lower,
      });
      _siRunning = result.status === 'running';
      renderStorageImportProgress(result);
      if (_siRunning) scheduleStorageImportPoll(result.job_id);
    } catch (err) {
      _siRunning = false;
      errEl.textContent = err.message || 'Import failed.';
      errEl.classList.remove('hidden');
      Utils.setLoading(confirmBtn, false);
    }
  }

  function scheduleStorageImportPoll(jobId) {
    clearTimeout(_siPollTimer);
    _siPollTimer = setTimeout(async () => {
      try {
        const result = await callFunction('/api/storage-sync-import-client', { job_id: jobId });
        _siRunning = result.status === 'running';
        renderStorageImportProgress(result);
        if (_siRunning) scheduleStorageImportPoll(jobId);
      } catch (err) {
        _siRunning = false;
        renderStorageImportError(err.message || 'Import failed while continuing — please retry from the Files tab.');
      }
    }, 1500);
  }

  function renderStorageImportProgress(result) {
    const overlay = document.getElementById('storage-import-modal');
    const modalEl = overlay?.querySelector('.modal');
    if (!modalEl) return; // modal was closed client-side; job keeps running server-side regardless
    const running = result.status === 'running';

    modalEl.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">Import from Storage</h2>
        ${running ? '' : '<button class="modal-close">×</button>'}
      </div>
      <div class="modal-body">
        <p style="font-size:var(--text-sm);margin-bottom:var(--space-3)">
          ${running ? 'Importing files…' : 'Import complete.'}
        </p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:var(--space-3);text-align:center;margin-bottom:var(--space-3)">
          <div><div style="font-size:var(--text-lg);font-weight:600">${result.imported_count}</div><div class="text-muted text-xs">Imported</div></div>
          <div><div style="font-size:var(--text-lg);font-weight:600">${result.skipped_count}</div><div class="text-muted text-xs">Skipped</div></div>
          <div><div style="font-size:var(--text-lg);font-weight:600">${result.error_count}</div><div class="text-muted text-xs">Errors</div></div>
        </div>
        ${running ? `<p class="text-muted text-sm">${result.remaining} file${result.remaining === 1 ? '' : 's'} remaining…</p>` : ''}
      </div>
      <div class="modal-footer">
        ${running
          ? '<button type="button" class="btn btn--secondary btn--sm" disabled>Importing…</button>'
          : '<button type="button" class="btn btn--primary btn--sm" id="si-done">Done</button>'}
      </div>`;

    if (!running) {
      modalEl.querySelector('#si-done').addEventListener('click', () => closeStorageImportModal({ refresh: true }));
      modalEl.querySelector('.modal-close')?.addEventListener('click', () => closeStorageImportModal({ refresh: true }));
    }
  }

  function renderStorageImportError(message) {
    const overlay = document.getElementById('storage-import-modal');
    const modalEl = overlay?.querySelector('.modal');
    if (!modalEl) return;
    modalEl.innerHTML = `
      <div class="modal-header">
        <h2 class="modal-title">Import from Storage</h2>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <div class="form-error">${Utils.esc(message)}</div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn--secondary btn--sm" id="si-close-err">Close</button>
      </div>`;
    modalEl.querySelector('.modal-close').addEventListener('click', () => closeStorageImportModal({ refresh: true }));
    modalEl.querySelector('#si-close-err').addEventListener('click', () => closeStorageImportModal({ refresh: true }));
  }

  function closeStorageImportModal(opts = {}) {
    clearTimeout(_siPollTimer);
    _siPollTimer = null;
    _siRunning   = false;
    closeModal(document.getElementById('storage-import-modal'));
    if (opts.refresh) loadFiles();
  }

  // ── Stage tracker ────────────────────────────────────────────────────────────

  function wireStageTracker() {
    const container = document.getElementById('stage-tracker-container');
    if (!container) return;

    if (!matter || !_stageList.length) {
      container.innerHTML = '';
      return;
    }

    const activeIdx = _stageList.findIndex(s => s.id === matter.current_stage_id);

    const steps = _stageList.map((s, i) => {
      const isDone   = activeIdx >= 0 && i < activeIdx;
      const isActive = i === activeIdx;
      const cls = isDone ? 'stage-step--done' : isActive ? 'stage-step--active' : '';
      return `<div class="stage-step ${cls}" data-stage-id="${Utils.esc(s.id)}" title="Set stage: ${Utils.esc(s.name)}">
        <div class="stage-dot"></div>
        <div class="stage-label">${Utils.esc(s.name)}</div>
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="stage-tracker">
        <div class="stage-tracker-header">
          <span class="stage-tracker-title">Case Progress</span>
          ${activeIdx >= 0 ? '<button class="btn btn--ghost btn--sm" id="btn-clear-stage" style="font-size:var(--text-xs);color:var(--color-text-muted)">Clear stage</button>' : ''}
        </div>
        <div class="stage-pipeline">${steps}</div>
      </div>`;

    container.querySelectorAll('.stage-step').forEach(el => {
      el.addEventListener('click', async () => {
        const stageId = el.dataset.stageId;
        if (stageId === matter.current_stage_id) return;
        try {
          await callFunction('/api/set-matter-stage', { matter_id: matter.id, stage_id: stageId });
          matter.current_stage_id = stageId;
          _currentStage = _stageList.find(s => s.id === stageId) || null;
          wireStageTracker();
          renderHero();
          Utils.toast(`Stage set to "${_currentStage?.name || ''}"`, 'success');
        } catch (err) {
          Utils.toast(err.message, 'error');
        }
      });
    });

    document.getElementById('btn-clear-stage')?.addEventListener('click', async () => {
      try {
        await callFunction('/api/set-matter-stage', { matter_id: matter.id, stage_id: null });
        matter.current_stage_id = null;
        _currentStage = null;
        wireStageTracker();
        renderHero();
        Utils.toast('Stage cleared', 'success');
      } catch (err) {
        Utils.toast(err.message, 'error');
      }
    });
  }

  // ── Draft document modal ─────────────────────────────────────────────────────

  let _draftTemplates = null;

  async function openDraftModal() {
    if (!matter) return;
    const modalEl = document.getElementById('draft-modal');

    if (!_draftTemplates) {
      const { data, error } = await db
        .from('draft_templates')
        .select('id, name, description, doc_category, case_types, wizard_schema')
        .eq('active', true)
        .order('sort_order');
      if (error || !data) { Utils.toast('Failed to load templates.', 'error'); return; }
      _draftTemplates = matter.case_type
        ? data.filter(t => !t.case_types || t.case_types.length === 0 || t.case_types.includes(matter.case_type))
        : data;
    }

    if (_draftTemplates.length === 0) {
      Utils.toast('No document templates available for this case type.', 'info');
      return;
    }
    if (_draftTemplates.length === 1) {
      openDraftWizard(modalEl, _draftTemplates[0]);
    } else {
      openDraftPicker(modalEl, _draftTemplates);
    }
  }

  function openDraftPicker(modalEl, templates) {
    const cards = templates.map(t => `
      <button type="button" class="draft-template-card" data-id="${Utils.esc(t.id)}">
        <span class="draft-template-name">${Utils.esc(t.name)}</span>
        ${t.description ? `<span class="draft-template-desc">${Utils.esc(t.description)}</span>` : ''}
      </button>`).join('');

    modalEl.innerHTML = `
      <div class="modal" style="max-width:500px">
        <div class="modal-header">
          <h2 class="modal-title">Select Document Template</h2>
          <button class="modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="draft-template-list">${cards}</div>
        </div>
      </div>`;

    modalEl.classList.remove('hidden');
    modalEl.querySelector('.modal-close').addEventListener('click', () => closeModal(modalEl));
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(modalEl); });

    modalEl.querySelectorAll('.draft-template-card').forEach(btn => {
      btn.addEventListener('click', () => {
        const tmpl = templates.find(t => t.id === btn.dataset.id);
        if (tmpl) openDraftWizard(modalEl, tmpl);
      });
    });
  }

  function openDraftWizard(modalEl, template) {
    const schema = Array.isArray(template.wizard_schema) ? template.wizard_schema : [];

    function prefillVal(f) {
      if (f.prefill === 'matter.date_of_marriage') {
        const kd = keyDates.find(d => d.date_type === 'marriage');
        if (kd) return kd.date_value;
      }
      if (f.prefill === 'matter.separation_date') {
        const kd = keyDates.find(d => d.date_type === 'separation');
        if (kd) return kd.date_value;
      }
      if (f.prefill) {
        const key = f.prefill.replace('matter.', '');
        const v = matter?.[key];
        if (v != null) return v;
      }
      return f.default ?? '';
    }

    function renderWzField(f) {
      const id  = `wz-${f.name}`;
      const val = prefillVal(f);
      const wrapAttrs = f.depends_on ? ` data-depends-on="${Utils.esc(f.depends_on)}"` : '';

      if (f.type === 'select') {
        const opts = (f.options || []).map(o =>
          `<option value="${Utils.esc(String(o.value))}"${String(val) === String(o.value) ? ' selected' : ''}>${Utils.esc(o.label)}</option>`
        ).join('');
        return `<div class="field" id="wz-wrap-${f.name}"${wrapAttrs}>
          <label for="${id}">${Utils.esc(f.label)}</label>
          <select id="${id}" name="${f.name}">${opts}</select>
        </div>`;
      }
      if (f.type === 'checkbox') {
        const chk = (val === true || val === 'true') ? ' checked' : '';
        return `<div class="field" id="wz-wrap-${f.name}"${wrapAttrs}>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:var(--space-2);font-weight:normal">
            <input type="checkbox" id="${id}" name="${f.name}" value="true"${chk} style="width:auto">
            ${Utils.esc(f.label)}
          </label>
        </div>`;
      }
      return `<div class="field" id="wz-wrap-${f.name}"${wrapAttrs}>
        <label for="${id}">${Utils.esc(f.label)}</label>
        <input type="${f.type || 'text'}" id="${id}" name="${f.name}" value="${Utils.esc(String(val ?? ''))}">
      </div>`;
    }

    const fieldsHtml = schema.map(renderWzField).join('');

    modalEl.innerHTML = `
      <div class="modal" style="max-width:620px">
        <div class="modal-header">
          <h2 class="modal-title">${Utils.esc(template.name)}</h2>
          <button class="modal-close">×</button>
        </div>
        <form id="draft-wz-form" novalidate>
          <div class="modal-body" style="max-height:70vh;overflow-y:auto">
            ${fieldsHtml || '<p class="text-muted">No wizard fields — click Generate to draft with existing case data.</p>'}
            <div id="draft-err" class="form-error hidden" style="margin-top:var(--space-3)"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn--ghost btn--sm modal-cancel">Cancel</button>
            <button type="submit" class="btn btn--primary btn--sm" id="draft-gen-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
              Generate Document
            </button>
          </div>
        </form>
      </div>`;

    function syncDepends() {
      modalEl.querySelectorAll('[data-depends-on]').forEach(wrap => {
        const ctrl = modalEl.querySelector(`[name="${wrap.dataset.dependsOn}"]`);
        if (!ctrl) return;
        const active = ctrl.type === 'checkbox' ? ctrl.checked : !!ctrl.value;
        wrap.style.display = active ? '' : 'none';
      });
    }
    syncDepends();
    modalEl.querySelectorAll('input, select').forEach(el => el.addEventListener('change', syncDepends));

    modalEl.classList.remove('hidden');
    modalEl.querySelector('.modal-close').addEventListener('click', () => closeModal(modalEl));
    modalEl.querySelector('.modal-cancel').addEventListener('click', () => closeModal(modalEl));
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(modalEl); });

    modalEl.querySelector('#draft-wz-form').addEventListener('submit', async e => {
      e.preventDefault();
      const errEl = modalEl.querySelector('#draft-err');
      errEl.classList.add('hidden');
      const genBtn = modalEl.querySelector('#draft-gen-btn');
      Utils.setLoading(genBtn, true);

      const fd = new FormData(e.target);
      const wizardData = {};
      for (const [k, v] of fd.entries()) wizardData[k] = v;
      schema.forEach(f => { if (f.type === 'checkbox' && !(f.name in wizardData)) wizardData[f.name] = false; });

      try {
        const session = await Auth.getSession();
        const res = await fetch('/api/drafting/generate', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body:    JSON.stringify({ template_id: template.id, matter_id: matter.id, wizard_data: wizardData }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server error (${res.status})`);
        }

        const data = await res.json();
        // Trigger the ms-word: URI — opens the filled .docx in native Word via WebDAV
        window.location.href = data.word_url;

        closeModal(modalEl);
        Utils.toast(`Opening "${data.file_name}" in Word…`, 'success');
        _draftsLoaded = false; // invalidate so Drafts tab reloads on next click
      } catch (err) {
        errEl.textContent = err.message || 'Failed to generate document.';
        errEl.classList.remove('hidden');
        Utils.setLoading(genBtn, false);
      }
    });
  }

  // ── Modal utility ────────────────────────────────────────────────────────────

  function closeModal(modalEl) {
    modalEl.classList.add('hidden');
    modalEl.innerHTML = '';
  }

  // ── SSN modal ────────────────────────────────────────────────────────────────

  function openSsnModal(entityType, entityId, entityLabel) {
    const modalEl = document.getElementById('ssn-modal');
    modalEl.innerHTML = `
      <div class="modal" style="max-width:420px">
        <div class="modal-header">
          <h2 class="modal-title">Set SSN${entityLabel ? ' — ' + Utils.esc(entityLabel) : ''}</h2>
          <button class="modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label for="ssn-input">Social Security Number <span class="required">*</span></label>
            <input type="text" id="ssn-input" placeholder="XXX-XX-XXXX" maxlength="11" autocomplete="off" inputmode="numeric">
            <p class="text-sm text-muted" style="margin-top:var(--space-2)">Encrypted with AES-256-GCM. Only the last 4 digits are visible in the portal. Every access is logged.</p>
          </div>
          <div id="ssn-modal-error" class="form-error hidden"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn--secondary btn--sm" id="ssn-modal-cancel">Cancel</button>
          <button type="button" class="btn btn--primary btn--sm" id="ssn-modal-save">Save</button>
        </div>
      </div>`;

    modalEl.classList.remove('hidden');

    const input = document.getElementById('ssn-input');
    const errEl = document.getElementById('ssn-modal-error');

    // Auto-format as XXX-XX-XXXX while typing
    input.addEventListener('input', e => {
      const digits = e.target.value.replace(/\D/g, '').slice(0, 9);
      if (digits.length > 5)      e.target.value = digits.slice(0,3) + '-' + digits.slice(3,5) + '-' + digits.slice(5);
      else if (digits.length > 3) e.target.value = digits.slice(0,3) + '-' + digits.slice(3);
      else                        e.target.value = digits;
    });

    modalEl.querySelector('.modal-close').addEventListener('click', () => closeModal(modalEl));
    document.getElementById('ssn-modal-cancel').addEventListener('click', () => closeModal(modalEl));
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(modalEl); });

    document.getElementById('ssn-modal-save').addEventListener('click', async () => {
      errEl.classList.add('hidden');
      const digits = input.value.replace(/\D/g, '');
      if (digits.length !== 9) {
        errEl.textContent = 'SSN must be 9 digits (e.g. 123-45-6789).';
        errEl.classList.remove('hidden');
        return;
      }

      const saveBtn = document.getElementById('ssn-modal-save');
      Utils.setLoading(saveBtn, true);
      try {
        const result = await callFunction('/api/save-ssn', { entity_type: entityType, entity_id: entityId, ssn: digits });
        // Update local state and re-render the affected section
        if (entityType === 'clients') {
          client.ssn_last4 = result.last4;
          renderClientInfo();
        } else if (entityType === 'opposing_parties') {
          if (oppParty?.id === entityId) oppParty.ssn_last4 = result.last4;
          if (jointSponsor?.id === entityId) jointSponsor.ssn_last4 = result.last4;
          renderOpposing();
        } else if (entityType === 'children') {
          const ch = children.find(c => c.id === entityId);
          if (ch) { ch.ssn_last4 = result.last4; renderChildren(); }
        }
        closeModal(modalEl);
        Utils.toast('SSN saved.', 'success');
      } catch (err) {
        errEl.textContent = err.message || 'Failed to save SSN.';
        errEl.classList.remove('hidden');
        Utils.setLoading(saveBtn, false);
      }
    });
  }

  async function doRevealSsn(entityType, entityId, displayId) {
    const displayEl  = document.getElementById(displayId);
    const revealBtn  = document.querySelector(`.btn-reveal-ssn[data-entity-id="${entityId}"]`);
    if (!displayEl) return;

    if (revealBtn) revealBtn.disabled = true;

    try {
      const result = await callFunction('/api/reveal-ssn', { entity_type: entityType, entity_id: entityId });
      let seconds = 30;
      const countdownId = `ssn-countdown-${entityId}`;
      displayEl.innerHTML = `<span class="val" style="font-family:monospace;letter-spacing:.05em">${Utils.esc(result.ssn)}</span> <span class="text-sm text-muted" id="${countdownId}" style="font-size:var(--text-xs)">Hiding in ${seconds}s</span>`;

      const timer = setInterval(() => {
        seconds--;
        const el = document.getElementById(countdownId);
        if (el) el.textContent = `Hiding in ${seconds}s`;
        if (seconds <= 0) {
          clearInterval(timer);
          const last4 = result.ssn.replace(/-/g, '').slice(-4);
          displayEl.innerHTML = `<span class="val">●●●–●●–${last4}</span>`;
          if (revealBtn) revealBtn.disabled = false;
        }
      }, 1000);
    } catch (err) {
      Utils.toast(err.message || 'Failed to reveal SSN.', 'error');
      if (revealBtn) revealBtn.disabled = false;
    }
  }

  // ── Immigration tab ──────────────────────────────────────────────────────────

  const IMM_CASE_PANELS = {
    family_based: {
      title: 'Family-Based Petition',
      // Petitioner identity moved to the structured Petitioner record on the
      // Case tab (opposing_parties, migration 1602) — form-fillable, unlike
      // the old free-text case_data keys.
      fields: [
        { key: 'visa_category',           label: 'Visa Category (IR-1, F-2A…)' },
        { key: 'priority_date',           label: 'Priority Date',     fmt: 'date' },
        { key: 'i130_receipt',            label: 'I-130 Receipt #' },
        { key: 'i485_receipt',            label: 'I-485 Receipt #' },
        { key: 'nvc_case_number',         label: 'NVC Case Number' },
        { key: 'dos_case_number',         label: 'DOS Case Number' },
        { key: 'interview_date',          label: 'Interview Date',    fmt: 'date' },
        { key: 'interview_location',      label: 'Interview Location' },
      ],
    },
    employment_based: {
      title: 'Employment-Based',
      fields: [
        { key: 'employer_name',    label: 'Employer Name' },
        { key: 'employer_address', label: 'Employer Address' },
        { key: 'job_title',        label: 'Job Title' },
        { key: 'soc_code',         label: 'SOC Code' },
        { key: 'visa_category',    label: 'Visa / Petition Category' },
        { key: 'i140_receipt',     label: 'I-140 Receipt #' },
        { key: 'perm_case_number', label: 'PERM Case Number' },
        { key: 'priority_date',    label: 'Priority Date',      fmt: 'date' },
        { key: 'i485_receipt',     label: 'I-485 Receipt #' },
        { key: 'consular_post',    label: 'Consular Post (if CP)' },
      ],
    },
    humanitarian: {
      title: 'Asylum & Humanitarian',
      fields: [
        { key: 'form_type',            label: 'Form Type (I-589, I-821D, I-821, I-918…)' },
        { key: 'receipt_number',       label: 'Receipt Number' },
        { key: 'filing_date',          label: 'Filing Date',          fmt: 'date' },
        { key: 'asylum_grounds',       label: 'Asylum Grounds' },
        { key: 'tps_country',          label: 'TPS Country (I-821)' },
        { key: 'tps_designation_date', label: 'TPS Designation Date', fmt: 'date' },
        { key: 'daca_expiry',          label: 'DACA Expiry',          fmt: 'date' },
        { key: 'interview_date',       label: 'Interview Date',       fmt: 'date' },
        { key: 'country_conditions',   label: 'Country Conditions Notes' },
      ],
    },
    removal_defense: {
      title: 'Removal Defense',
      fields: [
        { key: 'eoir_court',        label: 'EOIR Court' },
        { key: 'judge_name',        label: 'Judge' },
        { key: 'next_hearing_date', label: 'Next Hearing Date', fmt: 'date' },
        { key: 'hearing_type',      label: 'Hearing Type' },
        { key: 'ina_charges',       label: 'INA Charges' },
        { key: 'case_stage',        label: 'Case Stage (IJ / BIA / Circuit)' },
        { key: 'ij_decision_date',  label: 'IJ Decision Date',  fmt: 'date' },
        { key: 'bia_decision_date', label: 'BIA Decision Date', fmt: 'date' },
      ],
    },
    nonimmigrant: {
      title: 'Nonimmigrant Visa',
      fields: [
        { key: 'visa_type',          label: 'Visa Type' },
        { key: 'visa_number',        label: 'Visa Number' },
        { key: 'visa_expiry',        label: 'Visa Expiry',           fmt: 'date' },
        { key: 'status_expiry',      label: 'Status Expiry (I-94)',  fmt: 'date' },
        { key: 'ds160_confirmation', label: 'DS-160 Confirmation' },
        { key: 'cos_to',             label: 'Change of Status To' },
      ],
    },
    naturalization: {
      title: 'Naturalization & Citizenship',
      fields: [
        { key: 'lpr_date',           label: 'LPR Date',           fmt: 'date' },
        { key: 'n400_filing_date',   label: 'N-400 Filing Date',  fmt: 'date' },
        { key: 'n400_receipt',       label: 'N-400 Receipt #' },
        { key: 'biometrics_date',    label: 'Biometrics Date',    fmt: 'date' },
        { key: 'interview_date',     label: 'Interview Date',     fmt: 'date' },
        { key: 'oath_ceremony_date', label: 'Oath Ceremony Date', fmt: 'date' },
        { key: 'certificate_number', label: 'Certificate Number' },
      ],
    },
    habeas: {
      title: 'Habeas Corpus',
      fields: [
        { key: 'district_court',   label: 'District Court' },
        { key: 'case_number',      label: 'Case Number' },
        { key: 'filing_date',      label: 'Filing Date',     fmt: 'date' },
        { key: 'detention_since',  label: 'Detention Since', fmt: 'date' },
        { key: 'prior_eoir_case',  label: 'Prior EOIR Case #' },
      ],
    },
  };

  function updateTabVisibility() {
    const hasFamilyLaw   = practiceAreas.some(p => p.key === 'family_law');
    const hasImmigration = practiceAreas.some(p => p.key === 'immigration');

    // Party sections inside the Case tab: opposing party for family-law firms,
    // relabeled "Petitioner" for immigration matters; children stay family-law.
    document.getElementById('opposing-container')?.classList.toggle('hidden', !(hasFamilyLaw || isImmMatter()));
    document.getElementById('children-container')?.classList.toggle('hidden', !hasFamilyLaw);

    // Financial → Overview sub-tab is family-law only; others land on Trust
    const ovBtn   = document.querySelector('.subtab[data-group="fin"][data-subtab="fin-overview"]');
    const ovPanel = document.getElementById('subpanel-fin-overview');
    if (ovBtn)   ovBtn.classList.toggle('hidden', !hasFamilyLaw);
    if (ovPanel) ovPanel.classList.toggle('hidden', !hasFamilyLaw);
    if (!hasFamilyLaw) activateSubtab('fin', 'trust', { skipLoad: true });

    const immBtn   = document.querySelector('.detail-tab[data-tab="immigration"]');
    const immPanel = document.getElementById('tab-immigration');
    if (immBtn)   immBtn.classList.toggle('hidden', !hasImmigration);
    if (immPanel) immPanel.classList.toggle('hidden', !hasImmigration);
  }

  function wireImmSubtabs() {
    const allBtns = document.querySelectorAll('.imm-subtab');
    allBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        allBtns.forEach(b => b.classList.remove('imm-subtab--active'));
        document.querySelectorAll('.imm-subtab-panel').forEach(p => { p.style.display = 'none'; });
        btn.classList.add('imm-subtab--active');
        const panel = document.getElementById('imm-panel-' + btn.dataset.subtab);
        if (panel) panel.style.display = 'block';
      });
    });
  }

  function renderImmigration() {
    if (!practiceAreas.some(p => p.key === 'immigration')) return;

    const subtabKeys = ['family_based', 'employment_based', 'humanitarian', 'removal_defense', 'nonimmigrant', 'naturalization', 'habeas'];
    subtabKeys.forEach(key => {
      const btn = document.querySelector(`.imm-subtab[data-subtab="${key}"]`);
      if (btn) btn.classList.toggle('hidden', !enabledImmCaseTypes.has(key));
    });

    renderImmGeneral();
    renderImmFamilyMembers();
    subtabKeys.forEach(key => renderImmCasePanel(key));
    wireImmSubtabs();
    wireImmEdits();
  }

  function renderImmGeneral() {
    const d = immigrationData || {};
    if (!matter) {
      setGrid('grid-imm-general', '<p class="text-muted text-sm">No matter on record.</p>');
      return;
    }
    setGrid('grid-imm-general', [
      field('A-Number',                  d.a_number),
      field('USCIS Online Account #',    d.uscis_account_number),
      field('Immigration Status',        d.immigration_status),
      field('Country of Birth',          d.country_of_birth),
      field('Country of Citizenship',    d.country_of_citizenship),
      field('Languages',                 d.languages),
      field('Date of Last Entry',        d.last_entry_date,  'date'),
      field('Port of Entry',             d.port_of_entry),
      field('I-94 Number',               d.i94_number),
      field('I-94 / Auth Stay Until',    d.i94_expiry,       'date'),
      field('Currently Detained',        d.is_detained ?? null, 'bool'),
      d.is_detained    ? field('Detention Facility',    d.detention_facility)          : '',
      field('Prior Removal Order',       d.has_prior_removal_order ?? null, 'bool'),
      d.has_prior_removal_order ? field('Removal Order Notes', d.prior_removal_order_notes) : '',
      field('Criminal History',          d.has_criminal_history ?? null, 'bool'),
      d.has_criminal_history ? field('Criminal History Notes', d.criminal_history_notes) : '',
    ].join(''));
  }

  function renderImmFamilyMembers() {
    const container = document.getElementById('imm-family-list');
    if (!container) return;
    if (!matter) {
      container.innerHTML = '<p class="text-muted text-sm">No matter on record.</p>';
      return;
    }
    if (!immigrationFamilyMembers.length) {
      container.innerHTML = '<p class="text-muted text-sm" style="padding:var(--space-2) 0">No family members or dependents on record.</p>';
      return;
    }
    container.innerHTML = `<div class="children-list">${
      immigrationFamilyMembers.map(m => `
        <div class="child-card">
          <div class="child-card-header">
            <strong>${Utils.esc(m.first_name + (m.last_name ? ' ' + m.last_name : ''))}</strong>
            <div style="display:flex;gap:var(--space-2)">
              <button class="btn btn--ghost btn--sm btn-edit-imm-member" data-id="${m.id}">Edit</button>
            </div>
          </div>
          <div class="detail-grid">
            ${field('Relationship',       m.relationship)}
            ${field('Date of Birth',      m.dob,               'date')}
            ${field('Country of Birth',   m.country_of_birth)}
            ${field('Nationality',        m.nationality)}
            ${field('A-Number',           m.a_number)}
            ${field('Immigration Status', m.immigration_status)}
            ${m.is_derivative_beneficiary ? field('Derivative Beneficiary', true, 'bool') : ''}
            ${m.notes ? field('Notes',    m.notes) : ''}
          </div>
        </div>`
      ).join('')
    }</div>`;
  }

  function renderImmCasePanel(key) {
    const def     = IMM_CASE_PANELS[key];
    const gridId  = `grid-imm-${key}`;
    const gridEl  = document.getElementById(gridId);
    if (!def || !gridEl) return;
    if (!matter) { gridEl.innerHTML = '<p class="text-muted text-sm">No matter on record.</p>'; return; }
    const cd = immigrationData?.case_data || {};
    gridEl.innerHTML = def.fields.map(f => field(f.label, cd[f.key], f.fmt)).join('');
  }

  function buildImmGeneralFields() {
    const d  = immigrationData || {};
    const yn = (name, v) => `
      <div class="field">
        <label>${name}</label>
        <select name="${name.toLowerCase().replace(/ /g,'_').replace(/\?/g,'')}">
          <option value="">—</option>
          <option value="true"${v===true||v==='true'?' selected':''}>Yes</option>
          <option value="false"${v===false||v==='false'?' selected':''}>No</option>
        </select>
      </div>`;
    document.getElementById('fields-imm-general').innerHTML = `
      <div class="detail-grid" style="margin-bottom:var(--space-4)">
        <div class="field"><label>A-Number</label><input type="text" name="a_number" value="${Utils.esc(d.a_number||'')}"></div>
        <div class="field"><label>USCIS Online Account #</label><input type="text" name="uscis_account_number" value="${Utils.esc(d.uscis_account_number||'')}"></div>
        <div class="field"><label>Immigration Status</label>
          <select name="immigration_status">
            ${['','Undocumented','LPR','US Citizen','DACA Recipient','TPS','Asylum Pending','Asylum Granted','H-1B','L-1','O-1','F-1','B-1/B-2','J-1','TN','Detained','Other'].map(s =>
              `<option value="${s}"${(d.immigration_status||'')=== s?' selected':''}>${s||'— Select —'}</option>`
            ).join('')}
          </select>
        </div>
        <div class="field"><label>Country of Birth</label><input type="text" name="country_of_birth" value="${Utils.esc(d.country_of_birth||'')}"></div>
        <div class="field"><label>Country of Citizenship</label><input type="text" name="country_of_citizenship" value="${Utils.esc(d.country_of_citizenship||'')}"></div>
        <div class="field"><label>Languages</label><input type="text" name="languages" placeholder="e.g. Spanish, English" value="${Utils.esc(d.languages||'')}"></div>
        <div class="field"><label>Date of Last Entry</label><input type="date" name="last_entry_date" value="${d.last_entry_date||''}"></div>
        <div class="field"><label>Port of Entry</label><input type="text" name="port_of_entry" value="${Utils.esc(d.port_of_entry||'')}"></div>
        <div class="field"><label>I-94 Number</label><input type="text" name="i94_number" value="${Utils.esc(d.i94_number||'')}"></div>
        <div class="field"><label>I-94 / Auth Stay Until</label><input type="date" name="i94_expiry" value="${d.i94_expiry||''}"></div>
        <div class="field"><label>Currently Detained</label>
          <select name="is_detained">
            <option value="">—</option>
            <option value="true"${d.is_detained===true?' selected':''}>Yes</option>
            <option value="false"${d.is_detained===false?' selected':''}>No</option>
          </select>
        </div>
        <div class="field"><label>Detention Facility</label><input type="text" name="detention_facility" value="${Utils.esc(d.detention_facility||'')}"></div>
        <div class="field"><label>Prior Removal Order</label>
          <select name="has_prior_removal_order">
            <option value="">—</option>
            <option value="true"${d.has_prior_removal_order===true?' selected':''}>Yes</option>
            <option value="false"${d.has_prior_removal_order===false?' selected':''}>No</option>
          </select>
        </div>
      </div>
      <div class="field" style="margin-bottom:var(--space-3)"><label>Removal Order Notes</label><textarea name="prior_removal_order_notes" rows="2">${Utils.esc(d.prior_removal_order_notes||'')}</textarea></div>
      <div class="detail-grid" style="margin-bottom:var(--space-3)">
        <div class="field"><label>Criminal History</label>
          <select name="has_criminal_history">
            <option value="">—</option>
            <option value="true"${d.has_criminal_history===true?' selected':''}>Yes</option>
            <option value="false"${d.has_criminal_history===false?' selected':''}>No</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Criminal History Notes</label><textarea name="criminal_history_notes" rows="2">${Utils.esc(d.criminal_history_notes||'')}</textarea></div>`;
  }

  function buildImmCasePanelFields(key) {
    const def = IMM_CASE_PANELS[key];
    if (!def) return;
    const cd = immigrationData?.case_data || {};
    document.getElementById(`fields-imm-${key}`).innerHTML = `
      <div class="detail-grid">
        ${def.fields.map(f => `
          <div class="field">
            <label>${Utils.esc(f.label)}</label>
            ${f.fmt === 'date'
              ? `<input type="date" name="${f.key}" value="${Utils.esc(cd[f.key]||'')}">`
              : `<input type="text" name="${f.key}" value="${Utils.esc(cd[f.key]||'')}">`
            }
          </div>`).join('')}
      </div>`;
  }

  function wireImmEdits() {
    if (!matter) return;

    // General
    wireSection('imm-general', 'view-imm-general', 'form-imm-general',
      'btn-edit-imm-general', 'btn-cancel-imm-general',
      buildImmGeneralFields,
      async (fd) => {
        const toBool = v => v === 'true' ? true : v === 'false' ? false : null;
        const payload = {
          a_number:                    fd.get('a_number')?.trim()               || null,
          uscis_account_number:        fd.get('uscis_account_number')?.trim()   || null,
          immigration_status:          fd.get('immigration_status')?.trim()     || null,
          country_of_birth:            fd.get('country_of_birth')?.trim()       || null,
          country_of_citizenship:      fd.get('country_of_citizenship')?.trim() || null,
          languages:                   fd.get('languages')?.trim()              || null,
          last_entry_date:             fd.get('last_entry_date')                || null,
          port_of_entry:               fd.get('port_of_entry')?.trim()          || null,
          i94_number:                  fd.get('i94_number')?.trim()             || null,
          i94_expiry:                  fd.get('i94_expiry')                     || null,
          is_detained:                 toBoolean(fd.get('is_detained'))              ?? false,
          detention_facility:          fd.get('detention_facility')?.trim()          || null,
          has_prior_removal_order:     toBoolean(fd.get('has_prior_removal_order'))  ?? false,
          prior_removal_order_notes:   fd.get('prior_removal_order_notes')?.trim()  || null,
          has_criminal_history:        toBoolean(fd.get('has_criminal_history'))     ?? false,
          criminal_history_notes:      fd.get('criminal_history_notes')?.trim() || null,
          updated_at: new Date().toISOString(),
        };
        if (immigrationData) {
          const { error } = await db.from('client_immigration').update(payload).eq('id', immigrationData.id);
          if (error) throw error;
          Object.assign(immigrationData, payload);
        } else {
          const { data: newRow, error } = await db.from('client_immigration')
            .insert({ ...payload, matter_id: matter.id }).select().single();
          if (error) throw error;
          immigrationData = newRow;
        }
        renderImmGeneral();
      }
    );

    // Case-type panels
    ['family_based', 'employment_based', 'humanitarian', 'removal_defense', 'nonimmigrant', 'naturalization', 'habeas'].forEach(key => {
      wireSection(`imm-${key}`, `view-imm-${key}`, `form-imm-${key}`,
        `btn-edit-imm-${key}`, `btn-cancel-imm-${key}`,
        () => buildImmCasePanelFields(key),
        async (fd) => {
          const def = IMM_CASE_PANELS[key];
          const updates = {};
          def.fields.forEach(f => { updates[f.key] = fd.get(f.key)?.trim() || null; });
          const newCaseData = { ...(immigrationData?.case_data || {}), ...updates };
          const payload = { case_data: newCaseData, updated_at: new Date().toISOString() };
          if (immigrationData) {
            const { error } = await db.from('client_immigration').update(payload).eq('id', immigrationData.id);
            if (error) throw error;
            Object.assign(immigrationData, payload);
          } else {
            const { data: newRow, error } = await db.from('client_immigration')
              .insert({ matter_id: matter.id, case_data: newCaseData }).select().single();
            if (error) throw error;
            immigrationData = newRow;
          }
          renderImmCasePanel(key);
        }
      );
    });

    // Family member buttons — delegated so they survive re-renders
    const immTabPanel = document.getElementById('tab-immigration');
    if (immTabPanel) {
      immTabPanel.addEventListener('click', e => {
        if (e.target.closest('#btn-add-imm-member'))   openImmMemberModal(null);
        const editBtn = e.target.closest('.btn-edit-imm-member');
        if (editBtn) {
          const member = immigrationFamilyMembers.find(m => m.id === editBtn.dataset.id);
          if (member) openImmMemberModal(member);
        }
      });
    }
  }

  function toBoolean(v) {
    if (v === 'true')  return true;
    if (v === 'false') return false;
    return null;
  }

  async function openImmMemberModal(existing = null) {
    const modalEl = document.getElementById('imm-member-modal');
    const isEdit  = !!existing;
    const m       = existing || {};

    modalEl.innerHTML = `
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <h2 class="modal-title">${isEdit ? 'Edit' : 'Add'} Family Member / Dependent</h2>
          <button class="modal-close" id="imm-member-close" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <form id="imm-member-form" novalidate>
            <div class="detail-grid" style="margin-bottom:var(--space-4)">
              <div class="field"><label>First Name <span class="required">*</span></label><input type="text" name="first_name" value="${Utils.esc(m.first_name||'')}" required></div>
              <div class="field"><label>Last Name</label><input type="text" name="last_name" value="${Utils.esc(m.last_name||'')}"></div>
              <div class="field"><label>Relationship <span class="required">*</span></label>
                <select name="relationship" required>
                  ${['','Spouse','Child','Parent','Sibling','Other'].map(r =>
                    `<option value="${r}"${(m.relationship||'')=== r?' selected':''}>${r||'— Select —'}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="field"><label>Date of Birth</label><input type="date" name="dob" value="${m.dob||''}"></div>
              <div class="field"><label>Country of Birth</label><input type="text" name="country_of_birth" value="${Utils.esc(m.country_of_birth||'')}"></div>
              <div class="field"><label>Nationality</label><input type="text" name="nationality" value="${Utils.esc(m.nationality||'')}"></div>
              <div class="field"><label>A-Number</label><input type="text" name="a_number" value="${Utils.esc(m.a_number||'')}"></div>
              <div class="field"><label>Immigration Status</label><input type="text" name="immigration_status" value="${Utils.esc(m.immigration_status||'')}"></div>
            </div>
            <div class="flag-row" style="margin-bottom:var(--space-4)">
              <input type="checkbox" id="imm-member-deriv" name="is_derivative_beneficiary" ${m.is_derivative_beneficiary?'checked':''}>
              <label for="imm-member-deriv">Derivative beneficiary on this petition</label>
            </div>
            <div class="field" style="margin-bottom:var(--space-4)"><label>Notes</label><textarea name="notes" rows="2">${Utils.esc(m.notes||'')}</textarea></div>
            <div id="imm-member-err" class="form-error hidden" style="margin-bottom:var(--space-3)"></div>
            <div style="display:flex;gap:var(--space-3);justify-content:flex-end;align-items:center">
              ${isEdit ? `<button type="button" class="btn btn--danger btn--sm" id="imm-member-delete">Delete</button><span style="flex:1"></span>` : ''}
              <button type="button" class="btn btn--secondary btn--sm" id="imm-member-cancel">Cancel</button>
              <button type="submit" class="btn btn--primary btn--sm" id="imm-member-save">${isEdit ? 'Save changes' : 'Add member'}</button>
            </div>
          </form>
        </div>
      </div>`;
    modalEl.classList.remove('hidden');

    document.getElementById('imm-member-close').onclick  = () => closeModal(modalEl);
    document.getElementById('imm-member-cancel').onclick = () => closeModal(modalEl);

    if (isEdit) {
      document.getElementById('imm-member-delete').onclick = async () => {
        if (!await Utils.confirm('Delete this family member?', { confirmLabel: 'Delete' })) return;
        await doDeleteImmMember(existing.id);
        closeModal(modalEl);
      };
    }

    document.getElementById('imm-member-form').addEventListener('submit', async e => {
      e.preventDefault();
      const saveBtn = document.getElementById('imm-member-save');
      const errEl   = document.getElementById('imm-member-err');
      Utils.setLoading(saveBtn, true);
      const fd = new FormData(e.target);
      try {
        // Ensure a client_immigration row exists before inserting a family member
        if (!immigrationData) {
          const { data: newRow, error: immErr } = await db.from('client_immigration')
            .insert({ matter_id: matter.id }).select().single();
          if (immErr) throw immErr;
          immigrationData = newRow;
        }
        const payload = {
          immigration_id:            immigrationData.id,
          matter_id:                 matter.id,
          first_name:                fd.get('first_name')?.trim(),
          last_name:                 fd.get('last_name')?.trim()          || null,
          relationship:              fd.get('relationship'),
          dob:                       fd.get('dob')                        || null,
          country_of_birth:          fd.get('country_of_birth')?.trim()  || null,
          nationality:               fd.get('nationality')?.trim()        || null,
          a_number:                  fd.get('a_number')?.trim()           || null,
          immigration_status:        fd.get('immigration_status')?.trim() || null,
          is_derivative_beneficiary: fd.get('is_derivative_beneficiary') === 'on',
          notes:                     fd.get('notes')?.trim()              || null,
        };
        if (!payload.first_name) throw new Error('First name is required.');
        if (!payload.relationship) throw new Error('Relationship is required.');

        if (isEdit) {
          const { error } = await db.from('client_immigration_family_members').update(payload).eq('id', existing.id);
          if (error) throw error;
          const idx = immigrationFamilyMembers.findIndex(row => row.id === existing.id);
          if (idx !== -1) immigrationFamilyMembers[idx] = { ...immigrationFamilyMembers[idx], ...payload };
        } else {
          const { data: newMember, error } = await db.from('client_immigration_family_members')
            .insert(payload).select().single();
          if (error) throw error;
          immigrationFamilyMembers.push(newMember);
        }
        closeModal(modalEl);
        renderImmFamilyMembers();
        Utils.toast(isEdit ? 'Member updated.' : 'Member added.', 'success');
      } catch (err) {
        errEl.textContent = err.message || 'Save failed.';
        errEl.classList.remove('hidden');
        Utils.setLoading(saveBtn, false);
      }
    });
  }

  async function doDeleteImmMember(memberId) {
    try {
      const { error } = await db.from('client_immigration_family_members').delete().eq('id', memberId);
      if (error) throw error;
      immigrationFamilyMembers = immigrationFamilyMembers.filter(m => m.id !== memberId);
      renderImmFamilyMembers();
      Utils.toast('Member deleted.', 'success');
    } catch (err) {
      Utils.toast(err.message || 'Delete failed.', 'error');
    }
  }

  // ── Trust Ledger tab (lazy-loaded on first click) ────────────────────────────

  const FLAT_FEE_ARCHETYPE_MAP = {
    IL: 'operating_first',
    CA: 'choice', NY: 'choice', CO: 'choice', WA: 'choice', AZ: 'choice', MO: 'choice',
  };
  function getFlatFeeArchetype(jur) {
    return FLAT_FEE_ARCHETYPE_MAP[(jur || '').toUpperCase()] || 'trust_first';
  }

  let _trustLoaded       = false;
  let _trustProfile      = null;
  let _trustAccounts     = [];
  let _trustInvoices     = [];
  let _trustCanWrite     = false;
  let _trustMilestones   = [];
  let _trustJurisdiction = 'TX';
  let _trustRetainers    = [];
  let _pendingReversal   = null; // { milestoneId, invoiceId, amount, desc }

  function wireTrustTab() {
    _subtabLoaders.trust = async () => {
      if (_trustLoaded) return;
      _trustLoaded = true;
      await loadTrust();
    };

    document.getElementById('btn-trust-new-entry')?.addEventListener('click', openTrustEntryModal);
    document.getElementById('trust-entry-close')?.addEventListener('click', closeTrustEntryModal);
    document.getElementById('trust-entry-cancel')?.addEventListener('click', closeTrustEntryModal);

    document.getElementById('btn-trust-new-invoice')?.addEventListener('click', openInvoiceModal);
    document.getElementById('trust-invoice-close')?.addEventListener('click', closeInvoiceModal);
    document.getElementById('trust-invoice-cancel')?.addEventListener('click', closeInvoiceModal);
    document.getElementById('trust-invoice-form')?.addEventListener('submit', saveInvoice);

    document.getElementById('btn-trust-request-retainer')?.addEventListener('click', openRetainerModal);
    document.getElementById('retainer-close')?.addEventListener('click', closeRetainerModal);
    document.getElementById('retainer-cancel')?.addEventListener('click', closeRetainerModal);
    document.getElementById('retainer-form')?.addEventListener('submit', submitRetainer);

    document.getElementById('btn-trust-add-expense')?.addEventListener('click', openExpenseModal);
    document.getElementById('expense-close')?.addEventListener('click', closeExpenseModal);
    document.getElementById('expense-cancel')?.addEventListener('click', closeExpenseModal);
    document.getElementById('expense-form')?.addEventListener('submit', submitExpense);

    // Copy a pending retainer's payment link. Single GLOBAL delegate: the router
    // re-runs this page script (and wireTrustTab) on every navigation, so a plain
    // document.addEventListener would stack a new listener each visit. Remove the
    // prior one first so exactly one (fresh) handler is ever attached.
    if (document.__trustCopyClick) document.removeEventListener('click', document.__trustCopyClick);
    document.__trustCopyClick = async e => {
      const copyBtn = e.target.closest('[data-retainer-copy]');
      if (!copyBtn) return;
      try {
        await navigator.clipboard.writeText(copyBtn.dataset.retainerCopy);
        Utils.toast('Payment link copied', 'success');
      } catch { Utils.toast('Could not copy link', 'error'); }
    };
    document.addEventListener('click', document.__trustCopyClick);

    document.getElementById('ti-type')?.addEventListener('change', e => {
      showFlatFeeUI(e.target.value);
    });

    document.getElementById('ti-add-milestone')?.addEventListener('click', () => addMilestoneRow());

    document.getElementById('ti-amount')?.addEventListener('input', updateMilestoneTotals);

    document.getElementById('ti-disclosure-check')?.addEventListener('change', e => {
      const jur   = _trustJurisdiction.toUpperCase();
      const caRow = document.getElementById('ti-ca-sig-row');
      if (e.target.checked) {
        document.getElementById('ti-milestone-section').classList.add('hidden');
        if (jur === 'CA' && caRow) caRow.classList.remove('hidden');
      } else {
        document.getElementById('ti-milestone-section').classList.remove('hidden');
        if (caRow) caRow.classList.add('hidden');
      }
    });

    // Delegate mark-sent / void / earn-milestone / reverse-milestone / remove-milestone
    // clicks. Single GLOBAL delegate (see note above): stacking these was the cause
    // of the "Void fires, then you must cancel the dialog ~5 times" bug — each client
    // card visit had added another document listener, so one Void click fired N times.
    if (document.__trustActionClick) document.removeEventListener('click', document.__trustActionClick);
    document.__trustActionClick = async e => {
      const ms   = e.target.closest('[data-inv-mark-sent]');
      const vo   = e.target.closest('[data-inv-void]');
      const earn = e.target.closest('[data-milestone-earn]');
      const rev  = e.target.closest('[data-milestone-reverse]');
      const rmMs = e.target.closest('[data-milestone-remove]');
      if (ms)   await markInvoiceSent(ms.dataset.invMarkSent);
      if (vo)   await voidInvoice(vo.dataset.invVoid);
      if (earn) await markMilestoneEarned(earn.dataset.milestoneEarn, earn.dataset.milestoneInvoice);
      if (rev)  openReverseModal(rev.dataset.milestoneReverse, rev.dataset.milestoneInvoice, parseFloat(rev.dataset.milestoneAmount), rev.dataset.milestoneDesc);
      if (rmMs) { rmMs.closest('.ti-milestone-row')?.remove(); updateMilestoneTotals(); }
    };
    document.addEventListener('click', document.__trustActionClick);

    document.getElementById('tmr-close')?.addEventListener('click',   closeReverseModal);
    document.getElementById('tmr-cancel')?.addEventListener('click',  closeReverseModal);
    document.getElementById('tmr-confirm')?.addEventListener('click', confirmMilestoneReversal);

    document.getElementById('trust-e-type')?.addEventListener('change', e => {
      const isDisb = e.target.value === 'disbursement';
      document.getElementById('trust-e-inv-section').classList.toggle('hidden', !isDisb);
      if (isDisb) populateTrustInvoiceSelect();
    });

    document.querySelectorAll('input[name="trust-inv-path"]').forEach(r => {
      r.addEventListener('change', () => {
        const isPortal = document.querySelector('input[name="trust-inv-path"]:checked').value === 'portal';
        document.getElementById('trust-path-portal').classList.toggle('hidden', !isPortal);
        document.getElementById('trust-path-external').classList.toggle('hidden', isPortal);
      });
    });

    document.getElementById('trust-entry-form')?.addEventListener('submit', saveTrustEntry);
  }

  async function loadTrust() {
    const container = document.getElementById('trust-tab-container');
    if (!container) return;

    if (!matter) {
      container.innerHTML = '<p class="text-muted text-sm" style="padding:var(--space-2) 0">No active matter — trust entries require a matter.</p>';
      return;
    }

    container.innerHTML = '<div style="text-align:center;color:var(--color-text-muted);padding:var(--space-6)">Loading…</div>';

    try {
      _trustProfile = _trustProfile || await Auth.getProfile();

      const [balRes, entriesRes, invoicesRes, accountsRes, milestonesRes, retainersRes] = await Promise.all([
        db.from('matter_trust_balances')
          .select('balance, entry_count, last_transaction_at')
          .eq('matter_id', matter.id)
          .maybeSingle(),
        db.from('trust_ledger_entries')
          .select('id, created_at, entry_type, amount, balance_after, description, invoice_id, external_invoice_ref')
          .eq('matter_id', matter.id)
          .order('created_at', { ascending: false })
          .limit(20),
        db.from('invoices')
          .select('id, invoice_number, amount, status, description, sent_at, invoice_type, flat_fee_route, invoice_line_items(id, description, hours, rate, amount, item_type, sort_order)')
          .eq('matter_id', matter.id)
          .order('created_at', { ascending: false })
          .limit(10),
        db.from('trust_accounts')
          .select('id, account_label, bank_name, account_number_last4, jurisdiction')
          .eq('is_active', true)
          .order('account_label'),
        db.from('flat_fee_milestones')
          .select('id, invoice_id, description, amount, sort_order, earned_at, earned_by, trust_entry_id, reversed_at, reversed_by, reversal_reason, reversal_entry_id')
          .eq('matter_id', matter.id)
          .order('sort_order'),
        db.from('retainer_requests')
          .select('id, created_at, amount, description, status, payment_link, paid_at')
          .eq('matter_id', matter.id)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      _trustAccounts  = accountsRes.data || [];
      _trustInvoices  = invoicesRes.data || [];
      _trustRetainers = retainersRes.data || [];
      _trustCanWrite  = ['Owner', 'Attorney', 'Partner Attorney'].includes(_trustProfile?.role?.name || '');

      if (_trustAccounts.length > 0 && _trustAccounts[0].jurisdiction) {
        _trustJurisdiction = _trustAccounts[0].jurisdiction;
      }

      const milestonesById = {};
      (milestonesRes.data || []).forEach(m => {
        if (!milestonesById[m.invoice_id]) milestonesById[m.invoice_id] = [];
        milestonesById[m.invoice_id].push(m);
      });

      const hasAcct = _trustAccounts.length > 0;
      const btn = document.getElementById('btn-trust-new-entry');
      if (btn && hasAcct) btn.style.display = '';
      const invBtn = document.getElementById('btn-trust-new-invoice');
      if (invBtn && hasAcct && _trustCanWrite) invBtn.style.display = '';
      const retBtn = document.getElementById('btn-trust-request-retainer');
      if (retBtn && hasAcct && _trustCanWrite) retBtn.style.display = '';
      // Expenses aren't trust entries — any billing-write staff can log one, no trust account needed
      const expBtn = document.getElementById('btn-trust-add-expense');
      if (expBtn) expBtn.style.display = '';

      renderTrustTab(container, balRes.data, entriesRes.data || [], _trustInvoices, milestonesById);
    } catch (err) {
      container.innerHTML = `<p class="text-sm" style="color:var(--color-danger)">Could not load trust ledger. ${Utils.esc(err.message || '')}</p>`;
    }
  }

  function renderTrustTab(container, balance, entries, invoices, milestonesById) {
    function fmtC(n) {
      if (n == null) return '—';
      return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    const TYPE_LABELS = {
      deposit: 'Deposit', disbursement: 'Disbursement',
      transfer_in: 'Transfer In', transfer_out: 'Transfer Out',
      adjustment_credit: 'Adjustment +', adjustment_debit: 'Adjustment −',
    };
    function isCredit(t) { return ['deposit','transfer_in','adjustment_credit'].includes(t); }

    // Balance summary
    const bal = balance?.balance ?? 0;
    const balColor = bal > 0 ? 'var(--color-text)' : 'var(--color-text-muted)';
    const noAccount = _trustAccounts.length === 0;
    const balHtml = `
      <div style="background:var(--color-bg-subtle,#f8f9fa);border-radius:8px;padding:var(--space-4) var(--space-5);margin-bottom:var(--space-5);display:flex;align-items:center;gap:var(--space-6);flex-wrap:wrap">
        <div>
          <div class="text-muted text-sm" style="margin-bottom:2px">Current Balance</div>
          <div style="font-family:var(--font-serif);font-size:1.5rem;font-weight:600;letter-spacing:-.01em;color:${balColor}">${fmtC(bal)}</div>
        </div>
        ${balance?.entry_count ? `<div><div class="text-muted text-sm" style="margin-bottom:2px">Transactions</div><div style="font-weight:600">${balance.entry_count}</div></div>` : ''}
        ${balance?.last_transaction_at ? `<div><div class="text-muted text-sm" style="margin-bottom:2px">Last Activity</div><div style="font-size:var(--font-size-sm);font-weight:500">${Utils.formatDate(balance.last_transaction_at)}</div></div>` : ''}
        ${noAccount ? `<div style="margin-left:auto"><span class="text-muted text-sm">No trust account set up. <a href="#trust">Set up →</a></span></div>` : ''}
      </div>`;

    // Ledger entries
    let ledgerHtml;
    if (entries.length === 0) {
      ledgerHtml = `<p class="text-muted text-sm" style="margin-bottom:var(--space-5)">No trust transactions on record for this matter.</p>`;
    } else {
      const rows = entries.map(row => {
        const credit = isCredit(row.entry_type);
        const color  = credit ? 'var(--color-success)' : 'var(--color-danger)';
        const sign   = credit ? '+' : '−';
        const invTag = row.invoice_id
          ? `<span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;background:rgba(22,163,74,.12);color:var(--color-success);margin-left:4px">INV</span>`
          : row.external_invoice_ref
          ? `<span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;background:var(--color-bg-subtle,#f1f5f0);color:var(--color-text-muted);margin-left:4px">EXT</span>`
          : '';
        return `<tr>
          <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);color:var(--color-text-muted);font-size:var(--font-size-sm);white-space:nowrap">${Utils.formatDate(row.created_at)}</td>
          <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);white-space:nowrap">
            <span style="font-size:var(--font-size-sm);font-weight:500;color:${color}">${TYPE_LABELS[row.entry_type] || row.entry_type}</span>${invTag}
          </td>
          <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border)"><span class="text-sm">${Utils.esc(Utils.truncate(row.description, 50))}</span></td>
          <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);text-align:right;font-weight:600;color:${color};white-space:nowrap">${sign}${fmtC(row.amount).slice(1)}</td>
          <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);text-align:right;font-size:var(--font-size-sm);white-space:nowrap">${fmtC(row.balance_after)}</td>
        </tr>`;
      }).join('');
      ledgerHtml = `
        <div style="margin-bottom:var(--space-5)">
          <div style="font-weight:600;font-size:var(--font-size-sm);margin-bottom:var(--space-3);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em">Transactions</div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse">
              <thead><tr>
                <th style="text-align:left;padding:var(--space-2) var(--space-3);font-size:var(--font-size-sm);color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Date</th>
                <th style="text-align:left;padding:var(--space-2) var(--space-3);font-size:var(--font-size-sm);color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Type</th>
                <th style="text-align:left;padding:var(--space-2) var(--space-3);font-size:var(--font-size-sm);color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Description</th>
                <th style="text-align:right;padding:var(--space-2) var(--space-3);font-size:var(--font-size-sm);color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Amount</th>
                <th style="text-align:right;padding:var(--space-2) var(--space-3);font-size:var(--font-size-sm);color:var(--color-text-muted);font-weight:500;border-bottom:1px solid var(--color-border)">Balance After</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }

    // Invoices
    const STATUS_COLOR = { draft:'var(--color-text-muted)', sent:'var(--color-info,#0ea5e9)', paid:'var(--color-success)', void:'var(--color-danger)' };
    const TYPE_BADGE   = { flat_fee:'Flat Fee', retainer:'Retainer', expense:'Expense' };
    let invHtml;
    if (invoices.length === 0) {
      invHtml = '<p class="text-muted text-sm">No invoices for this matter yet.</p>';
    } else {
      invHtml = invoices.map(inv => {
        let actions = '';
        if (_trustCanWrite) {
          if (inv.status === 'draft') {
            actions = `<button class="btn btn--sm btn--primary" data-inv-mark-sent="${Utils.esc(inv.id)}" style="font-size:11px;padding:3px 10px">Mark Sent</button>
                       <button class="btn btn--sm btn--ghost" data-inv-void="${Utils.esc(inv.id)}" style="font-size:11px;padding:3px 8px;color:var(--color-danger)">Void</button>`;
          } else if (inv.status === 'sent') {
            actions = `<button class="btn btn--sm btn--ghost" data-inv-void="${Utils.esc(inv.id)}" style="font-size:11px;padding:3px 8px;color:var(--color-danger)">Void</button>`;
          }
        }

        const isFlatFeeTrust = inv.invoice_type === 'flat_fee' && inv.flat_fee_route === 'trust';
        const milestones     = (milestonesById || {})[inv.id] || [];
        let msHtml = '';
        if (isFlatFeeTrust && milestones.length > 0) {
          const earnedAmt = milestones.filter(m => m.earned_at && !m.reversed_at).reduce((s,m) => s + Number(m.amount), 0);
          const totalAmt  = milestones.reduce((s,m) => s + Number(m.amount), 0);
          const pct       = totalAmt > 0 ? Math.round((earnedAmt / totalAmt) * 100) : 0;
          const msRows    = milestones.map(m => {
            const reversed  = !!m.reversed_at;
            const earned    = !!m.earned_at && !reversed;
            const canEarn   = _trustCanWrite && !m.earned_at && inv.status === 'sent';
            const canReverse = _trustCanWrite && earned;
            const dotColor  = reversed ? 'var(--color-warning,#f59e0b)' : earned ? 'var(--color-success)' : 'var(--color-border)';
            const textStyle = reversed ? 'text-decoration:line-through;color:var(--color-text-muted)' : earned ? 'color:var(--color-text-muted)' : 'color:var(--color-text)';
            const actionBtn = canEarn
              ? `<button class="btn btn--sm btn--ghost" data-milestone-earn="${Utils.esc(m.id)}" data-milestone-invoice="${Utils.esc(inv.id)}" style="font-size:10px;padding:2px 7px;color:var(--color-success)">Earn</button>`
              : canReverse
              ? `<button class="btn btn--sm btn--ghost" data-milestone-reverse="${Utils.esc(m.id)}" data-milestone-invoice="${Utils.esc(inv.id)}" data-milestone-amount="${Utils.esc(String(m.amount))}" data-milestone-desc="${Utils.esc(m.description)}" style="font-size:10px;padding:2px 7px;color:var(--color-danger,#dc2626)">Reverse</button>`
              : '';
            const reversalNote = reversed && m.reversal_reason
              ? `<div style="font-size:10px;color:var(--color-warning,#b45309);padding-left:18px;margin-top:1px">Reversed: ${Utils.esc(m.reversal_reason)}</div>`
              : '';
            return `<div>
              <div style="display:flex;align-items:center;gap:var(--space-2);padding:2px 0;font-size:var(--font-size-sm)">
                <span style="width:10px;height:10px;border-radius:50%;background:${dotColor};flex-shrink:0"></span>
                <span style="flex:1;${textStyle}">${Utils.esc(m.description)}</span>
                <span style="font-weight:600;min-width:60px;text-align:right">${fmtC(m.amount)}</span>
                ${actionBtn}
              </div>${reversalNote}
            </div>`;
          }).join('');
          msHtml = `<div style="margin-top:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--color-bg-subtle,#f8f9fa);border-radius:6px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-1)">
              <span class="text-muted" style="font-size:10px;text-transform:uppercase;letter-spacing:.05em">Milestones</span>
              <span style="font-size:11px;color:var(--color-text-muted)">${pct}% earned (${fmtC(earnedAmt)} / ${fmtC(totalAmt)})</span>
            </div>
            ${msRows}
          </div>`;
        }

        const typeBadge = inv.invoice_type && inv.invoice_type !== 'hourly'
          ? `<span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;background:var(--color-bg-subtle,#e8f4fd);color:var(--color-info,#0ea5e9);margin-left:4px">${TYPE_BADGE[inv.invoice_type] || inv.invoice_type}</span>`
          : '';

        // Line-item detail (time entries / expenses / flat-fee lines) so viewing
        // an invoice here shows what it's made of, not just the total.
        const lineItems = (inv.invoice_line_items || []).slice()
          .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        const liHtml = lineItems.length ? `
          <div style="margin-top:var(--space-2);padding:var(--space-2) var(--space-3);background:var(--color-bg-subtle,#f8f9fa);border-radius:6px">
            ${lineItems.map(li => `
              <div style="display:flex;align-items:center;gap:var(--space-2);padding:2px 0;font-size:var(--font-size-sm)">
                <span style="flex:1;min-width:0;color:var(--color-text)">${Utils.esc(li.description)}</span>
                <span class="text-muted" style="font-size:11px;white-space:nowrap">${li.item_type === 'time' && li.hours != null ? `${li.hours}h${li.rate != null ? ' · ' + fmtC(li.rate) + '/h' : ''}` : ''}</span>
                <span style="font-weight:600;min-width:64px;text-align:right;white-space:nowrap">${Number(li.amount) === 0 ? '<span class="text-muted" style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em">No charge</span>' : fmtC(li.amount)}</span>
              </div>`).join('')}
          </div>` : '';

        return `<div style="padding:var(--space-3) 0;border-bottom:1px solid var(--color-border)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)">
            <div style="min-width:0;flex:1">
              <span style="font-weight:600;font-size:var(--font-size-sm)">${Utils.esc(inv.invoice_number)}</span>${typeBadge}
              <span class="text-muted text-sm" style="margin-left:var(--space-2)">${Utils.esc(Utils.truncate(inv.description, 45))}</span>
            </div>
            <div style="display:flex;align-items:center;gap:var(--space-2);flex-shrink:0">
              ${actions}
              <span style="font-size:var(--font-size-sm);font-weight:500;color:${STATUS_COLOR[inv.status] || 'var(--color-text)'}">${Utils.titleCase(inv.status)}</span>
              <span style="font-weight:600;font-size:var(--font-size-sm);min-width:68px;text-align:right">${fmtC(inv.amount)}</span>
            </div>
          </div>
          ${liHtml}
          ${msHtml}
        </div>`;
      }).join('');
    }

    // Retainer requests (trust-routed payment links)
    const RET_STATUS = {
      pending:   { label: 'Awaiting payment', color: 'var(--color-warning,#b45309)' },
      paid:      { label: 'Paid',             color: 'var(--color-success)' },
      cancelled: { label: 'Cancelled',        color: 'var(--color-text-muted)' },
      expired:   { label: 'Expired',          color: 'var(--color-text-muted)' },
    };
    let retainerHtml = '';
    if (_trustRetainers.length > 0) {
      const rows = _trustRetainers.map(r => {
        const st   = RET_STATUS[r.status] || { label: r.status, color: 'var(--color-text)' };
        const link = r.status === 'pending' && r.payment_link
          ? `<button class="btn btn--sm btn--ghost" data-retainer-copy="${Utils.esc(r.payment_link)}" style="font-size:11px;padding:3px 8px">Copy link</button>`
          : '';
        return `<div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);padding:var(--space-3) 0;border-bottom:1px solid var(--color-border)">
          <div style="min-width:0;flex:1">
            <span style="font-weight:600;font-size:var(--font-size-sm)">${r.amount == null ? 'Client enters amount' : fmtC(r.amount)}</span>
            <span class="text-muted text-sm" style="margin-left:var(--space-2)">${Utils.esc(Utils.truncate(r.description || 'Retainer', 40))}</span>
            <div class="text-muted" style="font-size:11px;margin-top:1px">Requested ${Utils.formatDate(r.created_at)}${r.paid_at ? ` · Paid ${Utils.formatDate(r.paid_at)}` : ''}</div>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);flex-shrink:0">
            ${link}
            <span style="font-size:var(--font-size-sm);font-weight:500;color:${st.color}">${st.label}</span>
          </div>
        </div>`;
      }).join('');
      retainerHtml = `
        <div style="margin-bottom:var(--space-5)">
          <div style="font-weight:600;font-size:var(--font-size-sm);margin-bottom:var(--space-3);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em">Retainer Requests</div>
          ${rows}
        </div>`;
    }

    container.innerHTML = `
      ${balHtml}
      ${retainerHtml}
      ${ledgerHtml}
      <div>
        <div style="font-weight:600;font-size:var(--font-size-sm);margin-bottom:var(--space-3);color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em">Invoices</div>
        ${invHtml}
      </div>`;
  }

  function openExpenseModal() {
    const modal = document.getElementById('expense-modal');
    if (!modal) return;
    document.getElementById('expense-form').reset();
    document.getElementById('expense-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('expense-error').classList.add('hidden');
    modal.classList.remove('hidden');
  }

  function closeExpenseModal() {
    document.getElementById('expense-modal')?.classList.add('hidden');
  }

  async function submitExpense(e) {
    e.preventDefault();
    const errEl = document.getElementById('expense-error');
    errEl.classList.add('hidden');

    const amount = parseFloat(document.getElementById('expense-amount').value);
    const desc   = document.getElementById('expense-desc').value.trim();
    if (!desc || !Number.isFinite(amount) || amount <= 0) {
      errEl.textContent = 'Enter a description and an amount greater than zero.';
      errEl.classList.remove('hidden');
      return;
    }

    const saveBtn = document.getElementById('expense-save');
    Utils.setLoading(saveBtn, true);
    try {
      const profile = await Auth.getProfile();
      const { error } = await db.from('expenses').insert({
        matter_id:    matter.id,
        client_id:    client?.id || null,
        expense_date: document.getElementById('expense-date').value || undefined,
        category:     document.getElementById('expense-category').value,
        description:  desc,
        amount:       amount,
        created_by:   profile?.id || null,
      });
      if (error) throw new Error(error.message);
      Utils.setLoading(saveBtn, false);
      closeExpenseModal();
      Utils.toast('Expense saved — it will appear as unbilled on this matter’s next invoice.', 'success');
    } catch (err) {
      Utils.setLoading(saveBtn, false);
      errEl.textContent = err.message || 'Failed to save expense.';
      errEl.classList.remove('hidden');
    }
  }

  function openRetainerModal() {
    const modal = document.getElementById('retainer-modal');
    if (!modal) return;
    document.getElementById('retainer-form').reset();
    document.getElementById('retainer-error').classList.add('hidden');

    // Open-amount toggle: when on, the client enters the amount at checkout, so
    // the amount field is disabled and optional.
    const openCb = document.getElementById('retainer-open-amount');
    const amtEl  = document.getElementById('retainer-amount');
    const syncOpen = () => {
      const open = !!openCb?.checked;
      if (!amtEl) return;
      amtEl.disabled = open;
      amtEl.required = !open;
      amtEl.style.opacity = open ? '0.5' : '';
      if (open) amtEl.value = '';
    };
    if (openCb && !openCb.dataset.wired) {
      openCb.addEventListener('change', syncOpen);
      openCb.dataset.wired = '1';
    }
    syncOpen();

    // Recipient picker: the client (default) plus any "Other People" who have an
    // email on file (e.g. a guarantor paying on the client's behalf).
    const recSel = document.getElementById('retainer-recipient');
    if (recSel) {
      const opts = [];
      if (client?.email) {
        opts.push(`<option value="client">${Utils.esc(Utils.fullName(client))} (client) — ${Utils.esc(client.email)}</option>`);
      }
      otherPeople.filter(p => p.email).forEach(p => {
        const nm = [p.first_name, p.last_name].filter(Boolean).join(' ');
        opts.push(`<option value="contact:${p.id}">${Utils.esc(nm)}${p.relationship ? ` (${Utils.esc(p.relationship)})` : ''} — ${Utils.esc(p.email)}</option>`);
      });
      recSel.innerHTML = opts.join('');
    }

    const note = document.getElementById('retainer-client-note');
    if (note) {
      const hasRecipient = !!(client?.email) || otherPeople.some(p => p.email);
      note.innerHTML = hasRecipient
        ? `The payment link will be emailed to the recipient selected above.`
        : `<span style="color:var(--color-danger)">No email on file for this client or any other person — add one before requesting a retainer.</span>`;
    }
    modal.classList.remove('hidden');
  }

  function closeRetainerModal() {
    document.getElementById('retainer-modal')?.classList.add('hidden');
  }

  async function submitRetainer(e) {
    e.preventDefault();
    const errEl = document.getElementById('retainer-error');
    errEl.classList.add('hidden');

    const openAmount = document.getElementById('retainer-open-amount')?.checked || false;
    const amount = parseFloat(document.getElementById('retainer-amount').value);
    const desc   = document.getElementById('retainer-desc').value.trim();
    if (!openAmount && (!Number.isFinite(amount) || amount <= 0)) {
      errEl.textContent = 'Enter a retainer amount greater than zero, or let the client enter it.';
      errEl.classList.remove('hidden');
      return;
    }

    // Recipient: the client by default, or one of the "Other People" contacts.
    const recVal = document.getElementById('retainer-recipient')?.value || 'client';
    let recipient = null;
    if (recVal.startsWith('contact:')) {
      const p = otherPeople.find(x => x.id === recVal.slice('contact:'.length));
      if (p) recipient = {
        recipient_email: p.email,
        recipient_name:  [p.first_name, p.last_name].filter(Boolean).join(' '),
      };
    }

    const saveBtn = document.getElementById('retainer-save');
    Utils.setLoading(saveBtn, true);
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/request-retainer', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body:    JSON.stringify({
          matter_id:   matter.id,
          description: desc || undefined,
          ...(openAmount ? { open_amount: true } : { amount }),
          ...(recipient || {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send retainer request');

      Utils.setLoading(saveBtn, false);
      closeRetainerModal();
      Utils.toast('Retainer payment link sent to client', 'success');
      _trustLoaded = false;
      await loadTrust();
    } catch (err) {
      Utils.setLoading(saveBtn, false);
      errEl.textContent = err.message || 'Failed to send retainer request';
      errEl.classList.remove('hidden');
    }
  }

  function openTrustEntryModal() {
    const modal = document.getElementById('trust-entry-modal');
    if (!modal) return;
    document.getElementById('trust-entry-form').reset();
    document.getElementById('trust-entry-error').classList.add('hidden');
    document.getElementById('trust-e-inv-section').classList.add('hidden');
    document.getElementById('trust-path-portal').classList.remove('hidden');
    document.getElementById('trust-path-external').classList.add('hidden');

    // Populate account selector
    const accountRow = document.getElementById('trust-e-account-row');
    const accountSel = document.getElementById('trust-e-account');
    if (_trustAccounts.length > 1) {
      accountSel.innerHTML = _trustAccounts.map(a =>
        `<option value="${Utils.esc(a.id)}">${Utils.esc(a.account_label)} — ${Utils.esc(a.bank_name)} ****${a.account_number_last4}</option>`
      ).join('');
      accountRow.style.display = '';
    } else {
      accountRow.style.display = 'none';
    }

    modal.classList.remove('hidden');
  }

  function closeTrustEntryModal() {
    document.getElementById('trust-entry-modal')?.classList.add('hidden');
  }

  function openInvoiceModal() {
    _trustMilestones = [];
    document.getElementById('trust-invoice-form').reset();
    document.getElementById('trust-invoice-error').classList.add('hidden');
    document.getElementById('ti-milestones-list').innerHTML = '';
    document.getElementById('ti-milestone-summary').innerHTML = '';
    showFlatFeeUI('hourly');
    document.getElementById('trust-invoice-modal').classList.remove('hidden');
  }

  function closeInvoiceModal() {
    document.getElementById('trust-invoice-modal')?.classList.add('hidden');
  }

  function showFlatFeeUI(type) {
    const archetype = type === 'flat_fee' ? getFlatFeeArchetype(_trustJurisdiction) : null;
    document.getElementById('ti-milestone-section').classList.toggle('hidden', archetype !== 'trust_first');
    document.getElementById('ti-operating-warning').classList.toggle('hidden', archetype !== 'operating_first');
    document.getElementById('ti-disclosure-section').classList.toggle('hidden', archetype !== 'choice');

    if (archetype === 'operating_first') {
      document.getElementById('ti-operating-rule-note').textContent =
        'Illinois Rule 1.15(d): advance fixed fees become attorney property on receipt and must go to the operating account. Depositing in trust would constitute commingling.';
    }
    if (archetype === 'choice') {
      const jur  = _trustJurisdiction.toUpperCase();
      const hint = document.getElementById('ti-disclosure-hint');
      if (jur === 'CA') {
        hint.textContent = 'California Rule 1.15(b): without written disclosure this fee is held in trust. With disclosure (and client signature for amounts > $1,000) it may go to operating.';
      } else if (jur === 'NY') {
        hint.textContent = 'New York Ethics Op. 983: fee may go to operating with written client agreement, otherwise held in trust.';
      } else if (jur === 'CO') {
        hint.textContent = 'Colorado RPC 1.15(f): fee may go to operating with written disclosure, otherwise held in trust.';
      } else {
        hint.textContent = 'With proper written disclosure this fee may go to the operating account. Without disclosure, it is held in trust.';
      }
    }

    if (archetype === 'trust_first' && document.getElementById('ti-milestones-list').children.length === 0) {
      addMilestoneRow();
    }
  }

  function addMilestoneRow(desc = '', amount = '') {
    const list = document.getElementById('ti-milestones-list');
    const idx  = list.children.length;
    const row  = document.createElement('div');
    row.className = 'ti-milestone-row';
    row.style.cssText = 'display:flex;gap:var(--space-2);margin-bottom:var(--space-2);align-items:center';
    row.innerHTML = `
      <input type="text" placeholder="Milestone description" value="${Utils.esc(desc)}"
        style="flex:1;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:6px;font-size:var(--font-size-sm)"
        class="ti-ms-desc" data-idx="${idx}">
      <input type="number" placeholder="Amount" value="${amount}" min="0.01" step="0.01"
        style="width:100px;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:6px;font-size:var(--font-size-sm)"
        class="ti-ms-amt" data-idx="${idx}">
      <button type="button" data-milestone-remove="1" style="color:var(--color-danger);background:none;border:none;cursor:pointer;font-size:16px;line-height:1;padding:0 4px" aria-label="Remove">×</button>`;
    list.appendChild(row);
    row.querySelector('.ti-ms-amt').addEventListener('input', updateMilestoneTotals);
    updateMilestoneTotals();
  }

  function updateMilestoneTotals() {
    const amts   = Array.from(document.querySelectorAll('.ti-ms-amt')).map(i => parseFloat(i.value) || 0);
    const total  = amts.reduce((s, a) => s + a, 0);
    const invAmt = parseFloat(document.getElementById('ti-amount').value) || 0;
    const ok     = invAmt > 0 && Math.abs(total - invAmt) < 0.005;
    function fmt(n) { return '$' + n.toFixed(2); }
    const sumEl  = document.getElementById('ti-milestone-summary');
    if (!sumEl) return;
    sumEl.innerHTML = `<div style="display:flex;justify-content:space-between;font-size:var(--font-size-sm);color:${ok ? 'var(--color-success)' : 'var(--color-danger)'}">
      <span>Milestones total: <strong>${fmt(total)}</strong></span>
      <span>Invoice total: <strong>${fmt(invAmt)}</strong></span>
      ${ok ? '<span>✓ Balanced</span>' : '<span>Must balance before saving</span>'}
    </div>`;
  }

  function getMilestoneRows() {
    const rows = [];
    document.querySelectorAll('.ti-milestone-row').forEach((row, idx) => {
      const desc = row.querySelector('.ti-ms-desc')?.value.trim() || '';
      const amt  = parseFloat(row.querySelector('.ti-ms-amt')?.value) || 0;
      if (desc && amt > 0) rows.push({ description: desc, amount: amt, sort_order: idx });
    });
    return rows;
  }

  async function saveInvoice(e) {
    e.preventDefault();
    const errEl  = document.getElementById('trust-invoice-error');
    errEl.classList.add('hidden');

    const invType = document.getElementById('ti-type').value;
    const desc    = document.getElementById('ti-desc').value.trim();
    const amount  = parseFloat(document.getElementById('ti-amount').value);
    const due     = document.getElementById('ti-due').value || null;

    if (!desc || isNaN(amount) || amount <= 0) {
      errEl.textContent = 'Description and a valid amount are required.';
      errEl.classList.remove('hidden');
      return;
    }

    const archetype = invType === 'flat_fee' ? getFlatFeeArchetype(_trustJurisdiction) : null;
    let flatFeeRoute = null;
    let disclosureAt = null;

    if (invType === 'flat_fee') {
      if (archetype === 'trust_first') {
        flatFeeRoute = 'trust';
        const msRows = getMilestoneRows();
        if (msRows.length === 0) {
          errEl.textContent = 'Add at least one milestone for a trust-first flat fee.';
          errEl.classList.remove('hidden');
          return;
        }
        const msTotal = msRows.reduce((s, m) => s + m.amount, 0);
        if (Math.abs(msTotal - amount) >= 0.005) {
          errEl.textContent = `Milestone total ($${msTotal.toFixed(2)}) must equal invoice amount ($${amount.toFixed(2)}).`;
          errEl.classList.remove('hidden');
          return;
        }
        _trustMilestones = msRows;
      } else if (archetype === 'operating_first') {
        flatFeeRoute = 'operating';
      } else if (archetype === 'choice') {
        const disclosed = document.getElementById('ti-disclosure-check')?.checked;
        if (disclosed) {
          if (_trustJurisdiction.toUpperCase() === 'CA') {
            const signed = document.getElementById('ti-ca-sig-check')?.checked;
            if (!signed && amount >= 1000) {
              errEl.textContent = 'California requires client signature for flat fees over $1,000.';
              errEl.classList.remove('hidden');
              return;
            }
          }
          flatFeeRoute = 'operating';
          disclosureAt = new Date().toISOString();
        } else {
          flatFeeRoute = 'trust';
          _trustMilestones = getMilestoneRows();
        }
      }
    }

    const saveBtn = document.getElementById('trust-invoice-save');
    Utils.setLoading(saveBtn, true);

    const { data: invData, error: invErr } = await db.from('invoices').insert({
      matter_id:              matter.id,
      description:            desc,
      amount:                 amount,
      due_date:               due,
      invoice_type:           invType,
      flat_fee_route:         flatFeeRoute,
      flat_fee_disclosure_at: disclosureAt,
      created_by:             _trustProfile.id,
    }).select('id').single();

    if (invErr) {
      Utils.setLoading(saveBtn, false);
      errEl.textContent = 'Failed to create invoice. ' + (invErr.message || '');
      errEl.classList.remove('hidden');
      return;
    }

    if (_trustMilestones.length > 0) {
      const { error: msErr } = await db.from('flat_fee_milestones').insert(
        _trustMilestones.map(m => ({
          invoice_id:  invData.id,
          matter_id:   matter.id,
          description: m.description,
          amount:      m.amount,
          sort_order:  m.sort_order,
        }))
      );
      if (msErr) {
        Utils.setLoading(saveBtn, false);
        errEl.textContent = 'Invoice created but milestones failed: ' + (msErr.message || '');
        errEl.classList.remove('hidden');
        _trustMilestones = [];
        _trustLoaded = false; _trustInvoices = [];
        await loadTrust();
        return;
      }
    }

    Utils.setLoading(saveBtn, false);
    _trustMilestones = [];
    closeInvoiceModal();
    Utils.toast('Invoice created', 'success');
    _trustLoaded = false; _trustInvoices = [];
    await loadTrust();
  }

  async function markInvoiceSent(invoiceId) {
    const { error } = await db.from('invoices').update({ status: 'sent' }).eq('id', invoiceId);
    if (error) { Utils.toast('Failed to mark invoice sent. ' + (error.message || ''), 'error'); return; }
    Utils.toast('Invoice marked sent — available for disbursements', 'success');
    _trustLoaded = false; _trustInvoices = [];
    await loadTrust();
  }

  async function voidInvoice(invoiceId) {
    if (!await Utils.confirm('Void this invoice? This cannot be undone.', { confirmLabel: 'Void Invoice', danger: true })) return;
    const { error } = await db.from('invoices').update({ status: 'void' }).eq('id', invoiceId);
    if (error) { Utils.toast('Failed to void invoice. ' + (error.message || ''), 'error'); return; }
    Utils.toast('Invoice voided', 'success');
    _trustLoaded = false; _trustInvoices = [];
    await loadTrust();
  }

  async function markMilestoneEarned(milestoneId, invoiceId) {
    if (!await Utils.confirm('Mark this milestone as earned? This will create a disbursement from trust.', { confirmLabel: 'Mark Earned' })) return;

    const { data: ms, error: msLookupErr } = await db.from('flat_fee_milestones')
      .select('amount, description')
      .eq('id', milestoneId)
      .single();
    if (msLookupErr || !ms) { Utils.toast('Milestone not found.', 'error'); return; }

    const resolvedAcct = _trustAccounts[0]?.id;
    if (!resolvedAcct) { Utils.toast('No trust account found.', 'error'); return; }

    const { data: entryData, error: entryErr } = await db.from('trust_ledger_entries').insert({
      trust_account_id: resolvedAcct,
      matter_id:        matter.id,
      entry_type:       'disbursement',
      amount:           ms.amount,
      description:      `Flat fee earned — ${ms.description}`,
      invoice_id:       invoiceId,
      created_by:       _trustProfile.id,
    }).select('id').single();

    if (entryErr) { Utils.toast('Failed to create disbursement: ' + (entryErr.message || ''), 'error'); return; }

    const { error: msUpdErr } = await db.from('flat_fee_milestones').update({
      earned_at:      new Date().toISOString(),
      earned_by:      _trustProfile.id,
      trust_entry_id: entryData.id,
    }).eq('id', milestoneId);

    if (msUpdErr) { Utils.toast('Disbursement created but could not mark milestone earned: ' + (msUpdErr.message || ''), 'error'); return; }

    Utils.toast('Milestone earned — trust disbursement recorded', 'success');
    _trustLoaded = false; _trustInvoices = [];
    await loadTrust();
  }

  function openReverseModal(milestoneId, invoiceId, amount, desc) {
    _pendingReversal = { milestoneId, invoiceId, amount, desc };
    document.getElementById('tmr-reason').value = '';
    document.getElementById('tmr-error').classList.add('hidden');
    document.getElementById('tmr-amount-display').textContent = '$' + amount.toFixed(2);
    document.getElementById('trust-milestone-reverse-modal').classList.remove('hidden');
  }

  function closeReverseModal() {
    _pendingReversal = null;
    document.getElementById('trust-milestone-reverse-modal')?.classList.add('hidden');
  }

  async function confirmMilestoneReversal() {
    if (!_pendingReversal) return;
    const reason  = document.getElementById('tmr-reason').value.trim();
    const errEl   = document.getElementById('tmr-error');
    if (!reason) {
      errEl.textContent = 'A reason is required.';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');

    const { milestoneId, invoiceId, amount, desc } = _pendingReversal;
    const resolvedAcct = _trustAccounts[0]?.id;
    if (!resolvedAcct) { Utils.toast('No trust account found.', 'error'); closeReverseModal(); return; }

    // Create a deposit entry returning funds to trust (immutable ledger — never modify original disbursement)
    const { data: entryData, error: entryErr } = await db.from('trust_ledger_entries').insert({
      trust_account_id: resolvedAcct,
      matter_id:        matter.id,
      entry_type:       'deposit',
      amount:           amount,
      description:      `Milestone reversal — ${desc}. Reason: ${reason}`,
      invoice_id:       invoiceId,
      created_by:       _trustProfile.id,
    }).select('id').single();

    if (entryErr) {
      errEl.textContent = 'Failed to create reversal entry: ' + (entryErr.message || '');
      errEl.classList.remove('hidden');
      return;
    }

    const { error: msErr } = await db.from('flat_fee_milestones').update({
      reversed_at:       new Date().toISOString(),
      reversed_by:       _trustProfile.id,
      reversal_reason:   reason,
      reversal_entry_id: entryData.id,
    }).eq('id', milestoneId);

    if (msErr) {
      errEl.textContent = 'Reversal entry created but could not stamp milestone: ' + (msErr.message || '');
      errEl.classList.remove('hidden');
      return;
    }

    Utils.toast('Milestone reversed — funds returned to trust', 'success');
    closeReverseModal();
    _trustLoaded = false; _trustInvoices = [];
    await loadTrust();
  }

  function populateTrustInvoiceSelect() {
    const sel = document.getElementById('trust-e-invoice');
    if (!sel) return;
    const sentInvoices = _trustInvoices.filter(i => ['sent','paid'].includes(i.status));
    function fmtC(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    sel.innerHTML = '<option value="">Select sent invoice…</option>' +
      sentInvoices.map(inv =>
        `<option value="${Utils.esc(inv.id)}">${Utils.esc(inv.invoice_number)} — ${fmtC(inv.amount)} — ${Utils.esc(Utils.truncate(inv.description, 40))}</option>`
      ).join('');
  }

  async function saveTrustEntry(e) {
    e.preventDefault();
    const errEl = document.getElementById('trust-entry-error');
    errEl.classList.add('hidden');

    const acctId = _trustAccounts.length === 1
      ? _trustAccounts[0].id
      : document.getElementById('trust-e-account').value;
    const type   = document.getElementById('trust-e-type').value;
    const desc   = document.getElementById('trust-e-desc').value.trim();
    const amount = parseFloat(document.getElementById('trust-e-amount').value);
    const payor  = document.getElementById('trust-e-payor').value.trim();

    if (!acctId || !type || !desc || isNaN(amount) || amount <= 0) {
      errEl.textContent = 'Entry type, description, and a valid amount are required.';
      errEl.classList.remove('hidden');
      return;
    }

    let invoiceId = null, externalRef = null;
    if (type === 'disbursement') {
      const path = document.querySelector('input[name="trust-inv-path"]:checked').value;
      if (path === 'portal') {
        invoiceId = document.getElementById('trust-e-invoice').value || null;
        if (!invoiceId) { errEl.textContent = 'Select a sent invoice for this disbursement.'; errEl.classList.remove('hidden'); return; }
      } else {
        externalRef = document.getElementById('trust-e-ext-ref').value.trim() || null;
        if (!externalRef) { errEl.textContent = 'Enter an external invoice reference.'; errEl.classList.remove('hidden'); return; }
      }
    }

    const saveBtn = document.getElementById('trust-entry-save');
    Utils.setLoading(saveBtn, true);

    const { error } = await db.from('trust_ledger_entries').insert({
      trust_account_id:     acctId,
      matter_id:            matter.id,
      entry_type:           type,
      amount:               amount,
      description:          desc,
      payor_payee:          payor || null,
      invoice_id:           invoiceId,
      external_invoice_ref: externalRef,
      created_by:           _trustProfile.id,
    });

    Utils.setLoading(saveBtn, false);

    if (error) {
      const msg = error.message?.includes('IOLTA VIOLATION')
        ? error.message.replace(/^ERROR:\s+/i, '')
        : 'Failed to save entry. ' + (error.message || '');
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
      return;
    }

    closeTrustEntryModal();
    Utils.toast('Trust entry saved', 'success');

    _trustLoaded = false;
    _trustAccounts = [];
    _trustInvoices = [];
    await loadTrust();
  }

  // ── Boot ─────────────────────────────────────────────────────────────────────

  // SSN button events. Single GLOBAL delegate: the router re-runs this script on
  // every navigation, so remove any prior handler first (else SSN edit/reveal
  // would fire once per past visit — same class of bug as the trust-tab void).
  if (document.__detailSsnClick) document.removeEventListener('click', document.__detailSsnClick);
  document.__detailSsnClick = e => {
    const editBtn   = e.target.closest('.btn-edit-ssn');
    const revealBtn = e.target.closest('.btn-reveal-ssn');
    if (editBtn)   openSsnModal(editBtn.dataset.entityType, editBtn.dataset.entityId, editBtn.dataset.entityLabel);
    if (revealBtn) doRevealSsn(revealBtn.dataset.entityType, revealBtn.dataset.entityId, revealBtn.dataset.displayId);
  };
  document.addEventListener('click', document.__detailSsnClick);

  await loadAll();

})();
