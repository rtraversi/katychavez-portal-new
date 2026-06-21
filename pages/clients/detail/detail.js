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
  let children = [];
  let financial = null;
  let keyDates          = [];
  let users             = [];
  let _calPendingDateId = null;  // tracks which key_date is being added to calendar

  let practiceAreas    = [];
  let caseTypesData    = [];
  let practiceAreaMap  = new Map();  // id → practice_area row
  let caseTypeMap      = new Map();  // id → case_type row

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
    const [
      { data: c },
      { data: u },
      { data: pa },
      { data: ct },
    ] = await Promise.all([
      db.from('clients').select('*').eq('id', clientId).single(),
      db.from('users').select('id, first_name, last_name, roles(name)').eq('active', true).order('first_name'),
      db.from('practice_areas').select('*').order('sort_order'),
      db.from('case_types').select('*').order('sort_order'),
    ]);

    client        = c;
    users         = u || [];
    practiceAreas = pa || [];
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
      ] = await Promise.all([
        db.from('opposing_parties').select('*').eq('matter_id', matter.id).maybeSingle(),
        db.from('children').select('*').eq('matter_id', matter.id).order('dob'),
        db.from('financial_info').select('*').eq('matter_id', matter.id).maybeSingle(),
        db.from('key_dates').select('*').eq('matter_id', matter.id).order('date_value'),
      ]);
      oppParty  = op;
      children  = ch || [];
      financial = fi;
      keyDates  = kd || [];
    }

    renderAll();
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
    }
    document.getElementById('detail-meta').innerHTML = metaParts.join('<span style="color:var(--color-border-mid)">·</span>');

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
      field('Retainer balance',m.retainer_balance, 'money'),
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
          <p class="text-muted" style="margin-bottom:var(--space-4)">No opposing party recorded yet.</p>
          <button class="btn btn--primary btn--sm" id="btn-add-opposing">Add opposing party</button>
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
          <h2 class="detail-section-title">Opposing Party — ${Utils.esc(op.first_name)} ${Utils.esc(op.last_name || '')}</h2>
          <button class="btn btn--secondary btn--sm" id="btn-edit-opposing">Edit</button>
        </div>
        ${op.is_address_restricted ? '<div class="badge badge--dv" style="margin-bottom:var(--space-4)">Address Restricted</div>' : ''}
        <div class="detail-grid">
          ${field('Name', [op.first_name, op.middle_name, op.last_name, op.former_maiden_name ? '(née '+op.former_maiden_name+')' : ''].filter(Boolean).join(' '))}
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
          ${field('Physically separated', op.physically_separated, 'bool')}
          ${field('Financial arrangement', op.financial_arrangement ? Utils.titleCase(op.financial_arrangement) : null)}
          ${field('Financial arrangement notes', op.financial_arrangement_notes)}
        </div>
      </div>
      <div class="detail-section">
        <div class="detail-section-header">
          <h2 class="detail-section-title">Opposing Counsel</h2>
        </div>
        <div class="detail-grid">
          ${field('Name', op.opposing_counsel_name)}
          ${field('Firm', op.opposing_counsel_firm)}
          ${field('Phone', op.opposing_counsel_phone, 'phone')}
          ${field('Email', op.opposing_counsel_email)}
          ${field('Address', opCounselAddr || null)}
        </div>
      </div>`;

    document.getElementById('btn-edit-opposing').addEventListener('click', () => openOpposingModal(op));
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

  // ── Render financial tab ─────────────────────────────────────────────────────

  function renderFinancial() {
    if (!matter) { setGrid('grid-financial', '<p class="text-muted text-sm">No matter on record.</p>'); return; }
    const f = financial || {};
    const m = matter;
    setGrid('grid-financial', [
      field('Retainer balance',        m.retainer_balance, 'money'),
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
          <span class="date-val" style="${!past && d.date_type === 'hearing' ? 'color:var(--color-primary);font-weight:500' : ''}">${Utils.formatDate(d.date_value)}</span>
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
    renderCase();
    renderMarriage();
    renderCircumstances();
    renderOpposing();
    renderChildren();
    renderFinancial();
    renderDates();
    wireEdits();
    wireTabs();
    wireEsignTab();
    wireMessagesTab();
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
    const tab    = document.querySelector('[data-tab="esign"]');
    const reqBtn = document.getElementById('btn-request-sig-esign');
    if (!tab) return;
    tab.addEventListener('click', async () => {
      if (_esignLoaded) return;
      _esignLoaded = true;
      await loadEsign();
    });
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
              <svg viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" style="width:15px;height:15px;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>
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
      });
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
          retainer_balance: fd.get('retainer_balance') ? parseFloat(fd.get('retainer_balance')) : null,
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

    // Circumstances: no inline edit (case-type-specific display only)
    document.getElementById('btn-edit-circumstances')?.addEventListener('click', () =>
      Utils.toast('Edit case-specific fields via the Case Details section.', 'info')
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
      ${inp('retainer_balance','Retainer balance ($)',m?.retainer_balance,'number','min="0" step="0.01"')}
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

  function openOpposingModal(existing = null) {
    if (!matter) { Utils.toast('No matter loaded.', 'error'); return; }
    const modalEl = document.getElementById('opposing-modal');
    const op = existing || {};
    modalEl.innerHTML = `
      <div class="modal" style="max-width:680px">
        <div class="modal-header">
          <h2 class="modal-title">${existing ? 'Edit' : 'Add'} opposing party</h2>
          <button class="modal-close">×</button>
        </div>
        <form id="opposing-form" novalidate>
          <div class="modal-body">
            <p class="section-divider">Identity</p>
            ${row2(inp('first_name','First name *',op.first_name||'','text','required'), inp('last_name','Last name',op.last_name||''))}
            ${row2(inp('middle_name','Middle name',op.middle_name||''), inp('former_maiden_name','Former/maiden',op.former_maiden_name||''))}
            ${row2(inp('dob','Date of birth',op.dob||'','date'), inp('place_of_birth','Place of birth',op.place_of_birth||''))}
            ${row2(inp('driver_license_number','DL number',op.driver_license_number||''), inp('driver_license_state','DL state',op.driver_license_state||'','text','maxlength="2"'))}
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
            <p class="section-divider">Financial separation</p>
            ${sel('financially_separated','Physically separated',[['true','Yes'],['false','No']],op.physically_separated == null ? '' : String(op.physically_separated))}
            ${sel('financial_arrangement','Financial arrangement',[['joint_account','Joint account'],['separate','Separate'],['other','Other']],op.financial_arrangement)}
            ${ta('financial_arrangement_notes','Notes on arrangement',op.financial_arrangement_notes||'',2)}
            <p class="section-divider">Opposing Counsel</p>
            ${row2(inp('opposing_counsel_name','Attorney name',op.opposing_counsel_name||''), inp('opposing_counsel_firm','Firm',op.opposing_counsel_firm||''))}
            ${row2(inp('opposing_counsel_phone','Phone',op.opposing_counsel_phone||'','tel'), inp('opposing_counsel_email','Email',op.opposing_counsel_email||'','email'))}
            ${inp('opposing_counsel_address','Counsel address',op.opposing_counsel_address||'')}
            ${row3(inp('opposing_counsel_city','City',op.opposing_counsel_city||''), inp('opposing_counsel_state','State',op.opposing_counsel_state||'','text','maxlength="2"'), inp('opposing_counsel_zip','ZIP',op.opposing_counsel_zip||''))}
          </div>
          <div class="modal-footer">
            <div id="opposing-err" class="form-error hidden" style="flex:1;margin-right:auto"></div>
            <button type="button" class="btn btn--secondary btn--sm modal-cancel">Cancel</button>
            <button type="submit" class="btn btn--primary btn--sm">${existing ? 'Save' : 'Add opposing party'}</button>
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

        if (existing) {
          const { error } = await db.from('opposing_parties').update(payload).eq('id', existing.id);
          if (error) throw error;
          oppParty = { ...existing, ...payload };
        } else {
          const { data, error } = await db.from('opposing_parties').insert(payload).select().single();
          if (error) throw error;
          oppParty = data;
        }
        closeModal(modalEl);
        renderOpposing();
        Utils.toast('Opposing party saved.', 'success');
      } catch (err) {
        errEl.textContent = err.message || 'Save failed.';
        errEl.classList.remove('hidden');
        Utils.setLoading(saveBtn, false);
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

        const html = await res.text();
        const blob = new Blob([html], { type: 'text/html' });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);

        closeModal(modalEl);
        Utils.toast('Document generated — print or save as PDF from the new tab.', 'success');
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
        } else if (entityType === 'opposing_parties' && oppParty) {
          oppParty.ssn_last4 = result.last4;
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

  // ── Boot ─────────────────────────────────────────────────────────────────────

  // SSN button events — wired once at init so re-renders don't duplicate listeners
  document.addEventListener('click', e => {
    const editBtn   = e.target.closest('.btn-edit-ssn');
    const revealBtn = e.target.closest('.btn-reveal-ssn');
    if (editBtn)   openSsnModal(editBtn.dataset.entityType, editBtn.dataset.entityId, editBtn.dataset.entityLabel);
    if (revealBtn) doRevealSsn(revealBtn.dataset.entityType, revealBtn.dataset.entityId, revealBtn.dataset.displayId);
  });

  await loadAll();

})();
