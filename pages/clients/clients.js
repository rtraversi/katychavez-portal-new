// Clients page logic — loaded dynamically when the clients route is active.
// Requires: db (supabase-client), Auth, Utils, Menu globals.
'use strict';

(async function ClientsPage() {

  // ── State ────────────────────────────────────────────────────────────────────
  let allClients    = [];
  let users         = [];
  let unreadMap     = {};   // client_id → unread message count
  let searchQuery   = '';
  let filterStatus  = '';
  let filterType    = '';
  const PAGE_SIZE   = 25;
  let offset        = 0;

  let practiceAreas   = [];
  let caseTypesData   = [];
  let caseTypeMap     = new Map();  // id → case_type row
  let caseTypePaKey   = new Map();  // case_type key → practice_area key (for badge colors)

  const tbody      = document.getElementById('clients-tbody');
  const searchEl   = document.getElementById('client-search');
  const statusEl   = document.getElementById('filter-status');
  const caseTypeEl = document.getElementById('filter-case-type');
  const pagination = document.getElementById('clients-pagination');
  const modalEl    = document.getElementById('client-modal');

  // ── Fetch data ───────────────────────────────────────────────────────────────

  async function loadUsers() {
    const { data } = await db.from('users').select('id, first_name, last_name, color, roles(name)').eq('active', true).order('first_name');
    users = data || [];
  }

  async function loadPracticeAreas() {
    const [{ data: pa }, { data: ct }, { data: enabled }] = await Promise.all([
      db.from('practice_areas').select('*').order('sort_order'),
      db.from('case_types').select('*').order('sort_order'),
      db.from('enabled_practice_areas').select('practice_area_key'),
    ]);
    const enabledKeys = new Set((enabled || []).map(r => r.practice_area_key));
    practiceAreas = (pa || []).filter(p => enabledKeys.has(p.key));
    caseTypesData = ct || [];
    caseTypeMap   = new Map(caseTypesData.map(c => [c.id, c]));
    // Build case_type_key → pa_key for badge coloring
    const paKeyMap = new Map((pa || []).map(p => [p.id, p.key]));
    caseTypePaKey = new Map(caseTypesData.map(c => [c.key, paKeyMap.get(c.practice_area_id) || '']));
    populateCaseTypeFilter();
  }

  function populateCaseTypeFilter() {
    const sel = document.getElementById('filter-case-type');
    if (!sel) return;
    const paMap = new Map(practiceAreas.map(p => [p.id, p]));
    let html = '<option value="">All case types</option>';
    practiceAreas.forEach(pa => {
      const paCts = caseTypesData.filter(ct => ct.practice_area_id === pa.id);
      if (!paCts.length) return;
      html += `<optgroup label="${Utils.esc(pa.name)}">`;
      paCts.forEach(ct => { html += `<option value="${Utils.esc(ct.key)}">${Utils.esc(ct.name)}</option>`; });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
  }

  function buildCaseTypeOptions(paId) {
    const cts = caseTypesData.filter(ct => ct.practice_area_id === paId);
    return '<option value="">— Select —</option>' +
      cts.map(ct => `<option value="${Utils.esc(ct.id)}">${Utils.esc(ct.name)}</option>`).join('');
  }

  async function loadUnreadCounts() {
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/get-conversations', {
        headers: { 'Authorization': `Bearer ${session?.access_token || ''}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      unreadMap = {};
      for (const c of (data.conversations || [])) {
        if (c.unread_count > 0) unreadMap[c.client_id] = c.unread_count;
      }
    } catch { /* silently ignore — messaging module may not be accessible */ }
  }

  async function loadClients() {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:var(--space-10);text-align:center;color:var(--color-text-muted)">Loading…</td></tr>`;

    let query = db
      .from('clients')
      .select(`
        id, first_name, last_name, email, phone, active, is_dv_confidential,
        matters ( id, case_type, case_number, status, assigned_attorney_id,
          key_dates ( date_type, date_value )
        )
      `, { count: 'exact' })
      .order('last_name');

    if (searchQuery) {
      const q = searchQuery.replace(/'/g, "''");
      query = query.or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`);
    }
    if (filterStatus)  query = query.eq('matters.status', filterStatus);

    const { data, error, count } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) { Utils.handleError(error, 'clients load'); return; }

    allClients = data || [];
    renderTable(allClients, count);
    renderPagination(count);
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  function renderTable(clients, total) {
    if (!clients.length) {
      tbody.innerHTML = `
        <tr><td colspan="7">
          <div class="empty-state">
            <p class="empty-state-title">No clients found</p>
            <p>Add your first client to get started.</p>
            <button class="btn btn--primary" onclick="document.getElementById('btn-new-client').click()">New client</button>
          </div>
        </td></tr>`;
      return;
    }

    tbody.innerHTML = clients.map(c => {
      const matter     = (c.matters || [])[0];
      const nextHearing = nextHearingDate(matter?.key_dates || []);
      const attorney   = matter?.assigned_attorney_id
        ? users.find(u => u.id === matter.assigned_attorney_id) : null;

      return `<tr data-id="${c.id}" style="cursor:pointer">
        <td>
          <div style="display:flex;align-items:center;gap:var(--space-3)">
            <div style="width:32px;height:32px;border-radius:50%;background:${attorney?.color || 'var(--color-primary)'};color:#fff;display:grid;place-items:center;font-size:var(--text-xs);font-weight:600;flex-shrink:0">
              ${Utils.initials(c)}
            </div>
            <div>
              <div style="font-weight:500;display:flex;align-items:center;gap:var(--space-2)">${Utils.esc(Utils.fullName(c))}${c.is_dv_confidential ? ' <span class="badge badge--dv" title="DV confidential">DV</span>' : ''}${unreadMap[c.id] ? `<span class="badge badge--msg-unread" title="${unreadMap[c.id]} unread message${unreadMap[c.id] > 1 ? 's' : ''}">💬 ${unreadMap[c.id]}</span>` : ''}</div>
              <div class="text-muted text-sm">${Utils.esc(c.email || '')}</div>
            </div>
          </div>
        </td>
        <td>${matter ? caseTypeBadge(matter.case_type) : '<span class="text-muted">—</span>'}</td>
        <td>${Utils.esc(matter?.case_number || '—')}</td>
        <td>${matter ? `<span class="badge badge--${matter.status}">${Utils.titleCase(matter.status)}</span>` : '<span class="text-muted">—</span>'}</td>
        <td>${attorney
          ? `<span style="display:inline-flex;align-items:center;gap:5px">${attorney.color ? `<span style="width:10px;height:10px;border-radius:50%;background:${Utils.esc(attorney.color)};flex-shrink:0;display:inline-block"></span>` : ''}<span>${Utils.esc(Utils.fullName(attorney))}</span></span>`
          : '<span class="text-muted">—</span>'}</td>
        <td>${nextHearing ? `<span style="color:${isOverdue(nextHearing)?'var(--color-danger)':'inherit'}">${Utils.formatDate(nextHearing)}</span>` : '<span class="text-muted">—</span>'}</td>
        <td>
          <button class="btn btn--ghost btn--sm btn-edit-client" data-id="${c.id}" title="Edit client">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </td>
      </tr>`;
    }).join('');
  }

  function nextHearingDate(dates) {
    const today = new Date().toISOString().slice(0, 10);
    return (dates || [])
      .filter(d => d.date_type === 'hearing' && d.date_value >= today)
      .sort((a, b) => a.date_value.localeCompare(b.date_value))[0]?.date_value;
  }
  function isOverdue(dateStr) { return dateStr < new Date().toISOString().slice(0, 10); }

  function renderPagination(total) {
    if (!total || total <= PAGE_SIZE) { pagination.innerHTML = ''; return; }
    const pages = Math.ceil(total / PAGE_SIZE);
    const current = Math.floor(offset / PAGE_SIZE) + 1;
    pagination.innerHTML = `
      <button class="btn btn--secondary btn--sm" ${current === 1 ? 'disabled' : ''} onclick="ClientsPage.goPage(${current - 2})">← Prev</button>
      <span>Page ${current} of ${pages}</span>
      <button class="btn btn--secondary btn--sm" ${current === pages ? 'disabled' : ''} onclick="ClientsPage.goPage(${current})">Next →</button>`;
  }

  // Badge colors keyed by practice area
  const PA_BADGE_COLORS = {
    family_law:      ['#ede9fe','#5b21b6'],
    immigration:     ['#dbeafe','#1e40af'],
    personal_injury: ['#ffedd5','#c2410c'],
    criminal:        ['#fee2e2','#b91c1c'],
  };

  function caseTypeBadge(caseTypeKey) {
    if (!caseTypeKey) return '<span class="text-muted">—</span>';
    // Look up display name from loaded case types; fall back to title-casing the key
    const ctRow = caseTypesData.find(c => c.key === caseTypeKey);
    const label  = ctRow?.name || Utils.titleCase(caseTypeKey.replace(/_/g, ' '));
    const paKey  = caseTypePaKey.get(caseTypeKey) || '';
    const [bg, color] = PA_BADGE_COLORS[paKey] || ['#f1f5f9','#475569'];
    return `<span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:var(--text-xs);font-weight:500;line-height:1.6;background:${bg};color:${color};white-space:nowrap">${Utils.esc(label)}</span>`;
  }

  // ── Modal ────────────────────────────────────────────────────────────────────

  function openModal(clientId = null) {
    modalEl.innerHTML = buildModalHTML(clientId);
    modalEl.classList.remove('hidden');
    document.getElementById('client-first-name').focus();

    // Wire PA → case type cascade
    document.getElementById('matter-practice-area').addEventListener('change', e => {
      document.getElementById('matter-case-type').innerHTML = buildCaseTypeOptions(e.target.value);
    });

    if (clientId) loadClientIntoForm(clientId);

    modalEl.querySelector('.modal-close').addEventListener('click', closeModal);
    modalEl.querySelector('#modal-cancel').addEventListener('click', closeModal);
    modalEl.querySelector('#client-form').addEventListener('submit', handleSave);
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });
  }

  function closeModal() { modalEl.classList.add('hidden'); modalEl.innerHTML = ''; }

  function buildModalHTML(clientId) {
    const paOptions = practiceAreas.map(pa =>
      `<option value="${Utils.esc(pa.id)}">${Utils.esc(pa.name)}</option>`
    ).join('');

    const ATTY_ROLES = new Set(['Owner', 'Attorney', 'Partner Attorney']);
    const attorneyOptions = users
      .filter(u => ATTY_ROLES.has(u.roles?.name))
      .map(u => `<option value="${u.id}">${Utils.fullName(u)}</option>`)
      .join('');

    return `
    <div class="modal" style="max-width:680px">
      <div class="modal-header">
        <h2 class="modal-title" id="modal-title">${clientId ? 'Edit client' : 'New client'}</h2>
        <button class="modal-close" aria-label="Close">×</button>
      </div>
      <form id="client-form" novalidate>
        <div class="modal-body">

          <p class="section-divider">Client information</p>
          <div class="field-row">
            <div class="field">
              <label for="client-first-name">First name <span class="required">*</span></label>
              <input type="text" id="client-first-name" name="first_name" required autocomplete="given-name">
            </div>
            <div class="field">
              <label for="client-last-name">Last name <span class="required">*</span></label>
              <input type="text" id="client-last-name" name="last_name" required autocomplete="family-name">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="client-dob">Date of birth</label>
              <input type="date" id="client-dob" name="dob">
            </div>
            <div class="field">
              <label for="client-preferred-contact">Preferred contact</label>
              <select id="client-preferred-contact" name="preferred_contact">
                <option value="">—</option>
                <option value="phone">Phone</option>
                <option value="email">Email</option>
                <option value="portal">Portal message</option>
                <option value="text">Text</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="client-phone">Phone</label>
              <input type="tel" id="client-phone" name="phone" autocomplete="tel">
            </div>
            <div class="field">
              <label for="client-email">Email</label>
              <input type="email" id="client-email" name="email" autocomplete="email">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="client-address1">Address</label>
              <input type="text" id="client-address1" name="address_line1" placeholder="Street address">
            </div>
            <div class="field">
              <label for="client-address2">Apt / Suite</label>
              <input type="text" id="client-address2" name="address_line2">
            </div>
          </div>
          <div class="field-row thirds">
            <div class="field">
              <label for="client-city">City</label>
              <input type="text" id="client-city" name="city">
            </div>
            <div class="field">
              <label for="client-state">State</label>
              <input type="text" id="client-state" name="state" value="TX" maxlength="2" style="text-transform:uppercase">
            </div>
            <div class="field">
              <label for="client-zip">ZIP</label>
              <input type="text" id="client-zip" name="zip" inputmode="numeric">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="client-employer">Employer</label>
              <input type="text" id="client-employer" name="employer">
            </div>
            <div class="field">
              <label for="client-emergency-name">Emergency contact name</label>
              <input type="text" id="client-emergency-name" name="emergency_contact_name">
            </div>
          </div>
          <div class="field">
            <label for="client-emergency-phone">Emergency contact phone</label>
            <input type="tel" id="client-emergency-phone" name="emergency_contact_phone">
          </div>

          <p class="section-divider" style="margin-top:var(--space-2)">Case information</p>
          <input type="hidden" id="matter-id" name="matter_id">
          <div class="field-row">
            <div class="field">
              <label for="matter-practice-area">Practice area <span class="required">*</span></label>
              <select id="matter-practice-area" name="practice_area_id" required>
                <option value="">— Select —</option>
                ${paOptions}
              </select>
            </div>
            <div class="field">
              <label for="matter-case-type">Case type <span class="required">*</span></label>
              <select id="matter-case-type" name="case_type_id" required>
                <option value="">— Select practice area first —</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field" style="visibility:hidden"></div>
            <div class="field">
              <label for="matter-status">Status</label>
              <select id="matter-status" name="matter_status">
                <option value="intake">Intake</option>
                <option value="active">Active</option>
                <option value="on_hold">On Hold</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="matter-case-number">Case number</label>
              <input type="text" id="matter-case-number" name="case_number" placeholder="Court docket #">
            </div>
            <div class="field">
              <label for="matter-court-county">Court / County</label>
              <input type="text" id="matter-court-county" name="court_county" placeholder="e.g. Dallas County">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="matter-judge">Judge</label>
              <input type="text" id="matter-judge" name="judge_name">
            </div>
            <div class="field">
              <label for="matter-date-filed">Date filed</label>
              <input type="date" id="matter-date-filed" name="date_filed">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="matter-attorney">Assigned attorney</label>
              <select id="matter-attorney" name="assigned_attorney_id">
                <option value="">— Unassigned —</option>
                ${attorneyOptions}
              </select>
            </div>
            <div class="field">
              <label for="matter-billing-type">Billing type</label>
              <select id="matter-billing-type" name="billing_type">
                <option value="hourly">Hourly</option>
                <option value="flat_fee">Flat fee</option>
                <option value="contingency">Contingency</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
          </div>

          <p class="section-divider" style="margin-top:var(--space-2)">Compliance</p>
          <div class="field">
            <label for="client-conflict-notes">Conflict check notes</label>
            <textarea id="client-conflict-notes" name="conflict_check_notes" rows="2"></textarea>
          </div>
          <div class="field" style="flex-direction:row;align-items:center;gap:var(--space-3)">
            <input type="checkbox" id="client-dv" name="is_dv_confidential" style="width:auto;cursor:pointer">
            <label for="client-dv" style="cursor:pointer;font-weight:400">
              DV / Protective order — address confidential
              <span style="display:block;font-size:var(--text-xs);color:var(--color-text-muted)">Restricts visibility per Texas DV confidentiality rules</span>
            </label>
          </div>

          <div class="field">
            <label for="client-notes">Internal notes</label>
            <textarea id="client-notes" name="notes" rows="2"></textarea>
          </div>

        </div>
        <div class="modal-footer">
          <div id="modal-error" class="form-error hidden" style="flex:1;margin-right:auto"></div>
          <button type="button" class="btn btn--secondary" id="modal-cancel">Cancel</button>
          <button type="submit" class="btn btn--primary" id="modal-save">
            ${clientId ? 'Save changes' : 'Create client'}
          </button>
        </div>
      </form>
    </div>`;
  }

  async function loadClientIntoForm(clientId) {
    // Load client fields
    const { data: client, error } = await db.from('clients').select('*').eq('id', clientId).single();
    if (error || !client) return;

    const f = document.getElementById('client-form');
    const clientFields = ['first_name','last_name','dob','phone','email','address_line1','address_line2',
      'city','state','zip','preferred_contact','employer','emergency_contact_name',
      'emergency_contact_phone','conflict_check_notes','notes'];
    clientFields.forEach(k => {
      const el = f.elements[k];
      if (el && client[k] != null) el.value = client[k];
    });
    const dvEl = f.elements['is_dv_confidential'];
    if (dvEl) dvEl.checked = !!client.is_dv_confidential;
    document.getElementById('modal-save').dataset.clientId = clientId;

    // Load first matter
    const { data: matter } = await db
      .from('matters')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at')
      .limit(1)
      .maybeSingle();

    if (matter) {
      document.getElementById('matter-id').value = matter.id;
      const matterFields = [
        ['matter_status',        'matter-status'],
        ['case_number',          'matter-case-number'],
        ['court_county',         'matter-court-county'],
        ['judge_name',           'matter-judge'],
        ['date_filed',           'matter-date-filed'],
        ['assigned_attorney_id', 'matter-attorney'],
        ['billing_type',         'matter-billing-type'],
      ];
      matterFields.forEach(([key, elId]) => {
        const el = document.getElementById(elId);
        if (el && matter[key] != null) el.value = matter[key];
      });

      // Two-step PA → case type
      const paEl = document.getElementById('matter-practice-area');
      const ctEl = document.getElementById('matter-case-type');
      let paId = matter.practice_area_id;
      let ctId = matter.case_type_id;

      // Legacy fallback: resolve from case_type text key if UUIDs missing
      if (!paId && matter.case_type) {
        const legacyCt = caseTypesData.find(c => c.key === matter.case_type);
        if (legacyCt) { paId = legacyCt.practice_area_id; ctId = legacyCt.id; }
      }

      if (paId && paEl) {
        paEl.value = paId;
        if (ctEl) {
          ctEl.innerHTML = buildCaseTypeOptions(paId);
          if (ctId) ctEl.value = ctId;
        }
      }
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    const errEl   = document.getElementById('modal-error');
    const saveBtn = document.getElementById('modal-save');
    const clientId = saveBtn.dataset.clientId;

    errEl.classList.add('hidden');
    Utils.setLoading(saveBtn, true);

    const f = e.target;

    const clientPayload = {
      first_name:             f.elements['first_name'].value.trim(),
      last_name:              f.elements['last_name'].value.trim(),
      dob:                    f.elements['dob'].value || null,
      phone:                  f.elements['phone'].value.trim() || null,
      email:                  f.elements['email'].value.trim() || null,
      address_line1:          f.elements['address_line1'].value.trim() || null,
      address_line2:          f.elements['address_line2'].value.trim() || null,
      city:                   f.elements['city'].value.trim() || null,
      state:                  f.elements['state'].value.trim().toUpperCase() || 'TX',
      zip:                    f.elements['zip'].value.trim() || null,
      preferred_contact:      f.elements['preferred_contact'].value || null,
      employer:               f.elements['employer'].value.trim() || null,
      emergency_contact_name: f.elements['emergency_contact_name'].value.trim() || null,
      emergency_contact_phone:f.elements['emergency_contact_phone'].value.trim() || null,
      conflict_check_notes:   f.elements['conflict_check_notes'].value.trim() || null,
      is_dv_confidential:     f.elements['is_dv_confidential'].checked,
      notes:                  f.elements['notes'].value.trim() || null,
    };

    const paId   = f.elements['practice_area_id'].value;
    const ctId   = f.elements['case_type_id'].value;
    const ctRow  = caseTypeMap.get(ctId);
    const matterPayload = {
      practice_area_id:     paId   || null,
      case_type_id:         ctId   || null,
      case_type:            ctRow?.key || null,  // text key for backward compat
      status:               f.elements['matter_status'].value || 'intake',
      case_number:          f.elements['case_number'].value.trim() || null,
      court_county:         f.elements['court_county'].value.trim() || null,
      judge_name:           f.elements['judge_name'].value.trim() || null,
      date_filed:           f.elements['date_filed'].value || null,
      assigned_attorney_id: f.elements['assigned_attorney_id'].value || null,
      billing_type:         f.elements['billing_type'].value || 'hourly',
      is_dv_confidential:   clientPayload.is_dv_confidential,
    };

    if (!clientPayload.first_name || !clientPayload.last_name) {
      errEl.textContent = 'First and last name are required.';
      errEl.classList.remove('hidden');
      Utils.setLoading(saveBtn, false);
      return;
    }
    if (!paId || !ctId) {
      errEl.textContent = 'Practice area and case type are required.';
      errEl.classList.remove('hidden');
      Utils.setLoading(saveBtn, false);
      return;
    }

    try {
      let savedClientId = clientId;
      const matterId = f.elements['matter_id'].value;

      if (clientId) {
        // Update existing client
        const { error } = await db.from('clients').update(clientPayload).eq('id', clientId);
        if (error) throw error;

        // Update or create matter
        if (matterId) {
          const { error: mErr } = await db.from('matters').update(matterPayload).eq('id', matterId);
          if (mErr) throw mErr;
        } else {
          const { error: mErr } = await db.from('matters').insert({ ...matterPayload, client_id: clientId });
          if (mErr) throw mErr;
        }
      } else {
        // Insert client, then matter
        const { data: newClient, error: cErr } = await db
          .from('clients').insert(clientPayload).select('id').single();
        if (cErr) throw cErr;
        savedClientId = newClient.id;

        const { error: mErr } = await db
          .from('matters').insert({ ...matterPayload, client_id: savedClientId });
        if (mErr) throw mErr;
      }

      closeModal();
      Utils.toast(clientId ? 'Client updated.' : 'Client created.', 'success');
      loadClients();
    } catch (err) {
      errEl.textContent = err.message || 'Save failed.';
      errEl.classList.remove('hidden');
      Utils.setLoading(saveBtn, false);
    }
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  document.getElementById('btn-new-client').addEventListener('click', () => openModal());

  document.getElementById('client-search').addEventListener('input', Utils.debounce(e => {
    searchQuery = e.target.value;
    offset = 0;
    loadClients();
  }));

  document.getElementById('filter-status').addEventListener('change', e => {
    filterStatus = e.target.value;
    offset = 0;
    loadClients();
  });

  document.getElementById('filter-case-type').addEventListener('change', e => {
    filterType = e.target.value;
    offset = 0;
    loadClients();
  });

  tbody.addEventListener('click', e => {
    const editBtn = e.target.closest('.btn-edit-client');
    if (editBtn) {
      e.stopPropagation();
      window._clientDetailId = editBtn.dataset.id;
      window.location.hash = '#clients/detail';
      return;
    }
    const row = e.target.closest('tr[data-id]');
    if (row) {
      window._clientDetailId = row.dataset.id;
      window.location.hash = '#clients/detail';
    }
  });

  // Expose goPage for pagination buttons
  window.ClientsPage = { goPage(page) { offset = page * PAGE_SIZE; loadClients(); } };

  // ── Init ─────────────────────────────────────────────────────────────────────
  await Promise.all([loadUsers(), loadPracticeAreas(), loadUnreadCounts()]);
  await loadClients();

})();
