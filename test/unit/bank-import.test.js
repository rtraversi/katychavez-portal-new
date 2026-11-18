// Unit tests for importing Quicken history into Bank Accounts:
//   pages/bank-accounts/qif.js      reading a QIF export
//   functions/api/_bank-import.js   deciding what to add and what to match
//
// What the import promises:
//   * QIF is read the way Quicken writes it: M/D'YY dates, comma amounts, [transfers],
//     /classes, splits, multi-account files, the category list with income/expense flags
//   * nothing is counted twice: entries the bank feed already covers are matched to the
//     feed's transaction and only lend it their category; only older entries are added
//   * a category set by hand is never overwritten
//   * running the same file again adds nothing
//
// Fixture payees and amounts are made up.

import { describe, it, expect } from 'vitest';
import { parseQif, parseQifDate, parseQifAmount, decodeQifBytes } from '../../pages/bank-accounts/qif.js';
import {
  validateEntries, planImport, importKey, rowsForInsert, newCategoriesFor, runImport,
  resolveCategoryMap, mapEntry, suggestCategoryMap,
} from '../../functions/api/_bank-import.js';
import { ledgerFrom, compileRules } from '../../pages/bank-accounts/categorize.js';

const QIF = [
  '!Option:AutoSwitch',
  '!Account',
  'NOperating Checking',
  'TBank',
  '^',
  '!Clear:AutoSwitch',
  '!Type:Cat',
  'NCard Income',
  'I',
  '^',
  'NPayroll',
  'E',
  '^',
  'NPayroll:Payroll Taxes',
  'E',
  '^',
  '!Type:Bank',
  "D1/ 5'26",
  'T1,000.00',
  'PExample Merch Dep',
  'LCard Income',
  '^',
  "D1/ 6'26",
  'U-574.00',
  'T-574.00',
  'PExample Payroll Co',
  'MBiweekly',
  'LPayroll/Firm',
  '^',
  "D1/ 6'26",
  'T-615.23',
  'PExample Payroll Co',
  'L--Split--',
  'SPayroll',
  '$-574.00',
  'SPayroll:Payroll Taxes',
  'Eemployer share',
  '$-41.23',
  '^',
  "D1/ 7'26",
  'T-2,000.00',
  'PCard Co Epay',
  'L[Card Account]',
  '^',
  'D13/45/26',
  'T-1.00',
  'PBad date',
  '^',
  "D1/ 8'26",
  'T-50.00',
  'PBroken split',
  'SOffice',
  '$-20.00',
  'SPersonal',
  '$-20.00',
  '^',
  '!Account',
  'NSavings',
  'TBank',
  '^',
  '!Type:Bank',
  'D2/1/2026',
  'T0.40',
  'PInterest',
  'LDiv Income',
  '^',
  '!Type:Memorized',
  'PSomething',
  'LIgnored',
  '^',
].join('\r\n');

describe('parseQifDate / parseQifAmount', () => {
  it('reads the date spellings Quicken writes', () => {
    expect(parseQifDate("10/ 1'26")).toBe('2026-10-01');
    expect(parseQifDate("1/5'2026")).toBe('2026-01-05');
    expect(parseQifDate('12/31/99')).toBe('1999-12-31');
    expect(parseQifDate('1/5/26')).toBe('2026-01-05');
    expect(parseQifDate('2026-01-05')).toBe('2026-01-05');
    expect(parseQifDate('2/30/26')).toBeNull();
    expect(parseQifDate('')).toBeNull();
  });

  it('reads amounts with commas, dollar signs and parentheses', () => {
    expect(parseQifAmount('-2,000.00')).toBe(-2000);
    expect(parseQifAmount('$1,000.00')).toBe(1000);
    expect(parseQifAmount('(30.00)')).toBe(-30);
    expect(parseQifAmount('.5')).toBe(0.5);
    expect(parseQifAmount('abc')).toBeNull();
  });

  it('decodes Windows ANSI text when it is not UTF-8', () => {
    const ansi = new Uint8Array([0x50, 0x46, 0x61, 0x72, 0x6d, 0x61, 0x63, 0xed, 0x61]);   // "PFarmacía" in cp1252
    expect(decodeQifBytes(ansi.buffer)).toBe('PFarmacía');
    expect(decodeQifBytes(new TextEncoder().encode('PCafé').buffer)).toBe('PCafé');
  });
});

