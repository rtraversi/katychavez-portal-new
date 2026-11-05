'use strict';

// Bank Accounts: the firm's own balances + transactions (bank_feeds module).
// Reads bank_connections / bank_accounts / bank_transactions / bank_category_rules
// through RLS (can_read('bank_feeds'), Owner by default). Connect / sync / disconnect
// go through POST /api/bank-feeds, because the provider credential never reaches the
// browser. Category rules are plain firm data and are written directly (RLS
// can_write('bank_feeds')). Categorizing happens here, at render time, so editing a
// rule recategorizes history at once. The logic is in categorize.js.
(async function BankAccountsPage() {
  const esc = (s) => Utils.esc(s == null ? '' : String(s));
  const $ = (id) => document.getElementById(id);
  const PAGE = 150;
  const TOP_IN = 5;    // income categories shown (deposits)
  const TOP_OUT = 7;   // expense categories shown (payments)
  const NONE = '__none__';   // category filter value for "Uncategorized"

  let Cat;
  try {
    Cat = await import(`/pages/bank-accounts/categorize.js?v=${window.APP_CONFIG?.deployVersion || ''}`);
  } catch (err) {
    console.error('[bank-accounts] categorize.js failed to load', err);
  }

  const state = {
    conns: [], accounts: [], txns: [], rules: [], rulesOk: false,
    compiled: [], catOf: new Map(),
    accountFilter: '', catFilter: '', search: '', shown: PAGE, days: 30,
    canWrite: false,
  };

  try {
    const writable = await Auth.getAccessibleModules('write');
    state.canWrite = writable.has('bank_feeds');
  } catch { /* read-only view */ }

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

  // ── Load ──────────────────────────────────────────────────────────────────
  async function load() {
    const [c, a, t] = await Promise.all([
      db.from('bank_connections').select('id, provider, label, status, last_attempt_at, last_synced_at, last_error, created_at').order('created_at'),
      db.from('bank_accounts').select('id, connection_id, name, institution, currency, balance, available_balance, balance_date, present').order('name'),
      db.from('bank_transactions').select('id, account_id, posted_at, amount, description, payee, memo').order('posted_at', { ascending: false }).limit(2000),
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
    await loadRules();
    return true;
  }

  // Rules load separately: a failure here (e.g. the table not migrated yet) must not
  // take the balances down with it.
  async function loadRules() {
    const r = await db.from('bank_category_rules')
      .select('id, pattern, category, direction, priority, created_at')
      .order('priority').order('created_at');
    state.rulesOk = !r.error && !!Cat;
    state.rules = state.rulesOk ? (r.data || []) : [];
    recategorize();
  }

  function recategorize() {
    state.compiled = Cat ? Cat.compileRules(state.rules) : [];
    state.catOf = new Map(state.txns.map(t => [t.id, Cat ? Cat.categorize(t, state.compiled) : null]));
  }

  const accountById = () => new Map(state.accounts.map(a => [a.id, a]));
  const connById = () => new Map(state.conns.map(c => [c.id, c]));
  const currencyOf = () => state.accounts.find(a => a.present)?.currency || 'USD';

  // ── Render: deskbar ───────────────────────────────────────────────────────
  function renderDeskbar() {
    const live = state.accounts.filter(a => a.present);
    const lastSync = state.conns.map(c => c.last_synced_at).filter(Boolean).sort().pop();
    const problems = state.conns.filter(c => c.status === 'revoked' || c.last_error).length;
    if (!state.conns.length) { $('ba-deskbar').innerHTML = ''; return; }
    const chips = [live.length
      ? { n: live.length, label: live.length === 1 ? 'account' : 'accounts', jump: 'ba-sec-accounts' }
      : { label: 'No accounts yet', static: true }];
    if (lastSync) chips.push({ label: `Synced ${Utils.formatDateTime(lastSync)}`, static: true });
    if (problems) chips.push({ n: problems, label: problems === 1 ? 'connection needs attention' : 'connections need attention', tone: 'warn', jump: 'ba-sec-conns' });
    $('ba-deskbar').innerHTML = DK.deskbar(chips);
    DK.wireDeskbar && DK.wireDeskbar($('ba-deskbar'));
  }

  // ── Render: accounts ──────────────────────────────────────────────────────
  function renderAccounts() {
    const live = state.accounts.filter(a => a.present);
    $('ba-count-accounts').textContent = live.length ? String(live.length) : '';
    if (!live.length) {
      $('ba-accounts').innerHTML = state.conns.length
        ? '<p class="dk-empty">No accounts yet. They appear after the first sync.</p>'
        : '<p class="dk-empty">No bank connected yet. Use <strong>Connect a bank</strong> below.</p>';
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

  // ── Render: income / expenses ─────────────────────────────────────────────
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
    if (!state.rulesOk) {
      setTotals('', '');
      inEl.innerHTML = outEl.innerHTML = '<p class="dk-empty">Categories are not available yet.</p>';
      return;
    }

    const cur = currencyOf();
    const { income, expenses } = Cat.summarizeFlows(summaryTxns(), state.compiled);
    const sum = (s) => s.categories.reduce((n, c) => n + Math.round(c.total * 100), Math.round(s.uncategorized.total * 100)) / 100;
    const totalIn = sum(income);
    const totalOut = sum(expenses);
    setTotals(totalIn ? signed(totalIn, cur) : '', totalOut ? signed(totalOut, cur) : '');

    const hint = state.rules.length ? '' : (state.canWrite ? ' Add category rules below to sort them.' : '');
    const inList = flowList(income, { limit: TOP_IN, kind: 'in', cur });
    const outList = flowList(expenses, { limit: TOP_OUT, kind: 'out', cur });
    inEl.innerHTML = inList.hasRows ? inList.html : `<p class="dk-empty">No deposits in the last ${state.days} days.</p>`;
    outEl.innerHTML = outList.hasRows ? outList.html
      : expenses.uncategorized.count
        ? `<p class="dk-empty">${expenses.uncategorized.count} payments, none categorized yet.${hint}</p>`
        : `<p class="dk-empty">No payments in the last ${state.days} days.</p>`;

    [inEl, outEl].forEach(el => el.querySelectorAll('[data-cat]').forEach(r => r.addEventListener('click', () => {
      setCatFilter(state.catFilter === r.dataset.cat ? '' : r.dataset.cat, true);
    })));
  }

  // ── Render: transactions ──────────────────────────────────────────────────
  function allCategories() {
    return [...new Set(state.rules.map(r => String(r.category).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function renderTxnToolbar() {
    const sel = $('ba-txn-account');
    sel.innerHTML = '<option value="">All accounts</option>' + state.accounts.map(a =>
      `<option value="${esc(a.id)}">${esc(a.name)}${a.institution ? ' · ' + esc(a.institution) : ''}${a.present ? '' : ' (no longer reported)'}</option>`).join('');
    sel.value = state.accountFilter;

    const cats = allCategories();
    const csel = $('ba-txn-cat');
    csel.hidden = !state.rulesOk || !cats.length;
    csel.innerHTML = '<option value="">All categories</option>' +
      cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') +
      `<option value="${NONE}">Uncategorized</option>`;
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
    const multi = new Set(state.accounts.map(a => a.id)).size > 1 && !state.accountFilter;
    $('ba-txns').innerHTML = `<div class="dk-register">${list.slice(0, state.shown).map(t => {
      const a = accounts.get(t.account_id);
      const n = Number(t.amount);
      const title = t.payee || t.description || 'Transaction';
      const cat = state.catOf.get(t.id);
      const meta = [
        esc(Utils.formatDate(t.posted_at)),
        multi && a ? esc(a.name) : '',
        t.payee && t.description && t.description !== t.payee ? esc(t.description) : '',
      ].filter(Boolean).join('<span class="sep">·</span>');
      return `<div class="dk-reg-row">
        <div><div class="dk-reg-title">${esc(title)}${cat ? ' ' + DK.tag(cat, n > 0 ? 'ok' : 'mut') : ''}</div><div class="dk-reg-meta">${meta}</div></div>
        <div class="ba-amt${n > 0 ? ' in' : ''}">${esc(signed(n, a?.currency || 'USD'))}</div>
      </div>`;
    }).join('')}</div>`;
    $('ba-txn-more-wrap').hidden = list.length <= state.shown;
  }

  // ── Render: connections ───────────────────────────────────────────────────
  function renderConns() {
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
      return `<div class="dk-reg-row">
        <div><div class="dk-reg-title">${esc(c.label)} ${tag}</div><div class="dk-reg-meta">${meta}</div></div>
        <div class="dk-reg-act">
          ${c.status === 'revoked' ? '' : `<button class="dk-linkbtn" type="button" data-sync="${esc(c.id)}">Sync now</button>`}
          <button class="dk-linkbtn d" type="button" data-disconnect="${esc(c.id)}">Disconnect</button>
        </div>
      </div>`;
    }).join('')}</div>`;

    $('ba-conns').querySelectorAll('[data-sync]').forEach(b => b.addEventListener('click', () => syncNow(b)));
    $('ba-conns').querySelectorAll('[data-disconnect]').forEach(b => b.addEventListener('click', () => disconnect(b.dataset.disconnect)));
  }

  // ── Render: category rules ────────────────────────────────────────────────
  const DIRECTION_LABEL = { any: 'money in and out', in: 'money in only', out: 'money out only' };

  function renderRules() {
    $('ba-rule-open').hidden = !state.canWrite || !state.rulesOk || !$('ba-rule-form').hidden;
    $('ba-cat-list').innerHTML = allCategories().map(c => `<option value="${esc(c)}">`).join('');
    $('ba-count-rules').textContent = state.rules.length ? String(state.rules.length) : '';
    const el = $('ba-rules');
    if (!state.rulesOk) { el.innerHTML = '<p class="dk-empty">Category rules are not available yet.</p>'; return; }
    if (!state.rules.length) {
      el.innerHTML = `<p class="dk-empty">No rules yet. A rule like "gusto" is <strong>Payroll</strong> sorts every matching transaction, past and future.</p>`;
      return;
    }
    // How many loaded transactions each rule actually decides (first match wins).
    const decided = new Map();
    for (const t of state.txns) {
      const hay = Cat.haystack(t);
      const dir = Number(t.amount) > 0 ? 'in' : 'out';
      const r = state.compiled.find(x => (x.direction === 'any' || x.direction === dir) && hay.includes(x.needle));
      if (r) decided.set(r, (decided.get(r) || 0) + 1);
    }
    const countFor = (rule) => {
      const needle = String(rule.pattern).trim().toLowerCase();
      const c = state.compiled.find(x => x.needle === needle && x.category === String(rule.category).trim() && x.direction === (rule.direction || 'any'));
      return c ? (decided.get(c) || 0) : 0;
    };
    el.innerHTML = `<div class="dk-register">${state.rules.map(r => {
      const n = countFor(r);
      return `<div class="dk-reg-row">
        <div><div class="dk-reg-title"><span class="ba-pattern">"${esc(r.pattern)}"</span> → ${DK.tag(r.category, r.direction === 'in' ? 'ok' : 'acc')}</div>
          <div class="dk-reg-meta">${esc(DIRECTION_LABEL[r.direction] || DIRECTION_LABEL.any)}<span class="sep">·</span>${n} transaction${n === 1 ? '' : 's'}</div></div>
        ${state.canWrite ? `<div class="dk-reg-act"><button class="dk-linkbtn d" type="button" data-rule-del="${esc(r.id)}">Delete</button></div>` : ''}
      </div>`;
    }).join('')}</div>`;
    el.querySelectorAll('[data-rule-del]').forEach(b => b.addEventListener('click', () => deleteRule(b.dataset.ruleDel)));
  }

  function renderAll() {
    renderDeskbar();
    renderAccounts();
    renderCats();
    renderTxnToolbar();
    renderTxns();
    renderConns();
    renderRules();
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
      `Disconnect "${c?.label || 'this connection'}"? Its accounts and transactions are removed from the portal. To cut SimpleFIN's access too, also delete the app in SimpleFIN Bridge.`,
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
    $('ba-connect-open').hidden = open;
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

  // ── Actions: category rules ───────────────────────────────────────────────
  function openRuleForm(open) {
    $('ba-rule-form').hidden = !open;
    $('ba-rule-open').hidden = open || !state.canWrite;
    if (open) $('ba-rule-pattern').focus();
    else { $('ba-rule-pattern').value = ''; $('ba-rule-category').value = ''; $('ba-rule-direction').value = 'any'; }
  }

  $('ba-rule-open').addEventListener('click', () => openRuleForm(true));
  $('ba-rule-cancel').addEventListener('click', () => openRuleForm(false));
  $('ba-rule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pattern = $('ba-rule-pattern').value.trim();
    const category = $('ba-rule-category').value.trim();
    const direction = $('ba-rule-direction').value;
    if (pattern.length < 2) { Utils.toast('Enter at least 2 characters to match on.', 'error'); return; }
    if (!category) { Utils.toast('Enter a category.', 'error'); return; }
    const btn = $('ba-rule-submit');
    btn.disabled = true;
    try {
      const profile = await Auth.getProfile().catch(() => null);
      const { error } = await db.from('bank_category_rules')
        .insert({ pattern, category, direction, created_by: profile?.id || null });
      if (error) throw new Error(error.message);
      openRuleForm(false);
      await loadRules();
      renderCats(); renderTxnToolbar(); renderTxns(); renderRules();
      Utils.toast(`Rule added: "${pattern}" is ${category}.`, 'success');
    } catch (err) {
      Utils.toast(`Could not add the rule: ${err.message}`, 'error', 7000);
    } finally {
      btn.disabled = false;
    }
  });

  async function deleteRule(id) {
    const r = state.rules.find(x => x.id === id);
    const ok = await Utils.confirm(`Delete the rule "${r?.pattern}" → ${r?.category}? Matching transactions go back to uncategorized (or to the next rule that matches).`,
      { danger: true, confirmLabel: 'Delete' });
    if (!ok) return;
    const { error } = await db.from('bank_category_rules').delete().eq('id', id);
    if (error) { Utils.toast(`Could not delete the rule: ${error.message}`, 'error', 7000); return; }
    await loadRules();
    renderCats(); renderTxnToolbar(); renderTxns(); renderRules();
  }

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
  if (!state.conns.length) openForm(true);
})();
