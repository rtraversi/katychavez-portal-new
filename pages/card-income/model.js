// model.js: pure shaping for the Card Income page. No DOM, no fetch.
//
// Input is what the two views return (cc_income_daily, cc_income_monthly) plus
// any cc_transactions rows. Dates stay 'YYYY-MM-DD' strings throughout so no
// timezone ever shifts a day. Tested in test/unit/card-income-model.test.js.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// Labels for cc_transactions.category. The sync assigns daca_renewal to $300
// sales; an owner can relabel any payment.
export const CATEGORIES = [
  { value: 'daca_renewal', label: 'DACA renewal' },
  { value: 'other',        label: 'Other' },
];

// ── Dates ──────────────────────────────────────────────────────────────────

export const yearOf  = (day) => Number(day.slice(0, 4));
export const monthOf = (day) => Number(day.slice(5, 7)) - 1;     // 0-based
export const dateOf  = (day) => Number(day.slice(8, 10));

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// 1-based day of year; Dec 31 of a leap year is 366.
export function dayOfYear(day) {
  const y = yearOf(day);
  return Math.round((Date.UTC(y, monthOf(day), dateOf(day)) - Date.UTC(y, 0, 1)) / 86400000) + 1;
}

export function isLeap(year) {
  return new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
}

// Same month/day in another year; Feb 29 maps to Feb 28.
export function sameDayIn(day, year) {
  const m = monthOf(day);
  const d = Math.min(dateOf(day), daysInMonth(year, m));
  return `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── Formatting ─────────────────────────────────────────────────────────────

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

// $19,850 for whole dollars, $605.50 otherwise.
export function fmtMoney(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = Math.round(n * 100) / 100;
  return Number.isInteger(v) ? usd0.format(v) : usd2.format(v);
}

// $950 · $12.4K · $1.2M — for axes, grids and tight spots.
export function fmtCompact(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e6) return `${s}$${trim(a / 1e6)}M`;
  if (a >= 1e3) return `${s}$${trim(a / 1e3)}K`;
  return `${s}$${Math.round(a)}`;
}
function trim(x) { return (x >= 100 ? x.toFixed(0) : x.toFixed(1)).replace(/\.0$/, ''); }

// +12% / −44% ; null when there is nothing to compare against.
export function fmtPct(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return null;
  const r = Math.round(p * 100);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}%`;
}

export function pctChange(cur, prev) {
  if (!prev) return null;
  return (cur - prev) / Math.abs(prev);
}