describe('parseQif', () => {
  const q = parseQif(QIF);

  it('reads transactions per account and skips unreadable ones', () => {
    expect(q.accounts.map(a => [a.name, a.count])).toEqual([['Operating Checking', 5], ['Savings', 1]]);
    expect(q.skipped).toBe(1);
    expect(q.entries[0]).toMatchObject({ account: 'Operating Checking', date: '2026-01-05', amount: 1000, payee: 'Example Merch Dep', category: 'Card Income', splits: null });
  });

  it('drops the /class, prefers T over U, keeps the memo', () => {
    expect(q.entries[1]).toMatchObject({ amount: -574, category: 'Payroll', memo: 'Biweekly' });
  });

  it('reads splits that add up, and turns transfers into Transfer:<account>', () => {
    expect(q.entries[2].category).toBeNull();
    expect(q.entries[2].splits).toEqual([
      { category: 'Payroll', memo: null, amount: -574 },
      { category: 'Payroll:Payroll Taxes', memo: 'employer share', amount: -41.23 },
    ]);
    expect(q.entries[3].category).toBe('Transfer:Card Account');
  });

  it('brings a split that does not add up in uncategorized, with a note', () => {
    const broken = q.entries.find(e => e.payee === 'Broken split');
    expect(broken).toMatchObject({ category: null, splits: null, amount: -50 });
    expect(q.warnings).toHaveLength(1);
  });

  it('reads the category list with its income/expense flags, and ignores memorized payees', () => {
    expect(q.categories).toEqual([
      { name: 'Card Income', kind: 'income' },
      { name: 'Payroll', kind: 'expense' },
      { name: 'Payroll:Payroll Taxes', kind: 'expense' },
    ]);
    expect(q.entries.some(e => e.category === 'Ignored')).toBe(false);
  });

  it('handles a file with no !Account header and bare LF line endings', () => {
    const r = parseQif("!Type:Bank\nD3/1'26\nT-9.99\nPCoffee\n^\n");
    expect(r.entries).toEqual([{ account: 'Quicken', date: '2026-03-01', amount: -9.99, payee: 'Coffee', memo: null, category: null, splits: null }]);
  });
});

// ── Planning ────────────────────────────────────────────────────────────────

const e = (date, amount, payee, category = null, extra = {}) => ({ date, amount, payee, category, ...extra });
const bank = (id, day, amount, extra = {}) => ({ id, posted_at: `${day}T07:00:00+00:00`, amount: String(amount), category_id: null, ...extra });

describe('validateEntries', () => {
  it('keeps good entries in cents and drops bad or zero ones', () => {
    const { entries, dropped } = validateEntries([
      e('2026-01-05', 1000, 'A', 'Card Income'),
      e('2026-13-01', 5, 'Bad month'),
      e('2026-01-05', 0, 'Zero'),
      e('2026-01-05', 'x', 'NaN'),
      { date: '2026-01-06', amount: -615.23, payee: 'P', splits: [{ category: 'Payroll', amount: -574 }, { category: 'Payroll:Taxes', amount: -41.23 }] },
      { date: '2026-01-06', amount: -50, payee: 'Q', splits: [{ category: 'A', amount: -20 }, { category: 'B', amount: -20 }] },
    ]);
    expect(dropped).toBe(3);
    expect(entries[0]).toMatchObject({ date: '2026-01-05', cents: 100000, category: 'Card Income', splits: null });
    expect(entries[1].splits.map(s => s.cents)).toEqual([-57400, -4123]);
    expect(entries[2].splits).toBeNull();   // didn't add up
  });
});

