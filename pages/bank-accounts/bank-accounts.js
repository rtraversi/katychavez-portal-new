'use strict';

// Bank Accounts: the firm's own balances + transactions (bank_feeds module).
// Reads bank_connections / bank_accounts / bank_transactions through RLS
// (can_read('bank_feeds'), Owner by default). Connect / sync / disconnect go through
// POST /api/bank-feeds, because the provider credential never reaches the browser.
(async function BankAccountsPage() {
  const esc = (s) => Utils.esc(s == null ? '' : String(s));
  const $ = (id) => document.getElementById(id);
  const PAGE = 150;

  const state = { conns: [], accounts: [], txns: [], accountFilter: '', search: '', shown: PAGE };

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
    return true;
  }

  const accountById = () => new Map(state.accounts.map(a => [a.id, a]));
  const connById = () => new Map(state.conns.map(c => [c.id, c]));

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
      return `<div class="dk-reg-row ba-pick${state.accountFilter === a.id ? ' is-active' : ''}" data-account="${esc(a.id)}" title="Show this account's transactions">
        <div><div class="dk-reg-title">${esc(a.name)}</div><div class="dk-reg-meta">${meta}</div></div>
        <div class="ba-amt lg${n < 0 ? ' neg' : ''}">${esc(money(a.balance, a.currency))}${avail}</div>
      </div>`;
    }).join('')}</div>`;

    $('ba-accounts').querySelectorAll('[data-account]').forEach(el => el.addEventListener('click', () => {
      state.accountFilter = state.accountFilter === el.dataset.account ? '' : el.dataset.account;
      state.shown = PAGE;
      $('ba-txn-account').value = state.accountFilter;
      renderAccounts();
      renderTxns();
      if (state.accountFilter) $('ba-sec-txns').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }

  // ── Render: transactions ──────────────────────────────────────────────────
  function renderTxnToolbar() {
    const sel = $('ba-txn-account');
    sel.innerHTML = '<option value="">All accounts</option>' + state.accounts.map(a =>
      `<option value="${esc(a.id)}">${esc(a.name)}${a.institution ? ' · ' + esc(a.institution) : ''}${a.present ? '' : ' (no longer reported)'}</option>`).join('');
    sel.value = state.accountFilter;
    $('ba-txn-toolbar').hidden = !state.txns.length;
  }

  function filteredTxns() {
    const q = state.search.trim().toLowerCase();
    return state.txns.filter(t => {
      if (state.accountFilter && t.account_id !== state.accountFilter) return false;
      if (!q) return true;
      return [t.payee, t.description, t.memo, String(t.amount)].some(v => v && String(v).toLowerCase().includes(q));
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
      const meta = [
        esc(Utils.formatDate(t.posted_at)),
        multi && a ? esc(a.name) : '',
        t.payee && t.description && t.description !== t.payee ? esc(t.description) : '',
      ].filter(Boolean).join('<span class="sep">·</span>');
      return `<div class="dk-reg-row">
        <div><div class="dk-reg-title">${esc(title)}</div><div class="dk-reg-meta">${meta}</div></div>
        <div class="ba-amt${n > 0 ? ' in' : ''}">${n > 0 ? '+' : ''}${esc(money(t.amount, a?.currency || 'USD'))}</div>
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

  function renderAll() {
    renderDeskbar();
    renderAccounts();
    renderTxnToolbar();
    renderTxns();
    renderConns();
  }

  async function reload() { if (await load()) renderAll(); }

  // ── Actions ───────────────────────────────────────────────────────────────
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

  $('ba-txn-account').addEventListener('change', (e) => {
    state.accountFilter = e.target.value;
    state.shown = PAGE;
    renderAccounts();
    renderTxns();
  });
  let searchTimer;
  $('ba-txn-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = e.target.value; state.shown = PAGE; renderTxns(); }, 150);
  });
  $('ba-txn-more').addEventListener('click', () => { state.shown += PAGE; renderTxns(); });

  await reload();
  if (!state.conns.length) openForm(true);
})();
