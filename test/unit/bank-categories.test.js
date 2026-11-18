// Unit tests for Bank Accounts transaction categories (pages/bank-accounts/categorize.js).
//
// What the page promises:
//   * a rule matches its text anywhere in payee, description or memo, ignoring case
//   * a rule can be limited to money in or money out, so one vendor name can mean
//     income one way and a fee the other (a card processor's deposits vs its fees)
//   * the first rule wins: lower priority first, then the older rule
//   * the summary ranks categories by the size of their net total, income and expense
//     alike, and keeps uncategorized separate
//   * totals add up to the cent

import { describe, it, expect } from 'vitest';
import {
  compileRules, categorize, summarize, summarizeFlows, since, haystack, UNCATEGORIZED,
  ledgerFrom, categorySource, matchRule, buildReport, normalizeCategoryName, topLevel,
  periodRange, toCsv, reportCsv,
} from '../../pages/bank-accounts/categorize.js';

const rule = (pattern, category, direction = 'any', extra = {}) => ({ pattern, category, direction, ...extra });
const tx = (amount, payee, description = '', extra = {}) => ({ id: `${payee}-${amount}`, amount: String(amount), payee, description, memo: null, posted_at: '2026-11-01T12:00:00Z', ...extra });

const RULES = compileRules([
  rule('payroll co', 'Payroll'),
  rule('merchant service', 'Income', 'in'),
  rule('merchant service', 'Merchant Fees', 'out'),
  rule('legalplan', 'Income', 'in'),
  rule('insurance', 'Insurance', 'out'),
  rule('loan', 'Loan Payment'),
]);

describe('categorize', () => {
  it('matches anywhere in payee, description or memo, ignoring case', () => {
    expect(categorize(tx(-1200, 'Trans Payroll Co Icd'), RULES)).toBe('Payroll');
    expect(categorize(tx(-1200, 'ACH', 'ACH TRANS / PAYROLL CO ;090826;ICD'), RULES)).toBe('Payroll');
    expect(categorize(tx(-50, 'ACH', '', { memo: 'payroll co fee' }), RULES)).toBe('Payroll');
  });

  it('splits one vendor by direction: deposits are income, fees are not', () => {
    expect(categorize(tx(1800, 'Trans Merchant Service Merch Dep'), RULES)).toBe('Income');
    expect(categorize(tx(-378.94, 'Merchant Services', 'MERCHANT SERVICE;110126;MERCH FEE'), RULES)).toBe('Merchant Fees');
  });

  it('a money-out rule never claims a deposit', () => {
    // An insurer paying the firm (a legal plan) is income, not an insurance expense.
    expect(categorize(tx(3500, 'Example Insurance', 'EXAMPLELEGALPLAN;EDI PYMNTS'), RULES)).toBe('Income');
    expect(categorize(tx(-210, 'Example Insurance', 'PREMIUM'), RULES)).toBe('Insurance');
    expect(categorize(tx(900, 'Example Insurance', 'REFUND'), RULES)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(categorize(tx(-20, 'Coffee Shop'), RULES)).toBeNull();
    expect(categorize({ amount: '-5' }, RULES)).toBeNull();
  });
});

describe('compileRules', () => {
  it('first rule wins: priority, then age', () => {
    const r = compileRules([
      rule('loan', 'Later', 'any', { priority: 100, created_at: '2026-02-01T00:00:00Z' }),
      rule('loan', 'Earlier', 'any', { priority: 100, created_at: '2026-01-01T00:00:00Z' }),
      rule('sba loan', 'SBA', 'any', { priority: 10, created_at: '2026-03-01T00:00:00Z' }),
    ]);
    expect(categorize(tx(-1005, 'SBA LOAN PAYMENT'), r)).toBe('SBA');
    expect(categorize(tx(-300, 'AUTO LOAN'), r)).toBe('Earlier');
  });

  it('drops patterns too short to mean anything, and blank categories', () => {
    const r = compileRules([rule('a', 'Too short'), rule('  ', 'Blank'), rule('ok', '  '), rule('  Fine  ', ' Kept ')]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ needle: 'fine', category: 'Kept', direction: 'any' });
  });

  it('treats an unknown direction as any', () => {
    expect(compileRules([rule('xx', 'X', 'sideways')])[0].direction).toBe('any');
  });
});