describe('planImport', () => {
  const entries = validateEntries([
    e('2026-01-05', 1000, 'Merch Dep', 'Card Income'),
    e('2026-01-05', 1000, 'Merch Dep', 'Card Income'),          // a genuine repeat
    e('2026-08-07', -41.23, 'Payroll Co', 'Payroll:Payroll Taxes'), // 2 days before the feed starts
    e('2026-08-08', -12.5, 'Typed by hand', 'Office'),           // before the feed, no match
    e('2026-08-10', -574, 'Payroll Co', 'Payroll'),
    e('2026-08-10', -574, 'Payroll Co', 'Payroll'),
    e('2026-08-12', 300, 'Merch Dep', 'Card Income'),
    e('2026-09-01', -99, 'Never reached the bank', 'Office'),
  ]).entries;
  const feed = [
    bank('b1', '2026-08-09', -41.23),   // the feed's first transaction: cutoff
    bank('b2', '2026-08-10', -574),
    bank('b3', '2026-08-11', -574),
    bank('b4', '2026-08-13', 300, { category_id: 'set-by-hand' }),
    bank('b5', '2026-08-20', -1.99),
  ];
  const plan = planImport(entries, feed);

  it('takes the cutoff from the feed\'s first transaction', () => {
    expect(plan.cutoff).toBe('2026-08-09');
  });

  it('adds entries from before the feed, including ones it never saw', () => {
    expect(plan.insert.map(p => [p.entry.date, p.entry.payee])).toEqual([
      ['2026-01-05', 'Merch Dep'], ['2026-01-05', 'Merch Dep'], ['2026-08-08', 'Typed by hand'],
    ]);
    expect(plan.insert[0].key).not.toBe(plan.insert[1].key);   // the repeat gets its own key
  });

  it('matches near the cutoff first, so a late-posting bank transaction is not doubled', () => {
    expect(plan.matched.find(m => m.entry.payee === 'Payroll Co' && m.entry.cents === -4123).txn.id).toBe('b1');
  });

  it('pairs equal amounts one-to-one, closest date first', () => {
    const payroll = plan.matched.filter(m => m.entry.cents === -57400).map(m => m.txn.id).sort();
    expect(payroll).toEqual(['b2', 'b3']);
    expect(plan.matched.find(m => m.entry.cents === 30000).txn.id).toBe('b4');
  });

  it('leaves out what the feed covers but never reported', () => {
    expect(plan.unmatched.map(x => x.payee)).toEqual(['Never reached the bank']);
  });

  it('adds everything when the account has no feed transactions', () => {
    const p = planImport(entries, []);
    expect(p.cutoff).toBeNull();
    expect(p.insert).toHaveLength(entries.length);
    expect(p.matched).toHaveLength(0);
  });

  it('gives the same keys on a second run', () => {
    expect(planImport(entries, feed).insert.map(p => p.key)).toEqual(plan.insert.map(p => p.key));
    expect(importKey(entries[0], 0)).toMatch(/^qif:2026-01-05:100000:[0-9a-f]{8}:0$/);
  });
});