export function fmtDay(day, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Date(Date.UTC(yearOf(day), monthOf(day), dateOf(day)))
    .toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

// ── Normalising rows from the views ────────────────────────────────────────

export function normDaily(rows) {
  return (rows || []).map(r => ({
    day: r.day,
    web: Number(r.web_amount) || 0,
    terminal: Number(r.terminal_amount) || 0,
    amount: Number(r.amount) || 0,
    count: r.txn_count === null || r.txn_count === undefined ? null : Number(r.txn_count),
    note: r.note || null,
    source: r.source,
  })).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export function normMonthly(rows) {
  return (rows || []).map(r => ({
    month: r.month.slice(0, 7),            // 'YYYY-MM'
    year: yearOf(r.month),
    m: monthOf(r.month),
    amount: Number(r.amount) || 0,
    count: r.txn_count === null || r.txn_count === undefined ? null : Number(r.txn_count),
    activeDays: r.active_days === null || r.active_days === undefined ? null : Number(r.active_days),
    grain: r.grain,
  }));
}

// ── The data set the page renders from ─────────────────────────────────────

// Builds the year index once; every view below reads from it.
// `asOf` is the latest day with data anywhere; pass it when `daily` holds only
// some years (the page loads two at a time).
export function buildIndex({ daily, monthly, asOf = null }) {
  const d = normDaily(daily);
  const m = normMonthly(monthly);

  const years = new Map();          // year -> { months: [12 x row|null], daily: [], hasDaily }
  const ensure = (y) => {
    if (!years.has(y)) years.set(y, { year: y, months: Array(12).fill(null), daily: [], hasDaily: false });
    return years.get(y);
  };
  for (const row of m) ensure(row.year).months[row.m] = row;
  for (const row of d) {
    const y = ensure(yearOf(row.day));
    y.daily.push(row);
    y.hasDaily = true;
  }

  const list = [...years.keys()].sort((a, b) => b - a);
  return { years, list, asOf: asOf || (d.length ? d[d.length - 1].day : null), latestYear: list[0] ?? null };
}

// Totals for a year up to and including `through` ('YYYY-MM-DD'), from daily
// rows when the year has them, otherwise from whole months.
function sumThrough(y, through) {
  if (!y) return { amount: 0, count: 0, days: 0, exact: false };
  if (y.hasDaily) {
    // A day with no count is a refund-only row in the sheets: no payments that day.
    let amount = 0, count = 0, days = 0;
    for (const r of y.daily) {
      if (through && r.day > through) break;
      amount += r.amount;
      days += 1;
      count += r.count || 0;
    }
    return { amount, count, days, exact: true };
  }
  const lastM = through ? monthOf(through) : 11;
  const full  = !through || dateOf(through) === daysInMonth(y.year, lastM);
  const upto  = full ? lastM : lastM - 1;          // whole months only
  let amount = 0, count = 0, counted = true;
  for (let i = 0; i <= upto; i++) {
    const r = y.months[i];
    if (!r) continue;
    amount += r.amount;
    if (r.count === null) counted = false; else count += r.count;
  }
  return { amount, count: counted ? count : null, days: null, exact: full, throughMonth: upto };
}

// The headline comparison for `year`. For the year in progress it is
// "Jan 1 – asOf" against the same span a year earlier; a finished year is
// compared whole. Falls back to whole months when the prior year has no
// daily rows (2020-2024 are monthly totals only).
export function yearSummary(index, year) {
  const y = index.years.get(year);
  const prev = index.years.get(year - 1);
  const inProgress = year === index.latestYear && index.asOf && yearOf(index.asOf) === year;
  const through = inProgress ? index.asOf : `${year}-12-31`;

  const cur = sumThrough(y, through);
  let prior = null, basis = 'full';
  if (prev) {
    if (!inProgress) {
      prior = sumThrough(prev, `${year - 1}-12-31`);
    } else if (prev.hasDaily) {
      prior = sumThrough(prev, sameDayIn(through, year - 1));
      basis = 'to-date';
    } else {
      // Prior year only has month totals: compare whole months on both sides.
      const lastFull = monthOf(through) - 1;
      if (lastFull >= 0) {
        const end = `${year}-${String(lastFull + 1).padStart(2, '0')}-${daysInMonth(year, lastFull)}`;
        prior = sumThrough(prev, `${year - 1}-${String(lastFull + 1).padStart(2, '0')}-${daysInMonth(year - 1, lastFull)}`);
        const curMonths = sumThrough(y, end);
        return {
          year, inProgress, through, basis: 'months', throughMonth: lastFull,
          amount: cur.amount, count: cur.count, activeDays: cur.days,
          compareAmount: curMonths.amount, priorAmount: prior.amount,
          change: pctChange(curMonths.amount, prior.amount),
        };
      }
    }
  }
  return {
    year, inProgress, through, basis,
    amount: cur.amount, count: cur.count, activeDays: cur.days,
    compareAmount: cur.amount,
    priorAmount: prior ? prior.amount : null,
    priorCount: prior ? prior.count : null,
    change: prior ? pctChange(cur.amount, prior.amount) : null,
  };
}

// Month to date for the month containing asOf, against the same days last year.
export function monthToDate(index) {
  if (!index.asOf) return null;
  const year = yearOf(index.asOf), m = monthOf(index.asOf);
  const start = `${year}-${String(m + 1).padStart(2, '0')}-01`;
  const y = index.years.get(year);
  const cur = (y?.daily || []).filter(r => r.day >= start && r.day <= index.asOf);
  const prevY = index.years.get(year - 1);
  let prior = null;
  if (prevY?.hasDaily) {
    const pStart = `${year - 1}-${String(m + 1).padStart(2, '0')}-01`;
    const pEnd = sameDayIn(index.asOf, year - 1);
    prior = prevY.daily.filter(r => r.day >= pStart && r.day <= pEnd).reduce((s, r) => s + r.amount, 0);
  }
  const amount = cur.reduce((s, r) => s + r.amount, 0);
  return {
    month: m, year, amount, priorAmount: prior,
    count: cur.reduce((s, r) => s + (r.count || 0), 0),
    change: prior === null ? null : pctChange(amount, prior),
  };
}

// Twelve rows for the month table / bar chart: this year beside last year.
export function monthRows(index, year) {
  const y = index.years.get(year);
  const p = index.years.get(year - 1);
  const asOfMonth = index.asOf && yearOf(index.asOf) === year ? monthOf(index.asOf) : 11;
  return MONTHS.map((label, m) => {
    const r = y?.months[m] || null;
    const pr = p?.months[m] || null;
    const future = year === index.latestYear && m > asOfMonth;
    const amount = r ? r.amount : (future ? null : 0);
    const count = r ? r.count : null;
    const days = r ? r.activeDays : null;
    return {
      m, label, long: MONTHS_LONG[m], future, partial: !future && year === yearOf(index.asOf || '0000') && m === asOfMonth,
      amount, count, activeDays: days,
      perDay: amount !== null && days ? amount / days : null,
      perPayment: amount !== null && count ? amount / count : null,
      priorAmount: pr ? pr.amount : null,
      change: amount !== null && pr && !(year === index.latestYear && m === asOfMonth) ? pctChange(amount, pr.amount) : null,
    };
  });
}

// Running total through the year, one point per data day (or per month end
// for monthly-only years). x is the day of year, y the cumulative amount.
export function cumulative(index, year) {
  const y = index.years.get(year);
  if (!y) return [];
  const pts = [{ x: 0, y: 0, day: null }];
  let run = 0;
  if (y.hasDaily) {
    for (const r of y.daily) { run += r.amount; pts.push({ x: dayOfYear(r.day), y: run, day: r.day }); }
  } else {
    y.months.forEach((r, m) => {
      if (!r) return;
      run += r.amount;
      const day = `${year}-${String(m + 1).padStart(2, '0')}-${daysInMonth(year, m)}`;
      pts.push({ x: dayOfYear(day), y: run, day, monthEnd: true });
    });
  }
  return pts;
}

// Cumulative value of a step series at day-of-year x.
export function valueAt(points, x) {
  let v = null;
  for (const p of points) { if (p.x <= x) v = p.y; else break; }
  return v;
}

// The every-year grid: rows of 12 month amounts plus a total, newest first.
export function yearGrid(index) {
  let max = 0;
  const rows = index.list.map(year => {
    const y = index.years.get(year);
    const cells = y.months.map(r => (r ? r.amount : null));
    cells.forEach(v => { if (v !== null && v > max) max = v; });
    const total = cells.reduce((s, v) => s + (v || 0), 0);
    return { year, cells, total, inProgress: year === index.latestYear && index.asOf && yearOf(index.asOf) === year };
  });
  return { rows, max };
}

// 0..1 heat for a grid cell, square-root scaled so small months still tint.
export function heat(v, max) {
  if (v === null || v <= 0 || !max) return 0;
  return Math.sqrt(v / max);
}

// Daily rows for one month of one year.
export function dailyForMonth(index, year, m) {
  const y = index.years.get(year);
  if (!y?.hasDaily) return [];
  return y.daily.filter(r => monthOf(r.day) === m);
}

// Months of a year that have daily rows (for the ledger month picker).
export function monthsWithDaily(index, year) {
  const y = index.years.get(year);
  if (!y?.hasDaily) return [];
  return [...new Set(y.daily.map(r => monthOf(r.day)))].sort((a, b) => a - b);
}

export function yearHasTerminal(index, year) {
  return (index.years.get(year)?.daily || []).some(r => r.terminal !== 0);
}

// ── Transactions (Converge) ────────────────────────────────────────────────

export function categoryLabel(value) {
  return CATEGORIES.find(c => c.value === value)?.label || null;
}

// Per-month count of payments with `category` in a year's transactions.
export function categoryByMonth(transactions, year, category) {
  const out = Array(12).fill(0);
  for (const t of transactions || []) {
    if (!t.included || t.category !== category || yearOf(t.txn_date) !== year) continue;
    if (Number(t.amount) > 0) out[monthOf(t.txn_date)] += 1;
  }
  return out;
}
