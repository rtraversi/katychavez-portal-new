// Card Income page model (pages/card-income/model.js): the numbers the owners
// read. What they hold:
//
//   * the year in progress is compared with the SAME days of the year before,
//     never the whole prior year
//   * a prior year kept only as month totals (2020-2024) is compared month for
//     month, through the last complete month
//   * the month in progress has no change % (it would compare a partial month
//     with a whole one) and later months show as future, not as $0
//   * dates never shift through a timezone; Feb 29 maps to Feb 28
//   * a $0 count still prints as 0 (formatting)
import { describe, it, expect } from 'vitest';
import {
  buildIndex, yearSummary, monthToDate, monthRows, cumulative, valueAt, yearGrid, heat,
  dayOfYear, sameDayIn, fmtMoney, fmtCompact, fmtPct, categoryByMonth, monthsWithDaily,
} from '../../pages/card-income/model.js';
import { niceTicks } from '../../pages/card-income/charts.js';

const day = (d, amount, count = 1, extra = {}) =>
  ({ day: d, web_amount: amount, terminal_amount: 0, amount, txn_count: count, note: null, source: 'sheet', ...extra });
const month = (m, amount, grain = 'monthly', txn = null, days = null) =>
  ({ month: `${m}-01`, amount, txn_count: txn, active_days: days, grain });

// Two daily years (2025 full-ish, 2026 to Oct 22) plus a monthly-only 2024.
function fixture() {
  const daily = [
    day('2025-01-10', 1000, 2), day('2025-10-05', 500), day('2025-10-22', 300), day('2025-10-23', 9999), day('2025-12-31', 700),
    day('2026-01-02', 1795, 2), day('2026-10-01', 1000), day('2026-10-22', 3500),
  ];
  const monthly = [
    month('2024-01', 36420), month('2024-10', 30900), month('2024-12', 27900),
    month('2025-01', 1000, 'daily', 2, 1), month('2025-10', 10799, 'daily', 3, 3), month('2025-12', 700, 'daily', 1, 1),
    month('2026-01', 1795, 'daily', 2, 1), month('2026-10', 4500, 'daily', 2, 2),
  ];
  return buildIndex({ daily, monthly });
}

describe('card income: comparisons', () => {
  it('compares the year in progress with the same days a year earlier', () => {
    const s = yearSummary(fixture(), 2026);
    expect(s.inProgress).toBe(true);
    expect(s.basis).toBe('to-date');
    expect(s.amount).toBe(1795 + 1000 + 3500);
    // 2025 through Oct 22: excludes Oct 23 ($9,999) and Dec 31.
    expect(s.priorAmount).toBe(1000 + 500 + 300);
    expect(s.change).toBeCloseTo((6295 - 1800) / 1800);
  });

  it('compares a finished year whole', () => {
    const s = yearSummary(fixture(), 2025);
    expect(s.inProgress).toBe(false);
    expect(s.amount).toBe(1000 + 500 + 300 + 9999 + 700);
    expect(s.priorAmount).toBe(36420 + 30900 + 27900);
  });

  it('falls back to whole months when the prior year has only month totals', () => {
    const index = buildIndex({
      daily: [day('2025-01-15', 100), day('2025-03-10', 50)],
      monthly: [month('2024-01', 1000), month('2024-02', 2000), month('2024-03', 4000),
        month('2025-01', 100, 'daily'), month('2025-03', 50, 'daily')],
    });
    const s = yearSummary(index, 2025);
    expect(s.basis).toBe('months');
    expect(s.throughMonth).toBe(1);               // Jan–Feb: March is still in progress
    expect(s.compareAmount).toBe(100);
    expect(s.priorAmount).toBe(3000);
    expect(s.amount).toBe(150);                   // the headline still counts March so far
  });

  it('month to date stops at the same day last year', () => {
    const m = monthToDate(fixture());
    expect(m.month).toBe(9);
    expect(m.amount).toBe(4500);
    expect(m.priorAmount).toBe(800);              // Oct 5 + Oct 22, not Oct 23
  });

  it('marks the current month partial (no change %) and later months future', () => {
    const rows = monthRows(fixture(), 2026);
    expect(rows[9].partial).toBe(true);
    expect(rows[9].change).toBeNull();
    expect(rows[10].future).toBe(true);
    expect(rows[10].amount).toBeNull();
    expect(rows[0].change).toBeCloseTo((1795 - 1000) / 1000);
    expect(rows[1].amount).toBe(0);               // a past month with nothing is $0, not blank
  });
});