describe('rowsForInsert / newCategoriesFor', () => {
  const [plain, split] = validateEntries([
    e('2026-01-05', 1000, 'Merch Dep', 'Card Income', { memo: 'jan' }),
    { date: '2026-01-06', amount: -615.23, payee: 'Payroll Co', splits: [{ category: 'Payroll', amount: -574 }, { category: 'Payroll:Payroll Taxes', memo: 'er', amount: -41.23 }] },
  ]).entries;

  it('adds one row per entry, or one per split line', () => {
    const one = rowsForInsert({ entry: plain, key: 'k1' }, 'acct');
    expect(one).toEqual([expect.objectContaining({ account_id: 'acct', provider_txn_id: 'k1', amount: 1000, category: 'Card Income', source: 'import', posted_at: '2026-01-05T12:00:00Z', memo: 'jan' })]);
    const two = rowsForInsert({ entry: split, key: 'k2' }, 'acct');
    expect(two.map(r => [r.provider_txn_id, r.amount, r.category])).toEqual([['k2:s0', -574, 'Payroll'], ['k2:s1', -41.23, 'Payroll:Payroll Taxes']]);
    expect(two[1].memo).toBe('er · split 2 of 2');
  });

  it('creates only missing categories, with the file\'s kind or its parent\'s, else by sign', () => {
    const plan = { insert: [{ entry: plain }, { entry: split }], matched: [{ entry: validateEntries([e('2026-09-01', -5, 'x', 'Office:Postage')]).entries[0] }] };
    const fileCats = [{ name: 'Payroll', kind: 'expense' }, { name: 'Card Income', kind: 'income' }];
    expect(newCategoriesFor(plan, ['payroll'], fileCats)).toEqual([
      { name: 'Card Income', kind: 'income', count: 1 },
      { name: 'Office:Postage', kind: 'expense', count: 1 },
      { name: 'Payroll:Payroll Taxes', kind: 'expense', count: 1 },
    ]);
  });

  it('creates Quicken transfers as Not counted, whatever their sign', () => {
    const [t] = validateEntries([e('2026-01-07', -500, 'Chase Epay', '[Chase Card]')]).entries;
    const cats = newCategoriesFor({ insert: [{ entry: t }], matched: [] }, [], [{ name: 'Transfer', kind: 'expense' }]);
    expect(cats).toEqual([{ name: 'Transfer:Chase Card', kind: 'excluded', count: 1 }]);
  });
});

describe('category mapping', () => {
  const ledger = ledgerFrom([
    { id: 'c1', name: 'Card Deposits (Elavon)', kind: 'income' },
    { id: 'c2', name: 'Merchant Fees', kind: 'expense' },
    { id: 'c3', name: 'Payroll', kind: 'expense' },
  ]);

  it('keeps only pairs that point at a category on the list, using its own spelling', () => {
    const m = resolveCategoryMap({ 'Credit Card Income': 'card deposits (elavon)', 'CC Fees': 'Nope', ' ': 'Payroll', x: 5 }, ledger);
    expect([...m]).toEqual([['credit card income', 'Card Deposits (Elavon)']]);
    expect(resolveCategoryMap(null, ledger).size).toBe(0);
    expect(resolveCategoryMap(['a'], ledger).size).toBe(0);
  });

  it('maps an entry and its splits, leaving unmapped names alone', () => {
    const map = new Map([['cc fees', 'Merchant Fees']]);
    const [plain, split] = validateEntries([
      e('2026-01-02', -30, 'Merchant Service', 'CC Fees'),
      { date: '2026-01-03', amount: -40, payee: 'P', splits: [{ category: 'CC Fees', amount: -10 }, { category: 'Other', amount: -30 }] },
    ]).entries;
    expect(mapEntry(plain, map).category).toBe('Merchant Fees');
    expect(mapEntry(split, map).splits.map(s => s.category)).toEqual(['Merchant Fees', 'Other']);
    expect(mapEntry(plain, new Map())).toBe(plain);
  });

  it('suggests what the firm\'s rules call the same bank transactions, by majority', () => {
    const rules = compileRules([
      { pattern: 'merch dep', category_id: 'c1', category: 'x', direction: 'in' },
      { pattern: 'merch fee', category_id: 'c2', category: 'x', direction: 'out' },
    ], ledger);
    const pair = (cat, payee, amount) => ({ entry: validateEntries([e('2026-09-01', amount, payee, cat)]).entries[0], txn: { payee, amount: String(amount) } });
    const s = suggestCategoryMap([
      pair('Credit Card Income', 'Merch Dep', 300),
      pair('Credit Card Income', 'Merch Dep', 900),
      pair('Credit Card Income', 'Odd Deposit', 50),       // no rule: no vote
      pair('CC Fees', 'Merch Fee', -30),
      pair('Payroll', 'Payroll Co', -574),                 // already on the list: nothing to suggest
    ], rules, ledger);
    expect([...s]).toEqual([['credit card income', 'Card Deposits (Elavon)'], ['cc fees', 'Merchant Fees']]);
  });
});