describe('summarize', () => {
  const txns = [
    tx(1800, 'Merchant Service Merch Dep'), tx(1300, 'Merchant Service Merch Dep', '', { id: 'd2' }),
    tx(-378.94, 'Merchant Services', 'MERCH FEE'),
    tx(-1294, 'Payroll Co'), tx(-1066, 'Payroll Co', '', { id: 'p2' }),
    tx(-1005, 'Business Loan'),
    tx(-20.97, 'Mail Plus'), tx(-0.1, 'Odd Cents'), tx(-0.2, 'Odd Cents', '', { id: 'o2' }),
  ];
  const s = summarize(txns, RULES);

  it('ranks categories by the size of their net total', () => {
    expect(s.categories.map(c => c.category)).toEqual(['Income', 'Payroll', 'Loan Payment', 'Merchant Fees']);
    expect(s.categories[0]).toMatchObject({ total: 3100, count: 2, moneyIn: 3100, moneyOut: 0 });
    expect(s.categories[1]).toMatchObject({ total: -2360, count: 2, moneyIn: 0, moneyOut: 2360 });
  });

  it('keeps uncategorized separate and adds to the cent', () => {
    expect(s.uncategorized).toEqual({ count: 3, total: -21.27 });
  });

  it('is empty-safe', () => {
    expect(summarize([], RULES)).toEqual({ categories: [], uncategorized: { count: 0, total: 0 } });
    expect(summarize(null, [])).toEqual({ categories: [], uncategorized: { count: 0, total: 0 } });
  });
});

describe('since / haystack', () => {
  it('keeps transactions on or after the cutoff', () => {
    const list = [tx(1, 'A', '', { posted_at: '2026-10-01T00:00:00Z' }), tx(2, 'B', '', { posted_at: '2026-10-31T00:00:00Z' })];
    expect(since(list, new Date('2026-10-15T00:00:00Z')).map(t => t.payee)).toEqual(['B']);
  });

  it('joins the searchable fields in lower case', () => {
    expect(haystack({ payee: 'Payroll Co', description: 'ACH', memo: null })).toBe('payroll co ach');
    expect(UNCATEGORIZED).toBe('Uncategorized');
  });
});

describe('summarizeFlows', () => {
  const rules = compileRules([
    rule('merchant service', 'Card Deposits', 'in'),
    rule('merchant service', 'Merchant Fees', 'out'),
    rule('legalplan', 'Legal Plan', 'in'),
    rule('software co', 'Office Software'),
    rule('payroll co', 'Payroll'),
  ]);
  const f = summarizeFlows([
    tx(1800, 'Merchant Service Merch Dep'), tx(3500, 'Example Insurance', 'EXAMPLELEGALPLAN;EDI'),
    tx(250, 'Mobile Deposit'),
    tx(-340.12, 'Merchant Services', 'MERCH FEE'), tx(-1294, 'Payroll Co'),
    tx(-30, 'Software Co'), tx(12, 'Software Co', 'REFUND'), tx(0, 'Zero'),
    tx(-44.3, 'PayPal'),
  ], rules);

  it('puts every deposit under income and every payment under expenses', () => {
    expect(f.income.categories.map(c => [c.category, c.total])).toEqual([['Legal Plan', 3500], ['Card Deposits', 1800], ['Office Software', 12]]);
    expect(f.expenses.categories.map(c => [c.category, c.total])).toEqual([['Payroll', -1294], ['Merchant Fees', -340.12], ['Office Software', -30]]);
  });

  it('keeps uncategorized deposits and payments apart, and skips zero amounts', () => {
    expect(f.income.uncategorized).toEqual({ count: 1, total: 250 });
    expect(f.expenses.uncategorized).toEqual({ count: 1, total: -44.3 });
  });
});

// ── Stored categories, the category list, and the report (2403) ─────────────

