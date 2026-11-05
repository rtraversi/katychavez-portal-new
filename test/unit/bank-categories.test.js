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