describe('card income: series', () => {
  it('builds a running total by day of year', () => {
    const pts = cumulative(fixture(), 2026);
    expect(pts[0]).toEqual({ x: 0, y: 0, day: null });
    expect(pts.at(-1)).toMatchObject({ day: '2026-10-22', y: 6295, x: dayOfYear('2026-10-22') });
    expect(valueAt(pts, dayOfYear('2026-06-01'))).toBe(1795);
  });

  it('places monthly-only years at month ends', () => {
    const pts = cumulative(fixture(), 2024);
    expect(pts.map(p => p.day)).toEqual([null, '2024-01-31', '2024-10-31', '2024-12-31']);
    expect(pts.at(-1).y).toBe(36420 + 30900 + 27900);
  });

  it('grids every year newest first with a heat scale', () => {
    const { rows, max } = yearGrid(fixture());
    expect(rows.map(r => r.year)).toEqual([2026, 2025, 2024]);
    expect(max).toBe(36420);
    expect(rows[0].inProgress).toBe(true);
    expect(heat(null, max)).toBe(0);
    expect(heat(36420, max)).toBe(1);
    expect(heat(9105, max)).toBeCloseTo(0.5);
  });

  it('counts a refund-only day (no count) as zero payments, not unknown', () => {
    const index = buildIndex({
      daily: [day('2025-02-21', 500, 2), day('2025-02-22', -100, null)],
      monthly: [month('2025-02', 400, 'daily', 2, 2)],
    });
    const s = yearSummary(index, 2025);
    expect(s.count).toBe(2);
    expect(s.amount).toBe(400);
  });

  it('lists months that have daily rows', () => {
    expect(monthsWithDaily(fixture(), 2026)).toEqual([0, 9]);
    expect(monthsWithDaily(fixture(), 2024)).toEqual([]);
  });
});

describe('card income: dates and formatting', () => {
  it('maps Feb 29 to Feb 28 and counts leap days', () => {
    expect(sameDayIn('2028-02-29', 2027)).toBe('2027-02-28');
    expect(dayOfYear('2028-12-31')).toBe(366);
    expect(dayOfYear('2026-01-01')).toBe(1);
  });

  it('formats money, compact money and percentages', () => {
    expect(fmtMoney(19850)).toBe('$19,850');
    expect(fmtMoney(605.5)).toBe('$605.50');
    expect(fmtMoney(0)).toBe('$0');
    expect(fmtCompact(141500)).toBe('$142K');
    expect(fmtCompact(12400)).toBe('$12.4K');
    expect(fmtCompact(1200000)).toBe('$1.2M');
    expect(fmtCompact(950)).toBe('$950');
    expect(fmtPct(-0.438)).toBe('−44%');
    expect(fmtPct(0.12)).toBe('+12%');
    expect(fmtPct(null)).toBeNull();
  });

  it('picks clean axis ticks', () => {
    expect(niceTicks(141500)).toEqual([0, 50000, 100000, 150000]);
    expect(niceTicks(40406)).toEqual([0, 10000, 20000, 30000, 40000, 50000]);
    expect(niceTicks(0)).toEqual([0]);
  });
});

describe('card income: DACA renewals', () => {
  it('counts labeled, counted sales per month and skips refunds and excluded rows', () => {
    const t = (d, amount, category, included = true) => ({ txn_date: d, amount, category, included });
    const counts = categoryByMonth([
      t('2026-10-01', 300, 'daca_renewal'), t('2026-10-02', 300, 'daca_renewal'),
      t('2026-10-03', -300, 'daca_renewal'), t('2026-10-04', 300, 'daca_renewal', false),
      t('2026-09-01', 300, 'other'), t('2025-10-01', 300, 'daca_renewal'),
    ], 2026, 'daca_renewal');
    expect(counts[9]).toBe(2);
    expect(counts.reduce((a, b) => a + b)).toBe(2);
  });
});