describe('normalizeCategoryName', () => {
  it('tidies spacing around colons and inside names', () => {
    expect(normalizeCategoryName('  Office :  Software ')).toBe('Office:Software');
    expect(normalizeCategoryName('Payroll:Payroll  Main:Payroll Taxes')).toBe('Payroll:Payroll Main:Payroll Taxes');
    expect(normalizeCategoryName('Office::Postage:')).toBe('Office:Postage');
  });

  it('folds Quicken spellings: transfers, splits, uncategorized', () => {
    expect(normalizeCategoryName('[Card Account]')).toBe('Transfer:Card Account');
    expect(normalizeCategoryName('--Split--')).toBeNull();
    expect(normalizeCategoryName('Uncategorized')).toBeNull();
    expect(normalizeCategoryName('   ')).toBeNull();
    expect(normalizeCategoryName(null)).toBeNull();
  });

  it('caps the length without leaving a dangling colon', () => {
    const long = normalizeCategoryName(`${'a'.repeat(79)}:b`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith(':')).toBe(false);
    expect(topLevel('Office:Software:Cloud')).toBe('Office');
  });
});

describe('stored categories beat rules', () => {
  const ledger = ledgerFrom([
    { id: 'c-pay', name: 'Payroll', kind: 'expense' },
    { id: 'c-per', name: 'Personal', kind: 'expense' },
    { id: 'c-inc', name: 'Card Income', kind: 'income' },
  ]);
  const rules = compileRules([{ pattern: 'card co', category: 'Card Payment', direction: 'out' }], ledger);

  it('uses the stored category when there is one, the rule otherwise', () => {
    const t1 = tx(-500, 'CARD CO EPAY');
    const t2 = tx(-2000, 'CARD CO EPAY', '', { id: 'x2', category_id: 'c-per' });
    expect(categorize(t1, rules, ledger)).toBe('Card Payment');
    expect(categorySource(t1, rules, ledger)).toBe('rule');
    expect(categorize(t2, rules, ledger)).toBe('Personal');
    expect(categorySource(t2, rules, ledger)).toBe('stored');
  });

  it('ignores a stored id that is no longer on the list', () => {
    const t = tx(-500, 'CARD CO EPAY', '', { category_id: 'deleted' });
    expect(categorize(t, rules, ledger)).toBe('Card Payment');
    expect(categorySource(tx(-3, 'Nothing'), rules, ledger)).toBeNull();
  });

  it('a rule tied to a list category follows a rename', () => {
    const renamed = ledgerFrom([{ id: 'c-pay', name: 'Wages', kind: 'expense' }]);
    const r = compileRules([{ id: 'r1', pattern: 'payroll co', category: 'Payroll', category_id: 'c-pay' }], renamed);
    expect(categorize(tx(-900, 'Payroll Co'), r, renamed)).toBe('Wages');
    expect(matchRule(tx(-900, 'Payroll Co'), r).id).toBe('r1');
  });

  it('feeds the overview tiles too', () => {
    const f = summarizeFlows([tx(-2000, 'CARD CO EPAY', '', { category_id: 'c-per' }), tx(-500, 'CARD CO EPAY', '', { id: 'y' })], rules, ledger);
    expect(f.expenses.categories.map(c => [c.category, c.total])).toEqual([['Personal', -2000], ['Card Payment', -500]]);
  });
});

