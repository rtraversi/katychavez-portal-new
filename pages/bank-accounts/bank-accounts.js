'use strict';

// Bank Accounts: the firm's own balances + transactions (bank_feeds module), sorted
// into categories for the books.
//
// Reads bank_connections / bank_accounts / bank_transactions / bank_categories /
// bank_category_rules through RLS (can_read('bank_feeds'), Owner by default).
// Writes:
//   * connect / sync / disconnect / Quicken import → POST /api/bank-feeds (the Worker),
//     because the provider credential never reaches the browser and only the Worker
//     writes transactions
//   * categories, rules, and a transaction's category → directly (RLS can_write); the
//     database lets the browser change a transaction's category and nothing else
//
// A transaction's category: the one stored on it wins; otherwise the first matching
// rule, worked out here at render time so editing a rule recategorizes history at once.
// The logic is in categorize.js; the QIF reader in qif.js.
(async function BankAccountsPage() {
  const esc = (s) => Utils.esc(s == null ? '' : String(s));
  const $ = (id) => document.getElementById(id);
  const PAGE = 150;
  const TOP_IN = 5;         // income categories shown on the overview (deposits)
  const TOP_OUT = 7;        // expense categories shown (payments)
  const NONE = '__none__';  // category filter value for "Uncategorized"
  const NEW = '__new__';    // picker value for "+ New category…"
  const MAX_LOAD = 5000;    // transactions the Accounts tab loads (newest first)
  const DB_PAGE = 1000;     // PostgREST's row cap per request
  const REPORT_TXN_ROWS = 300;
  const TXN_COLS = 'id, account_id, posted_at, amount, description, payee, memo, category_id, source';
  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

  let Cat;
  let Qif;
  try {
    const v = window.APP_CONFIG?.deployVersion || '';
    [Cat, Qif] = await Promise.all([
      import(`/pages/bank-accounts/categorize.js?v=${v}`),
      import(`/pages/bank-accounts/qif.js?v=${v}`),
    ]);
  } catch (err) {
    console.error('[bank-accounts] modules failed to load', err);
  }

  const state = {
    tab: 'accounts',
    conns: [], accounts: [], txns: [], truncated: false,
    rules: [], cats: [], catsOk: false,
    ledger: null, compiled: [], catOf: new Map(),
    accountFilter: '', catFilter: '', search: '', shown: PAGE, days: 30,
    canWrite: false, canAdmin: false, profileId: null,
    report: { period: 'this_year', from: '', to: '', account: '', range: null, data: null, txns: [], open: new Set(), loaded: false, seq: 0 },
    qif: null,          // the parsed QIF file
    importPlan: null,   // the last dry-run result
  };

  try {
    const [writable, admin] = await Promise.all([Auth.getAccessibleModules('write'), Auth.getAccessibleModules('admin')]);
    state.canWrite = writable.has('bank_feeds');
    state.canAdmin = admin.has('bank_feeds');
  } catch { /* read-only view */ }
  try { state.profileId = (await Auth.getProfile())?.id || null; } catch { /* attribution only */ }

  // ── Money ─────────────────────────────────────────────────────────────────
  const fmtCache = new Map();
  function money(v, currency = 'USD') {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (!fmtCache.has(currency)) {
      let f;
      try { f = new Intl.NumberFormat('en-US', { style: 'currency', currency }); }
      catch { f = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
      fmtCache.set(currency, f);
    }
    return fmtCache.get(currency).format(n);
  }
  const signed = (n, currency) => `${n > 0 ? '+' : ''}${money(n, currency)}`;

  async function api(body) {
    const session = await Auth.getSession();
    const res = await fetch('/api/bank-feeds', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON error page */ }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  // Page through a query past PostgREST's per-request row cap. build() returns a
  // fresh, fully ordered query each time. { data, error, more }
  async function selectPaged(build, max) {
    const out = [];
    for (let from = 0; from < max; from += DB_PAGE) {
      const { data, error } = await build().range(from, Math.min(from + DB_PAGE, max) - 1);
      if (error) return { data: out, error, more: false };
      out.push(...(data || []));
      if (!data || data.length < DB_PAGE) return { data: out, error: null, more: false };
    }
    return { data: out, error: null, more: true };
  }

  // ── Load ──────────────────────────────────────────────────────────────────
  async function load() {
    const [c, a, t] = await Promise.all([
      db.from('bank_connections').select('id, provider, label, status, last_attempt_at, last_synced_at, last_error, created_at').order('created_at'),
      db.from('bank_accounts').select('id, connection_id, name, institution, currency, balance, available_balance, balance_date, present').order('name'),
      selectPaged(() => db.from('bank_transactions').select(TXN_COLS).order('posted_at', { ascending: false }).order('id'), MAX_LOAD),
    ]);
    if (c.error || a.error || t.error) {
      ['ba-accounts', 'ba-txns', 'ba-conns'].forEach(id => {
        $(id).innerHTML = '<p class="dk-empty" style="color:var(--color-danger)">Could not load bank data.</p>';
      });
      return false;
    }
    state.conns = c.data || [];
    state.accounts = a.data || [];
    state.txns = t.data || [];
    state.truncated = !!t.more;
    await loadCategories();
    return true;
  }

  // Categories and rules load separately: a failure here (e.g. not migrated yet) must
  // not take the balances down with it.
  async function loadCategories() {
    const [cats, rules] = await Promise.all([
      db.from('bank_categories').select('id, name, kind').order('name'),
      db.from('bank_category_rules').select('id, pattern, category, category_id, direction, priority, created_at').order('priority').order('created_at'),
    ]);
    state.catsOk = !cats.error && !rules.error && !!Cat;
    state.cats = state.catsOk ? (cats.data || []) : [];
    state.rules = state.catsOk ? (rules.data || []) : [];
    recategorize();
  }

  function recategorize() {
    state.ledger = Cat ? Cat.ledgerFrom(state.cats) : null;
    state.compiled = Cat ? Cat.compileRules(state.rules, state.ledger) : [];
    state.catOf = new Map(state.txns.map(t => [t.id, Cat ? Cat.categorize(t, state.compiled, state.ledger) : null]));
  }

  const accountById = () => new Map(state.accounts.map(a => [a.id, a]));
  const connById = () => new Map(state.conns.map(c => [c.id, c]));
  const currencyOf = () => state.accounts.find(a => a.present)?.currency || 'USD';
  const uncategorizedCount = () => state.txns.reduce((n, t) => n + (Number(t.amount) !== 0 && !state.catOf.get(t.id) ? 1 : 0), 0);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#ba-tabs .detail-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('detail-tab--active', on);
      b.setAttribute('aria-selected', String(on));
    });
    ['accounts', 'report', 'categories'].forEach(t => $(`ba-panel-${t}`).classList.toggle('tab-panel--active', t === tab));
    if (tab === 'report' && !state.report.loaded) runReport();
  }
  document.querySelectorAll('#ba-tabs .detail-tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ── Render: deskbar ───────────────────────────────────────────────────────
  function renderDeskbar() {
    const live = state.accounts.filter(a => a.present);
    const lastSync = state.conns.map(c => c.last_synced_at).filter(Boolean).sort().pop();
    const problems = state.conns.filter(c => c.status === 'revoked' || c.last_error).length;
    const unc = state.catsOk ? uncategorizedCount() : 0;
    $('ba-tabcount-unc').textContent = unc ? String(unc) : '';
    if (!state.conns.length && !state.txns.length) { $('ba-deskbar').innerHTML = ''; return; }
    const chips = [live.length
      ? { n: live.length, label: live.length === 1 ? 'account' : 'accounts', jump: 'ba-sec-accounts' }
      : { label: 'No accounts yet', static: true }];
    if (lastSync) chips.push({ label: `Synced ${Utils.formatDateTime(lastSync)}`, static: true });
    if (problems) chips.push({ n: problems, label: problems === 1 ? 'connection needs attention' : 'connections need attention', tone: 'warn', jump: 'ba-sec-conns' });
    if (unc) chips.push({ n: unc, label: 'uncategorized', tone: 'warn', jump: 'ba-sec-txns' });
    $('ba-deskbar').innerHTML = DK.deskbar(chips);
    // Chips jump within the Accounts tab; the uncategorized one also filters to them.
    $('ba-deskbar').querySelectorAll('[data-jump]').forEach(chip => chip.addEventListener('click', () => {
      showTab('accounts');
      if (chip.dataset.jump === 'ba-sec-txns') setCatFilter(NONE, false);
      $(chip.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  // ── Render: connections (top of the Accounts tab) ─────────────────────────
  function renderConns() {
    $('ba-connect-open').hidden = !state.canAdmin || !$('ba-connect-form').hidden;
    if (!state.conns.length) {
      $('ba-conns').innerHTML = '<p class="dk-empty">Banks are linked through SimpleFIN, a read-only bank-data service (about $15 a year, paid to SimpleFIN). The portal never sees your bank password.</p>';
      return;
    }
    const counts = new Map();
    state.accounts.forEach(a => { if (a.present) counts.set(a.connection_id, (counts.get(a.connection_id) || 0) + 1); });
    $('ba-conns').innerHTML = `<div class="dk-register">${state.conns.map(c => {
      const tag = c.status === 'revoked' ? DK.tag('Revoked', 'warn') : c.last_error ? DK.tag('Warning', 'warn') : DK.tag('Active', 'ok');
      const n = counts.get(c.id) || 0;
      const meta = [
        'SimpleFIN',
        `${n} account${n === 1 ? '' : 's'}`,
        c.last_synced_at ? `last synced ${esc(Utils.formatDateTime(c.last_synced_at))}` : 'not synced yet',
        c.last_error ? `<span class="danger">${esc(c.last_error)}</span>` : '',
      ].filter(Boolean).join('<span class="sep">·</span>');
      const acts = [
        c.status !== 'revoked' && state.canWrite ? `<button class="dk-linkbtn" type="button" data-sync="${esc(c.id)}">Sync now</button>` : '',
        state.canAdmin ? `<button class="dk-linkbtn d" type="button" data-disconnect="${esc(c.id)}">Disconnect</button>` : '',
      ].join('');
      return `<div class="dk-reg-row">
        <div><div class="dk-reg-title">${esc(c.label)} ${tag}</div><div class="dk-reg-meta">${meta}</div></div>
        ${acts ? `<div class="dk-reg-act">${acts}</div>` : ''}
      </div>`;
    }).join('')}</div>`;

    $('ba-conns').querySelectorAll('[data-sync]').forEach(b => b.addEventListener('click', () => syncNow(b)));
    $('ba-conns').querySelectorAll('[data-disconnect]').forEach(b => b.addEventListener('click', () => disconnect(b.dataset.disconnect)));
  }

  // ── Render: accounts ──────────────────────────────────────────────────────
  function renderAccounts() {
    const live = state.accounts.filter(a => a.present);
    $('ba-count-accounts').textContent = live.length ? String(live.length) : '';
    if (!live.length) {
      $('ba-accounts').innerHTML = state.conns.length
        ? '<p class="dk-empty">No accounts yet. They appear after the first sync.</p>'
        : '<p class="dk-empty">No bank connected yet. Use <strong>Connect a bank</strong> above.</p>';
      return;
    }
    const conns = connById();
    $('ba-accounts').innerHTML = `<div class="dk-register">${live.map(a => {
      const conn = conns.get(a.connection_id);
      const n = Number(a.balance);
      const avail = a.available_balance !== null && a.available_balance !== a.balance
        ? `<span class="ba-amt-sub">${esc(money(a.available_balance, a.currency))} available</span>` : '';
      const meta = [
        a.institution ? esc(a.institution) : '',
        a.balance_date ? `as of ${esc(Utils.formatDateTime(a.balance_date))}` : '',
        conn?.status === 'revoked' ? '<span class="danger">connection revoked — balance may be stale</span>' : '',
      ].filter(Boolean).join('<span class="sep">·</span>');
      return `<div class="dk-reg-row ba-pick${state.accountFilter === a.id ? ' is-active' : ''}" data-account="${esc(a.id)}" title="Show only this account">
        <div><div class="dk-reg-title">${esc(a.name)}</div><div class="dk-reg-meta">${meta}</div></div>
        <div class="ba-amt lg${n < 0 ? ' neg' : ''}">${esc(money(a.balance, a.currency))}${avail}</div>
      </div>`;
    }).join('')}</div>`;

    $('ba-accounts').querySelectorAll('[data-account]').forEach(el => el.addEventListener('click', () => {
      setAccountFilter(state.accountFilter === el.dataset.account ? '' : el.dataset.account);
    }));
  }

  // ── Render: income / expenses tiles ───────────────────────────────────────
  // Deposits and payments are summarized separately (categorize.summarizeFlows):
  // Income lists every deposit category plus uncategorized deposits; Expenses lists
  // the biggest payment categories. Both follow the account filter and the period.
  function summaryTxns() {
    const cutoff = Date.now() - state.days * 86400000;
    return state.txns.filter(t =>
      (!state.accountFilter || t.account_id === state.accountFilter) && Date.parse(t.posted_at) >= cutoff);
  }

  function flowList(summary, { limit, kind, cur }) {
    const top = summary.categories.slice(0, limit);
    const unc = summary.uncategorized;
    const otherLabel = kind === 'in' ? 'Other deposits' : 'Uncategorized';
    // Uncategorized deposits are a real line of income, so they sit in the list;
    // uncategorized payments go in the footer, so a pile of them can't push out
    // a real category.
    const showOtherRow = kind === 'in' && unc.count > 0;
    const rows = top.map(c => ({ ...c, other: false }));
    if (showOtherRow) rows.push({ category: otherLabel, total: unc.total, count: unc.count, other: true });
    if (!rows.length) return { html: '', hasRows: false };

    const max = Math.max(...rows.map(c => Math.abs(c.total))) || 1;
    const html = rows.map(c => {
      const pct = Math.max(2, Math.round(Math.abs(c.total) / max * 100));
      const key = c.other ? NONE : c.category;
      const active = state.catFilter === key;
      return `<div class="dk-reg-row ba-pick${active ? ' is-active' : ''}${c.other ? ' ba-other' : ''}" data-cat="${esc(key)}" title="Show these transactions">
        <div><div class="dk-reg-title">${esc(c.category)}</div>
          <div class="dk-reg-meta">${c.count} ${kind === 'in' ? 'deposit' : 'payment'}${c.count === 1 ? '' : 's'}</div>
          <span class="ba-bar${kind === 'in' ? ' in' : ''}"><i style="width:${pct}%"></i></span></div>
        <div class="ba-amt${kind === 'in' ? ' in' : ''}">${esc(signed(c.total, cur))}</div>
      </div>`;
    }).join('');

    const feet = [];
    const hidden = summary.categories.length - top.length;
    if (hidden > 0) feet.push(`${hidden} more categor${hidden === 1 ? 'y' : 'ies'}`);
    if (kind === 'out' && unc.count) {
      feet.push(`<button class="dk-linkbtn" type="button" data-cat="${NONE}">${unc.count} uncategorized (${esc(signed(unc.total, cur))})</button>`);
    }
    const foot = feet.length ? `<div class="ba-cat-foot">${feet.join(' · ')}</div>` : '';
    return { html: `<div class="dk-register">${html}${foot}</div>`, hasRows: true };
  }

  function renderCats() {
    document.querySelectorAll('#ba-period [data-days]').forEach(b =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.days) === state.days)));
    const inEl = $('ba-in');
    const outEl = $('ba-out');
    const setTotals = (i, o) => { $('ba-total-in').textContent = i; $('ba-total-out').textContent = o; };

    const acct = state.accountFilter ? accountById().get(state.accountFilter) : null;
    $('ba-period-note').textContent = `Income and expenses: last ${state.days} days${acct ? ` in ${acct.name}` : ''}`;

    if (!state.txns.length) {
      setTotals('', '');
      inEl.innerHTML = outEl.innerHTML = '<p class="dk-empty">Appears once transactions come in.</p>';
      return;
    }
    if (!state.catsOk) {
      setTotals('', '');
      inEl.innerHTML = outEl.innerHTML = '<p class="dk-empty">Categories are not available yet.</p>';
      return;
    }

    const cur = currencyOf();
    const { income, expenses } = Cat.summarizeFlows(summaryTxns(), state.compiled, state.ledger);
    const sum = (s) => s.categories.reduce((n, c) => n + Math.round(c.total * 100), Math.round(s.uncategorized.total * 100)) / 100;
    const totalIn = sum(income);
    const totalOut = sum(expenses);
    setTotals(totalIn ? signed(totalIn, cur) : '', totalOut ? signed(totalOut, cur) : '');

    const inList = flowList(income, { limit: TOP_IN, kind: 'in', cur });
    const outList = flowList(expenses, { limit: TOP_OUT, kind: 'out', cur });
    inEl.innerHTML = inList.hasRows ? inList.html : `<p class="dk-empty">No deposits in the last ${state.days} days.</p>`;
    outEl.innerHTML = outList.hasRows ? outList.html
      : expenses.uncategorized.count
        ? `<p class="dk-empty">${expenses.uncategorized.count} payments, none categorized yet.</p>`
        : `<p class="dk-empty">No payments in the last ${state.days} days.</p>`;

    [inEl, outEl].forEach(el => el.querySelectorAll('[data-cat]').forEach(r => r.addEventListener('click', () => {
      setCatFilter(state.catFilter === r.dataset.cat ? '' : r.dataset.cat, true);
    })));
  }

  // ── Render: transactions ──────────────────────────────────────────────────
  // Every category name in play: the list, plus any a rule still names that isn't on it.
  function allCategoryNames() {
    const names = new Map((state.ledger?.list || []).map(c => [c.name.toLowerCase(), c.name]));
    state.compiled.forEach(r => { if (!names.has(r.category.toLowerCase())) names.set(r.category.toLowerCase(), r.category); });
    return [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  function renderTxnToolbar() {
    const sel = $('ba-txn-account');
    sel.innerHTML = '<option value="">All accounts</option>' + state.accounts.map(a =>
      `<option value="${esc(a.id)}">${esc(a.name)}${a.institution ? ' · ' + esc(a.institution) : ''}${a.present ? '' : ' (no longer reported)'}</option>`).join('');
    sel.value = state.accountFilter;

    const cats = allCategoryNames();
    const csel = $('ba-txn-cat');
    csel.hidden = !state.catsOk;
    csel.innerHTML = '<option value="">All categories</option>' +
      `<option value="${NONE}">Uncategorized</option>` +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (state.catFilter && state.catFilter !== NONE && !cats.includes(state.catFilter)) state.catFilter = '';
    csel.value = state.catFilter;

    $('ba-txn-toolbar').hidden = !state.txns.length;
  }

  function filteredTxns() {
    const q = state.search.trim().toLowerCase();
    return state.txns.filter(t => {
      if (state.accountFilter && t.account_id !== state.accountFilter) return false;
      if (state.catFilter) {
        const c = state.catOf.get(t.id);
        if (state.catFilter === NONE ? c : c !== state.catFilter) return false;
      }
      if (!q) return true;
      return [t.payee, t.description, t.memo, String(t.amount), state.catOf.get(t.id)]
        .some(v => v && String(v).toLowerCase().includes(q));
    });
  }

  // Tag color for a category: income green, expense light red. Names the list doesn't
  // know go by the transaction's sign.
  function kindTag(name, amount) {
    const kind = state.ledger?.byName.get(String(name).toLowerCase())?.kind || (Number(amount) > 0 ? 'income' : 'expense');
    return kind === 'income' ? 'ok' : 'crit';
  }

  // The category on one transaction: a tag that opens the picker.
  //   set by hand or imported → solid · filled in by a rule → dashed outline · none → amber
  function catControl(t) {
    if (!state.catsOk) return '';
    const name = Cat.categorize(t, state.compiled, state.ledger);
    const src = Cat.categorySource(t, state.compiled, state.ledger);
    let tag;
    let title;
    if (!name) { tag = DK.tag('Uncategorized', 'warn'); title = 'Choose a category'; }
    else if (src === 'rule') {
      tag = DK.tag(name, kindTag(name, t.amount));
      title = `From the rule "${Cat.matchRule(t, state.compiled)?.needle || ''}". Click to set a category on this transaction instead.`;
    } else {
      tag = DK.tag(name, kindTag(name, t.amount));
      title = t.source === 'import' ? 'From the Quicken import. Click to change.' : 'Set on this transaction. Click to change.';
    }
    const cls = `ba-cat-btn${src === 'rule' ? ' rule' : ''}`;
    if (!state.canWrite) return ` <span class="${cls}" title="${esc(src === 'rule' ? title : '')}">${tag}</span>`;
    return ` <button class="${cls}" type="button" data-pick="${esc(t.id)}" title="${esc(title)}">${tag}</button>`;
  }

  function txnRow(t, accounts, multi) {
    const a = accounts.get(t.account_id);
    const n = Number(t.amount);
    const title = t.payee || t.description || 'Transaction';
    const meta = [
      esc(Utils.formatDate(t.posted_at)),
      multi && a ? esc(a.name) : '',
      t.payee && t.description && t.description !== t.payee ? esc(t.description) : '',
      t.source === 'import' && t.memo ? esc(t.memo) : '',
      t.source === 'import' ? 'from Quicken' : '',
    ].filter(Boolean).join('<span class="sep">·</span>');
    return `<div class="dk-reg-row">
      <div><div class="dk-reg-title">${esc(title)}${catControl(t)}</div><div class="dk-reg-meta">${meta}</div></div>
      <div class="ba-amt${n > 0 ? ' in' : ''}">${esc(signed(n, a?.currency || 'USD'))}</div>
    </div>`;
  }

  function renderTxns() {
    const accounts = accountById();
    const list = filteredTxns();
    $('ba-count-txns').textContent = list.length ? String(list.length) : '';
    if (!list.length) {
      $('ba-txns').innerHTML = state.txns.length
        ? '<p class="dk-empty">No transactions match.</p>'
        : '<p class="dk-empty">No transactions yet.</p>';
      $('ba-txn-more-wrap').hidden = true;
      return;
    }
    const multi = state.accounts.length > 1 && !state.accountFilter;
    const atEnd = list.length <= state.shown;
    const note = state.truncated && atEnd
      ? `<div class="ba-cat-foot">Showing the newest ${MAX_LOAD.toLocaleString()} transactions. The Report tab covers everything.</div>` : '';
    $('ba-txns').innerHTML = `<div class="dk-register">${list.slice(0, state.shown).map(t => txnRow(t, accounts, multi)).join('')}${note}</div>`;
    $('ba-txn-more-wrap').hidden = atEnd;
    wirePickers($('ba-txns'));
  }

  // ── Category picker ───────────────────────────────────────────────────────
  function pickerOptions(selectedId) {
    const list = state.ledger?.list || [];
    const opt = (c) => `<option value="${esc(c.id)}"${c.id === selectedId ? ' selected' : ''}>${esc(c.name)}</option>`;
    const income = list.filter(c => c.kind === 'income');
    const expense = list.filter(c => c.kind === 'expense');
    return `<option value=""${selectedId ? '' : ' selected'}>${selectedId ? 'Clear (let rules decide)' : 'Choose a category…'}</option>` +
      (income.length ? `<optgroup label="Income">${income.map(opt).join('')}</optgroup>` : '') +
      (expense.length ? `<optgroup label="Expenses">${expense.map(opt).join('')}</optgroup>` : '') +
      `<option value="${NEW}">+ New category…</option>`;
  }

  function wirePickers(root) {
    root.querySelectorAll('[data-pick]').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openPicker(btn);
    }));
  }

  function findTxn(id) {
    return state.txns.find(x => x.id === id) || state.report.txns.find(x => x.id === id);
  }

  function openPicker(btn) {
    const t = findTxn(btn.dataset.pick);
    if (!t) return;
    const sel = document.createElement('select');
    sel.className = 'ba-cat-select';
    sel.setAttribute('aria-label', 'Category');
    sel.innerHTML = pickerOptions(t.category_id && state.ledger.byId.has(t.category_id) ? t.category_id : '');
    btn.replaceWith(sel);
    sel.focus();
    let done = false;
    const restore = () => { if (!done) { done = true; rerenderTxnViews(); } };
    sel.addEventListener('blur', () => setTimeout(restore, 150));
    sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') restore(); });
    sel.addEventListener('change', async () => {
      done = true;
      let id = sel.value;
      if (id === NEW) {
        id = await createCategoryInline(Number(t.amount) > 0 ? 'income' : 'expense');
        if (!id) { rerenderTxnViews(); return; }
      }
      await setTxnCategory(t, id || null);
    });
  }

  async function createCategoryInline(kind) {
    const raw = await Utils.prompt(`Name for the new ${kind} category. Use a colon for a subcategory, like Office:Postage.`, { confirmLabel: 'Add', placeholder: 'e.g. Office:Postage' });
    if (raw === null || raw === undefined) return null;
    const name = Cat.normalizeCategoryName(raw);
    if (!name) { Utils.toast('Enter a category name.', 'error'); return null; }
    const existing = state.ledger.byName.get(name.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await db.from('bank_categories')
      .insert({ name, kind, created_by: state.profileId }).select('id, name, kind').single();
    if (error) { Utils.toast(`Could not add the category: ${error.message}`, 'error', 7000); return null; }
    state.cats.push(data);
    recategorize();
    renderCategoryList(); renderRules(); renderTxnToolbar();
    Utils.toast(`Added ${name} under ${kind === 'income' ? 'Income' : 'Expenses'}.`, 'success');
    return data.id;
  }

  async function setTxnCategory(t, categoryId) {
    const patch = {
      category_id: categoryId,
      category_set_at: categoryId ? new Date().toISOString() : null,
      category_set_by: categoryId ? state.profileId : null,
    };
    const { data, error } = await db.from('bank_transactions').update(patch).eq('id', t.id).select('id');
    if (error || !data?.length) {
      Utils.toast(`Could not save the category${error ? `: ${error.message}` : '.'}`, 'error', 7000);
      rerenderTxnViews();
      return;
    }
    for (const list of [state.txns, state.report.txns]) {
      const row = list.find(x => x.id === t.id);
      if (row) Object.assign(row, patch);
    }
    Object.assign(t, patch);
    const learned = categoryId ? await learnFrom(t) : null;
    if (learned) await loadCategories(); else recategorize();
    rerenderTxnViews();
    renderCats(); renderDeskbar(); renderTxnToolbar(); renderCategoryList(); renderRules();
  }

  // Remember a payee after it is categorized by hand, the way Quicken memorizes one:
  // add a rule so the next transaction from it lands in the same category. Skipped when
  // a rule already covers this transaction (then the choice is for this one only) or
  // when this payee's hand-set categories disagree.
  async function learnFrom(t) {
    const cat = state.ledger.byId.get(t.category_id);
    const covering = Cat.matchRule(t, state.compiled);
    if (covering) {
      if (covering.category !== cat?.name) {
        Utils.toast(`Set on this transaction. The rule "${covering.needle}" still files the others as ${covering.category}.`, 'info', 7000);
      }
      return null;
    }
    const key = Cat.payeeKey(t);
    if (!key) return null;
    const pool = state.txns.some(x => x.id === t.id) ? state.txns : [...state.txns, t];
    const direction = Number(t.amount) > 0 ? 'in' : 'out';
    const rule = Cat.learnableRules(pool, state.compiled, state.ledger, { onlyKey: key }).find(r => r.direction === direction);
    if (!rule) return null;
    const { error } = await db.from('bank_category_rules').insert({
      pattern: rule.pattern, category: rule.category, category_id: rule.category_id, direction: rule.direction, created_by: state.profileId,
    });
    if (error) { console.warn('[bank-accounts] could not learn a rule', error.message); return null; }
    Utils.toast(`Saved. From now on, "${rule.pattern}" ${direction === 'in' ? 'deposits are' : 'payments are'} ${rule.category}. (Categories tab › Category rules to change.)`, 'success', 7000);
    return rule;
  }

  async function learnAll() {
    const rules = Cat.learnableRules(state.txns, state.compiled, state.ledger);
    if (!rules.length) {
      Utils.toast('Nothing new to learn: every payee you have categorized is already covered by a rule, or its categories disagree.', 'info', 7000);
      return;
    }
    const sample = rules.slice(0, 8).map(r => `"${r.pattern}" → ${r.category}`).join('; ');
    const ok = await Utils.confirm(
      `Add ${rules.length} rule${rules.length === 1 ? '' : 's'} learned from the categories already set on transactions? ${sample}${rules.length > 8 ? '; …' : ''}. Each payee's future transactions (and any uncategorized ones now) get the same category.`,
      { confirmLabel: `Add ${rules.length} rule${rules.length === 1 ? '' : 's'}` });
    if (!ok) return;
    const { error } = await db.from('bank_category_rules').insert(rules.map(r => ({
      pattern: r.pattern, category: r.category, category_id: r.category_id, direction: r.direction, created_by: state.profileId,
    })));
    if (error) { Utils.toast(`Could not add the rules: ${error.message}`, 'error', 7000); return; }
    await afterCategoryChange();
    Utils.toast(`Added ${rules.length} learned rule${rules.length === 1 ? '' : 's'}.`, 'success');
  }

  // After a category changes: the transaction list, and the report if it has run.
  function rerenderTxnViews() {
    renderTxns();
    if (state.report.range) buildAndRenderReport();
  }

  // ── Render: categories tab ────────────────────────────────────────────────
  function categoryUse() {
    const txns = new Map();
    for (const t of state.txns) {
      const name = state.catOf.get(t.id);
      if (name) txns.set(name.toLowerCase(), (txns.get(name.toLowerCase()) || 0) + 1);
    }
    const rules = new Map();
    for (const r of state.compiled) rules.set(r.category.toLowerCase(), (rules.get(r.category.toLowerCase()) || 0) + 1);
    return { txns, rules };
  }

  function nameHtml(name) {
    const i = name.lastIndexOf(':');
    return i < 0 ? esc(name) : `<span class="ba-parent">${esc(name.slice(0, i + 1))}</span>${esc(name.slice(i + 1))}`;
  }

  function renderCategoryList() {
    const el = $('ba-cats');
    $('ba-cat-open').hidden = !state.canWrite || !state.catsOk || !$('ba-cat-form').hidden;
    if (!state.catsOk) { el.innerHTML = '<p class="dk-empty">Categories are not available yet.</p>'; return; }
    const list = state.ledger.list;
    $('ba-count-cats').textContent = list.length ? String(list.length) : '';
    if (!list.length) {
      el.innerHTML = '<p class="dk-empty">No categories yet. Add them here, or import from Quicken below to bring over the list you already use.</p>';
      return;
    }
    const use = categoryUse();
    const group = (label, kind) => {
      const rows = list.filter(c => c.kind === kind);
      if (!rows.length) return '';
      return `<div class="dk-reg-group">${label} <span class="n">${rows.length}</span></div>` + rows.map(c => {
        const nt = use.txns.get(c.name.toLowerCase()) || 0;
        const nr = use.rules.get(c.name.toLowerCase()) || 0;
        const meta = [`${nt} transaction${nt === 1 ? '' : 's'}`, nr ? `${nr} rule${nr === 1 ? '' : 's'}` : ''].filter(Boolean).join('<span class="sep">·</span>');
        const acts = state.canWrite ? `<div class="dk-reg-act">
            <button class="dk-linkbtn" type="button" data-cat-rename="${esc(c.id)}">Rename</button>
            <button class="dk-linkbtn" type="button" data-cat-kind="${esc(c.id)}">Move to ${kind === 'income' ? 'Expenses' : 'Income'}</button>
            <button class="dk-linkbtn d" type="button" data-cat-del="${esc(c.id)}">Delete</button>
          </div>` : '';
        return `<div class="dk-reg-row"><div><div class="dk-reg-title">${nameHtml(c.name)}</div><div class="dk-reg-meta">${meta}</div></div>${acts}</div>`;
      }).join('');
    };
    el.innerHTML = `<div class="dk-register ba-compact">${group('Income', 'income')}${group('Expenses', 'expense')}</div>`;
    el.querySelectorAll('[data-cat-rename]').forEach(b => b.addEventListener('click', () => renameCategory(b.dataset.catRename)));
    el.querySelectorAll('[data-cat-kind]').forEach(b => b.addEventListener('click', () => flipKind(b.dataset.catKind)));
    el.querySelectorAll('[data-cat-del]').forEach(b => b.addEventListener('click', () => deleteCategory(b.dataset.catDel)));
  }

  async function afterCategoryChange() {
    await loadCategories();
    renderDeskbar(); renderCats(); renderTxnToolbar(); renderTxns(); renderCategoryList(); renderRules();
    if (state.report.range) buildAndRenderReport();
  }

  async function renameCategory(id) {
    const c = state.ledger.byId.get(id);
    if (!c) return;
    const raw = await Utils.prompt(`Rename "${c.name}". Everything filed under it, and its rules, move with it.`, { confirmLabel: 'Rename', defaultValue: c.name });
    if (raw === null || raw === undefined) return;
    const name = Cat.normalizeCategoryName(raw);
    if (!name) { Utils.toast('Enter a category name.', 'error'); return; }
    if (name === c.name) return;
    const clash = state.ledger.byName.get(name.toLowerCase());
    if (clash && clash.id !== id) { Utils.toast(`There is already a category called ${clash.name}.`, 'error', 6000); return; }
    const { error } = await db.from('bank_categories').update({ name }).eq('id', id);
    if (error) { Utils.toast(`Could not rename: ${error.message}`, 'error', 7000); return; }
    // Keep the rules' own text in step with the list.
    await db.from('bank_category_rules').update({ category: name }).eq('category_id', id);
    await afterCategoryChange();
    Utils.toast(`Renamed to ${name}.`, 'success');
  }

  async function flipKind(id) {
    const c = state.ledger.byId.get(id);
    if (!c) return;
    const kind = c.kind === 'income' ? 'expense' : 'income';
    const { error } = await db.from('bank_categories').update({ kind }).eq('id', id);
    if (error) { Utils.toast(`Could not change it: ${error.message}`, 'error', 7000); return; }
    await afterCategoryChange();
  }

  async function deleteCategory(id) {
    const c = state.ledger.byId.get(id);
    if (!c) return;
    const nt = state.txns.filter(t => t.category_id === id).length;
    const nr = state.rules.filter(r => r.category_id === id).length;
    const parts = [
      nt ? `${nt} transaction${nt === 1 ? '' : 's'} filed under it go back to uncategorized (or to a matching rule)` : '',
      nr ? `its ${nr} rule${nr === 1 ? ' is' : 's are'} deleted` : '',
    ].filter(Boolean).join(', and ');
    const what = parts ? ` ${parts[0].toUpperCase()}${parts.slice(1)}.` : '';
    const ok = await Utils.confirm(`Delete the category "${c.name}"?${what}`, { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    const { error } = await db.from('bank_categories').delete().eq('id', id);
    if (error) { Utils.toast(`Could not delete: ${error.message}`, 'error', 7000); return; }
    state.txns.forEach(t => { if (t.category_id === id) t.category_id = null; });
    state.report.txns.forEach(t => { if (t.category_id === id) t.category_id = null; });
    await afterCategoryChange();
  }

  function openCatForm(open) {
    $('ba-cat-form').hidden = !open;
    $('ba-cat-open').hidden = open || !state.canWrite;
    if (open) $('ba-cat-name').focus();
    else { $('ba-cat-name').value = ''; $('ba-cat-kind').value = 'expense'; }
  }
  $('ba-cat-open').addEventListener('click', () => openCatForm(true));
  $('ba-cat-cancel').addEventListener('click', () => openCatForm(false));
  $('ba-cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = Cat.normalizeCategoryName($('ba-cat-name').value);
    if (!name) { Utils.toast('Enter a category name.', 'error'); return; }
    if (state.ledger.byName.has(name.toLowerCase())) { Utils.toast(`${name} is already on the list.`, 'error'); return; }
    const kind = $('ba-cat-kind').value === 'income' ? 'income' : 'expense';
    const btn = $('ba-cat-submit');
    btn.disabled = true;
    const { error } = await db.from('bank_categories').insert({ name, kind, created_by: state.profileId });
    btn.disabled = false;
    if (error) { Utils.toast(`Could not add the category: ${error.message}`, 'error', 7000); return; }
    openCatForm(false);
    await afterCategoryChange();
    Utils.toast(`Added ${name}.`, 'success');
  });

  // ── Render: category rules ────────────────────────────────────────────────
  const DIRECTION_LABEL = { any: 'money in and out', in: 'money in only', out: 'money out only' };

  function renderRules() {
    $('ba-rule-open').hidden = !state.canWrite || !state.catsOk || !$('ba-rule-form').hidden;
    $('ba-rule-learn').hidden = !state.canWrite || !state.catsOk;
    const list = state.ledger?.list || [];
    $('ba-rule-category').innerHTML = '<option value="">Choose…</option>' +
      ['income', 'expense'].map(k => {
        const rows = list.filter(c => c.kind === k);
        return rows.length ? `<optgroup label="${k === 'income' ? 'Income' : 'Expenses'}">${rows.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>` : '';
      }).join('');
    $('ba-count-rules').textContent = state.rules.length ? String(state.rules.length) : '';
    const el = $('ba-rules');
    if (!state.catsOk) { el.innerHTML = '<p class="dk-empty">Category rules are not available yet.</p>'; return; }
    if (!state.rules.length) {
      el.innerHTML = '<p class="dk-empty">No rules yet. A rule like "gusto" is <strong>Payroll</strong> sorts every matching transaction, past and future.</p>';
      return;
    }
    // How many loaded transactions each rule actually decides: the first match, and
    // only where no category is stored on the transaction.
    const decided = new Map();
    for (const t of state.txns) {
      if (Cat.categorySource(t, state.compiled, state.ledger) !== 'rule') continue;
      const r = Cat.matchRule(t, state.compiled);
      if (r?.id) decided.set(r.id, (decided.get(r.id) || 0) + 1);
    }
    el.innerHTML = `<div class="dk-register ba-compact">${state.rules.map(r => {
      const n = decided.get(r.id) || 0;
      const cat = r.category_id ? state.ledger.byId.get(r.category_id) : null;
      const name = cat?.name || r.category;
      const kind = cat?.kind || (r.direction === 'in' ? 'income' : 'expense');
      return `<div class="dk-reg-row">
        <div><div class="dk-reg-title"><span class="ba-pattern">"${esc(r.pattern)}"</span> → ${DK.tag(name, kind === 'income' ? 'ok' : 'crit')}</div>
          <div class="dk-reg-meta">${esc(DIRECTION_LABEL[r.direction] || DIRECTION_LABEL.any)}<span class="sep">·</span>${n} transaction${n === 1 ? '' : 's'}</div></div>
        ${state.canWrite ? `<div class="dk-reg-act"><button class="dk-linkbtn d" type="button" data-rule-del="${esc(r.id)}">Delete</button></div>` : ''}
      </div>`;
    }).join('')}</div>`;
    el.querySelectorAll('[data-rule-del]').forEach(b => b.addEventListener('click', () => deleteRule(b.dataset.ruleDel)));
  }

  function openRuleForm(open) {
    $('ba-rule-form').hidden = !open;
    $('ba-rule-open').hidden = open || !state.canWrite;
    if (open) $('ba-rule-pattern').focus();
    else { $('ba-rule-pattern').value = ''; $('ba-rule-category').value = ''; $('ba-rule-direction').value = 'any'; }
  }

  $('ba-rule-open').addEventListener('click', () => {
    if (!state.ledger?.list.length) { Utils.toast('Add a category first, then a rule that files transactions under it.', 'info', 6000); return; }
    openRuleForm(true);
  });
  $('ba-rule-cancel').addEventListener('click', () => openRuleForm(false));
  $('ba-rule-learn').addEventListener('click', learnAll);
  $('ba-rule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pattern = $('ba-rule-pattern').value.trim();
    const cat = state.ledger.byId.get($('ba-rule-category').value);
    const direction = $('ba-rule-direction').value;
    if (pattern.length < 2) { Utils.toast('Enter at least 2 characters to match on.', 'error'); return; }
    if (!cat) { Utils.toast('Choose a category.', 'error'); return; }
    const btn = $('ba-rule-submit');
    btn.disabled = true;
    try {
      const { error } = await db.from('bank_category_rules')
        .insert({ pattern, category: cat.name, category_id: cat.id, direction, created_by: state.profileId });
      if (error) throw new Error(error.message);
      openRuleForm(false);
      await afterCategoryChange();
      Utils.toast(`Rule added: "${pattern}" is ${cat.name}.`, 'success');
    } catch (err) {
      Utils.toast(`Could not add the rule: ${err.message}`, 'error', 7000);
    } finally {
      btn.disabled = false;
    }
  });

  async function deleteRule(id) {
    const r = state.rules.find(x => x.id === id);
    const ok = await Utils.confirm(`Delete the rule "${r?.pattern}" → ${r?.category}? Matching transactions go back to uncategorized (or to the next rule that matches). Categories set on a transaction stay.`,
      { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    const { error } = await db.from('bank_category_rules').delete().eq('id', id);
    if (error) { Utils.toast(`Could not delete the rule: ${error.message}`, 'error', 7000); return; }
    await afterCategoryChange();
  }

  // ── Report tab ────────────────────────────────────────────────────────────
  function reportRange() {
    const r = state.report;
    if (r.period === 'custom') return r.from && r.to && r.from <= r.to ? { from: r.from, to: r.to } : null;
    return Cat.periodRange(r.period);
  }

  function renderReportControls() {
    const sel = $('ba-rep-account');
    sel.innerHTML = '<option value="">All accounts</option>' + state.accounts.map(a =>
      `<option value="${esc(a.id)}">${esc(a.name)}${a.present ? '' : ' (no longer reported)'}</option>`).join('');
    if (state.report.account && !state.accounts.some(a => a.id === state.report.account)) state.report.account = '';
    sel.value = state.report.account;
    $('ba-rep-period').value = state.report.period;
    $('ba-rep-custom').hidden = state.report.period !== 'custom';
  }

  async function runReport() {
    const r = state.report;
    r.loaded = true;
    if (!Cat) { $('ba-report').innerHTML = '<p class="dk-empty">The report is not available.</p>'; return; }
    const range = reportRange();
    if (!range) { r.range = null; r.data = null; $('ba-report').innerHTML = '<p class="dk-empty">Choose a start and end date.</p>'; return; }
    const seq = ++r.seq;
    $('ba-report').innerHTML = '<p class="dk-empty">Running the report…</p>';
    // Local-day boundaries: from midnight on the first day to midnight after the last.
    const start = new Date(`${range.from}T00:00:00`).toISOString();
    const endD = new Date(`${range.to}T00:00:00`);
    endD.setDate(endD.getDate() + 1);
    const res = await selectPaged(() => {
      let q = db.from('bank_transactions').select(TXN_COLS)
        .gte('posted_at', start).lt('posted_at', endD.toISOString())
        .order('posted_at').order('id');
      if (r.account) q = q.eq('account_id', r.account);
      return q;
    }, 100000);
    if (seq !== r.seq) return;   // a newer run started meanwhile
    if (res.error) { r.range = null; r.data = null; $('ba-report').innerHTML = '<p class="dk-empty" style="color:var(--color-danger)">Could not run the report.</p>'; return; }
    r.txns = res.data;
    r.range = range;
    buildAndRenderReport();
  }

  function buildAndRenderReport() {
    const r = state.report;
    if (!r.range) return;
    r.data = Cat.buildReport(r.txns, state.compiled, state.ledger);
    renderReport();
  }

  function renderReport() {
    const r = state.report;
    const rep = r.data;
    const cur = currencyOf();
    const acct = r.account ? accountById().get(r.account) : null;
    const span = `${Utils.formatDate(r.range.from)} – ${Utils.formatDate(r.range.to)}`;
    const head = `<p class="ba-rep-title">${esc(span)} · ${esc(acct ? acct.name : 'All accounts')} · ${rep.count} transaction${rep.count === 1 ? '' : 's'}</p>`;
    if (!rep.count) {
      $('ba-report').innerHTML = head + '<p class="dk-empty">No transactions in this period. Bank history starts about 90 days before the bank was connected; for anything earlier, use Import from Quicken on the Categories tab.</p>';
      return;
    }
    const amt = (n) => `<span class="ba-amt${n < 0 ? ' neg' : ''}">${esc(money(n, cur))}</span>`;
    const disc = (key, open, label) => `<button class="dk-disclosure" type="button" data-rep-toggle="${esc(key)}" aria-expanded="${open}" aria-label="${esc(label)}">${CHEVRON}</button>`;
    const accounts = accountById();
    const multi = !r.account && state.accounts.length > 1;

    const txnList = (txns) => `<div class="ba-rep-txns">${txns.slice(0, REPORT_TXN_ROWS).map(t => {
      const a = accounts.get(t.account_id);
      const who = t.payee || t.description || 'Transaction';
      return `<div class="ba-rep-txn"><span class="d">${esc(Utils.formatDate(t.posted_at))}</span>
        <span class="p" title="${esc(who)}">${esc(who)}${multi && a ? ` <span class="ba-parent">· ${esc(a.name)}</span>` : ''}${catControl(t)}</span>
        ${amt(Number(t.amount))}</div>`;
    }).join('')}${txns.length > REPORT_TXN_ROWS ? `<div class="ba-rep-txn"><span></span><span class="p">…and ${txns.length - REPORT_TXN_ROWS} more. Transactions CSV has them all.</span><span></span></div>` : ''}</div>`;

    const memberRow = (m, key, child, unc) => {
      const open = r.open.has(key);
      return `<div class="ba-rep-row${child ? ' child' : ''}${unc ? ' unc' : ''}">
          ${disc(key, open, `Show the transactions in ${m.name}`)}
          <span class="ba-rep-name">${esc(child ? m.label : m.name)}</span>
          <span class="ba-rep-n">${m.count}</span>
          ${amt(m.total)}
        </div>${open ? txnList(m.txns) : ''}`;
    };

    const section = (label, sec, kindKey) => {
      if (!sec.groups.length) {
        return `<div class="dk-reg-group">${label}<span class="ba-rep-sum">${esc(money(0, cur))}</span></div><p class="dk-empty" style="padding:10px 20px;margin:0">None in this period.</p>`;
      }
      const rows = sec.groups.map(g => {
        const gKey = `${kindKey}|${g.name}`;
        const single = g.members.length === 1 && g.members[0].name === g.name;
        if (single) return memberRow(g.members[0], `${gKey}|txns`, false, g.uncategorized);
        const open = r.open.has(gKey);
        return `<div class="ba-rep-row">
            ${disc(gKey, open, `Show the subcategories of ${g.name}`)}
            <span class="ba-rep-name">${esc(g.name)}</span>
            <span class="ba-rep-n">${g.count}</span>
            ${amt(g.total)}
          </div>${open ? g.members.map(m => memberRow(m, `${gKey}|${m.name}`, true, false)).join('') : ''}`;
      }).join('');
      return `<div class="dk-reg-group">${label} <span class="n">${sec.count}</span><span class="ba-rep-sum${sec.total < 0 ? ' neg' : ''}">${esc(money(sec.total, cur))}</span></div>${rows}`;
    };

    $('ba-report').innerHTML = `${head}<div class="dk-register ba-rep">
        ${section('Income', rep.income, 'in')}
        ${section('Expenses', rep.expenses, 'out')}
        <div class="ba-rep-net"><span class="lbl">Overall</span>${amt(rep.net)}</div>
      </div>`;

    $('ba-report').querySelectorAll('[data-rep-toggle]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.repToggle;
      if (r.open.has(k)) r.open.delete(k); else r.open.add(k);
      renderReport();
    }));
    wirePickers($('ba-report'));
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('ba-rep-period').addEventListener('change', (e) => {
    state.report.period = e.target.value;
    $('ba-rep-custom').hidden = state.report.period !== 'custom';
    if (state.report.period === 'custom' && !state.report.from) {
      state.report.from = $('ba-rep-from').value = Cat.periodRange('this_year').from;
      state.report.to = $('ba-rep-to').value = Cat.isoDay(new Date());
    }
    state.report.open.clear();
    runReport();
  });
  ['ba-rep-from', 'ba-rep-to'].forEach(id => $(id).addEventListener('change', () => {
    state.report.from = $('ba-rep-from').value;
    state.report.to = $('ba-rep-to').value;
    runReport();
  }));
  $('ba-rep-account').addEventListener('change', (e) => { state.report.account = e.target.value; runReport(); });
  $('ba-rep-print').addEventListener('click', () => {
    if (!state.report.data) return;
    document.body.classList.add('ba-printing');
    const done = () => { document.body.classList.remove('ba-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  });
  $('ba-rep-csv').addEventListener('click', () => {
    const r = state.report;
    if (!r.data) return;
    download(`income-expenses-by-category_${r.range.from}_to_${r.range.to}.csv`, Cat.reportCsv(r.data));
  });
  $('ba-rep-csv-txns').addEventListener('click', () => {
    const r = state.report;
    if (!r.data) return;
    const accounts = accountById();
    const rows = [['Date', 'Account', 'Payee', 'Description', 'Memo', 'Category', 'Kind', 'Amount']];
    for (const t of r.txns) {
      const name = Cat.categorize(t, state.compiled, state.ledger);
      const kind = name ? (state.ledger.byName.get(name.toLowerCase())?.kind || '') : '';
      rows.push([String(t.posted_at).slice(0, 10), accounts.get(t.account_id)?.name || '', t.payee || '', t.description || '', t.memo || '', name || Cat.UNCATEGORIZED, kind, Number(t.amount).toFixed(2)]);
    }
    download(`transactions_${r.range.from}_to_${r.range.to}.csv`, Cat.toCsv(rows));
  });

  // ── Import from Quicken ───────────────────────────────────────────────────
  function renderImportAccounts() {
    const sel = $('ba-import-account');
    const prev = sel.value;
    const live = state.accounts.filter(a => a.present);
    sel.innerHTML = '<option value="">Choose the account…</option>' + state.accounts.map(a =>
      `<option value="${esc(a.id)}">${esc(a.name)}${a.institution ? ' · ' + esc(a.institution) : ''}</option>`).join('');
    sel.value = state.accounts.some(a => a.id === prev) ? prev : (live.length === 1 ? live[0].id : '');
    $('ba-import-preview-btn').disabled = !(state.canAdmin && Qif && state.catsOk && state.accounts.length);
    if (!state.canAdmin) $('ba-import-result').innerHTML = '<p class="dk-empty">Only the Owner can import.</p>';
    else if (!state.accounts.length) $('ba-import-result').innerHTML = '<p class="dk-empty">Connect the bank first. History is imported into one of its accounts.</p>';
  }

  $('ba-import-file').addEventListener('change', async (e) => {
    state.qif = null;
    state.importPlan = null;
    $('ba-import-result').innerHTML = '';
    $('ba-import-src-wrap').hidden = true;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = Qif.parseQif(Qif.decodeQifBytes(await file.arrayBuffer()));
      if (!parsed.entries.length) {
        $('ba-import-result').innerHTML = '<p class="dk-empty" style="color:var(--color-danger)">No transactions found in that file. Export it from Quicken as a QIF file with Transactions ticked.</p>';
        return;
      }
      state.qif = parsed;
      $('ba-import-src').innerHTML = parsed.accounts.map(a =>
        `<option value="${esc(a.name)}">${esc(a.name)} (${a.count}, ${esc(Utils.formatDate(a.from))} – ${esc(Utils.formatDate(a.to))})</option>`).join('');
      $('ba-import-src-wrap').hidden = parsed.accounts.length < 2;
    } catch (err) {
      console.error('[bank-accounts] QIF parse failed', err);
      $('ba-import-result').innerHTML = '<p class="dk-empty" style="color:var(--color-danger)">Could not read that file.</p>';
    }
  });
  // A different source account or target account means a different plan.
  ['ba-import-src', 'ba-import-account'].forEach(id => $(id).addEventListener('change', () => {
    if (state.importPlan) { state.importPlan = null; $('ba-import-result').innerHTML = ''; }
  }));

  function importPayload(dryRun) {
    const src = state.qif.accounts.length > 1 ? $('ba-import-src').value : state.qif.accounts[0]?.name;
    return {
      action: 'import',
      account_id: $('ba-import-account').value,
      dry_run: dryRun,
      categories: state.qif.categories,
      entries: state.qif.entries.filter(e => e.account === src).map(({ account, ...rest }) => rest),
    };
  }

  $('ba-import-preview-btn').addEventListener('click', async () => {
    if (!state.qif) { Utils.toast('Choose the QIF file first.', 'error'); return; }
    if (!$('ba-import-account').value) { Utils.toast('Choose the account to import into.', 'error'); return; }
    const btn = $('ba-import-preview-btn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const { import: plan } = await api(importPayload(true));
      state.importPlan = plan;
      renderImportPlan();
    } catch (err) {
      Utils.toast(err.message, 'error', 8000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Preview';
    }
  });

  function renderImportPlan() {
    const p = state.importPlan;
    const q = state.qif;
    const d = (s) => esc(Utils.formatDate(s));
    const rows = [];
    const row = (title, meta, tag) => rows.push(`<div class="dk-reg-row"><div><div class="dk-reg-title">${title}${tag ? ' ' + tag : ''}</div>${meta ? `<div class="dk-reg-meta">${meta}</div>` : ''}</div></div>`);
    const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    const skippedLines = q.skipped + p.dropped;

    row(`${plural(p.entries, 'transaction', 'transactions')} in the file`,
      `${d(p.from)} – ${d(p.to)}${skippedLines ? `<span class="sep">·</span>${plural(skippedLines, 'unreadable or zero-amount entry', 'unreadable or zero-amount entries')} left out` : ''}`);
    row(`${p.add} will be added`,
      p.cutoff ? `dated before the bank feed starts on ${d(p.cutoff)}, each with its Quicken category` : 'this account has nothing from the bank feed yet, so everything is added',
      p.add ? DK.tag('Add', 'ok') : '');
    if (p.already_added) row(`${p.already_added} already added by an earlier import`, 'left as they are', DK.tag('Skip', 'mut'));
    if (p.matched) {
      const bits = [
        `${p.match_categorize} get Quicken's category`,
        p.match_already_set ? `${p.match_already_set} already have a category, kept` : '',
        p.match_split ? `${p.match_split} are split in Quicken, so set those by hand` : '',
        p.matched - p.match_categorize - p.match_already_set - p.match_split > 0 ? `${p.matched - p.match_categorize - p.match_already_set - p.match_split} have no category in Quicken either` : '',
      ].filter(Boolean).join('<span class="sep">·</span>');
      row(`${p.matched} match transactions the bank feed already has`, `Nothing is added for these.<span class="sep">·</span>${bits}`, DK.tag('Match', 'acc'));
    }
    if (p.unmatched) {
      const samples = p.unmatched_samples.map(s => `<li>${d(s.date)} · ${esc(s.payee || 'No payee')} · ${esc(money(s.amount))}</li>`).join('');
      row(`${p.unmatched} in the feed's period that the bank never reported`,
        `Left out, so nothing is counted twice. Usually these were typed into Quicken by hand, or are still pending at the bank.<ul class="ba-import-samples">${samples}${p.unmatched > p.unmatched_samples.length ? '<li>…</li>' : ''}</ul>`,
        DK.tag('Skip', 'warn'));
    }
    if (p.new_categories.length) {
      row(`${plural(p.new_categories.length, 'new category', 'new categories')} will be created`,
        p.new_categories.map(c => `${esc(c.name)} (${c.kind})`).join('<span class="sep">·</span>'));
    }
    if (q.warnings.length) row(plural(q.warnings.length, 'note on the file', 'notes on the file'), q.warnings.slice(0, 5).map(esc).join('<br>'));

    const nothing = !p.add && !p.match_categorize && !p.new_categories.length;
    $('ba-import-result').innerHTML = `<div class="dk-register ba-import-sum">${rows.join('')}</div>
      <div class="ba-connect-actions" style="margin-top:12px">
        ${nothing ? '<p class="dk-empty" style="margin:0">Nothing to change: this file is already in.</p>'
          : '<button class="btn btn--primary" id="ba-import-run" type="button">Import</button>'}
      </div>`;
    $('ba-import-run')?.addEventListener('click', runImportNow);
  }

  async function runImportNow() {
    const btn = $('ba-import-run');
    btn.disabled = true;
    btn.textContent = 'Importing…';
    try {
      const { import: r } = await api(importPayload(false));
      Utils.toast(`Imported: ${r.added_rows} added, ${r.categorized} categorized${r.categories_created ? `, ${r.categories_created} new categories` : ''}.`, 'success', 8000);
      $('ba-import-result').innerHTML = '';
      $('ba-import-file').value = '';
      $('ba-import-src-wrap').hidden = true;
      state.qif = null;
      state.importPlan = null;
      await reload();
    } catch (err) {
      Utils.toast(err.message, 'error', 9000);
      btn.disabled = false;
      btn.textContent = 'Import';
    }
  }

  // ── Everything ────────────────────────────────────────────────────────────
  function renderAll() {
    renderDeskbar();
    renderConns();
    renderAccounts();
    renderCats();
    renderTxnToolbar();
    renderTxns();
    renderCategoryList();
    renderRules();
    renderReportControls();
    renderImportAccounts();
    if (state.report.loaded) runReport();
  }

  async function reload() { if (await load()) renderAll(); }

  // ── Filters ───────────────────────────────────────────────────────────────
  function setAccountFilter(id) {
    state.accountFilter = id;
    state.shown = PAGE;
    $('ba-txn-account').value = id;
    renderAccounts();
    renderCats();
    renderTxns();
  }

  function setCatFilter(cat, scroll) {
    state.catFilter = cat;
    state.shown = PAGE;
    $('ba-txn-cat').value = cat;
    renderCats();
    renderTxns();
    if (scroll && cat) $('ba-sec-txns').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Actions: connections ──────────────────────────────────────────────────
  async function syncNow(btn) {
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Syncing…';
    try {
      const { sync } = await api({ action: 'sync', id: btn.dataset.sync });
      Utils.toast(sync.warning ? `Synced, with a warning from the bank: ${sync.warning}` : 'Synced.', sync.warning ? 'warning' : 'success');
      await reload();
    } catch (err) {
      Utils.toast(err.message, 'error', 7000);
      btn.disabled = false;
      btn.textContent = label;
      await reload();
    }
  }

  async function disconnect(id) {
    const c = state.conns.find(x => x.id === id);
    const ok = await Utils.confirm(
      `Disconnect "${c?.label || 'this connection'}"? Its accounts and transactions are removed from the portal, including history imported from Quicken into them and every category set on them. To cut SimpleFIN's access too, also delete the app in SimpleFIN Bridge.`,
      { danger: true, confirmLabel: 'Disconnect' });
    if (!ok) return;
    try {
      await api({ action: 'disconnect', id });
      if (state.accountFilter && state.accounts.find(a => a.id === state.accountFilter)?.connection_id === id) state.accountFilter = '';
      Utils.toast('Disconnected.', 'success');
      await reload();
    } catch (err) {
      Utils.toast(err.message, 'error', 7000);
    }
  }

  function openForm(open) {
    $('ba-connect-form').hidden = !open;
    $('ba-connect-open').hidden = open || !state.canAdmin;
    if (open) $('ba-connect-token').focus();
    else { $('ba-connect-token').value = ''; $('ba-connect-label').value = ''; }
  }

  $('ba-connect-open').addEventListener('click', () => openForm(true));
  $('ba-connect-cancel').addEventListener('click', () => openForm(false));
  $('ba-connect-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = $('ba-connect-token').value.trim();
    if (!token) { Utils.toast('Paste the setup token from SimpleFIN Bridge.', 'error'); return; }
    const btn = $('ba-connect-submit');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      const { sync } = await api({ action: 'connect', setup_token: token, label: $('ba-connect-label').value.trim() });
      openForm(false);
      if (sync?.ok) {
        Utils.toast(`Connected: ${sync.accounts} account${sync.accounts === 1 ? '' : 's'}, ${sync.transactions} transaction${sync.transactions === 1 ? '' : 's'}.`, 'success', 6000);
      } else {
        Utils.toast(`Connected, but the first sync failed: ${sync?.error || 'unknown error'}`, 'warning', 8000);
      }
      await reload();
    } catch (err) {
      Utils.toast(err.message, 'error', 9000);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  });

  // ── Filter controls ───────────────────────────────────────────────────────
  $('ba-txn-account').addEventListener('change', (e) => setAccountFilter(e.target.value));
  $('ba-txn-cat').addEventListener('change', (e) => setCatFilter(e.target.value, false));
  document.querySelectorAll('#ba-period [data-days]').forEach(b => b.addEventListener('click', () => {
    state.days = Number(b.dataset.days);
    renderCats();
  }));
  let searchTimer;
  $('ba-txn-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value; state.shown = PAGE; renderTxns(); }, 150);
  });
  $('ba-txn-more').addEventListener('click', () => { state.shown += PAGE; renderTxns(); });

  await reload();
  if (!state.conns.length && state.canAdmin) openForm(true);
})();
