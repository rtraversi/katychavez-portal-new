// app.js: the Card Income page. Reads the cc_income_* views (RLS: Owner only),
// shapes them with model.js and draws with charts.js.

import {
  MONTHS, MONTHS_LONG, CATEGORIES, buildIndex, yearSummary, monthToDate, monthRows,
  cumulative, dayOfYear, yearGrid, heat, dailyForMonth, monthsWithDaily, yearHasTerminal,
  categoryByMonth, categoryLabel, fmtMoney, fmtCompact, fmtPct, fmtDay, monthOf, yearOf,
} from './model.js';
import { drawCumulative, drawMonths } from './charts.js';

// Utils.esc returns '' for falsy input, so stringify first or a 0 count vanishes.
const esc = (s) => {
  const str = s === null || s === undefined ? '' : String(s);
  return window.Utils ? window.Utils.esc(str) : str.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
};
const $ = (id) => document.getElementById(id);

export async function mountCardIncome({ db, auth }) {
  const accessible = await auth.getAccessibleModules('read');
  if (!accessible.has('cc_income')) {
    $('ci-gate').innerHTML = '<div class="dk-register"><div class="dk-empty">Card Income is available to the firm owners only.</div></div>';
    return;
  }

  const state = { year: null, ledgerMonth: null, monthly: [], daily: [], txns: [], asOf: null, asOfSource: null };
  const loadedYears = new Set();
  let ro = null;   // ResizeObserver redrawing the charts at new widths

  $('ci-refresh').addEventListener('click', () => { loadedYears.clear(); load(state.year); });

  await load(null);

  // ── Data ─────────────────────────────────────────────────────────────────
  async function load(year) {
    const body = $('ci-body');
    body.style.opacity = body.hidden ? '' : '.55';
    $('ci-refresh').disabled = true;
    try {
      if (!state.monthly.length || !loadedYears.size) {
        const [mRes, lastRes] = await Promise.all([
          db.from('cc_income_monthly').select('*').order('month'),
          db.from('cc_income_daily').select('day,source').order('day', { ascending: false }).limit(1),
        ]);
        if (mRes.error) throw mRes.error;
        if (lastRes.error) throw lastRes.error;
        state.monthly = mRes.data || [];
        state.asOf = lastRes.data?.[0]?.day || null;
        state.asOfSource = lastRes.data?.[0]?.source || null;
        state.daily = [];
        state.txns = [];
      }
      if (!state.monthly.length) {
        $('ci-gate').innerHTML = '<div class="dk-register"><div class="dk-empty">No card income has been imported yet.</div></div>';
        return;
      }
      const latest = Math.max(...state.monthly.map(r => yearOf(r.month)));
      state.year = year || latest;

      // Daily rows and transactions for the selected year and the one before.
      const need = [state.year - 1, state.year].filter(y => !loadedYears.has(y));
      if (need.length) {
        const from = `${Math.min(...need)}-01-01`, to = `${Math.max(...need)}-12-31`;
        const [dRes, tRes] = await Promise.all([
          db.from('cc_income_daily').select('*').gte('day', from).lte('day', to).order('day'),
          db.from('cc_transactions')
            .select('id,txn_id,txn_date,amount,txn_type,included,channel,card_brand,card_last4,cardholder,description,category,category_set_by_user,note')
            .gte('txn_date', from).lte('txn_date', to).order('txn_at'),
        ]);
        if (dRes.error) throw dRes.error;
        if (tRes.error) throw tRes.error;
        state.daily.push(...(dRes.data || []));
        state.txns.push(...(tRes.data || []));
        need.forEach(y => loadedYears.add(y));
      }
      $('ci-gate').innerHTML = '';
      body.hidden = false;
      render();
    } catch (err) {
      console.error('[card-income] load failed', err);
      $('ci-gate').innerHTML = '<div class="dk-register"><div class="dk-empty" style="color:var(--color-danger)">Card income could not be loaded. Try Refresh.</div></div>';
    } finally {
      body.style.opacity = '';
      $('ci-refresh').disabled = false;
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function render() {
    const index = buildIndex({ daily: state.daily, monthly: state.monthly, asOf: state.asOf });
    const Y = state.year;
    renderYears(index);
    renderAsOf();
    renderStats(index, Y);
    renderCharts(index, Y);
    renderMonthTable(index, Y);
    renderDaca(Y);
    renderLedger(index, Y);
    renderGrid(index, Y);
  }

  function renderYears(index) {
    const wrap = $('ci-years');
    wrap.innerHTML = [...index.list].sort((a, b) => a - b).map(y =>
      `<button type="button" class="dk-chipbtn${y === state.year ? ' is-on' : ''}" data-year="${y}" aria-pressed="${y === state.year}">${y}</button>`).join('');
    wrap.querySelectorAll('[data-year]').forEach(b => b.addEventListener('click', () => selectYear(Number(b.dataset.year))));
  }

  function selectYear(y) {
    if (y === state.year) return;
    state.ledgerMonth = null;
    load(y);
  }

  function renderAsOf() {
    if (!state.asOf) { $('ci-asof').textContent = ''; return; }
    const src = state.asOfSource === 'converge' ? 'Converge' : 'the Google Sheets history';
    $('ci-asof').innerHTML = `Through <b>${esc(fmtDay(state.asOf))}</b> · from ${esc(src)}`;
  }

  function delta(change, text) {
    const p = fmtPct(change);
    if (!p) return `<div class="dk-stat-delta">${esc(text || '')}</div>`;
    const dir = change > 0.005 ? 'up' : change < -0.005 ? 'down' : '';
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
    return `<div class="dk-stat-delta"><b class="${dir}">${arrow} ${esc(p)}</b> ${esc(text)}</div>`;
  }

  function tile(label, value, deltaHtml) {
    return `<div class="dk-stat"><div class="dk-stat-label">${esc(label)}</div><div class="dk-stat-value">${esc(value)}</div>${deltaHtml || ''}</div>`;
  }

  function renderStats(index, Y) {
    const s = yearSummary(index, Y);
    const tiles = [];
    let vs = '';
    if (s.priorAmount !== null) {
      vs = s.basis === 'to-date' ? `vs ${fmtMoney(s.priorAmount)} same period ${Y - 1}`
        : s.basis === 'months' ? `${MONTHS[0]}–${MONTHS[s.throughMonth]} vs ${fmtMoney(s.priorAmount)} in ${Y - 1}`
        : `vs ${fmtMoney(s.priorAmount)} in ${Y - 1}`;
    }
    tiles.push(tile(s.inProgress ? `${Y} year to date` : `${Y} total`, fmtMoney(s.amount),
      s.priorAmount !== null ? delta(s.change, vs) : delta(null, 'No earlier year to compare')));

    if (s.inProgress) {
      const mtd = monthToDate(index);
      if (mtd) {
        tiles.push(tile(`${MONTHS_LONG[mtd.month]} so far`, fmtMoney(mtd.amount),
          mtd.priorAmount !== null ? delta(mtd.change, `vs ${fmtMoney(mtd.priorAmount)} same days ${mtd.year - 1}`) : ''));
      }
    }
    if (s.count) {
      tiles.push(tile('Payments', s.count.toLocaleString('en-US'),
        `<div class="dk-stat-delta">Average <b>${esc(fmtMoney(s.amount / s.count))}</b> each</div>`));
    }
    if (s.activeDays) {
      tiles.push(tile('Per active day', fmtMoney(s.amount / s.activeDays),
        `<div class="dk-stat-delta">${esc(s.activeDays)} days with card income</div>`));
    }
    $('ci-stats').innerHTML = tiles.join('');
  }

  function legend(id, Y, hasPrev, box) {
    const k = box ? 'ci-key box' : 'ci-key';
    $(id).innerHTML = `<span><i class="${k} ci-cur"></i>${Y}</span>` + (hasPrev ? `<span><i class="${k} ci-prev"></i>${Y - 1}</span>` : '');
  }

  function renderCharts(index, Y) {
    const cur = cumulative(index, Y);
    const prev = cumulative(index, Y - 1);
    const inProgress = state.asOf && yearOf(state.asOf) === Y;
    const asOfX = inProgress ? dayOfYear(state.asOf) : null;
    const rows = monthRows(index, Y);
    const hasPrev = prev.length > 1;

    legend('ci-running-legend', Y, hasPrev, false);
    legend('ci-months-legend', Y, rows.some(r => r.priorAmount !== null), true);
    $('ci-running-note').textContent = inProgress ? `through ${fmtDay(state.asOf, { month: 'short', day: 'numeric' })}` : '';

    const draw = () => {
      drawCumulative($('ci-running'), { year: Y, cur, prev: hasPrev ? prev : [], asOfX });
      drawMonths($('ci-months-chart'), { year: Y, rows });
    };
    draw();
    ro?.disconnect();
    let t = null, lastW = $('ci-running').clientWidth;
    ro = new ResizeObserver(() => {
      const w = $('ci-running')?.clientWidth;
      if (!w || w === lastW) return;
      lastW = w;
      clearTimeout(t);
      t = setTimeout(draw, 120);
    });
    ro.observe($('ci-running'));
  }

  function chg(change) {
    const p = fmtPct(change);
    if (!p) return '<span class="mut">—</span>';
    const dir = change > 0.005 ? 'up' : change < -0.005 ? 'down' : '';
    return `<span class="ci-chg ${dir}">${esc(p)}</span>`;
  }

  function renderMonthTable(index, Y) {
    const rows = monthRows(index, Y);
    const showPrev = rows.some(r => r.priorAmount !== null);
    const any = (k) => rows.some(r => r[k] !== null && r[k] !== undefined);
    // Years kept as month totals only (2020-2024) have no counts or days: drop those columns.
    const showCounts = any('count'), showDays = any('activeDays');
    $('ci-table-title').textContent = `${Y} by month`;
    const cell = (v, f = fmtMoney) => (v === null || v === undefined ? '<td class="num mut">—</td>' : `<td class="num">${esc(f(v))}</td>`);
    const body = rows.map(r => `
      <tr class="${r.partial ? 'is-partial' : ''}">
        <td>${esc(r.long)}</td>
        ${cell(r.amount)}
        ${showPrev ? cell(r.priorAmount) : ''}
        ${showPrev ? `<td class="num">${r.future ? '<span class="mut">—</span>' : chg(r.change)}</td>` : ''}
        ${showCounts ? cell(r.count, n => n.toLocaleString('en-US')) : ''}
        ${showDays ? cell(r.activeDays, n => String(n)) + cell(r.perDay) : ''}
        ${showCounts ? cell(r.perPayment) : ''}
      </tr>`).join('');
    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    const tA = sum('amount'), tP = sum('priorAmount'), tC = sum('count'), tD = sum('activeDays');
    $('ci-month-table').innerHTML = `
      <table class="ci-table">
        <thead><tr>
          <th>Month</th><th class="num">${Y}</th>
          ${showPrev ? `<th class="num">${Y - 1}</th><th class="num">Change</th>` : ''}
          ${showCounts ? '<th class="num">Payments</th>' : ''}
          ${showDays ? '<th class="num">Active days</th><th class="num">Per day</th>' : ''}
          ${showCounts ? '<th class="num">Per payment</th>' : ''}
        </tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr>
          <td>Total</td><td class="num">${esc(fmtMoney(tA))}</td>
          ${showPrev ? `<td class="num">${esc(fmtMoney(tP))}</td><td class="num"></td>` : ''}
          ${showCounts ? `<td class="num">${esc(tC.toLocaleString('en-US'))}</td>` : ''}
          ${showDays ? `<td class="num">${esc(tD)}</td><td class="num">${tD ? esc(fmtMoney(tA / tD)) : '—'}</td>` : ''}
          ${showCounts ? `<td class="num">${tC ? esc(fmtMoney(tA / tC)) : '—'}</td>` : ''}
        </tr></tfoot>
      </table>`;
  }

  function renderDaca(Y) {
    const counts = categoryByMonth(state.txns, Y, 'daca_renewal');
    const total = counts.reduce((a, b) => a + b, 0);
    const haveTxns = state.txns.some(t => yearOf(t.txn_date) === Y);
    $('ci-daca-count').textContent = haveTxns ? `${total} in ${Y}` : '';
    if (!haveTxns) {
      $('ci-daca').innerHTML = `<div class="dk-empty">Counted per payment once the Converge sync is connected: every $300 sale is labeled a DACA renewal, and you can relabel any payment in the daily ledger. The sheets only kept daily totals, so earlier renewals can't be separated out.</div>`;
      return;
    }
    $('ci-daca').innerHTML = `<div class="table-wrap"><table class="ci-table">
      <thead><tr>${MONTHS.map(m => `<th class="num">${m}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody><tr>${counts.map(c => `<td class="num${c ? '' : ' mut'}">${c}</td>`).join('')}<td class="num"><b>${total}</b></td></tr></tbody>
    </table></div>`;
  }

  function renderLedger(index, Y) {
    const months = monthsWithDaily(index, Y);
    const chips = $('ci-ledger-months');
    if (!months.length) {
      chips.innerHTML = '';
      $('ci-ledger').innerHTML = `<div class="dk-empty">${Y} was kept as monthly totals only, so there are no daily rows.</div>`;
      return;
    }
    if (state.ledgerMonth === null || !months.includes(state.ledgerMonth)) state.ledgerMonth = months[months.length - 1];
    chips.innerHTML = months.map(m =>
      `<button type="button" class="dk-chipbtn${m === state.ledgerMonth ? ' is-on' : ''}" data-m="${m}" aria-pressed="${m === state.ledgerMonth}">${MONTHS[m]}</button>`).join('');
    chips.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
      state.ledgerMonth = Number(b.dataset.m);
      renderLedger(index, Y);
    }));

    const rows = dailyForMonth(index, Y, state.ledgerMonth);
    const term = yearHasTerminal(index, Y);
    const txns = state.txns.filter(t => yearOf(t.txn_date) === Y && monthOf(t.txn_date) === state.ledgerMonth);
    const money = (v) => `<td class="num">${v ? esc(fmtMoney(v)) : '<span class="mut">—</span>'}</td>`;
    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    let html = `<table class="ci-table">
      <thead><tr><th>Date</th>${term ? '<th class="num">Online</th><th class="num">Terminal</th>' : ''}<th class="num">Payments</th><th class="num">Total</th><th>Note</th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td>${esc(fmtDay(r.day, { weekday: 'short', month: 'short', day: 'numeric' }))}</td>
        ${term ? money(r.web) + money(r.terminal) : ''}
        <td class="num">${r.count === null ? '<span class="mut">—</span>' : esc(r.count)}</td>
        <td class="num">${esc(fmtMoney(r.amount))}</td>
        <td class="ci-note">${r.note ? esc(r.note) : ''}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td>${esc(MONTHS_LONG[state.ledgerMonth])}</td>${term ? `<td class="num">${esc(fmtMoney(sum('web')))}</td><td class="num">${esc(fmtMoney(sum('terminal')))}</td>` : ''}
        <td class="num">${esc(sum('count'))}</td><td class="num">${esc(fmtMoney(sum('amount')))}</td><td></td></tr></tfoot>
    </table>`;

    if (txns.length) {
      html += `<table class="ci-table" aria-label="Payments">
        <thead><tr><th>Date</th><th>Cardholder</th><th>Card</th><th class="num">Amount</th><th>Label</th></tr></thead>
        <tbody>${txns.map(t => `<tr${t.included ? '' : ' class="mut"'}>
          <td>${esc(fmtDay(t.txn_date, { month: 'short', day: 'numeric' }))}</td>
          <td>${esc(t.cardholder || '—')}${t.included ? '' : ' <span class="dk-tag mut">not counted</span>'}</td>
          <td>${esc([t.card_brand, t.card_last4 ? `…${t.card_last4}` : ''].filter(Boolean).join(' ') || '—')}</td>
          <td class="num">${esc(fmtMoney(Number(t.amount)))}</td>
          <td><select class="ci-label" data-id="${esc(t.id)}" aria-label="Label for this payment">
            <option value="">Unlabeled</option>
            ${CATEGORIES.map(c => `<option value="${c.value}"${t.category === c.value ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
          </select></td>
        </tr>`).join('')}</tbody>
      </table>`;
    }
    $('ci-ledger').innerHTML = html;
    $('ci-ledger').querySelectorAll('select.ci-label').forEach(sel => sel.addEventListener('change', () => relabel(sel)));
  }

  async function relabel(sel) {
    const id = sel.dataset.id;
    const category = sel.value || null;
    sel.disabled = true;
    const { error } = await db.from('cc_transactions').update({ category, category_set_by_user: true }).eq('id', id);
    sel.disabled = false;
    if (error) {
      console.error('[card-income] relabel failed', error);
      window.Utils?.toast('Could not save the label.', 'error');
      return;
    }
    const t = state.txns.find(x => x.id === id);
    if (t) { t.category = category; t.category_set_by_user = true; }
    renderDaca(state.year);
    window.Utils?.toast(`Saved as ${categoryLabel(category) || 'unlabeled'}.`, 'success');
  }

  function renderGrid(index, Y) {
    const { rows, max } = yearGrid(index);
    $('ci-grid').innerHTML = `<table class="ci-table ci-grid-table">
      <thead><tr><th class="yr">Year</th>${MONTHS.map(m => `<th class="num">${m}</th>`).join('')}<th class="num">Total</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${r.year === Y ? 'is-sel' : ''}">
        <td class="yr"><button type="button" data-year="${r.year}" aria-pressed="${r.year === Y}">${r.year}</button></td>
        ${r.cells.map((v, m) => v === null
          ? '<td class="cell empty">—</td>'
          : `<td class="cell" style="--h:${heat(v, max).toFixed(3)}" title="${esc(`${MONTHS_LONG[m]} ${r.year}: ${fmtMoney(v)}`)}">${esc(fmtCompact(v))}</td>`).join('')}
        <td class="total">${esc(fmtCompact(r.total))}${r.inProgress ? ' <span class="mut" style="font-weight:400">so far</span>' : ''}</td>
      </tr>`).join('')}</tbody>
    </table>`;
    $('ci-grid').querySelectorAll('[data-year]').forEach(b => b.addEventListener('click', () => {
      selectYear(Number(b.dataset.year));
      $('ci-root').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  }
}