describe('buildReport', () => {
  const ledger = ledgerFrom([
    { id: 'i1', name: 'Card Income', kind: 'income' },
    { id: 'i2', name: 'Legal Plan Income', kind: 'income' },
    { id: 'e1', name: 'Payroll', kind: 'expense' },
    { id: 'e2', name: 'Payroll:Payroll Taxes', kind: 'expense' },
    { id: 'e3', name: 'Office:Software', kind: 'expense' },
    { id: 'e4', name: 'Office:PayPal', kind: 'expense' },
  ]);
  const rules = compileRules([
    { pattern: 'merch dep', category_id: 'i1', category: 'x', direction: 'in' },
    { pattern: 'payroll co', category_id: 'e1', category: 'x' },
    { pattern: 'software co', category_id: 'e3', category: 'x' },
  ], ledger);
  const txns = [
    tx(1000, 'Merch Dep', '', { id: 'a', posted_at: '2026-10-02T12:00:00Z' }),
    tx(1800, 'Merch Dep', '', { id: 'b', posted_at: '2026-10-30T12:00:00Z' }),
    tx(3000, 'Legal Plan', '', { id: 'c', category_id: 'i2' }),
    tx(250, 'Mobile Deposit', '', { id: 'd' }),
    tx(-574, 'Payroll Co', '', { id: 'e' }),
    tx(-41.23, 'Payroll Co', 'TAX', { id: 'f', category_id: 'e2' }),
    tx(-11.26, 'Software Co', '', { id: 'g' }),
    tx(5, 'Software Co', 'REFUND', { id: 'h' }),
    tx(-24.98, 'Pay Pal', '', { id: 'i', category_id: 'e4' }),
    tx(-9.99, 'Coffee', '', { id: 'j' }),
    tx(0, 'Zero', '', { id: 'k' }),
  ];
  const rep = buildReport(txns, rules, ledger);

  it('sorts by the category kind, so a refund reduces its expense', () => {
    const office = rep.expenses.groups.find(g => g.name === 'Office');
    expect(office.members.map(m => [m.label, m.total])).toEqual([['PayPal', -24.98], ['Software', -6.26]]);
    expect(office.total).toBe(-31.24);
    expect(rep.income.groups.some(g => g.name === 'Office')).toBe(false);
  });

  it('rolls subcategories up under the parent, the parent itself first', () => {
    const pay = rep.expenses.groups.find(g => g.name === 'Payroll');
    expect(pay.total).toBe(-615.23);
    expect(pay.members.map(m => m.label)).toEqual(['Payroll', 'Payroll Taxes']);
  });

  it('lists Uncategorized first, split by sign', () => {
    expect(rep.income.groups[0]).toMatchObject({ name: 'Uncategorized', uncategorized: true, total: 250, count: 1 });
    expect(rep.expenses.groups[0]).toMatchObject({ name: 'Uncategorized', total: -9.99, count: 1 });
    expect(rep.income.groups.slice(1).map(g => g.name)).toEqual(['Card Income', 'Legal Plan Income']);
  });

  it('totals to the cent and skips zero amounts', () => {
    expect(rep.income.total).toBe(6050);
    expect(rep.expenses.total).toBe(-656.46);
    expect(rep.net).toBe(5393.54);
    expect(rep.count).toBe(10);
    expect(rep.income.count + rep.expenses.count).toBe(10);
  });

  it('keeps each line in date order', () => {
    expect(rep.income.groups.find(g => g.name === 'Card Income').members[0].txns.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('files a category the list does not know by the sign of its net', () => {
    const r = buildReport([tx(-40, 'Gym')], compileRules([{ pattern: 'gym', category: 'Health' }]), ledgerFrom([]));
    expect(r.expenses.groups.map(g => g.name)).toEqual(['Health']);
  });

  it('is empty-safe', () => {
    const r = buildReport([], [], ledgerFrom([]));
    expect(r).toMatchObject({ net: 0, count: 0, income: { total: 0, groups: [] }, expenses: { total: 0, groups: [] } });
  });

  it('exports a summary CSV that adds up', () => {
    const csv = reportCsv(rep).trim().split('\r\n');
    expect(csv[0]).toBe('Section,Category,Transactions,Amount');
    expect(csv).toContain('Expenses,Payroll:Payroll Taxes,1,-41.23');
    expect(csv).toContain('Income,Total income,4,6050.00');
    expect(csv[csv.length - 1]).toBe(',Overall,10,5393.54');
  });
});

describe('periodRange', () => {
  const nov = new Date(2026, 10, 18);
  it('covers whole calendar periods, inclusive', () => {
    expect(periodRange('this_year', nov)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodRange('last_year', nov)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(periodRange('this_month', nov)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(periodRange('last_month', nov)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(periodRange('this_quarter', nov)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange('last_quarter', nov)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('wraps into last year in January', () => {
    const jan = new Date(2027, 0, 5);
    expect(periodRange('last_month', jan)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(periodRange('last_quarter', jan)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange('custom', jan)).toBeNull();
  });
});

describe('toCsv', () => {
  it('quotes what needs quoting and defuses formulas, but not negative numbers', () => {
    expect(toCsv([['a,b', 'say "hi"', '=HYPERLINK("x")', '-41.23', '-1,005.00', '+1 555', null]]))
      .toBe('"a,b","say ""hi""","\'=HYPERLINK(""x"")",-41.23,"-1,005.00",\'+1 555,\r\n');
  });
});
