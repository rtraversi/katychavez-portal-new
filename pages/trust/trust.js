'use strict';

(async function TrustAccountingPage() {

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const loadingEl       = document.getElementById('ta-loading');
  const setupEl         = document.getElementById('ta-setup-required');
  const mainEl          = document.getElementById('ta-main');
  const newEntryBtn     = document.getElementById('ta-new-entry-btn');
  const reconcileBtn    = document.getElementById('ta-reconcile-btn');
  const addAccountBtn   = document.getElementById('ta-add-account-btn');
  const accountSelect   = document.getElementById('ta-account-select');
  const accountBar      = document.getElementById('ta-account-bar');

  const balancesLoading = document.getElementById('ta-balances-loading');
  const balancesEmpty   = document.getElementById('ta-balances-empty');
  const balancesTable   = document.getElementById('ta-balances-table');
  const balancesBody    = document.getElementById('ta-balances-body');

  const txnLoading      = document.getElementById('ta-txn-loading');
  const txnEmpty        = document.getElementById('ta-txn-empty');
  const txnTable        = document.getElementById('ta-txn-table');
  const txnBody         = document.getElementById('ta-txn-body');
  const loadMoreWrap    = document.getElementById('ta-load-more-wrap');

  const entryModal      = document.getElementById('ta-entry-modal');
  const entryForm       = document.getElementById('ta-entry-form');
  const entryTypeEl     = document.getElementById('ta-e-type');
  const entryMatterEl   = document.getElementById('ta-e-matter');
  const entryAmountEl   = document.getElementById('ta-e-amount');
  const entryDescEl     = document.getElementById('ta-e-description');
  const entryPayorEl    = document.getElementById('ta-e-payor');
  const entryCheckEl    = document.getElementById('ta-e-check');
  const invSection      = document.getElementById('ta-e-invoice-section');
  const invSelect       = document.getElementById('ta-e-invoice');
  const extRefEl        = document.getElementById('ta-e-ext-ref');
  const pathPortalEl    = document.getElementById('ta-e-path-portal');
  const pathExternalEl  = document.getElementById('ta-e-path-external');
  const entryErrorEl    = document.getElementById('ta-entry-error');

  const reconHistoryLoading = document.getElementById('ta-recon-history-loading');
  const reconHistoryEmpty   = document.getElementById('ta-recon-history-empty');
  const reconHistoryTable   = document.getElementById('ta-recon-history-table');
  const reconHistoryBody    = document.getElementById('ta-recon-history-body');

  const reconModal       = document.getElementById('ta-recon-modal');
  const reconForm        = document.getElementById('ta-recon-form');
  const reconBankEl      = document.getElementById('ta-r-bank');
  const reconDitEl       = document.getElementById('ta-r-dit');
  const reconOcEl        = document.getElementById('ta-r-oc');
  const reconAdjEl       = document.getElementById('ta-r-adjusted');
  const reconAdjDisp     = document.getElementById('ta-r-adjusted-display');
  const reconLedgerEl    = document.getElementById('ta-r-ledger');
  const reconLedgerDisp  = document.getElementById('ta-r-ledger-display');
  const reconClientEl    = document.getElementById('ta-r-client');
  const reconClientDisp  = document.getElementById('ta-r-client-display');
  const reconMatchEl     = document.getElementById('ta-r-match');
  const reconErrorEl     = document.getElementById('ta-recon-error');

  const accountModal    = document.getElementById('ta-account-modal');
  const accountForm     = document.getElementById('ta-account-form');
  const accountErrorEl  = document.getElementById('ta-account-error');

  // ── State ────────────────────────────────────────────────────────────────────
  const LIMIT = 25;
  let txnOffset      = 0;
  let trustAccounts  = [];
  let currentAcctId  = null;
  let matters        = [];
  let canWrite       = false;
  let canAdmin       = false;

  // Delegated click for recon history "Print Report" buttons (set once, survives reloads)
  reconHistoryBody.addEventListener('click', e => {
    const btn = e.target.closest('[data-recon-print]');
    if (btn) openReconReport(btn.dataset.reconPrint);
  });

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const profile  = await Auth.getProfile();
  const roleName = profile?.role?.name || '';
  canWrite = ['Owner', 'Attorney', 'Partner Attorney'].includes(roleName);
  canAdmin = roleName === 'Owner';

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function fmt(n) {
    if (n == null) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const TYPE_LABELS = {
    deposit:          'Deposit',
    disbursement:     'Disbursement',
    transfer_in:      'Transfer In',
    transfer_out:     'Transfer Out',
    adjustment_credit:'Adjustment +',
    adjustment_debit: 'Adjustment −',
  };

  function isCredit(type) {
    return ['deposit', 'transfer_in', 'adjustment_credit'].includes(type);
  }

  function matterLabel(m) {
    if (!m) return '—';
    const typeName = m.case_types?.name || m.case_type || '';
    return typeName + (m.case_number ? ' #' + m.case_number : '') || '—';
  }

  function showModal(el)  { el.classList.remove('hidden'); }
  function hideModal(el)  { el.classList.add('hidden'); }
  function showErr(el, m) { el.textContent = m; el.classList.remove('hidden'); }
  function clearErr(el)   { el.textContent = ''; el.classList.add('hidden'); }

  // ── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    const { data, error } = await db
      .from('trust_accounts')
      .select('*')
      .eq('is_active', true)
      .order('account_label');

    loadingEl.classList.add('hidden');

    if (error) { Utils.toast('Failed to load trust accounts', 'error'); return; }

    trustAccounts = data || [];

    if (trustAccounts.length === 0) {
      setupEl.classList.remove('hidden');
      addAccountBtn.style.display = canAdmin ? '' : 'none';
      return;
    }

    mainEl.classList.remove('hidden');
    if (canWrite) newEntryBtn.style.display = '';
    if (canWrite) document.getElementById('ta-export-btn').style.display = '';
    if (canAdmin) reconcileBtn.style.display = '';
    if (canAdmin) document.getElementById('ta-account-settings-btn').style.display = '';

    accountSelect.innerHTML = trustAccounts.map(a =>
      `<option value="${Utils.esc(a.id)}">${Utils.esc(a.account_label)} — ${Utils.esc(a.bank_name)} ****${a.account_number_last4}</option>`
    ).join('');

    if (trustAccounts.length === 1) accountBar.style.display = 'none';
    currentAcctId = trustAccounts[0].id;

    // Pre-load non-closed matters for entry modal (trust entries can occur on active, pending, or open matters)
    const { data: mData } = await db
      .from('matters')
      .select('id, case_type_id, case_number, case_types!case_type_id(name), client_id, clients(first_name, last_name)')
      .neq('status', 'closed')
      .order('case_number');
    matters = mData || [];

    entryMatterEl.innerHTML = '<option value="">Select matter…</option>' +
      matters.map(m => {
        const cn = m.clients ? `${m.clients.first_name} ${m.clients.last_name}` : '';
        const label = cn ? `${cn} — ${matterLabel(m)}` : matterLabel(m);
        return `<option value="${Utils.esc(m.id)}">${Utils.esc(label)}</option>`;
      }).join('');

    await Promise.all([loadSummary(), loadBalances(), loadTransactions(true), loadStaleChecks(), loadReconHistory()]);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  async function loadSummary() {
    const [balRes, invRes, reconRes] = await Promise.all([
      db.from('matter_trust_balances').select('balance'),
      db.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      db.from('trust_reconciliations')
        .select('period_end, all_match')
        .eq('trust_account_id', currentAcctId)
        .order('period_end', { ascending: false })
        .limit(1),
    ]);

    const total = (balRes.data || []).reduce((s, r) => s + Number(r.balance || 0), 0);
    document.getElementById('ta-stat-total').textContent = fmt(total);
    renderBufferAlert(total);

    const n = invRes.count ?? 0;
    document.getElementById('ta-stat-invoices').textContent = n === 0 ? 'None open' : `${n} open`;

    const recon = reconRes.data?.[0];
    const reconEl = document.getElementById('ta-stat-recon');
    if (!recon) {
      reconEl.innerHTML = '<span class="text-muted" style="font-size:var(--font-size-sm);font-weight:400">Never reconciled</span>';
    } else {
      const color = recon.all_match ? 'var(--color-success)' : 'var(--color-danger)';
      const icon  = recon.all_match ? '✓' : '✗';
      reconEl.innerHTML = `<span style="color:${color};margin-right:4px">${icon}</span>${Utils.formatDate(recon.period_end)}`;
    }
  }

  // ── Client balances ───────────────────────────────────────────────────────────
  async function loadBalances() {
    balancesLoading.style.display = '';
    balancesTable.classList.add('hidden');
    balancesEmpty.classList.add('hidden');

    const { data, error } = await db
      .from('matter_trust_balances')
      .select('matter_id, balance, entry_count, last_transaction_at')
      .gt('balance', 0)
      .order('balance', { ascending: false });

    balancesLoading.style.display = 'none';

    if (error || !data || data.length === 0) {
      if (error) Utils.toast('Failed to load client balances', 'error');
      balancesEmpty.classList.remove('hidden');
      return;
    }

    const ids = data.map(r => r.matter_id);
    const { data: mData } = await db
      .from('matters')
      .select('id, case_type_id, case_number, case_types!case_type_id(name), client_id, clients(first_name, last_name)')
      .in('id', ids);
    const mMap = Object.fromEntries((mData || []).map(m => [m.id, m]));

    balancesBody.innerHTML = data.map(row => {
      const m  = mMap[row.matter_id];
      const cn = m?.clients ? `${m.clients.first_name} ${m.clients.last_name}` : '—';
      const ml = matterLabel(m);
      const clientHref = m?.client_id ? `#clients/${Utils.esc(m.client_id)}` : '#clients';
      return `<tr>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border)">
          <div style="font-weight:500">${Utils.esc(cn)}</div>
          <div class="text-muted text-sm">${Utils.esc(ml)}</div>
        </td>
        <td style="padding:var(--space-3) var(--space-5);text-align:right;font-weight:700;border-bottom:1px solid var(--color-border)">${fmt(row.balance)}</td>
        <td style="padding:var(--space-3) var(--space-5);color:var(--color-text-muted);font-size:var(--font-size-sm);border-bottom:1px solid var(--color-border)">
          ${row.last_transaction_at ? Utils.formatDate(row.last_transaction_at) : '—'}
        </td>
        <td style="padding:var(--space-3) var(--space-5);text-align:right;border-bottom:1px solid var(--color-border)">
          <button class="btn btn--ghost btn--sm" data-subledger-matter="${Utils.esc(row.matter_id)}" data-subledger-client="${Utils.esc(cn)}" data-subledger-matter-name="${Utils.esc(ml)}">Ledger</button>
          <a href="${clientHref}" class="btn btn--ghost btn--sm" style="margin-left:var(--space-1)">Client</a>
        </td>
      </tr>`;
    }).join('');

    balancesTable.classList.remove('hidden');
  }

  // ── Transactions ──────────────────────────────────────────────────────────────
  async function loadTransactions(reset) {
    if (reset) { txnOffset = 0; txnBody.innerHTML = ''; }
    txnLoading.style.display = '';
    if (reset) { txnTable.classList.add('hidden'); txnEmpty.classList.add('hidden'); }

    const { data, error } = await db
      .from('trust_ledger_entries')
      .select('id, created_at, matter_id, entry_type, amount, balance_after, description, invoice_id, external_invoice_ref')
      .eq('trust_account_id', currentAcctId)
      .order('created_at', { ascending: false })
      .range(txnOffset, txnOffset + LIMIT - 1);

    txnLoading.style.display = 'none';

    if (error) { Utils.toast('Failed to load transactions', 'error'); return; }

    if (!data || (data.length === 0 && txnOffset === 0)) {
      txnEmpty.classList.remove('hidden');
      loadMoreWrap.classList.add('hidden');
      return;
    }

    if (data.length > 0) {
      const mids = [...new Set(data.map(r => r.matter_id))];
      const { data: mData } = await db
        .from('matters')
        .select('id, case_type_id, case_number, case_types!case_type_id(name), clients(first_name, last_name)')
        .in('id', mids);
      const mMap = Object.fromEntries((mData || []).map(m => [m.id, m]));

      txnBody.insertAdjacentHTML('beforeend', data.map(row => {
        const m     = mMap[row.matter_id];
        const cn    = m?.clients ? `${m.clients.first_name} ${m.clients.last_name}` : '—';
        const credit = isCredit(row.entry_type);
        const color  = credit ? 'var(--color-success)' : 'var(--color-danger)';
        const sign   = credit ? '+' : '−';
        const invTag = row.invoice_id
          ? `<span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;background:rgba(22,163,74,.12);color:var(--color-success);margin-left:4px;vertical-align:middle">INV</span>`
          : row.external_invoice_ref
          ? `<span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;background:var(--color-bg-subtle,#f1f5f0);color:var(--color-text-muted);margin-left:4px;vertical-align:middle">EXT</span>`
          : '';
        return `<tr>
          <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);color:var(--color-text-muted);font-size:var(--font-size-sm);white-space:nowrap">${Utils.formatDate(row.created_at)}</td>
          <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border)">
            <div style="font-weight:500">${Utils.esc(cn)}</div>
            <div class="text-muted text-sm">${Utils.esc(matterLabel(m))}</div>
          </td>
          <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);white-space:nowrap">
            <span style="font-size:var(--font-size-sm);font-weight:500;color:${color}">${TYPE_LABELS[row.entry_type] || row.entry_type}</span>${invTag}
          </td>
          <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);max-width:220px">
            <span class="text-sm">${Utils.esc(Utils.truncate(row.description, 60))}</span>
          </td>
          <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:right;font-weight:600;color:${color};white-space:nowrap">
            ${sign}${fmt(row.amount).slice(1)}
          </td>
          <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:right;white-space:nowrap">${fmt(row.balance_after)}</td>
        </tr>`;
      }).join(''));

      txnOffset += data.length;
    }

    txnTable.classList.remove('hidden');
    loadMoreWrap.classList.toggle('hidden', data.length < LIMIT);
  }

  // ── New entry modal ───────────────────────────────────────────────────────────
  function openEntryModal() {
    entryForm.reset();
    clearErr(entryErrorEl);
    invSection.classList.add('hidden');
    pathPortalEl.classList.remove('hidden');
    pathExternalEl.classList.add('hidden');
    showModal(entryModal);
  }

  entryTypeEl.addEventListener('change', () => {
    const isDisbursement = entryTypeEl.value === 'disbursement';
    invSection.classList.toggle('hidden', !isDisbursement);
    if (isDisbursement) loadInvoicesForMatter();
  });

  entryMatterEl.addEventListener('change', () => {
    if (entryTypeEl.value === 'disbursement') loadInvoicesForMatter();
  });

  document.querySelectorAll('input[name="ta-e-inv-path"]').forEach(r => {
    r.addEventListener('change', () => {
      const isPortal = document.querySelector('input[name="ta-e-inv-path"]:checked').value === 'portal';
      pathPortalEl.classList.toggle('hidden', !isPortal);
      pathExternalEl.classList.toggle('hidden', isPortal);
    });
  });

  async function loadInvoicesForMatter() {
    const mid = entryMatterEl.value;
    if (!mid) { invSelect.innerHTML = '<option value="">Select sent invoice…</option>'; return; }
    const { data } = await db
      .from('invoices')
      .select('id, invoice_number, amount, description')
      .eq('matter_id', mid)
      .in('status', ['sent', 'paid'])
      .order('created_at', { ascending: false });
    invSelect.innerHTML = '<option value="">Select sent invoice…</option>' +
      (data || []).map(inv =>
        `<option value="${Utils.esc(inv.id)}">${Utils.esc(inv.invoice_number)} — ${fmt(inv.amount)} — ${Utils.esc(Utils.truncate(inv.description, 40))}</option>`
      ).join('');
  }

  entryForm.addEventListener('submit', async e => {
    e.preventDefault();
    clearErr(entryErrorEl);

    const type   = entryTypeEl.value;
    const matter = entryMatterEl.value;
    const amount = parseFloat(entryAmountEl.value);
    const desc   = entryDescEl.value.trim();

    if (!type || !matter || isNaN(amount) || !desc) {
      showErr(entryErrorEl, 'Entry type, client/matter, amount, and description are required.');
      return;
    }
    if (amount <= 0) { showErr(entryErrorEl, 'Amount must be greater than zero.'); return; }

    let invoiceId = null, externalRef = null;
    if (type === 'disbursement') {
      const path = document.querySelector('input[name="ta-e-inv-path"]:checked').value;
      if (path === 'portal') {
        invoiceId = invSelect.value || null;
        if (!invoiceId) { showErr(entryErrorEl, 'Select a sent invoice for this disbursement.'); return; }
      } else {
        externalRef = extRefEl.value.trim() || null;
        if (!externalRef) { showErr(entryErrorEl, 'Enter an external invoice reference for this disbursement.'); return; }
      }
    }

    const saveBtn = document.getElementById('ta-entry-save');
    Utils.setLoading(saveBtn, true);

    const { error } = await db.from('trust_ledger_entries').insert({
      trust_account_id:     currentAcctId,
      matter_id:            matter,
      entry_type:           type,
      amount:               amount,
      description:          desc,
      payor_payee:          entryPayorEl.value.trim() || null,
      check_number:         entryCheckEl.value.trim() || null,
      invoice_id:           invoiceId,
      external_invoice_ref: externalRef,
      created_by:           profile.id,
    });

    Utils.setLoading(saveBtn, false);

    if (error) {
      // Surface the DB-level IOLTA violation message directly — it's user-readable
      const raw = error.message || '';
      const msg = raw.includes('IOLTA VIOLATION')
        ? raw.replace(/^ERROR:\s+/i, '')
        : 'Failed to save entry. ' + raw;
      showErr(entryErrorEl, msg);
      return;
    }

    hideModal(entryModal);
    Utils.toast('Entry saved', 'success');
    await Promise.all([loadSummary(), loadBalances(), loadTransactions(true)]);
  });

  document.getElementById('ta-entry-close').addEventListener('click',  () => hideModal(entryModal));
  document.getElementById('ta-entry-cancel').addEventListener('click', () => hideModal(entryModal));
  newEntryBtn.addEventListener('click', openEntryModal);

  // ── Reconciliation history ────────────────────────────────────────────────────
  async function loadReconHistory() {
    reconHistoryLoading.style.display = '';
    reconHistoryTable.classList.add('hidden');
    reconHistoryEmpty.classList.add('hidden');

    const { data, error } = await db
      .from('trust_reconciliations')
      .select('id, period_start, period_end, period_type, adjusted_bank_balance, ledger_balance, client_ledger_sum, all_match, created_at')
      .eq('trust_account_id', currentAcctId)
      .order('period_end', { ascending: false });

    reconHistoryLoading.style.display = 'none';

    if (error || !data || data.length === 0) {
      reconHistoryEmpty.classList.remove('hidden');
      return;
    }

    reconHistoryBody.innerHTML = data.map(r => {
      const period = `${Utils.formatDate(r.period_start)} – ${Utils.formatDate(r.period_end)}`;
      const typeTag = r.period_type === 'quarterly'
        ? `<span style="font-size:10px;padding:1px 5px;border-radius:4px;background:var(--color-bg-subtle,#f1f5f0);color:var(--color-text-muted);margin-left:4px">Q</span>`
        : '';
      const matchColor = r.all_match ? 'var(--color-success)' : 'var(--color-danger)';
      const matchIcon  = r.all_match ? '✓' : '✗';
      return `<tr>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border)">
          <span style="font-weight:500">${period}</span>${typeTag}
        </td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:right">${fmt(r.adjusted_bank_balance)}</td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:right">${fmt(r.ledger_balance)}</td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:right">${fmt(r.client_ledger_sum)}</td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:center;font-weight:700;color:${matchColor}">${matchIcon}</td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:right">
          <button class="btn btn--ghost btn--sm" data-recon-print="${Utils.esc(r.id)}">Print Report</button>
        </td>
      </tr>`;
    }).join('');

    reconHistoryTable.classList.remove('hidden');
  }

  async function openReconReport(reconId) {
    const acct = trustAccounts.find(a => a.id === currentAcctId);

    const [reconRes, balRes] = await Promise.all([
      db.from('trust_reconciliations')
        .select('*, users!completed_by(first_name, last_name)')
        .eq('id', reconId)
        .single(),
      db.from('matter_trust_balances')
        .select('matter_id, balance, last_transaction_at')
        .gt('balance', 0)
        .order('balance', { ascending: false }),
    ]);

    const recon = reconRes.data;
    if (!recon) { Utils.toast('Could not load reconciliation', 'error'); return; }

    const balRows = balRes.data || [];
    let mMap = {};
    if (balRows.length > 0) {
      const { data: mData } = await db
        .from('matters')
        .select('id, case_type_id, case_number, case_types!case_type_id(name), clients(first_name, last_name)')
        .in('id', balRows.map(b => b.matter_id));
      mMap = Object.fromEntries((mData || []).map(m => [m.id, m]));
    }

    const firmName   = (window.APP_CONFIG?.firmName) || 'Law Firm';
    const acctLabel  = acct ? `${acct.account_label} — ${acct.bank_name} ****${acct.account_number_last4}` : 'Trust Account';
    const preparerUser = recon.users;
    const preparer   = preparerUser ? `${preparerUser.first_name} ${preparerUser.last_name}` : 'Staff';
    const printDate  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const periodStr  = `${Utils.formatDate(recon.period_start)} – ${Utils.formatDate(recon.period_end)}`;

    const matchStyle = recon.all_match
      ? 'background:#dcfce7;border:1px solid #86efac;color:#15803d'
      : 'background:#fee2e2;border:1px solid #fca5a5;color:#b91c1c';
    const matchText  = recon.all_match
      ? '✓ THREE-WAY RECONCILIATION BALANCES — All figures agree within $0.01'
      : '✗ RECONCILIATION DOES NOT BALANCE — Review entries before signing';

    const clientRows = balRows.map(b => {
      const m  = mMap[b.matter_id];
      const cn = m?.clients ? `${m.clients.first_name} ${m.clients.last_name}` : '—';
      const ml = matterLabel(m);
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${cn}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#6b7280">${ml}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${fmt(b.balance)}</td>
      </tr>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Trust Reconciliation Report — ${periodStr}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #111; margin: 0; padding: 0; }
  @page { size: letter; margin: 1in; }
  @media print { .no-print { display: none !important; } }
  .page { max-width: 7.5in; margin: 0 auto; padding: 24px; }
  h1 { font-size: 16pt; font-weight: bold; text-align: center; margin: 0 0 4px; }
  h2 { font-size: 12pt; font-weight: bold; margin: 0 0 2px; }
  .subtitle { text-align: center; color: #374151; margin-bottom: 20px; font-size: 11pt; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 20px; font-size: 11pt; }
  .meta-grid .label { color: #6b7280; }
  hr { border: none; border-top: 2px solid #111; margin: 16px 0; }
  hr.thin { border-top: 1px solid #d1d5db; }
  .section { margin-bottom: 20px; }
  .section-title { font-weight: bold; font-size: 11pt; border-bottom: 1px solid #111; padding-bottom: 4px; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.04em; }
  .formula-row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 11pt; }
  .formula-row.total { border-top: 1px solid #111; font-weight: bold; margin-top: 4px; }
  .amount { font-family: 'Courier New', monospace; min-width: 100px; text-align: right; }
  .match-box { padding: 10px 14px; border-radius: 6px; text-align: center; font-weight: bold; font-size: 11pt; margin: 16px 0; ${matchStyle} }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  thead th { text-align: left; padding: 6px 10px; background: #f3f4f6; border-bottom: 2px solid #111; font-weight: bold; }
  .notes-box { border: 1px solid #d1d5db; border-radius: 4px; padding: 10px 14px; min-height: 60px; font-size: 11pt; white-space: pre-wrap; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
  .sig-line { border-top: 1px solid #111; padding-top: 6px; font-size: 10pt; color: #374151; }
  .print-btn { display: block; margin: 20px auto; padding: 10px 28px; background: #1d4ed8; color: #fff; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; font-family: sans-serif; }
</style>
</head>
<body>
<div class="page">

  <button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>

  <h1>${firmName}</h1>
  <p class="subtitle">Three-Way Trust Account Reconciliation Worksheet</p>

  <div class="meta-grid">
    <div><span class="label">Trust Account:</span><br><strong>${acctLabel}</strong></div>
    <div><span class="label">Reconciliation Period:</span><br><strong>${periodStr}</strong></div>
    <div><span class="label">Prepared By:</span><br><strong>${preparer}</strong></div>
    <div><span class="label">Date Printed:</span><br><strong>${printDate}</strong></div>
  </div>

  <hr>

  <!-- Section A: Bank Adjustment -->
  <div class="section">
    <div class="section-title">A — Bank Statement Reconciliation</div>
    <div class="formula-row">
      <span>Bank Statement Balance (as of ${Utils.formatDate(recon.period_end)})</span>
      <span class="amount">${fmt(recon.bank_statement_balance)}</span>
    </div>
    <div class="formula-row">
      <span>+ Deposits in Transit (recorded in books, not yet on statement)</span>
      <span class="amount">${fmt(recon.deposits_in_transit)}</span>
    </div>
    <div class="formula-row">
      <span>− Outstanding Checks (issued but not yet cleared by bank)</span>
      <span class="amount">(${fmt(recon.outstanding_checks)})</span>
    </div>
    <div class="formula-row total">
      <span>= Adjusted Bank Balance</span>
      <span class="amount">${fmt(recon.adjusted_bank_balance)}</span>
    </div>
  </div>

  <!-- Section B: Firm Ledger -->
  <div class="section">
    <div class="section-title">B — Firm Trust Ledger Balance</div>
    <div class="formula-row">
      <span>Total per firm trust ledger (sum of all ledger entries through ${Utils.formatDate(recon.period_end)})</span>
      <span class="amount">${fmt(recon.ledger_balance)}</span>
    </div>
  </div>

  <!-- Section C: Client Ledger Sum -->
  <div class="section">
    <div class="section-title">C — Sum of Client Ledger Balances</div>
    <div class="formula-row">
      <span>Total of all individual client matter balances</span>
      <span class="amount">${fmt(recon.client_ledger_sum)}</span>
    </div>
  </div>

  <!-- Match verdict -->
  <div class="match-box">${matchText}</div>
  <p style="font-size:10pt;color:#6b7280;margin:0 0 20px;text-align:center">A = B = C required. Tolerance: ±$0.01 for rounding.</p>

  <!-- Per-client breakdown -->
  ${balRows.length > 0 ? `
  <div class="section">
    <div class="section-title">Client Sub-Ledger Balances (current)</div>
    <p style="font-size:9.5pt;color:#6b7280;margin:0 0 8px">Balances shown are current at time of printing. They should match client_ledger_sum above if no transactions have occurred after the period end.</p>
    <table>
      <thead><tr><th>Client</th><th>Matter</th><th style="text-align:right">Balance</th></tr></thead>
      <tbody>${clientRows}</tbody>
      <tfoot><tr>
        <td colspan="2" style="padding:8px 10px;font-weight:bold;border-top:2px solid #111">Total</td>
        <td style="padding:8px 10px;font-weight:bold;border-top:2px solid #111;text-align:right;font-family:'Courier New',monospace">${fmt(balRows.reduce((s,b) => s + Number(b.balance||0), 0))}</td>
      </tr></tfoot>
    </table>
  </div>
  ` : ''}

  <!-- Notes -->
  <div class="section">
    <div class="section-title">Notes</div>
    <div class="notes-box">${recon.notes ? Utils.esc(recon.notes) : ''}</div>
  </div>

  <!-- Signature -->
  <div class="sig-grid">
    <div>
      <div class="sig-line">Preparer Signature</div>
    </div>
    <div>
      <div class="sig-line">Date Signed</div>
    </div>
    <div>
      <div class="sig-line">Supervising Attorney Signature (if applicable)</div>
    </div>
    <div>
      <div class="sig-line">Date Signed</div>
    </div>
  </div>

  <p style="font-size:9pt;color:#6b7280;margin-top:30px;text-align:center">
    This report was generated by ${firmName}'s practice management system.
    Retain per applicable state bar record-retention rules (${acct?.retention_years || 5} years for this jurisdiction).
  </p>

</div>
<script>
  // auto-print when opened directly
  if (window.opener) setTimeout(() => window.print(), 400);
</script>
</body>
</html>`;

    const w = window.open('', '_blank', 'width=900,height=750');
    w.document.write(html);
    w.document.close();
  }

  // ── Firm buffer alert ─────────────────────────────────────────────────────────
  const bufferAlertEl  = document.getElementById('ta-buffer-alert');
  const bufferAlertTxt = document.getElementById('ta-buffer-alert-text');

  function renderBufferAlert(ledgerBalance) {
    const acct   = trustAccounts.find(a => a.id === currentAcctId);
    if (!acct) return;
    const minBal = Number(acct.minimum_balance ?? 100);

    // Warn when available-to-disburse (ledger − buffer) is within 2× buffer
    const available = ledgerBalance - minBal;
    if (available <= minBal && minBal > 0) {
      const color = available <= 0 ? 'var(--color-danger)' : '#b45309';
      bufferAlertTxt.innerHTML = available <= 0
        ? `<strong style="color:${color}">Trust balance has fallen below the firm buffer of ${fmt(minBal)}.</strong> The firm's own funds (kept to cover bank fees) may be depleted. Review entries immediately.`
        : `<strong style="color:${color}">Trust balance is approaching the firm buffer.</strong> Available balance after buffer: <strong>${fmt(available)}</strong> (buffer: ${fmt(minBal)}). Review before the next disbursement.`;
      bufferAlertEl.style.display = 'flex';
      bufferAlertEl.classList.remove('hidden');
    } else {
      bufferAlertEl.classList.add('hidden');
      bufferAlertEl.style.display = '';
    }
  }

  // ── Stale / outstanding checks ────────────────────────────────────────────────
  async function loadStaleChecks() {
    const acct = trustAccounts.find(a => a.id === currentAcctId);
    const staleDays = Number(acct?.stale_check_days ?? 90);

    const staleCard    = document.getElementById('ta-stale-card');
    const staleLoading = document.getElementById('ta-stale-loading');
    const staleEmpty   = document.getElementById('ta-stale-empty');
    const staleTable   = document.getElementById('ta-stale-table');
    const staleBody    = document.getElementById('ta-stale-body');
    const staleSubtitle= document.getElementById('ta-stale-subtitle');

    staleCard.style.display = '';
    staleLoading.style.display = '';
    staleTable.classList.add('hidden');
    staleEmpty.classList.add('hidden');

    // Outstanding = disbursements with a check number and no cleared_at
    const { data, error } = await db
      .from('trust_ledger_entries')
      .select('id, created_at, matter_id, amount, description, payor_payee, check_number')
      .eq('trust_account_id', currentAcctId)
      .eq('entry_type', 'disbursement')
      .not('check_number', 'is', null)
      .is('cleared_at', null)
      .order('created_at', { ascending: true });

    staleLoading.style.display = 'none';

    if (error || !data || data.length === 0) {
      staleEmpty.classList.remove('hidden');
      staleSubtitle.textContent = 'No outstanding checks.';
      return;
    }

    const today = new Date();
    const mids  = [...new Set(data.map(r => r.matter_id))];
    const { data: mData } = await db
      .from('matters')
      .select('id, case_type_id, case_number, case_types!case_type_id(name), clients(first_name, last_name)')
      .in('id', mids);
    const mMap = Object.fromEntries((mData || []).map(m => [m.id, m]));

    const staleCount = data.filter(r => {
      const days = Math.floor((today - new Date(r.created_at)) / 86400000);
      return days >= staleDays;
    }).length;

    staleSubtitle.textContent = staleCount > 0
      ? `${data.length} outstanding · ${staleCount} stale (>${staleDays} days)`
      : `${data.length} outstanding · none stale yet`;

    staleBody.innerHTML = data.map(r => {
      const m    = mMap[r.matter_id];
      const cn   = m?.clients ? `${m.clients.first_name} ${m.clients.last_name}` : '—';
      const ml   = Utils.esc(Utils.truncate(matterLabel(m), 35));
      const days = Math.floor((today - new Date(r.created_at)) / 86400000);
      const isStale = days >= staleDays;
      const daysColor = isStale ? 'var(--color-danger)' : days >= staleDays * 0.75 ? '#b45309' : 'var(--color-text-muted)';
      const staleTag  = isStale ? `<span style="display:inline-block;font-size:10px;padding:1px 5px;border-radius:4px;background:rgba(220,38,38,.1);color:var(--color-danger);margin-left:4px;font-weight:600">STALE</span>` : '';
      return `<tr>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);white-space:nowrap;font-size:var(--font-size-sm);color:var(--color-text-muted)">${Utils.formatDate(r.created_at)}</td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border)">
          <div style="font-weight:500">${Utils.esc(cn)}</div>
          <div class="text-muted text-sm">${ml}</div>
        </td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);font-size:var(--font-size-sm);font-weight:500">${Utils.esc(r.check_number)}</td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);font-size:var(--font-size-sm);color:var(--color-text-muted)">${Utils.esc(r.payor_payee || '—')}</td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:right;font-weight:600;color:var(--color-danger)">−${fmt(r.amount).slice(1)}</td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:center;font-weight:600;color:${daysColor}">${days}${staleTag}</td>
        <td style="padding:var(--space-3) var(--space-5);border-bottom:1px solid var(--color-border);text-align:right">
          <button class="btn btn--ghost btn--sm" data-clear-entry="${Utils.esc(r.id)}" data-clear-check="${Utils.esc(r.check_number)}" data-clear-amount="${r.amount}" data-clear-payee="${Utils.esc(r.payor_payee || '')}" data-clear-matter="${Utils.esc(cn)}">Update</button>
        </td>
      </tr>`;
    }).join('');

    staleTable.classList.remove('hidden');
  }

  // ── Clear / void check modal ──────────────────────────────────────────────────
  const clearModal   = document.getElementById('ta-clear-modal');
  const clearEntryEl = document.getElementById('ta-clear-entry-id');
  const clearInfoEl  = document.getElementById('ta-clear-info');
  const clearDateEl  = document.getElementById('ta-clear-date');
  const clearDateWrap= document.getElementById('ta-clear-date-wrap');
  const clearErrorEl = document.getElementById('ta-clear-error');
  const clearConfBtn = document.getElementById('ta-clear-confirm');

  document.getElementById('ta-stale-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-clear-entry]');
    if (!btn) return;
    openClearModal({
      id:     btn.dataset.clearEntry,
      check:  btn.dataset.clearCheck,
      amount: btn.dataset.clearAmount,
      payee:  btn.dataset.clearPayee,
      matter: btn.dataset.clearMatter,
    });
  });

  function openClearModal(entry) {
    clearEntryEl.value = entry.id;
    clearInfoEl.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-2)">
        <div><span class="text-muted">Check #</span><br><strong>${Utils.esc(entry.check)}</strong></div>
        <div><span class="text-muted">Amount</span><br><strong style="color:var(--color-danger)">−${fmt(entry.amount).slice(1)}</strong></div>
        <div><span class="text-muted">Payee</span><br><strong>${Utils.esc(entry.payee || '—')}</strong></div>
        <div><span class="text-muted">Matter</span><br><strong>${Utils.esc(entry.matter)}</strong></div>
      </div>`;
    // Reset radio
    document.querySelectorAll('input[name="ta-clear-action"]').forEach(r => r.checked = false);
    clearDateEl.value = new Date().toISOString().slice(0, 10);
    clearDateWrap.classList.add('hidden');
    clearErrorEl.classList.add('hidden');
    showModal(clearModal);
  }

  document.querySelectorAll('input[name="ta-clear-action"]').forEach(r => {
    r.addEventListener('change', () => {
      const val = document.querySelector('input[name="ta-clear-action"]:checked')?.value;
      clearDateWrap.classList.toggle('hidden', val !== 'cleared');
    });
  });

  clearConfBtn.addEventListener('click', async () => {
    const entryId = clearEntryEl.value;
    const action  = document.querySelector('input[name="ta-clear-action"]:checked')?.value;
    clearErrorEl.classList.add('hidden');

    if (!action) { clearErrorEl.textContent = 'Select an action.'; clearErrorEl.classList.remove('hidden'); return; }
    if (action === 'cleared' && !clearDateEl.value) {
      clearErrorEl.textContent = 'Enter the date the bank cleared this check.';
      clearErrorEl.classList.remove('hidden');
      return;
    }

    Utils.setLoading(clearConfBtn, true);

    if (action === 'cleared') {
      const { error } = await db
        .from('trust_ledger_entries')
        .update({ cleared_at: clearDateEl.value })
        .eq('id', entryId);
      Utils.setLoading(clearConfBtn, false);
      if (error) { clearErrorEl.textContent = 'Failed to update. ' + (error.message || ''); clearErrorEl.classList.remove('hidden'); return; }
      hideModal(clearModal);
      Utils.toast('Check marked cleared', 'success');
    } else {
      // void: fetch the entry first, then create a reversing deposit
      const { data: entry, error: fetchErr } = await db
        .from('trust_ledger_entries')
        .select('matter_id, amount, check_number, payor_payee, description')
        .eq('id', entryId)
        .single();

      if (fetchErr || !entry) {
        Utils.setLoading(clearConfBtn, false);
        clearErrorEl.textContent = 'Failed to load entry.';
        clearErrorEl.classList.remove('hidden');
        return;
      }

      const { error: insertErr } = await db
        .from('trust_ledger_entries')
        .insert({
          trust_account_id: currentAcctId,
          matter_id:        entry.matter_id,
          entry_type:       'adjustment_credit',
          amount:           entry.amount,
          description:      `Void/stale check reversal — Chk #${entry.check_number}: ${entry.description}`,
          payor_payee:      entry.payor_payee,
          created_by:       profile.id,
        });

      Utils.setLoading(clearConfBtn, false);
      if (insertErr) {
        clearErrorEl.textContent = 'Failed to create reversing entry. ' + (insertErr.message || '');
        clearErrorEl.classList.remove('hidden');
        return;
      }

      // Mark original entry with cleared_at = today (signals resolved, just never cashed)
      await db.from('trust_ledger_entries').update({ cleared_at: new Date().toISOString().slice(0, 10) }).eq('id', entryId);

      hideModal(clearModal);
      Utils.toast('Check voided — reversing deposit created', 'success');
    }

    await Promise.all([loadSummary(), loadBalances(), loadTransactions(true), loadStaleChecks()]);
  });

  document.getElementById('ta-clear-close').addEventListener('click',  () => hideModal(clearModal));
  document.getElementById('ta-clear-cancel').addEventListener('click', () => hideModal(clearModal));

  // ── Reconciliation modal ──────────────────────────────────────────────────────
  async function openReconModal() {
    reconForm.reset();
    clearErr(reconErrorEl);
    reconMatchEl.classList.add('hidden');
    reconLedgerDisp.textContent = '…';
    reconClientDisp.textContent = '…';

    // Compute system figures in parallel
    const [ledgerRes, clientRes] = await Promise.all([
      db.from('trust_ledger_entries')
        .select('entry_type, amount')
        .eq('trust_account_id', currentAcctId),
      db.from('matter_trust_balances').select('balance'),
    ]);

    const ledgerTotal = (ledgerRes.data || []).reduce((s, r) => {
      return s + (isCredit(r.entry_type) ? 1 : -1) * Number(r.amount);
    }, 0);

    const clientTotal = (clientRes.data || []).reduce((s, r) => s + Number(r.balance || 0), 0);

    reconLedgerEl.value      = ledgerTotal.toFixed(2);
    reconClientEl.value      = clientTotal.toFixed(2);
    reconLedgerDisp.textContent = fmt(ledgerTotal);
    reconClientDisp.textContent = fmt(clientTotal);

    // Pre-fill last-month date range
    const now   = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last  = new Date(now.getFullYear(), now.getMonth(), 0);
    document.getElementById('ta-r-start').value = first.toISOString().slice(0, 10);
    document.getElementById('ta-r-end').value   = last.toISOString().slice(0, 10);

    showModal(reconModal);
  }

  function updateReconMatch() {
    const bank   = parseFloat(reconBankEl.value)  || 0;
    const dit    = parseFloat(reconDitEl.value)    || 0;
    const oc     = parseFloat(reconOcEl.value)     || 0;
    const ledger = parseFloat(reconLedgerEl.value  || '0');
    const client = parseFloat(reconClientEl.value  || '0');

    if (!reconBankEl.value) { reconMatchEl.classList.add('hidden'); reconAdjDisp.textContent = '—'; return; }

    const adjusted = bank + dit - oc;
    reconAdjEl.value          = adjusted.toFixed(2);
    reconAdjDisp.textContent  = fmt(adjusted);

    const ok = Math.abs(adjusted - ledger) <= 0.01 && Math.abs(adjusted - client) <= 0.01 && Math.abs(ledger - client) <= 0.01;
    reconMatchEl.classList.remove('hidden');
    reconMatchEl.style.background = ok ? 'rgba(22,163,74,.1)' : 'rgba(220,38,38,.1)';
    reconMatchEl.style.color      = ok ? 'var(--color-success)' : 'var(--color-danger)';
    reconMatchEl.textContent      = ok
      ? '✓ All three figures match — reconciliation complete'
      : `✗ Adjusted bank balance (${fmt(adjusted)}) does not match ledger (${fmt(ledger)}) or client sum (${fmt(client)})`;
  }

  reconBankEl.addEventListener('input', updateReconMatch);
  reconDitEl.addEventListener('input',  updateReconMatch);
  reconOcEl.addEventListener('input',   updateReconMatch);

  reconForm.addEventListener('submit', async e => {
    e.preventDefault();
    clearErr(reconErrorEl);

    const start    = document.getElementById('ta-r-start').value;
    const end      = document.getElementById('ta-r-end').value;
    const period   = document.getElementById('ta-r-period-type').value;
    const bank     = parseFloat(reconBankEl.value);
    const dit      = parseFloat(reconDitEl.value)   || 0;
    const oc       = parseFloat(reconOcEl.value)    || 0;
    const ledger   = parseFloat(reconLedgerEl.value);
    const client   = parseFloat(reconClientEl.value);
    const notes    = document.getElementById('ta-r-notes').value.trim();

    if (!start || !end || isNaN(bank)) {
      showErr(reconErrorEl, 'Period dates and bank statement balance are required.');
      return;
    }

    const saveBtn = document.getElementById('ta-recon-save');
    Utils.setLoading(saveBtn, true);

    const { error } = await db.from('trust_reconciliations').insert({
      trust_account_id:       currentAcctId,
      period_start:           start,
      period_end:             end,
      period_type:            period,
      bank_statement_balance: bank,
      deposits_in_transit:    dit,
      outstanding_checks:     oc,
      ledger_balance:         ledger,
      client_ledger_sum:      client,
      notes:                  notes || null,
      completed_by:           profile.id,
    });

    Utils.setLoading(saveBtn, false);

    if (error) { showErr(reconErrorEl, 'Failed to save reconciliation. ' + (error.message || '')); return; }

    hideModal(reconModal);
    Utils.toast('Reconciliation saved', 'success');
    await Promise.all([loadSummary(), loadReconHistory()]);
  });

  document.getElementById('ta-recon-close').addEventListener('click',  () => hideModal(reconModal));
  document.getElementById('ta-recon-cancel').addEventListener('click', () => hideModal(reconModal));
  reconcileBtn.addEventListener('click', openReconModal);

  // ── Add trust account modal ────────────────────────────────────────────────────
  function openAccountModal() {
    accountForm.reset();
    clearErr(accountErrorEl);
    showModal(accountModal);
  }

  const JUR_NOTICES = {
    TX: '⚠️ Texas: You must notify the Texas Access to Justice Foundation (TAJF) within 30 days of opening this account. Visit texasiolta.org to submit notification.',
    FL: '⚠️ Florida: IOLTA accounts require an annual trust accounting certification filed with the Florida Bar between June 1 and August 15 each year.',
    NY: 'ℹ️ New York: Trust records must be retained for 7 years and exportable for state bar review on demand.',
    IL: 'ℹ️ Illinois: Electronic fund transfers (wires/EFTs) must include explicit recipient metadata. Record wire recipient details in the description or notes field.',
    CA: 'ℹ️ California: Bar audits (CTAPP program) may request printed monthly three-way reconciliation worksheets. Use the Reconcile button monthly.',
  };

  document.getElementById('ta-a-jurisdiction')?.addEventListener('input', e => {
    const jur    = e.target.value.trim().toUpperCase();
    const notice = document.getElementById('ta-a-jur-notice');
    if (JUR_NOTICES[jur]) {
      notice.textContent = JUR_NOTICES[jur];
      notice.classList.remove('hidden');
    } else {
      notice.classList.add('hidden');
    }
  });

  accountForm.addEventListener('submit', async e => {
    e.preventDefault();
    clearErr(accountErrorEl);

    const label      = document.getElementById('ta-a-label').value.trim();
    const bank       = document.getElementById('ta-a-bank').value.trim();
    const last4      = document.getElementById('ta-a-last4').value.trim();
    const jur        = document.getElementById('ta-a-jurisdiction').value.trim().toUpperCase();
    const notes      = document.getElementById('ta-a-notes').value.trim();
    const minBal     = parseFloat(document.getElementById('ta-a-min-balance').value) || 100;
    const staleDays  = parseInt(document.getElementById('ta-a-stale-days').value, 10) || 90;

    if (!label || !bank || !last4 || !jur) {
      showErr(accountErrorEl, 'All required fields must be filled.');
      return;
    }
    if (!/^\d{4}$/.test(last4)) {
      showErr(accountErrorEl, 'Last 4 digits must be exactly 4 numbers.');
      return;
    }

    const saveBtn = document.getElementById('ta-account-save');
    Utils.setLoading(saveBtn, true);

    const retentionYears = ['FL','MA','NC','SC','WI'].includes(jur) ? 6
      : ['NY','IL','CO','OH','NJ','CT','RI'].includes(jur) ? 7 : 5;

    const { error } = await db.from('trust_accounts').insert({
      account_label:        label,
      bank_name:            bank,
      account_number_last4: last4,
      jurisdiction:         jur,
      retention_years:      retentionYears,
      minimum_balance:      minBal,
      stale_check_days:     staleDays,
      notes:                notes || null,
    });

    Utils.setLoading(saveBtn, false);

    if (error) { showErr(accountErrorEl, 'Failed to add account. ' + (error.message || '')); return; }

    hideModal(accountModal);
    const notice = jur === 'TX'
      ? 'Trust account added. Remember to notify TAJF within 30 days.'
      : jur === 'FL'
      ? 'Trust account added. Annual certification required June 1 – Aug 15.'
      : 'Trust account added';
    Utils.toast(notice, 'success');
    setupEl.classList.add('hidden');
    loadingEl.classList.remove('hidden');
    await init();
  });

  document.getElementById('ta-account-close').addEventListener('click',  () => hideModal(accountModal));
  document.getElementById('ta-account-cancel').addEventListener('click', () => hideModal(accountModal));
  addAccountBtn.addEventListener('click', openAccountModal);

  // ── Account switcher ───────────────────────────────────────────────────────────
  accountSelect.addEventListener('change', async () => {
    currentAcctId = accountSelect.value;
    await Promise.all([loadSummary(), loadBalances(), loadTransactions(true), loadStaleChecks(), loadReconHistory()]);
  });

  // ── Load more ──────────────────────────────────────────────────────────────────
  document.getElementById('ta-load-more').addEventListener('click', () => loadTransactions(false));

  // ── Per-client sub-ledger ─────────────────────────────────────────────────────
  const subLedgerModal   = document.getElementById('ta-subledger-modal');
  const slBody           = document.getElementById('ta-sl-body');
  const slTable          = document.getElementById('ta-sl-table');
  const slEmpty          = document.getElementById('ta-sl-empty');
  const slLoading        = document.getElementById('ta-sl-loading');
  const slBalanceEl      = document.getElementById('ta-sl-balance');
  let   _slMatterId      = null;
  let   _slClientName    = '';
  let   _slMatterName    = '';

  balancesBody.addEventListener('click', e => {
    const btn = e.target.closest('[data-subledger-matter]');
    if (btn) openSubLedger(btn.dataset.subledgerMatter, btn.dataset.subledgerClient, btn.dataset.subledgerMatterName);
  });

  async function openSubLedger(matterId, clientName, matterName) {
    _slMatterId   = matterId;
    _slClientName = clientName;
    _slMatterName = matterName;

    document.getElementById('ta-subledger-title').textContent = `${clientName} — Trust Sub-Ledger`;
    document.getElementById('ta-subledger-subtitle').textContent = matterName;
    document.getElementById('ta-sl-from').value = '';
    document.getElementById('ta-sl-to').value   = '';

    showModal(subLedgerModal);
    await loadSubLedger();
  }

  async function loadSubLedger() {
    slLoading.style.display = '';
    slTable.classList.add('hidden');
    slEmpty.classList.add('hidden');
    slBalanceEl.textContent = '—';

    const from = document.getElementById('ta-sl-from').value;
    const to   = document.getElementById('ta-sl-to').value;

    let query = db.from('trust_ledger_entries')
      .select('id, created_at, entry_type, amount, balance_after, description, payor_payee, check_number, cleared_at')
      .eq('matter_id', _slMatterId)
      .order('created_at', { ascending: true });

    if (from) query = query.gte('created_at', from);
    if (to)   query = query.lte('created_at', to + 'T23:59:59');

    const { data, error } = await query;
    slLoading.style.display = 'none';

    if (error || !data || data.length === 0) {
      slEmpty.classList.remove('hidden');
      return;
    }

    const currentBalance = Number(data[data.length - 1].balance_after || 0);
    slBalanceEl.textContent = fmt(currentBalance);
    slBalanceEl.style.color = currentBalance < 0 ? 'var(--color-danger)' : 'var(--color-success)';

    slBody.innerHTML = data.map(r => {
      const credit = isCredit(r.entry_type);
      const color  = credit ? 'var(--color-success)' : 'var(--color-danger)';
      const sign   = credit ? '+' : '−';
      const staleTag = (!r.cleared_at && r.check_number) ? `<span style="font-size:9px;padding:0 4px;border-radius:3px;background:rgba(220,38,38,.1);color:var(--color-danger);margin-left:3px">OUT</span>` : '';
      return `<tr>
        <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);white-space:nowrap;color:var(--color-text-muted)">${Utils.formatDate(r.created_at)}</td>
        <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);color:${color};font-weight:500;white-space:nowrap">${TYPE_LABELS[r.entry_type] || r.entry_type}</td>
        <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);max-width:200px">${Utils.esc(Utils.truncate(r.description, 55))}</td>
        <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);white-space:nowrap">${r.check_number ? Utils.esc(r.check_number) + staleTag : '—'}</td>
        <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);text-align:right;font-weight:600;color:${color};white-space:nowrap">${sign}${fmt(r.amount).slice(1)}</td>
        <td style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border);text-align:right;white-space:nowrap">${fmt(r.balance_after)}</td>
      </tr>`;
    }).join('');

    slTable.classList.remove('hidden');
  }

  document.getElementById('ta-sl-filter').addEventListener('click', loadSubLedger);
  document.getElementById('ta-sl-clear-filter').addEventListener('click', () => {
    document.getElementById('ta-sl-from').value = '';
    document.getElementById('ta-sl-to').value   = '';
    loadSubLedger();
  });
  document.getElementById('ta-subledger-close').addEventListener('click', () => hideModal(subLedgerModal));

  document.getElementById('ta-subledger-print').addEventListener('click', () => {
    const acct = trustAccounts.find(a => a.id === currentAcctId);
    const firmName  = window.APP_CONFIG?.firmName || 'Law Firm';
    const from = document.getElementById('ta-sl-from').value;
    const to   = document.getElementById('ta-sl-to').value;
    const rangeStr = from || to ? `${from ? Utils.formatDate(from) : 'Start'} – ${to ? Utils.formatDate(to) : 'Present'}` : 'All dates';

    const rows = [...slBody.querySelectorAll('tr')].map(r => r.outerHTML).join('');
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Trust Sub-Ledger — ${_slClientName}</title>
<style>
  body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #111; max-width: 8in; margin: 0 auto; padding: 24px; }
  @page { size: letter; margin: 1in; }
  @media print { .no-print { display: none !important; } }
  h1 { font-size: 15pt; margin: 0 0 4px; } h2 { font-size: 11pt; margin: 0 0 16px; color: #374151; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; margin-top: 12px; }
  th { text-align: left; padding: 6px 8px; background: #f3f4f6; border-bottom: 2px solid #111; font-weight: bold; }
  td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
  .btn { display: block; margin: 16px auto; padding: 8px 24px; background: #1d4ed8; color: #fff; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; font-family: sans-serif; }
</style></head><body>
<button class="btn no-print" onclick="window.print()">Print / Save as PDF</button>
<h1>${firmName} — Client Trust Sub-Ledger</h1>
<h2>${_slClientName} &nbsp;·&nbsp; ${_slMatterName} &nbsp;·&nbsp; ${rangeStr}</h2>
<p style="font-size:10pt;color:#6b7280">Account: ${acct ? acct.account_label + ' — ' + acct.bank_name + ' ****' + acct.account_number_last4 : '—'}</p>
<table>
  <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Check #</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<p style="margin-top:20px;font-size:9.5pt;color:#6b7280">Printed ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} &nbsp;|&nbsp; Retain per bar record-retention rules.</p>
<script>if (window.opener) setTimeout(() => window.print(), 400);</script>
</body></html>`;
    const w = window.open('', '_blank', 'width=850,height=700');
    w.document.write(html);
    w.document.close();
  });

  // ── Export CSV ────────────────────────────────────────────────────────────────
  const exportModal = document.getElementById('ta-export-modal');
  const exportBtn   = document.getElementById('ta-export-btn');

  exportBtn.addEventListener('click', () => {
    const now   = new Date();
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last  = new Date(now.getFullYear(), now.getMonth(), 0);
    document.getElementById('ta-exp-from').value = first.toISOString().slice(0, 10);
    document.getElementById('ta-exp-to').value   = last.toISOString().slice(0, 10);
    document.getElementById('ta-export-error').classList.add('hidden');
    showModal(exportModal);
  });

  document.getElementById('ta-export-close').addEventListener('click',  () => hideModal(exportModal));
  document.getElementById('ta-export-cancel').addEventListener('click', () => hideModal(exportModal));

  document.getElementById('ta-export-download').addEventListener('click', async () => {
    const from     = document.getElementById('ta-exp-from').value;
    const to       = document.getElementById('ta-exp-to').value;
    const errorEl  = document.getElementById('ta-export-error');
    const dlBtn    = document.getElementById('ta-export-download');
    errorEl.classList.add('hidden');

    Utils.setLoading(dlBtn, true);

    let query = db.from('trust_ledger_entries')
      .select('id, created_at, matter_id, entry_type, amount, balance_after, description, payor_payee, check_number, cleared_at, invoice_id, external_invoice_ref')
      .eq('trust_account_id', currentAcctId)
      .order('created_at', { ascending: true });

    if (from) query = query.gte('created_at', from);
    if (to)   query = query.lte('created_at', to + 'T23:59:59');

    const { data, error } = await query;

    if (error || !data) {
      Utils.setLoading(dlBtn, false);
      errorEl.textContent = 'Failed to fetch data. ' + (error?.message || '');
      errorEl.classList.remove('hidden');
      return;
    }

    // Fetch matter + client names
    const mids = [...new Set(data.map(r => r.matter_id))];
    let mMap = {};
    if (mids.length > 0) {
      const { data: mData } = await db.from('matters')
        .select('id, case_type_id, case_number, case_types!case_type_id(name), clients(first_name, last_name)')
        .in('id', mids);
      mMap = Object.fromEntries((mData || []).map(m => [m.id, m]));
    }

    Utils.setLoading(dlBtn, false);

    const acct    = trustAccounts.find(a => a.id === currentAcctId);
    const acctStr = acct ? `${acct.account_label} — ${acct.bank_name} ****${acct.account_number_last4}` : '';

    const csvEsc = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const headers = ['Date','Client','Matter','Matter #','Type','Description','Payor/Payee','Check #','Amount','Balance After','Cleared Date','Invoice Ref'];
    const rows = data.map(r => {
      const m   = mMap[r.matter_id];
      const cn  = m?.clients ? `${m.clients.first_name} ${m.clients.last_name}` : '';
      const cr  = isCredit(r.entry_type);
      return [
        Utils.formatDate(r.created_at),
        cn,
        matterLabel(m),
        m?.case_number || '',
        TYPE_LABELS[r.entry_type] || r.entry_type,
        r.description,
        r.payor_payee || '',
        r.check_number || '',
        (cr ? '' : '-') + Number(r.amount).toFixed(2),
        Number(r.balance_after).toFixed(2),
        r.cleared_at || '',
        r.invoice_id ? `INV:${r.invoice_id}` : (r.external_invoice_ref || ''),
      ].map(csvEsc).join(',');
    });

    const rangeLabel = from || to ? `_${from || ''}_to_${to || ''}` : '_all';
    const filename = `trust_ledger${rangeLabel}.csv`;
    const csvContent = [
      `# Trust Account: ${acctStr}`,
      `# Exported: ${new Date().toLocaleString()}`,
      `# Date range: ${from || 'beginning'} to ${to || 'present'}`,
      '',
      headers.join(','),
      ...rows,
    ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);

    hideModal(exportModal);
    Utils.toast(`Exported ${data.length} entries`, 'success');
  });

  // ── Edit trust account modal ───────────────────────────────────────────────────
  const editAccountModal   = document.getElementById('ta-edit-account-modal');
  const editAccountForm    = document.getElementById('ta-edit-account-form');
  const editAccountErrorEl = document.getElementById('ta-edit-account-error');
  const acctSettingsBtn    = document.getElementById('ta-account-settings-btn');

  function openEditAccountModal() {
    const acct = trustAccounts.find(a => a.id === currentAcctId);
    if (!acct) return;
    document.getElementById('ta-ea-label').value      = acct.account_label || '';
    document.getElementById('ta-ea-bank').value       = acct.bank_name || '';
    document.getElementById('ta-ea-last4').value      = acct.account_number_last4 || '';
    document.getElementById('ta-ea-min-balance').value= Number(acct.minimum_balance ?? 100).toFixed(2);
    document.getElementById('ta-ea-stale-days').value = acct.stale_check_days ?? 90;
    document.getElementById('ta-ea-notes').value      = acct.notes || '';
    clearErr(editAccountErrorEl);
    showModal(editAccountModal);
  }

  editAccountForm.addEventListener('submit', async e => {
    e.preventDefault();
    clearErr(editAccountErrorEl);

    const label     = document.getElementById('ta-ea-label').value.trim();
    const bank      = document.getElementById('ta-ea-bank').value.trim();
    const last4     = document.getElementById('ta-ea-last4').value.trim();
    const minBal    = parseFloat(document.getElementById('ta-ea-min-balance').value) || 0;
    const staleDays = parseInt(document.getElementById('ta-ea-stale-days').value, 10) || 90;
    const notes     = document.getElementById('ta-ea-notes').value.trim();

    if (!label || !bank || !last4) {
      showErr(editAccountErrorEl, 'Label, bank name, and last 4 digits are required.');
      return;
    }
    if (!/^\d{4}$/.test(last4)) {
      showErr(editAccountErrorEl, 'Last 4 digits must be exactly 4 numbers.');
      return;
    }

    const saveBtn = document.getElementById('ta-edit-account-save');
    Utils.setLoading(saveBtn, true);

    const { error } = await db.from('trust_accounts').update({
      account_label:        label,
      bank_name:            bank,
      account_number_last4: last4,
      minimum_balance:      minBal,
      stale_check_days:     staleDays,
      notes:                notes || null,
    }).eq('id', currentAcctId);

    Utils.setLoading(saveBtn, false);

    if (error) { showErr(editAccountErrorEl, 'Failed to save. ' + (error.message || '')); return; }

    hideModal(editAccountModal);
    Utils.toast('Account settings saved', 'success');
    // Reload full page state so buffer alert + stale threshold refresh
    loadingEl.classList.remove('hidden');
    mainEl.classList.add('hidden');
    await init();
  });

  document.getElementById('ta-edit-account-close').addEventListener('click',  () => hideModal(editAccountModal));
  document.getElementById('ta-edit-account-cancel').addEventListener('click', () => hideModal(editAccountModal));
  acctSettingsBtn.addEventListener('click', openEditAccountModal);

  // ── Go ─────────────────────────────────────────────────────────────────────────
  await init();

})();