// ── runImport through a fake Supabase client ───────────────────────────────

function fakeAdmin(tables) {
  const ops = [];
  const db = { ...tables };
  function builder(table) {
    const op = { table, filters: [], kind: 'select' };
    ops.push(op);
    const rows = () => {
      let r = [...(db[table] || [])];
      for (const [k, col, v] of op.filters) {
        if (k === 'eq') r = r.filter(x => x[col] === v);
        if (k === 'is') r = r.filter(x => (x[col] ?? null) === v);
        if (k === 'in') r = r.filter(x => v.includes(x[col]));
      }
      return r;
    };
    const b = {
      select() { return b; },
      order() { return b; },
      eq(c, v) { op.filters.push(['eq', c, v]); return b; },
      is(c, v) { op.filters.push(['is', c, v]); return b; },
      in(c, v) { op.filters.push(['in', c, v]); return b; },
      range(from, to) { return Promise.resolve({ data: rows().slice(from, to + 1), error: null }); },
      insert(row) {
        op.kind = 'insert';
        const list = db[table] || (db[table] = []);
        if (list.some(x => String(x.name).toLowerCase() === String(row.name).toLowerCase())) return Promise.resolve({ error: { code: '23505', message: 'dup' } });
        list.push({ id: `${table}-${list.length + 1}`, ...row });
        return Promise.resolve({ error: null });
      },
      upsert(rowsIn, opts) {
        op.kind = 'upsert'; op.opts = opts;
        const list = db[table] || (db[table] = []);
        for (const r of rowsIn) {
          if (!list.some(x => x.account_id === r.account_id && x.provider_txn_id === r.provider_txn_id)) list.push({ id: `t-${list.length + 1}`, ...r });
        }
        return Promise.resolve({ error: null });
      },
      update(patch) {
        op.kind = 'update'; op.patch = patch;
        return { in: (c, v) => { op.filters.push(['in', c, v]); return { is: (c2, v2) => { op.filters.push(['is', c2, v2]); return { select: () => {
          const hit = rows();
          hit.forEach(x => Object.assign(x, patch));
          return Promise.resolve({ data: hit.map(x => ({ id: x.id })), error: null });
        } }; } }; } };
      },
    };
    return b;
  }
  return { from: builder, ops, db };
}

