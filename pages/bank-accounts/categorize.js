// Bank Accounts: transaction categories. Pure functions, no DOM. bank-accounts.js
// imports this as an ES module; tests import it directly.
//
// A rule (bank_category_rules) is { pattern, category, direction, priority }. A
// transaction gets the category of the first rule, by priority then age, whose
// pattern appears anywhere in its payee, description or memo (case-insensitive) and
// whose direction fits: 'in' = money in (amount > 0), 'out' = money out, 'any' = both.

export const UNCATEGORIZED = 'Uncategorized';

// Rules → matchers in evaluation order. Blank or one-letter patterns are dropped: they
// would match nearly everything.
export function compileRules(rules) {
  return (rules || [])
    .map((r, i) => ({
      needle: String(r?.pattern ?? '').trim().toLowerCase(),
      category: String(r?.category ?? '').trim(),
      direction: r?.direction === 'in' || r?.direction === 'out' ? r.direction : 'any',
      priority: Number.isFinite(Number(r?.priority)) ? Number(r.priority) : 100,
      created: r?.created_at ? Date.parse(r.created_at) || 0 : 0,
      i,
    }))
    .filter(r => r.needle.length >= 2 && r.category)
    .sort((a, b) => a.priority - b.priority || a.created - b.created || a.i - b.i);
}

export function haystack(t) {
  return [t?.payee, t?.description, t?.memo].filter(Boolean).join(' ').toLowerCase();
}

// Transaction → category name, or null when no rule matches.
export function categorize(t, compiled) {
  const hay = haystack(t);
  if (!hay) return null;
  const dir = Number(t?.amount) > 0 ? 'in' : 'out';
  for (const r of compiled) {
    if (r.direction !== 'any' && r.direction !== dir) continue;
    if (hay.includes(r.needle)) return r.category;
  }
  return null;
}

// Transactions → per-category totals, biggest money movement first.
//   { categories: [{ category, total, count, moneyIn, moneyOut }],
//     uncategorized: { count, total } }
// total is net (in minus out); ranking uses its size, so a large income category and
// a large expense category both rank high. Cents are summed as integers to avoid
// floating-point drift across hundreds of rows.
export function summarize(txns, compiled) {
  const by = new Map();
  let uCount = 0;
  let uCents = 0;
  for (const t of txns || []) {
    const cents = Math.round(Number(t?.amount) * 100);
    if (!Number.isFinite(cents)) continue;
    const cat = categorize(t, compiled);
    if (!cat) { uCount++; uCents += cents; continue; }
    const row = by.get(cat) || { category: cat, cents: 0, count: 0, inCents: 0, outCents: 0 };
    row.cents += cents;
    row.count++;
    if (cents > 0) row.inCents += cents; else row.outCents -= cents;
    by.set(cat, row);
  }
  const categories = [...by.values()]
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents) || a.category.localeCompare(b.category))
    .map(r => ({ category: r.category, total: r.cents / 100, count: r.count, moneyIn: r.inCents / 100, moneyOut: r.outCents / 100 }));
  return { categories, uncategorized: { count: uCount, total: uCents / 100 } };
}

// Money in and money out, summarized separately. Every deposit lands under income and
// every payment under expenses, each grouped by category. A category that has both
// (e.g. a refund from a software vendor) shows in each column with just that side,
// and nothing is netted across the two.
//   { income: summarize(deposits), expenses: summarize(payments) }
export function summarizeFlows(txns, compiled) {
  const moneyIn = [];
  const moneyOut = [];
  for (const t of txns || []) {
    const n = Number(t?.amount);
    if (!Number.isFinite(n) || n === 0) continue;
    (n > 0 ? moneyIn : moneyOut).push(t);
  }
  return { income: summarize(moneyIn, compiled), expenses: summarize(moneyOut, compiled) };
}

// Transactions posted on or after `since` (a Date).
export function since(txns, sinceDate) {
  const cut = sinceDate.getTime();
  return (txns || []).filter(t => Date.parse(t?.posted_at) >= cut);
}
