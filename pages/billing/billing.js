'use strict';

(async function BillingPage() {

  // Escape DB-/staff-sourced strings (client names, case numbers, descriptions,
  // attorney names, error messages) before they enter innerHTML.
  const esc = (s) => (window.Utils?.esc
    ? window.Utils.esc(s)
    : String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])));

  // ── DOM refs ──────────────────────────────────────────────────────────────────
  const listPanel     = document.getElementById('bl-list-panel');
  const newPanel      = document.getElementById('bl-new-panel');
  const detailPanel   = document.getElementById('bl-detail-panel');
  const invoiceList   = document.getElementById('bl-invoice-list');
  const filterTabs    = document.getElementById('bl-filter-tabs');
  const newBtn        = document.getElementById('bl-new-btn');
  const newBackBtn    = document.getElementById('bl-new-back-btn');
  const detailBackBtn = document.getElementById('bl-detail-back-btn');
  const detailActions = document.getElementById('bl-detail-actions');
  const detailContent = document.getElementById('bl-detail-content');
  const matterSelect  = document.getElementById('bl-matter-select'); // hidden input holding chosen matter id
  const matterSearch  = document.getElementById('bl-matter-search');
  const matterList    = document.getElementById('bl-matter-list');
  const entriesSection  = document.getElementById('bl-entries-section');
  const entriesList     = document.getElementById('bl-entries-list');
  const noEntries       = document.getElementById('bl-no-entries');
  const selectAllCb     = document.getElementById('bl-select-all');
  const expensesSection = document.getElementById('bl-expenses-section');
  const expensesList    = document.getElementById('bl-expenses-list');
  const expSelectAllCb  = document.getElementById('bl-exp-select-all');
  const reviewSection   = document.getElementById('bl-review-section');
  const reviewSummary   = document.getElementById('bl-review-summary');
  const reviewTotal     = document.getElementById('bl-review-total');
  const generateBtn     = document.getElementById('bl-generate-btn');
  const invDescription  = document.getElementById('bl-inv-description');
  const invDueDate      = document.getElementById('bl-inv-due-date');
  const expensePanel    = document.getElementById('bl-expense-panel');
  const addExpenseBtn   = document.getElementById('bl-add-expense-btn');
  const expenseBackBtn  = document.getElementById('bl-expense-back-btn');
  const expMatterSel    = document.getElementById('bl-exp-matter');
  const expDate         = document.getElementById('bl-exp-date');
  const expCategory     = document.getElementById('bl-exp-category');
  const expAmount       = document.getElementById('bl-exp-amount');
  const expDesc         = document.getElementById('bl-exp-desc');
  const expSaveBtn      = document.getElementById('bl-exp-save-btn');
  const expListPanel    = document.getElementById('bl-explist-panel');
  const expListBtn      = document.getElementById('bl-explist-btn');
  const expListBackBtn  = document.getElementById('bl-explist-back-btn');
  const expListAddBtn   = document.getElementById('bl-explist-add-btn');
  const expList         = document.getElementById('bl-explist');
  const addTimeBtn      = document.getElementById('bl-add-time-btn');
  const addTimeForm     = document.getElementById('bl-add-time-form');
  const atDesc          = document.getElementById('bl-at-desc');
  const atUser          = document.getElementById('bl-at-user');
  const atMinutes       = document.getElementById('bl-at-minutes');
  const atDate          = document.getElementById('bl-at-date');
  const atNoCharge      = document.getElementById('bl-at-nocharge');
  const atSave          = document.getElementById('bl-at-save');
  const atCancel        = document.getElementById('bl-at-cancel');
  const fbPanel         = document.getElementById('bl-fb-panel');
  const fbBtn           = document.getElementById('bl-fb-btn');
  const fbBackBtn       = document.getElementById('bl-fb-back-btn');
  const fbList          = document.getElementById('bl-fb-list');

  // ── State ─────────────────────────────────────────────────────────────────────
  let allInvoices      = [];
  let activeFilter     = 'all';
  let timeEntries        = [];
  let staffList          = [];   // [{ user_id, name, rate }] — per-client rates for reassignment
  let selectedEntryIds   = new Set();
  let expenses           = [];
  let selectedExpenseIds = new Set();
  let currentInvoice   = null;
  let fbInvoices        = [];   // unpaid FreshBooks invoices for the "From FreshBooks" picker
  let fbMatters         = [];   // open matters, cached for the per-row matter select

  // firm_settings.billing_mode (migration 1536): 'portal' | 'freshbooks_first'.
  // null = not configured (pre-1536 deployment) → show both workflows, which is
  // exactly how this page behaved before the setting existed.
  let billingMode      = null;

  // ── Helpers ───────────────────────────────────────────────────────────────────
  function fmtCurrency(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Docket-kit status pill — draft=mut, sent=acc, paid=ok, void/overdue=crit
  const STATUS_KIND = { draft: 'mut', sent: 'acc', paid: 'ok', void: 'crit', overdue: 'crit' };
  function statusBadge(status) {
    return DK.tag(status, STATUS_KIND[status] || 'mut');
  }

  async function apiPost(path, body) {
    const session = await Auth.getSession();
    const res = await fetch(path, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function apiGet(path) {
    const session = await Auth.getSession();
    const res = await fetch(path, { headers: { 'Authorization': `Bearer ${session.access_token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  function showPanel(panel) {
    listPanel.style.display    = panel === 'list'    ? '' : 'none';
    newPanel.style.display     = panel === 'new'     ? '' : 'none';
    detailPanel.style.display  = panel === 'detail'  ? '' : 'none';
    expensePanel.style.display = panel === 'expense' ? '' : 'none';
    expListPanel.style.display = panel === 'explist' ? '' : 'none';
    fbPanel.style.display      = panel === 'fb'      ? '' : 'none';
  }

  // ── Filter tabs ───────────────────────────────────────────────────────────────
  function renderFilterTabs() {
    filterTabs.querySelectorAll('.bl-tab').forEach(btn => {
      const active = btn.dataset.filter === activeFilter;
      btn.style.background   = active ? 'var(--daily-tint)' : 'var(--surface)';
      btn.style.color        = active ? 'var(--daily)' : 'var(--ink-soft)';
      btn.style.borderColor  = active ? 'var(--daily)' : 'var(--line)';
      btn.style.fontWeight   = active ? '700' : '600';
    });
  }

  filterTabs.addEventListener('click', e => {
    const tab = e.target.closest('.bl-tab');
    if (!tab) return;
    activeFilter = tab.dataset.filter;
    renderFilterTabs();
    renderInvoiceList();
  });

  // ── Invoice list ──────────────────────────────────────────────────────────────
  async function loadInvoices() {
    invoiceList.innerHTML = '<div class="dk-empty">Loading…</div>';
    try {
      const data = await apiGet('/api/get-invoices');
      allInvoices = data.invoices || [];
      renderInvoiceList();
    } catch (err) {
      invoiceList.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">Failed to load invoices: ${esc(err.message)}</div>`;
    }
  }

  function renderInvoiceList() {
    // "Pending review" (draft) count on the tab — the staging pool the biller
    // works through before anything goes out.
    const draftTab = filterTabs.querySelector('[data-filter="draft"]');
    if (draftTab) {
      const n = allInvoices.filter(i => i.status === 'draft').length;
      draftTab.textContent = n ? `Pending review (${n})` : 'Pending review';
    }

    const filtered = activeFilter === 'all'
      ? allInvoices
      : allInvoices.filter(inv => inv.status === activeFilter);

    if (!filtered.length) {
      const startHere = billingMode === 'freshbooks_first'
        ? 'Click <strong>From FreshBooks</strong> to bring one in.'
        : 'Click <strong>+ New Invoice</strong> to create one.';
      const msg = activeFilter === 'all'
        ? `No invoices yet. ${startHere}`
        : `No ${activeFilter} invoices.`;
      invoiceList.innerHTML = `<div class="dk-empty">${msg}</div>`;
      return;
    }

    const reg = document.createElement('div');
    reg.className = 'dk-register';

    filtered.forEach(inv => {
      const client = inv.matters?.clients;
      const clientName = client ? `${client.first_name} ${client.last_name}` : '—';
      const caseNum    = inv.matters?.case_number || '';
      const row = document.createElement('div');
      row.className = 'dk-reg-row';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <div style="min-width:0">
          <div class="dk-reg-title">
            <span>${esc(clientName)}</span>
            ${caseNum ? `<span class="dk-tag mut">${esc(caseNum)}</span>` : ''}
          </div>
          <div class="dk-reg-meta">
            <span>${fmtDate(inv.created_at)}</span>
            <span class="sep">·</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px">${esc(inv.description || '—')}</span>
          </div>
        </div>
        <div class="dk-reg-act" style="align-items:center;gap:14px">
          <span style="font-family:var(--font-serif);font-weight:700;color:var(--money);white-space:nowrap">${fmtCurrency(inv.amount)}</span>
          ${statusBadge(inv.status)}
          <button class="btn btn--ghost bl-view-btn" data-id="${inv.id}" style="font-size:12px;padding:4px 10px">View</button>
        </div>`;
      row.addEventListener('click', e => {
        if (!e.target.classList.contains('bl-view-btn')) showDetail(inv);
      });
      row.querySelector('.bl-view-btn').addEventListener('click', () => showDetail(inv));
      reg.appendChild(row);
    });

    invoiceList.innerHTML = '';
    invoiceList.appendChild(reg);
  }

  // ── New invoice flow ──────────────────────────────────────────────────────────
  const matterClientIds = new Map(); // matter id → client id (for expense rows)

  // Fetches open matters once, returns [{ id, name, caseNum, clientId, label }].
  async function fetchMatters() {
    const { data } = await window.db
      .from('matters')
      .select('id, case_number, status, clients(id, first_name, last_name)')
      .in('status', ['intake', 'active'])
      .order('created_at', { ascending: false });
    return (data || []).map(m => {
      const c       = m.clients;
      const name    = c ? `${c.first_name} ${c.last_name}` : (m.case_number || m.id);
      const caseNum = m.case_number || '';
      return {
        id:       m.id,
        name,
        caseNum,
        clientId: c?.id || null,
        label:    caseNum ? `${name} — ${caseNum}` : name,
      };
    });
  }

  // Populates a native <select> (used by the expense form).
  async function loadMatters(selectEl) {
    selectEl.innerHTML = '<option value="">Loading matters…</option>';
    try {
      const matters = await fetchMatters();
      selectEl.innerHTML = '<option value="">Choose a matter…</option>';
      matters.forEach(m => {
        matterClientIds.set(m.id, m.clientId);
        const opt = document.createElement('option');
        opt.value       = m.id;
        opt.textContent = m.label;
        selectEl.appendChild(opt);
      });
    } catch (err) {
      selectEl.innerHTML = '<option value="">Failed to load matters</option>';
    }
  }

  // Searchable matter picker for New Invoice — type-to-filter combobox that
  // mirrors the client search on Clients & Matters. Writes the chosen id into
  // the hidden #bl-matter-select and fires its 'change' event, so the rest of
  // the invoice flow (which reads matterSelect.value) is unchanged.
  const matterPicker = (() => {
    let matters  = [];   // all open matters
    let filtered = [];   // current query result
    let activeIdx = -1;

    const isOpen = () => !matterList.hidden;

    function setValue(id, text) {
      const changed = matterSelect.value !== (id || '');
      matterSelect.value = id || '';
      matterSearch.value = text || '';
      if (changed) matterSelect.dispatchEvent(new Event('change'));
    }

    function close() {
      matterList.hidden = true;
      activeIdx = -1;
      matterSearch.setAttribute('aria-expanded', 'false');
    }

    // Highlight the matched substring of a query within a label.
    function mark(text, q) {
      if (!q) return esc(text);
      const i = text.toLowerCase().indexOf(q);
      if (i < 0) return esc(text);
      return esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) +
        '</mark>' + esc(text.slice(i + q.length));
    }

    function render() {
      const q = matterSearch.value.trim().toLowerCase();
      filtered = q
        ? matters.filter(m => m.name.toLowerCase().includes(q) || m.caseNum.toLowerCase().includes(q))
        : matters.slice();

      if (!matters.length) {
        matterList.innerHTML = '<div class="dk-combo-empty">No open matters found.</div>';
      } else if (!filtered.length) {
        matterList.innerHTML = `<div class="dk-combo-empty">No matches for “${esc(matterSearch.value.trim())}”.</div>`;
      } else {
        matterList.innerHTML = filtered.map((m, i) => `
          <div class="dk-combo-opt${i === activeIdx ? ' active' : ''}" role="option" data-idx="${i}">
            <span class="co-name">${mark(m.name, q)}</span>
            ${m.caseNum ? `<span class="co-meta">${mark(m.caseNum, q)}</span>` : ''}
          </div>`).join('');
      }
      matterList.hidden = false;
      matterSearch.setAttribute('aria-expanded', 'true');
    }

    function choose(idx) {
      const m = filtered[idx];
      if (!m) return;
      setValue(m.id, m.label);
      close();
    }

    function scrollToActive() {
      matterList.querySelector('.dk-combo-opt.active')?.scrollIntoView({ block: 'nearest' });
    }

    matterSearch.addEventListener('input', () => {
      if (matterSelect.value) setValue('', matterSearch.value); // editing invalidates the prior pick
      activeIdx = -1;
      render();
    });
    matterSearch.addEventListener('focus', () => { if (!isOpen()) render(); });
    // Element-scoped close — no global document listener to stack across navigations.
    matterSearch.addEventListener('blur', () => setTimeout(close, 120));
    matterSearch.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isOpen()) { render(); return; }
        activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
        render(); scrollToActive();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = Math.max(activeIdx - 1, 0);
        render(); scrollToActive();
      } else if (e.key === 'Enter') {
        if (isOpen() && activeIdx >= 0) { e.preventDefault(); choose(activeIdx); }
      } else if (e.key === 'Escape') {
        close();
      }
    });
    // mousedown (before the input's blur) so the pick registers before we close.
    matterList.addEventListener('mousedown', (e) => {
      const opt = e.target.closest('.dk-combo-opt');
      if (!opt) return;
      e.preventDefault();
      choose(Number(opt.dataset.idx));
    });

    async function load() {
      setValue('', '');
      close();
      matterSearch.disabled = true;
      const placeholder = matterSearch.placeholder;
      matterSearch.placeholder = 'Loading matters…';
      try {
        matters = await fetchMatters();
        matters.forEach(m => matterClientIds.set(m.id, m.clientId));
      } catch (err) {
        matters = [];
      }
      matterSearch.disabled = false;
      matterSearch.placeholder = placeholder;
    }

    return { load };
  })();

  // Loads unbilled time + expenses for a matter. Reused by the matter picker
  // and by the manual add-time flow (which must NOT clear existing selections
  // — the biller shouldn't lose their checked entries by adding one more).
  async function loadUnbilledFor(matterId) {
    entriesSection.style.display = '';
    entriesList.innerHTML = '<div class="dk-empty">Loading time entries…</div>';
    noEntries.style.display = 'none';

    // Unbilled expenses load in parallel — a failure here shouldn't block invoicing time
    const expensesPromise = window.db
      .from('expenses')
      .select('id, expense_date, category, description, amount')
      .eq('matter_id', matterId)
      .eq('billed', false)
      .order('expense_date', { ascending: true });

    try {
      const data = await apiGet(`/api/get-unbilled-time?matter_id=${matterId}`);
      timeEntries = data.time_entries || [];
      staffList   = data.staff || [];
    } catch (err) {
      entriesList.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">Error: ${esc(err.message)}</div>`;
      return;
    }

    populateAddTimeUsers(atUser);

    expenses = (await expensesPromise).data || [];
    expensesSection.style.display = expenses.length ? '' : 'none';
    if (expenses.length) renderExpenses();

    if (!timeEntries.length) {
      entriesList.innerHTML = '';
      noEntries.style.display = '';
      updateReview();
      return;
    }

    renderTimeEntries();
  }

  // A matter that already has a live invoice is the double-billing hot path
  // (already-pulled provider time is filtered server-side, but a second draft
  // for the same period is still easy to create by accident — see INV-0035/0040).
  function showDupWarning(matterId) {
    const warnBox  = document.getElementById('bl-dup-warn');
    const warnText = document.getElementById('bl-dup-warn-text');
    if (!warnBox) return;
    const live = allInvoices.filter(inv =>
      (inv.matter_id || inv.matters?.id) === matterId &&
      (inv.status === 'draft' || inv.status === 'sent'));
    if (!live.length) { warnBox.style.display = 'none'; return; }
    const list = live.slice(0, 3)
      .map(inv => `${inv.invoice_number} (${inv.status}, ${fmtCurrency(inv.amount)})`)
      .join(', ');
    warnText.textContent =
      `This matter already has ${list}${live.length > 3 ? ` and ${live.length - 3} more` : ''}. ` +
      'Make sure this isn\'t the same billing period — void the old invoice first if you\'re redoing it.';
    warnBox.style.display = 'flex';
  }

  matterSelect.addEventListener('change', async () => {
    const matterId = matterSelect.value;
    entriesSection.style.display  = 'none';
    expensesSection.style.display = 'none';
    reviewSection.style.display   = 'none';
    selectedEntryIds.clear();
    selectedExpenseIds.clear();
    timeEntries = [];
    staffList   = [];
    expenses    = [];
    hideAddTimeForm();
    showDupWarning(matterId);
    if (!matterId) return;
    await loadUnbilledFor(matterId);
  });

  // ── Manual time entry ("Add time entry") ─────────────────────────────────────
  function populateAddTimeUsers(selectEl) {
    selectEl.innerHTML = '<option value="">Who worked this time…</option>' +
      staffList.map(s =>
        `<option value="${esc(s.user_id)}">${esc(s.name)}${s.rate ? ` — ${fmtCurrency(s.rate)}/h` : ''}</option>`
      ).join('');
  }

  function hideAddTimeForm() {
    addTimeForm.style.display = 'none';
  }

  addTimeBtn.addEventListener('click', () => {
    const opening = addTimeForm.style.display === 'none';
    addTimeForm.style.display = opening ? '' : 'none';
    if (opening) {
      atDesc.value     = '';
      atMinutes.value  = '';
      atNoCharge.checked = false;
      atDate.value     = new Date().toISOString().slice(0, 10);
      populateAddTimeUsers(atUser);
      atDesc.focus();
    }
  });
  atCancel.addEventListener('click', (e) => { e.preventDefault(); hideAddTimeForm(); });

  atSave.addEventListener('click', async (e) => {
    e.preventDefault();
    const matterId = matterSelect.value;
    const minutes  = Number(atMinutes.value);
    if (!matterId)                        return Utils.toast('Choose a matter first.', 'error');
    if (!atDesc.value.trim())             return Utils.toast('Enter a description.', 'error');
    if (!atUser.value)                    return Utils.toast('Pick who the time belongs to.', 'error');
    if (!(minutes > 0))                   return Utils.toast('Enter the minutes worked.', 'error');

    atSave.disabled = true;
    atSave.innerHTML = '<span class="spinner"></span> Adding…';
    try {
      const data = await apiPost('/api/add-time-entry', {
        matter_id:   matterId,
        user_id:     atUser.value,
        description: atDesc.value.trim(),
        minutes,
        entry_date:  atDate.value || null,
        no_charge:   atNoCharge.checked,
      });
      // Pre-select the new entry — it was added specifically to go on this invoice.
      if (data.time_entry?.id) selectedEntryIds.add(data.time_entry.id);
      hideAddTimeForm();
      Utils.toast('Time entry added.', 'success');
      await loadUnbilledFor(matterId);
    } catch (err) {
      Utils.toast('Failed to add time entry: ' + err.message, 'error');
    } finally {
      atSave.disabled = false;
      atSave.textContent = 'Add Entry';
    }
  });

  // ── Unbilled expenses ─────────────────────────────────────────────────────────
  const CATEGORY_LABELS = {
    postage: 'Postage', copies: 'Copies', filing_fee: 'Filing fee', mailing: 'Mailing',
    admin_fee: 'Admin Fee', other: 'Expense',
  };

  function renderExpenses() {
    const reg = document.createElement('div');
    reg.className = 'dk-register';

    expenses.forEach(exp => {
      const row = document.createElement('div');
      row.className = 'dk-reg-row';
      row.style.gridTemplateColumns = 'auto minmax(0,1fr) auto';
      row.style.alignItems = 'center';
      row.innerHTML = `
        <input type="checkbox" class="bl-exp-cb" data-id="${exp.id}" ${selectedExpenseIds.has(exp.id) ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer">
        <div style="min-width:0">
          <div class="dk-reg-title" style="font-size:14px" title="${esc(exp.description)}">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px">${esc(exp.description)}</span>
          </div>
          <div class="dk-reg-meta">
            <span>${fmtDate(exp.expense_date)}</span>
            <span class="sep">·</span>
            <span>${esc(CATEGORY_LABELS[exp.category] || exp.category)}</span>
          </div>
        </div>
        <span style="font-family:var(--font-serif);font-weight:700;color:var(--money);white-space:nowrap">${fmtCurrency(exp.amount)}</span>`;
      reg.appendChild(row);
    });

    expensesList.innerHTML = '';
    expensesList.appendChild(reg);

    expensesList.querySelectorAll('.bl-exp-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedExpenseIds.add(cb.dataset.id);
        else            selectedExpenseIds.delete(cb.dataset.id);
        updateExpSelectAll();
        updateReview();
      });
    });

    updateExpSelectAll();
    updateReview();
  }

  function updateExpSelectAll() {
    expSelectAllCb.indeterminate = selectedExpenseIds.size > 0 && selectedExpenseIds.size < expenses.length;
    expSelectAllCb.checked       = selectedExpenseIds.size === expenses.length && expenses.length > 0;
  }

  expSelectAllCb.addEventListener('change', () => {
    if (expSelectAllCb.checked) {
      expenses.forEach(e => selectedExpenseIds.add(e.id));
    } else {
      selectedExpenseIds.clear();
    }
    renderExpenses();
  });

  function renderTimeEntries() {
    const reg = document.createElement('div');
    reg.className = 'dk-register';

    timeEntries.forEach(entry => {
      const attorney = entry.users
        ? [entry.users.first_name, entry.users.last_name].filter(Boolean).join(' ')
        : '—';
      // Provider-pulled entries get a dropdown so time attributed to the wrong
      // person (or left unmapped) can be reassigned — the rate and amount
      // recompute from that person's per-client rate.
      const userCell = (entry.source === 'freshbooks' && staffList.length)
        ? `<select class="bl-entry-user" data-id="${entry.id}" title="Attributed to — reassign if this time was pulled to the wrong person"
             style="width:auto;font-size:12px;padding:1px 24px 1px 6px;background-position:right 6px center;background-size:13px;border-radius:6px;color:inherit">
             ${entry.users?.id ? '' : '<option value="" selected disabled>Unassigned</option>'}
             ${staffList.map(s => `<option value="${s.user_id}" ${entry.users?.id === s.user_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
           </select>`
        : `<span>${esc(attorney)}</span>`;
      const row = document.createElement('div');
      row.className = 'dk-reg-row';
      row.style.gridTemplateColumns = 'auto minmax(0,1fr) auto';
      row.style.alignItems = 'center';
      const isSelected = selectedEntryIds.has(entry.id);
      const unbillable = entry.billable === false;
      const rate = entry.effective_rate ? fmtCurrency(entry.effective_rate) + '/h' : '—';
      const noChargeBadge = unbillable
        ? '<span class="sep">·</span><span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:4px;background:var(--paper-deep);color:var(--ink-faint)">No charge</span>'
        : '';
      // Increment rounding transparency: when the firm's billing increment
      // rounded this entry up, show the actual tracked time next to the billed
      // hours — the biller always sees the adjustment, the portal never hides it.
      const rounded  = entry.actual_hours != null && entry.actual_hours !== entry.hours;
      const trackedM = entry.duration_seconds != null
        ? Math.round(entry.duration_seconds / 60)
        : Math.round((entry.actual_hours || 0) * 60);
      const hoursCell = rounded
        ? `<span title="Billed hours rounded up to the firm's billing increment. Actual tracked time: ${entry.actual_hours}h">${entry.hours}h <span style="color:var(--ink-faint)">(${trackedM}m tracked)</span></span>`
        : `<span>${entry.hours}h</span>`;
      row.innerHTML = `
        <input type="checkbox" class="bl-entry-cb" data-id="${entry.id}" ${isSelected ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer">
        <div style="min-width:0">
          <div class="dk-reg-title" style="font-size:14px" title="${esc(entry.description)}">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px">${esc(entry.description)}</span>
          </div>
          <div class="dk-reg-meta">
            <span>${fmtDate(entry.entry_date)}</span>
            <span class="sep">·</span>
            ${userCell}
            <span class="sep">·</span>
            ${hoursCell}
            <span class="sep">·</span>
            <span>${rate}</span>
            ${noChargeBadge}
          </div>
        </div>
        <span style="font-family:var(--font-serif);font-weight:700;color:var(--money);white-space:nowrap">${fmtCurrency(entry.amount)}</span>`;
      reg.appendChild(row);
    });

    entriesList.innerHTML = '';
    entriesList.appendChild(reg);

    entriesList.querySelectorAll('.bl-entry-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) selectedEntryIds.add(cb.dataset.id);
        else            selectedEntryIds.delete(cb.dataset.id);
        updateSelectAll();
        updateReview();
      });
    });

    // Reassign a pulled entry to a different person: rebill at that person's
    // per-client rate. A no-charge entry keeps its zero amount — reassignment
    // only fixes the attribution.
    entriesList.querySelectorAll('.bl-entry-user').forEach(sel => {
      sel.addEventListener('change', () => {
        const entry = timeEntries.find(e => String(e.id) === sel.dataset.id);
        const s     = staffList.find(x => x.user_id === sel.value);
        if (!entry || !s) return;
        const [first, ...rest] = s.name.split(' ');
        entry.users   = { id: s.user_id, first_name: first, last_name: rest.join(' ') };
        entry.user_id = s.user_id;
        if (entry.billable !== false) {
          entry.rate           = s.rate || null;
          entry.effective_rate = s.rate || 0;
          entry.amount         = Math.round(entry.hours * (s.rate || 0) * 100) / 100;
        }
        renderTimeEntries();
      });
    });

    updateSelectAll();
    updateReview();
  }

  function updateSelectAll() {
    selectAllCb.indeterminate = selectedEntryIds.size > 0 && selectedEntryIds.size < timeEntries.length;
    selectAllCb.checked       = selectedEntryIds.size === timeEntries.length && timeEntries.length > 0;
  }

  selectAllCb.addEventListener('change', () => {
    if (selectAllCb.checked) {
      timeEntries.forEach(e => selectedEntryIds.add(e.id));
    } else {
      selectedEntryIds.clear();
    }
    renderTimeEntries();
  });

  function updateReview() {
    const selected    = timeEntries.filter(e => selectedEntryIds.has(e.id));
    const selectedExp = expenses.filter(e => selectedExpenseIds.has(e.id));
    const total       = selected.reduce((sum, e) => sum + e.amount, 0)
                      + selectedExp.reduce((sum, e) => sum + Number(e.amount), 0);

    if (selected.length === 0 && selectedExp.length === 0) {
      reviewSection.style.display = 'none';
      generateBtn.disabled = true;
      return;
    }

    const parts = [];
    if (selected.length)    parts.push(`${selected.length} entr${selected.length === 1 ? 'y' : 'ies'}`);
    if (selectedExp.length) parts.push(`${selectedExp.length} expense${selectedExp.length === 1 ? '' : 's'}`);

    reviewSection.style.display = '';
    reviewSummary.textContent   = `${parts.join(' + ')} selected`;
    reviewTotal.textContent     = fmtCurrency(total);
    generateBtn.disabled        = false;
  }

  generateBtn.addEventListener('click', async () => {
    const matterId    = matterSelect.value;
    const selected    = timeEntries.filter(e => selectedEntryIds.has(e.id));
    const selectedExp = expenses.filter(e => selectedExpenseIds.has(e.id));
    if (!matterId || (!selected.length && !selectedExp.length)) return;

    generateBtn.innerHTML  = '<span class="spinner"></span> Generating…';
    generateBtn.disabled   = true;

    try {
      const lineItems = [
        ...selected.map(e => ({
          time_entry_id: e.id,
          description:   e.description,
          hours:         e.hours,
          rate:          e.effective_rate || null,
          amount:        e.amount,
          item_type:     'time',
        })),
        ...selectedExp.map(e => ({
          expense_id:  e.id,
          description: `${CATEGORY_LABELS[e.category] || 'Expense'} — ${e.description}`,
          amount:      Number(e.amount),
          item_type:   'expense',
        })),
      ];

      const data = await apiPost('/api/create-invoice', {
        matter_id:   matterId,
        description: invDescription.value.trim() || 'Legal Services',
        due_date:    invDueDate.value || null,
        line_items:  lineItems,
        expense_ids: selectedExp.map(e => e.id),
      });

      Utils.toast('Invoice created as draft.', 'success');
      await loadInvoices();
      showPanel('list');
      // Use the freshly-loaded invoice (has matters/clients join) rather than the raw insert response
      const freshInvoice = allInvoices.find(i => i.id === data.invoice.id) || data.invoice;
      showDetail(freshInvoice);

    } catch (err) {
      Utils.toast('Failed to create invoice: ' + err.message, 'error');
      generateBtn.textContent = 'Generate Invoice';
      generateBtn.disabled = false;
    }
  });

  // ── Invoice detail ────────────────────────────────────────────────────────────
  function showDetail(invoice) {
    currentInvoice = invoice;

    const client   = invoice.matters?.clients;
    const clientName = client ? `${client.first_name} ${client.last_name}` : '—';
    const caseNum    = invoice.matters?.case_number || '';
    const isDraft    = invoice.status === 'draft';
    const lineItems  = (invoice.invoice_line_items || []).slice()
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const total      = lineItems.reduce((s, i) => s + Number(i.amount), 0) || invoice.amount;

    const lbl = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-faint);margin-bottom:var(--space-1)';
    detailContent.innerHTML = `
      <div class="dk-sec">
        <div style="border-top:2px solid var(--ink);background:var(--surface);border-radius:0 0 var(--r-card) var(--r-card);box-shadow:var(--card-shadow);padding:20px">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:var(--space-3)">
            <div>
              <div style="${lbl}">Invoice</div>
              <div style="font-family:var(--font-serif);font-weight:700;font-size:1.4rem;color:var(--money)">${fmtCurrency(invoice.amount)}</div>
              <div style="font-size:var(--text-sm);color:var(--ink-soft);margin-top:var(--space-1)">${esc(invoice.description || '')}</div>
            </div>
            <div style="text-align:right">
              ${statusBadge(invoice.status)}
              <div style="font-size:var(--text-sm);color:var(--ink-soft);margin-top:var(--space-2)">Created ${fmtDate(invoice.created_at)}</div>
              ${invoice.due_date ? `<div style="font-size:var(--text-sm);color:var(--ink-soft)">Due ${fmtDate(invoice.due_date)}</div>` : ''}
              ${invoice.paid_at  ? `<div style="font-size:var(--text-sm);color:var(--color-success);font-weight:600">Paid ${fmtDate(invoice.paid_at)}</div>` : ''}
              ${trustRelease(invoice) ? `<div style="font-size:var(--text-sm);color:var(--ink-soft)">Trust release recorded</div>` : ''}
            </div>
          </div>

          <div style="margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--line)">
            <div style="${lbl}">Client / Matter</div>
            <div style="font-family:var(--font-serif);font-weight:600;color:var(--ink)">${esc(clientName)}</div>
            ${caseNum ? `<div style="font-size:var(--text-sm);color:var(--ink-soft)">${esc(caseNum)}</div>` : ''}
          </div>

          ${invoice.payment_link ? `
          <div style="margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--line)">
            <div style="${lbl}">Payment Link</div>
            <div style="display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap">
              <a href="${esc(invoice.payment_link)}" target="_blank" rel="noopener noreferrer"
                style="font-size:var(--text-sm);color:var(--daily);word-break:break-all">${esc(invoice.payment_link)}</a>
              <button class="btn btn--ghost bl-copy-link" style="font-size:12px;padding:4px 10px;white-space:nowrap">Copy link</button>
            </div>
          </div>` : ''}

          ${invoice.pdf_document_id ? `
          <div style="margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--line)">
            <div style="${lbl}">Invoice PDF</div>
            <button class="btn btn--ghost bl-view-pdf" style="font-size:12px;padding:4px 10px">View PDF</button>
          </div>` : ''}
        </div>
      </div>

      ${isDraft ? `
      <div class="dk-sec">
        <div style="background:var(--surface);border:1px dashed var(--line);border-radius:var(--r-card);padding:14px 16px">
          <div style="${lbl}">Edit Details <span style="font-weight:400;text-transform:none;letter-spacing:0">— drafts can be adjusted until they're sent</span></div>
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:flex-end;margin-top:var(--space-2)">
            <div style="flex:1;min-width:220px">
              <label style="display:block;font-size:var(--text-sm);font-weight:600;color:var(--ink);margin-bottom:var(--space-2)">Description</label>
              <input id="bl-ed-desc" type="text" value="${esc(invoice.description || '')}"
                style="width:100%;padding:var(--space-2) var(--space-3);border:1px solid var(--line);border-radius:var(--radius);font-size:var(--text-sm);font-family:var(--font-sans);background:var(--surface);color:var(--ink);box-sizing:border-box">
            </div>
            <div>
              <label style="display:block;font-size:var(--text-sm);font-weight:600;color:var(--ink);margin-bottom:var(--space-2)">Due date</label>
              <input id="bl-ed-due" type="date" value="${invoice.due_date ? String(invoice.due_date).slice(0, 10) : ''}"
                style="padding:var(--space-2) var(--space-3);border:1px solid var(--line);border-radius:var(--radius);font-size:var(--text-sm);font-family:var(--font-sans);background:var(--surface);color:var(--ink)">
            </div>
            <button id="bl-ed-save" class="btn btn--secondary" style="font-size:13px">Save details</button>
          </div>
        </div>
      </div>` : ''}

      ${lineItems.length || isDraft ? `
      <div class="dk-sec">
        <div class="dk-sec-head"><h2>Line Items</h2><span class="dk-sec-rule"></span>
          ${isDraft ? '<button id="bl-li-add" class="btn btn--ghost" style="font-size:12px;padding:4px 10px;white-space:nowrap">+ Add items</button>' : ''}
        </div>
        <div id="bl-li-add-panel" style="display:none;margin-bottom:var(--space-3)"></div>
        <div class="dk-register">
          ${lineItems.map(li => `
            <div class="dk-reg-row" style="grid-template-columns:minmax(0,1fr) auto;align-items:center">
              <div style="min-width:0">
                <div class="dk-reg-title" style="font-size:14px">${esc(li.description)}</div>
                <div class="dk-reg-meta">
                  ${li.item_type === 'time'
                    ? `<span>${li.hours ? li.hours + 'h' : '—'}</span>
                       <span class="sep">·</span>
                       <span>${li.rate ? fmtCurrency(li.rate) + '/h' : '—'}</span>`
                    : `<span>${esc({ flat_fee: 'Flat fee', expense: 'Expense', other: 'Other' }[li.item_type] || li.item_type)}</span>`}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:10px">
                ${Number(li.amount) === 0
                  ? '<span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:1px 6px;border-radius:4px;background:var(--paper-deep);color:var(--ink-faint);white-space:nowrap">No charge</span>'
                  : `<span style="font-family:var(--font-serif);font-weight:600;color:var(--money);white-space:nowrap">${fmtCurrency(li.amount)}</span>`}
                ${isDraft ? `<button class="btn btn--ghost bl-li-remove" data-id="${li.id}" title="Remove from draft — the time or expense returns to unbilled" style="font-size:12px;padding:2px 8px;color:var(--color-danger)">✕</button>` : ''}
              </div>
            </div>`).join('')}
          ${!lineItems.length ? '<div class="dk-empty">No line items yet — use <strong>+ Add items</strong>.</div>' : ''}
          <div class="dk-reg-row" style="grid-template-columns:minmax(0,1fr) auto;align-items:center;background:var(--paper-deep)">
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-faint)">Total</span>
            <span style="font-family:var(--font-serif);font-weight:700;font-size:1.05rem;color:var(--money);white-space:nowrap">${fmtCurrency(total)}</span>
          </div>
        </div>
      </div>` : ''}`;

    // Copy payment link
    const copyBtn = detailContent.querySelector('.bl-copy-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(invoice.payment_link).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 2000);
        });
      });
    }

    // View the FreshBooks-mirrored invoice PDF (stored in the matter's Files)
    const pdfBtn = detailContent.querySelector('.bl-view-pdf');
    if (pdfBtn) {
      pdfBtn.addEventListener('click', async () => {
        pdfBtn.disabled = true;
        try {
          const data = await apiPost('/api/get-download-url', { document_id: invoice.pdf_document_id });
          window.open(data.download_url, '_blank', 'noopener');
        } catch (err) {
          Utils.toast('Failed to open PDF: ' + err.message, 'error');
        } finally {
          pdfBtn.disabled = false;
        }
      });
    }

    if (isDraft) wireDraftEditing(invoice);

    // Action buttons
    detailActions.innerHTML = '';
    if (invoice.status === 'draft') {
      const sendBtn = document.createElement('button');
      sendBtn.className   = 'btn btn--primary';
      sendBtn.textContent = 'Send Invoice';
      sendBtn.addEventListener('click', () => doSendInvoice(invoice.id));
      detailActions.appendChild(sendBtn);

      const voidBtn = document.createElement('button');
      voidBtn.className   = 'btn btn--ghost';
      voidBtn.textContent = 'Void';
      voidBtn.style.color = 'var(--color-danger)';
      voidBtn.addEventListener('click', () => doVoidInvoice(invoice.id));
      detailActions.appendChild(voidBtn);
    } else if (invoice.status === 'sent') {
      const payBtn = document.createElement('button');
      payBtn.className   = 'btn btn--primary';
      payBtn.textContent = 'Pay from Trust';
      payBtn.addEventListener('click', () => doReleaseInvoice(invoice));
      detailActions.appendChild(payBtn);

      const resendBtn = document.createElement('button');
      resendBtn.className   = 'btn btn--ghost';
      resendBtn.textContent = 'Resend Invoice';
      resendBtn.addEventListener('click', () => doResendInvoice(invoice.id));
      detailActions.appendChild(resendBtn);

      const voidBtn = document.createElement('button');
      voidBtn.className   = 'btn btn--ghost';
      voidBtn.textContent = 'Void Invoice';
      voidBtn.style.color = 'var(--color-danger)';
      voidBtn.addEventListener('click', () => doVoidInvoice(invoice.id));
      detailActions.appendChild(voidBtn);
    } else if (invoice.status === 'paid' && !trustRelease(invoice)) {
      // Card-paid invoice: money landed in trust; record the trust→operating
      // release once the funds have actually been moved at the bank.
      const relBtn = document.createElement('button');
      relBtn.className   = 'btn btn--secondary';
      relBtn.textContent = 'Record Trust Release';
      relBtn.addEventListener('click', () => doReleaseInvoice(invoice));
      detailActions.appendChild(relBtn);
    }

    showPanel('detail');
  }

  // The disbursement ledger entry citing this invoice, if one exists (needs the
  // trust_ledger_entries join from /api/get-invoices).
  function trustRelease(invoice) {
    return (invoice.trust_ledger_entries || []).find(e => e.entry_type === 'disbursement') || null;
  }

  // ── Draft editing (Review Pending Invoices) ───────────────────────────────────
  // Merge an update-draft-invoice response into the list and re-render the
  // detail. The response lacks the trust_ledger_entries join; spreading over
  // the cached row keeps it.
  function applyUpdatedInvoice(fresh, warnings) {
    (warnings || []).forEach(w => Utils.toast(w, 'info'));
    const idx = allInvoices.findIndex(i => i.id === fresh.id);
    if (idx >= 0) {
      allInvoices[idx] = { ...allInvoices[idx], ...fresh };
      showDetail(allInvoices[idx]);
    } else {
      showDetail(fresh);
    }
  }

  function wireDraftEditing(invoice) {
    // Header edits
    detailContent.querySelector('#bl-ed-save')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const data = await apiPost('/api/update-draft-invoice', {
          invoice_id:  invoice.id,
          description: detailContent.querySelector('#bl-ed-desc').value,
          due_date:    detailContent.querySelector('#bl-ed-due').value || null,
        });
        Utils.toast('Draft updated.', 'success');
        applyUpdatedInvoice(data.invoice, data.warnings);
      } catch (err) {
        Utils.toast('Update failed: ' + err.message, 'error');
        btn.disabled = false;
      }
    });

    // Remove a line — its time entry / expense returns to unbilled
    detailContent.querySelectorAll('.bl-li-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Utils.confirm('Remove this line from the draft? The underlying time or expense goes back to unbilled.', { confirmLabel: 'Remove Line' })) return;
        try {
          const data = await apiPost('/api/update-draft-invoice', {
            invoice_id: invoice.id,
            remove_line_item_ids: [btn.dataset.id],
          });
          Utils.toast('Line removed.', 'success');
          applyUpdatedInvoice(data.invoice, data.warnings);
        } catch (err) {
          Utils.toast('Remove failed: ' + err.message, 'error');
        }
      });
    });

    // Add items — unbilled time/expenses for this matter, plus a quick manual entry
    const addBtn   = detailContent.querySelector('#bl-li-add');
    const addPanel = detailContent.querySelector('#bl-li-add-panel');
    addBtn?.addEventListener('click', async () => {
      const opening = addPanel.style.display === 'none';
      addPanel.style.display = opening ? '' : 'none';
      if (opening) await loadDraftAddPanel(invoice, addPanel);
    });
  }

  async function loadDraftAddPanel(invoice, panel) {
    const matterId = invoice.matter_id || invoice.matters?.id;
    panel.innerHTML = '<div class="dk-empty">Loading unbilled items…</div>';

    let entries = [], staff = [], exp = [];
    try {
      const [timeData, expData] = await Promise.all([
        apiGet(`/api/get-unbilled-time?matter_id=${matterId}`),
        window.db.from('expenses')
          .select('id, expense_date, category, description, amount')
          .eq('matter_id', matterId).eq('billed', false)
          .order('expense_date', { ascending: true }),
      ]);
      entries = timeData.time_entries || [];
      staff   = timeData.staff || [];
      exp     = expData.data || [];
    } catch (err) {
      panel.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">Error: ${esc(err.message)}</div>`;
      return;
    }

    const inputStyle = 'padding:var(--space-2) var(--space-3);border:1px solid var(--line);border-radius:var(--radius);font-size:var(--text-sm);font-family:var(--font-sans);background:var(--surface);color:var(--ink);box-sizing:border-box';
    const rowHtml = (cb, title, meta, amount) => `
      <div class="dk-reg-row" style="grid-template-columns:auto minmax(0,1fr) auto;align-items:center">
        ${cb}
        <div style="min-width:0">
          <div class="dk-reg-title" style="font-size:14px">${title}</div>
          <div class="dk-reg-meta">${meta}</div>
        </div>
        <span style="font-family:var(--font-serif);font-weight:600;color:var(--money);white-space:nowrap">${amount}</span>
      </div>`;

    panel.innerHTML = `
      <div style="background:var(--paper-deep);border:1px solid var(--line);border-radius:var(--radius);padding:var(--space-3) var(--space-4)">
        ${entries.length || exp.length ? `
        <div class="dk-register" style="background:var(--surface);border-radius:var(--radius)">
          ${entries.map(e => {
            const who = e.users ? [e.users.first_name, e.users.last_name].filter(Boolean).join(' ') : '—';
            return rowHtml(
              `<input type="checkbox" class="bl-dadd-cb" data-kind="time" data-id="${esc(String(e.id))}" style="width:18px;height:18px;cursor:pointer">`,
              esc(e.description),
              `<span>${fmtDate(e.entry_date)}</span><span class="sep">·</span><span>${esc(who)}</span><span class="sep">·</span><span>${e.hours}h</span>`,
              fmtCurrency(e.amount));
          }).join('')}
          ${exp.map(x => rowHtml(
            `<input type="checkbox" class="bl-dadd-cb" data-kind="expense" data-id="${esc(x.id)}" style="width:18px;height:18px;cursor:pointer">`,
            esc(`${CATEGORY_LABELS[x.category] || 'Expense'} — ${x.description}`),
            `<span>${fmtDate(x.expense_date)}</span>`,
            fmtCurrency(x.amount))).join('')}
        </div>
        <div style="margin-top:var(--space-3)">
          <button id="bl-dadd-save" class="btn btn--primary" style="font-size:13px;padding:6px 14px">Add selected to invoice</button>
        </div>` : '<div class="dk-empty">No unbilled time or expenses on this matter.</div>'}

        <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--line)">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-faint);margin-bottom:var(--space-2)">Log new time entry</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-2);align-items:end">
            <input id="bl-dat-desc" type="text" placeholder="Description" style="${inputStyle};grid-column:1/-1;width:100%">
            <select id="bl-dat-user" style="${inputStyle};cursor:pointer">
              <option value="">Who…</option>
              ${staff.map(s => `<option value="${esc(s.user_id)}">${esc(s.name)}${s.rate ? ` — ${fmtCurrency(s.rate)}/h` : ''}</option>`).join('')}
            </select>
            <input id="bl-dat-minutes" type="number" min="1" max="1440" step="1" placeholder="Minutes" style="${inputStyle};width:100%">
            <input id="bl-dat-date" type="date" value="${new Date().toISOString().slice(0, 10)}" style="${inputStyle};width:100%">
            <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);color:var(--ink-soft);cursor:pointer;white-space:nowrap">
              <input type="checkbox" id="bl-dat-nocharge" style="width:16px;height:16px"> No charge
            </label>
          </div>
          <button id="bl-dat-save" class="btn btn--secondary" style="font-size:13px;padding:6px 14px;margin-top:var(--space-2)">Log Entry</button>
        </div>
      </div>`;

    // Add selected unbilled items to the draft
    panel.querySelector('#bl-dadd-save')?.addEventListener('click', async (e) => {
      const checked = [...panel.querySelectorAll('.bl-dadd-cb:checked')];
      if (!checked.length) return Utils.toast('Nothing selected.', 'error');
      const items = checked.map(cb => {
        if (cb.dataset.kind === 'time') {
          const en = entries.find(x => String(x.id) === cb.dataset.id);
          return {
            time_entry_id: en.id,
            description:   en.description,
            hours:         en.hours,
            rate:          en.effective_rate || null,
            amount:        en.amount,
            item_type:     'time',
          };
        }
        const x = exp.find(v => v.id === cb.dataset.id);
        return {
          expense_id:  x.id,
          description: `${CATEGORY_LABELS[x.category] || 'Expense'} — ${x.description}`,
          amount:      Number(x.amount),
          item_type:   'expense',
        };
      });
      e.currentTarget.disabled = true;
      try {
        const data = await apiPost('/api/update-draft-invoice', { invoice_id: invoice.id, add_items: items });
        Utils.toast(`${items.length} item${items.length === 1 ? '' : 's'} added.`, 'success');
        applyUpdatedInvoice(data.invoice, data.warnings);
      } catch (err) {
        Utils.toast('Add failed: ' + err.message, 'error');
        e.currentTarget.disabled = false;
      }
    });

    // Log a brand-new manual entry, then refresh the checklist so it can be added
    panel.querySelector('#bl-dat-save')?.addEventListener('click', async (e) => {
      const desc    = panel.querySelector('#bl-dat-desc').value.trim();
      const userId  = panel.querySelector('#bl-dat-user').value;
      const minutes = Number(panel.querySelector('#bl-dat-minutes').value);
      if (!desc)           return Utils.toast('Enter a description.', 'error');
      if (!userId)         return Utils.toast('Pick who the time belongs to.', 'error');
      if (!(minutes > 0))  return Utils.toast('Enter the minutes worked.', 'error');
      e.currentTarget.disabled = true;
      try {
        await apiPost('/api/add-time-entry', {
          matter_id:   matterId,
          user_id:     userId,
          description: desc,
          minutes,
          entry_date:  panel.querySelector('#bl-dat-date').value || null,
          no_charge:   panel.querySelector('#bl-dat-nocharge').checked,
        });
        Utils.toast('Time entry logged — select it above to add it to this draft.', 'success');
        await loadDraftAddPanel(invoice, panel);
      } catch (err) {
        Utils.toast('Failed to log time: ' + err.message, 'error');
        e.currentTarget.disabled = false;
      }
    });
  }

  async function doReleaseInvoice(invoice) {
    const recording = invoice.status === 'paid';
    const msg = recording
      ? `Record the trust → operating release of ${fmtCurrency(invoice.amount)} for this paid invoice? Do this after the funds have been moved at the bank — it posts a permanent trust ledger disbursement.`
      : `Pay this invoice from the client's trust funds? This posts a permanent ${fmtCurrency(invoice.amount)} trust ledger disbursement and marks the invoice paid. The actual trust → operating transfer happens at the bank.`;
    if (!await Utils.confirm(msg, { confirmLabel: recording ? 'Record Release' : 'Pay from Trust' })) return;

    // Optional check number for the ledger entry; Cancel = no check number.
    const check = await Utils.prompt('Check number (optional — Cancel to skip)', { confirmLabel: 'Continue', placeholder: 'e.g. 1042' });

    try {
      await apiPost('/api/release-invoice-trust', { invoice_id: invoice.id, check_number: check || null });
      Utils.toast(recording ? 'Trust release recorded.' : 'Invoice paid from trust.', 'success');
      await loadInvoices();
      const fresh = allInvoices.find(i => i.id === invoice.id);
      if (fresh) showDetail(fresh);
    } catch (err) {
      Utils.toast('Trust release failed: ' + err.message, 'error');
    }
  }

  async function doSendInvoice(invoiceId) {
    const btn = detailActions.querySelector('.btn--primary');
    if (btn) { btn.innerHTML = '<span class="spinner"></span> Sending…'; btn.disabled = true; }

    try {
      const data = await apiPost('/api/send-invoice', { invoice_id: invoiceId });
      Utils.toast('Invoice sent.', 'success');

      // Refresh the invoice in allInvoices and re-render detail
      const idx = allInvoices.findIndex(i => i.id === invoiceId);
      if (idx >= 0) {
        allInvoices[idx] = { ...allInvoices[idx], ...data.invoice };
        showDetail(allInvoices[idx]);
      }
    } catch (err) {
      Utils.toast('Send failed: ' + err.message, 'error');
      if (btn) { btn.textContent = 'Send Invoice'; btn.disabled = false; }
    }
  }

  async function doResendInvoice(invoiceId) {
    const btn = detailActions.querySelector('.btn--ghost');
    const orig = btn?.textContent;
    if (btn) { btn.textContent = 'Resending…'; btn.disabled = true; }

    try {
      const data = await apiPost('/api/resend-invoice', { invoice_id: invoiceId });
      Utils.toast('Invoice resent with a fresh payment link.', 'success');
      const idx = allInvoices.findIndex(i => i.id === invoiceId);
      if (idx >= 0) {
        allInvoices[idx] = { ...allInvoices[idx], ...data.invoice };
        showDetail(allInvoices[idx]);
      }
    } catch (err) {
      Utils.toast('Resend failed: ' + err.message, 'error');
      if (btn) { btn.textContent = orig; btn.disabled = false; }
    }
  }

  async function doVoidInvoice(invoiceId) {
    if (!await Utils.confirm('Void this invoice? This cannot be undone.', { confirmLabel: 'Void Invoice', danger: true })) return;

    try {
      const data = await apiPost('/api/void-invoice', { invoice_id: invoiceId });
      Utils.toast('Invoice voided.', 'success');

      const idx = allInvoices.findIndex(i => i.id === invoiceId);
      if (idx >= 0) {
        allInvoices[idx] = { ...allInvoices[idx], ...data.invoice };
        showDetail(allInvoices[idx]);
      }
    } catch (err) {
      Utils.toast('Void failed: ' + err.message, 'error');
    }
  }

  // ── From FreshBooks (biller composes/finalizes there; portal mirrors) ────────
  async function loadFbInvoices() {
    fbList.innerHTML = '<div class="dk-empty">Loading…</div>';
    try {
      const [data, matters] = await Promise.all([apiGet('/api/fb-unpaid-invoices'), fetchMatters()]);
      fbMatters = matters;
      if (!data.connected) {
        fbList.innerHTML = '<div class="dk-empty">FreshBooks isn\'t connected. Connect it in <strong>Settings → Billing &amp; Payments</strong>.</div>';
        return;
      }
      fbInvoices = data.invoices || [];
      renderFbInvoices();
    } catch (err) {
      fbList.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">Failed to load: ${esc(err.message)}</div>`;
    }
  }

  function renderFbInvoices() {
    if (!fbInvoices.length) {
      fbList.innerHTML = '<div class="dk-empty">No unpaid FreshBooks invoices to mirror.</div>';
      return;
    }

    const reg = document.createElement('div');
    reg.className = 'dk-register';

    fbInvoices.forEach(inv => {
      const matterOpts = fbMatters.map(m =>
        `<option value="${esc(m.id)}" ${inv.matter_guess?.id === m.id ? 'selected' : ''}>${esc(m.label)}</option>`
      ).join('');
      const row = document.createElement('div');
      row.className = 'dk-reg-row';
      row.style.gridTemplateColumns = 'minmax(0,1fr) auto';
      row.style.alignItems = 'center';
      row.innerHTML = `
        <div style="min-width:0">
          <div class="dk-reg-title">
            <span>${esc(inv.clientName || '—')}</span>
            <span class="dk-tag mut">${esc(inv.invoiceNumber)}</span>
            ${inv.v3Status === 'draft' ? '<span class="dk-tag">Draft</span>' : ''}
          </div>
          <div class="dk-reg-meta">
            <span>${fmtDate(inv.createdDate)}</span>
            <span class="sep">·</span>
            <span>${inv.v3Status === 'draft' ? 'not yet sent to client' : esc(inv.v3Status || '')}</span>
          </div>
          <select class="bl-fb-matter" data-ext="${esc(inv.externalId)}"
            style="margin-top:6px;width:100%;max-width:360px;padding:4px 26px 4px 8px;border:1px solid var(--line);border-radius:6px;font-size:12px;background:var(--surface);color:var(--ink)">
            <option value="">Choose a matter…</option>
            ${matterOpts}
          </select>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
          <span style="font-family:var(--font-serif);font-weight:700;color:var(--money);white-space:nowrap">${fmtCurrency(inv.outstanding || inv.amount)}</span>
          <button class="btn btn--primary bl-fb-attach" data-ext="${esc(inv.externalId)}" style="font-size:12px;padding:4px 10px;white-space:nowrap">Attach pay link &amp; send</button>
        </div>`;
      reg.appendChild(row);
    });

    fbList.innerHTML = '';
    fbList.appendChild(reg);

    fbList.querySelectorAll('.bl-fb-attach').forEach(btn => {
      btn.addEventListener('click', () => doMirrorFbInvoice(btn.dataset.ext));
    });
  }

  async function doMirrorFbInvoice(externalId) {
    const sel = fbList.querySelector(`.bl-fb-matter[data-ext="${CSS.escape(externalId)}"]`);
    const matterId = sel?.value;
    if (!matterId) return Utils.toast('Choose a matter first.', 'error');

    const btn = fbList.querySelector(`.bl-fb-attach[data-ext="${CSS.escape(externalId)}"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…'; }

    try {
      const data = await apiPost('/api/mirror-fb-invoice', { external_id: externalId, matter_id: matterId });
      (data.warnings || []).forEach(w => Utils.toast(w, 'info'));
      Utils.toast('Invoice mirrored and sent with a pay link.', 'success');
      fbInvoices = fbInvoices.filter(i => i.externalId !== externalId);
      renderFbInvoices();
      await loadInvoices();
      showPanel('list');
      const fresh = allInvoices.find(i => i.id === data.invoice.id) || data.invoice;
      showDetail(fresh);
    } catch (err) {
      Utils.toast('Failed: ' + err.message, 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Attach pay link & send'; }
    }
  }

  fbBtn.addEventListener('click', async () => { showPanel('fb'); await loadFbInvoices(); });
  fbBackBtn.addEventListener('click', () => showPanel('list'));

  // ── Navigation ────────────────────────────────────────────────────────────────
  newBtn.addEventListener('click', async () => {
    entriesSection.style.display  = 'none';
    expensesSection.style.display = 'none';
    reviewSection.style.display   = 'none';
    selectedEntryIds.clear();
    selectedExpenseIds.clear();
    timeEntries = [];
    expenses    = [];
    invDescription.value = 'Legal Services';
    invDueDate.value = '';
    showPanel('new');
    await matterPicker.load(); // clears the picker + loads open matters
  });

  newBackBtn.addEventListener('click', () => showPanel('list'));
  detailBackBtn.addEventListener('click', () => { showPanel('list'); renderInvoiceList(); });

  // ── Add expense ───────────────────────────────────────────────────────────────
  addExpenseBtn.addEventListener('click', async () => {
    expMatterSel.value = '';
    expDate.value      = new Date().toISOString().slice(0, 10);
    expCategory.value  = 'other';
    expAmount.value    = '';
    expDesc.value      = '';
    showPanel('expense');
    await loadMatters(expMatterSel);
  });

  expenseBackBtn.addEventListener('click', () => showPanel('list'));

  // ── Expenses register ─────────────────────────────────────────────────────────
  expListBtn.addEventListener('click', async () => { showPanel('explist'); await loadExpensesList(); });
  expListBackBtn.addEventListener('click', () => showPanel('list'));
  expListAddBtn.addEventListener('click', () => addExpenseBtn.click());

  async function loadExpensesList() {
    expList.innerHTML = '<div class="dk-empty">Loading…</div>';

    const { data, error } = await window.db
      .from('expenses')
      .select('id, expense_date, category, description, amount, billed, matters(id, case_number, clients(first_name, last_name)), invoices:invoice_id(invoice_number)')
      .order('expense_date', { ascending: false })
      .limit(200);

    if (error) {
      expList.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">Failed to load expenses: ${esc(error.message)}</div>`;
      return;
    }
    if (!data?.length) {
      expList.innerHTML = '<div class="dk-empty">No expenses logged yet. Use <strong>+ Add Expense</strong> to record a hard cost.</div>';
      return;
    }

    const reg = document.createElement('div');
    reg.className = 'dk-register';

    data.forEach(exp => {
      const client = exp.matters?.clients;
      const clientName = client ? `${client.first_name} ${client.last_name}` : '—';
      const row = document.createElement('div');
      row.className = 'dk-reg-row';
      row.innerHTML = `
        <div style="min-width:0">
          <div class="dk-reg-title">
            <span>${esc(clientName)}</span>
            ${exp.matters?.case_number ? `<span class="dk-tag mut">${esc(exp.matters.case_number)}</span>` : ''}
          </div>
          <div class="dk-reg-meta">
            <span>${fmtDate(exp.expense_date)}</span>
            <span class="sep">·</span>
            <span>${esc(CATEGORY_LABELS[exp.category] || exp.category)}</span>
            <span class="sep">·</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px">${esc(exp.description)}</span>
          </div>
        </div>
        <div class="dk-reg-act" style="align-items:center;gap:14px">
          <span style="font-family:var(--font-serif);font-weight:700;color:var(--money);white-space:nowrap">${fmtCurrency(exp.amount)}</span>
          ${exp.billed
            ? DK.tag(exp.invoices?.invoice_number ? `Billed · ${exp.invoices.invoice_number}` : 'Billed', 'ok')
            : DK.tag('Unbilled', 'warn')}
          ${exp.billed ? '' : `<button class="btn btn--ghost bl-exp-del" data-id="${exp.id}" style="font-size:12px;padding:4px 10px;color:var(--color-danger)">Delete</button>`}
        </div>`;
      reg.appendChild(row);
    });

    expList.innerHTML = '';
    expList.appendChild(reg);

    expList.querySelectorAll('.bl-exp-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Utils.confirm('Delete this unbilled expense?', { confirmLabel: 'Delete', danger: true })) return;
        // billed=false guard: refuses if it got billed since the list loaded
        const { error: delErr } = await window.db.from('expenses')
          .delete().eq('id', btn.dataset.id).eq('billed', false);
        if (delErr) Utils.toast('Delete failed: ' + delErr.message, 'error');
        else        Utils.toast('Expense deleted.', 'success');
        await loadExpensesList();
      });
    });
  }

  expSaveBtn.addEventListener('click', async () => {
    const matterId = expMatterSel.value;
    const amount   = Number(expAmount.value);
    const desc     = expDesc.value.trim();

    if (!matterId)            return Utils.toast('Choose a matter.', 'error');
    if (!(amount > 0))        return Utils.toast('Enter an amount greater than zero.', 'error');
    if (!desc)                return Utils.toast('Enter a description.', 'error');

    expSaveBtn.disabled = true;
    expSaveBtn.innerHTML = '<span class="spinner"></span> Saving…';

    try {
      const profile = await Auth.getProfile();
      const { error } = await window.db.from('expenses').insert({
        matter_id:    matterId,
        client_id:    matterClientIds.get(matterId) || null,
        expense_date: expDate.value || undefined,
        category:     expCategory.value,
        description:  desc,
        amount:       amount,
        created_by:   profile?.id || null,
      });
      if (error) throw new Error(error.message);
      Utils.toast('Expense saved — it will appear as unbilled on this matter’s next invoice.', 'success');
      showPanel('list');
    } catch (err) {
      Utils.toast('Failed to save expense: ' + err.message, 'error');
    } finally {
      expSaveBtn.disabled = false;
      expSaveBtn.textContent = 'Save Expense';
    }
  });

  // ── Billing mode ──────────────────────────────────────────────────────────────
  // The portal supports two invoice-authoring workflows, but no firm needs both,
  // and showing both was the bulk of the billing clutter (CONSOLIDATION-ANALYSIS
  // §1). One firm-level setting decides which entry point appears here. Neither
  // code path is removed — view/resend/void/payment tracking work in both modes.
  async function loadBillingMode() {
    try {
      const { data } = await db.from('firm_settings').select('billing_mode').limit(1).maybeSingle();
      const mode = data?.billing_mode;
      billingMode = (mode === 'portal' || mode === 'freshbooks_first') ? mode : null;
    } catch {
      billingMode = null;   // unreadable → show both, never strand the biller
    }
  }

  function applyBillingMode() {
    if (billingMode === 'portal') {
      fbBtn.style.display  = 'none';
    } else if (billingMode === 'freshbooks_first') {
      newBtn.style.display = 'none';
    }
    // billingMode === null → leave both buttons visible (pre-1536 behaviour).
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  renderFilterTabs();
  await loadBillingMode();
  applyBillingMode();
  await loadInvoices();

})();