describe('runImport', () => {
  const ACCT = 'acct-1';
  const fileEntries = [
    { date: '2026-01-05', amount: 1000, payee: 'Merch Dep', category: 'Card Income' },
    { date: '2026-08-10', amount: -574, payee: 'Payroll Co', category: 'Payroll' },
    { date: '2026-08-13', amount: 300, payee: 'Merch Dep', category: 'Card Income' },
    { date: '2026-09-01', amount: -99, payee: 'Never reached the bank', category: 'Office' },
  ];
  const seed = () => fakeAdmin({
    bank_transactions: [
      { id: 'b1', account_id: ACCT, source: 'provider', posted_at: '2026-08-09T07:00:00Z', amount: '-41.23', category_id: null },
      { id: 'b2', account_id: ACCT, source: 'provider', posted_at: '2026-08-10T07:00:00Z', amount: '-574', category_id: null },
      { id: 'b3', account_id: ACCT, source: 'provider', posted_at: '2026-08-13T07:00:00Z', amount: '300', category_id: 'hand-set' },
    ],
    bank_categories: [{ id: 'cat-pay', name: 'Payroll', kind: 'expense' }],
  });

  it('a dry run reports the plan and writes nothing', async () => {
    const admin = seed();
    const r = await runImport(admin, { accountId: ACCT, entries: fileEntries, fileCategories: [{ name: 'Card Income', kind: 'income' }], dryRun: true });
    expect(r).toMatchObject({
      dry_run: true, entries: 4, cutoff: '2026-08-09', add: 1, already_added: 0,
      matched: 2, match_categorize: 1, match_already_set: 1, unmatched: 1,
      new_categories: [{ name: 'Card Income', kind: 'income' }],
    });
    expect(admin.ops.some(o => o.kind !== 'select')).toBe(false);
  });

  it('adds history, categorizes matches without touching hand-set ones, and is safe to repeat', async () => {
    const admin = seed();
    const r = await runImport(admin, { accountId: ACCT, entries: fileEntries, fileCategories: [], dryRun: false, userId: 'u1' });
    expect(r).toMatchObject({ dry_run: false, added_rows: 1, categorized: 1, categories_created: 1 });

    const added = admin.db.bank_transactions.find(t => t.source === 'import');
    const cardIncome = admin.db.bank_categories.find(c => c.name === 'Card Income');
    expect(added).toMatchObject({ amount: 1000, category_id: cardIncome.id, category_set_by: 'u1', posted_at: '2026-01-05T12:00:00Z' });
    expect(admin.db.bank_transactions.find(t => t.id === 'b2').category_id).toBe('cat-pay');
    expect(admin.db.bank_transactions.find(t => t.id === 'b3').category_id).toBe('hand-set');
    expect(admin.ops.find(o => o.kind === 'upsert').opts).toMatchObject({ ignoreDuplicates: true });

    const again = await runImport(admin, { accountId: ACCT, entries: fileEntries, fileCategories: [], dryRun: true });
    expect(again).toMatchObject({ add: 0, already_added: 1, match_categorize: 0, match_already_set: 2, new_categories: [] });
  });

  it('suggests the firm\'s own category for a Quicken one, and files under it when mapped', async () => {
    const admin = seed();
    admin.db.bank_categories.push({ id: 'cat-card', name: 'Card Deposits', kind: 'income' });
    admin.db.bank_category_rules = [{ id: 'r1', pattern: 'merch dep', category: 'Card Deposits', category_id: 'cat-card', direction: 'in', priority: 100 }];
    admin.db.bank_transactions.push({ id: 'b4', account_id: ACCT, source: 'provider', posted_at: '2026-08-20T07:00:00Z', amount: '650', category_id: null, payee: 'Merch Dep' });
    const entries = [...fileEntries, { date: '2026-08-20', amount: 650, payee: 'Merch Dep', category: 'Card Income' }];

    const dry = await runImport(admin, { accountId: ACCT, entries, fileCategories: [], dryRun: true });
    expect(dry.quicken_categories.find(c => c.name === 'Card Income')).toMatchObject({ suggestion: 'Card Deposits', mapped_to: null, count: 3 });

    const r = await runImport(admin, { accountId: ACCT, entries, fileCategories: [], categoryMap: { 'Card Income': 'Card Deposits' }, dryRun: false, userId: 'u1' });
    // Nothing new to create: Card Income goes to Card Deposits, Payroll is on the list,
    // and the Office entry is skipped (the bank never reported it).
    expect(r).toMatchObject({ categories_created: 0, new_categories: [], categorized: 2 });
    expect(r.quicken_categories.find(c => c.name === 'Card Income').mapped_to).toBe('Card Deposits');
    expect(admin.db.bank_categories.some(c => c.name === 'Card Income')).toBe(false);
    expect(admin.db.bank_transactions.find(t => t.source === 'import').category_id).toBe('cat-card');
    expect(admin.db.bank_transactions.find(t => t.id === 'b4').category_id).toBe('cat-card');
  });
});
