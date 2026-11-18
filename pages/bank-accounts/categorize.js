// Bank Accounts: transaction categories and the category report. Pure functions, no
// DOM. bank-accounts.js imports this as an ES module; tests import it directly.
//
// A transaction's category comes from, in order:
//   1. the category stored on it (bank_transactions.category_id), set by hand or by a
//      Quicken import. This always wins.
//   2. the first rule (bank_category_rules), by priority then age, whose pattern appears
//      anywhere in its payee, description or memo (case-insensitive) and whose direction
//      fits: 'in' = money in (amount > 0), 'out' = money out, 'any' = both.
//   3. otherwise it is uncategorized.
//
// The category list (bank_categories) gives each name a kind, income or expense, which
// decides where the report puts it. A colon makes a subcategory: "Office:Software" is
// reported under "Office".

export const UNCATEGORIZED = 'Uncategorized';

// ── Category list ───────────────────────────────────────────────────────────

// A category name as the list stores it, or null for "no category". Quicken spellings
// are folded in: "[Chase Card]" (a transfer) becomes "Transfer:Chase Card", and
// "--Split--" / "Uncategorized" mean no category.
export function normalizeCategoryName(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const transfer = /^\[(.+)\]$/.exec(s);
  if (transfer) s = `Transfer:${transfer[1]}`;
  s = s.split(':').map(p => p.trim()).filter(Boolean).join(':');
  if (!s || /^(--)?split(--)?$/i.test(s) || /^uncategori[sz]ed$/i.test(s)) return null;
  if (s.length > 80) s = s.slice(0, 80).replace(/[:\s]+$/, '');
  return s || null;
}

export const topLevel = (name) => String(name).split(':')[0];

// Category rows → lookups. { byId: Map(id → cat), byName: Map(lowercase name → cat), list }
export function ledgerFrom(categories) {
  const list = (categories || [])
    .filter(c => c && c.name)
    .map(c => ({ id: c.id, name: String(c.name), kind: c.kind === 'income' ? 'income' : 'expense' }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return {
    list,
    byId: new Map(list.map(c => [c.id, c])),
    byName: new Map(list.map(c => [c.name.toLowerCase(), c])),
  };
}

// ── Rules ───────────────────────────────────────────────────────────────────

// Rules → matchers in evaluation order. Blank or one-letter patterns are dropped: they
// would match nearly everything. A rule tied to a list category (category_id) uses that
// category's current name, so a rename carries through.
export function compileRules(rules, ledger) {
  return (rules || [])
    .map((r, i) => ({
      needle: String(r?.pattern ?? '').trim().toLowerCase(),
      category: String((r?.category_id && ledger?.byId.get(r.category_id)?.name) || r?.category || '').trim(),
      direction: r?.direction === 'in' || r?.direction === 'out' ? r.direction : 'any',
      priority: Number.isFinite(Number(r?.priority)) ? Number(r.priority) : 100,
      created: r?.created_at ? Date.parse(r.created_at) || 0 : 0,
      id: r?.id,
      i,
    }))
    .filter(r => r.needle.length >= 2 && r.category)
    .sort((a, b) => a.priority - b.priority || a.created - b.created || a.i - b.i);
}

export function haystack(t) {
  return [t?.payee, t?.description, t?.memo].filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ');
}

// ── Learning (the Quicken "memorized payee") ────────────────────────────────
//
// Bank text carries a stable name plus parts that change every time:
//   "Trans Human Interest Inte;111726;401k 88213"  →  "human interest inte"
//   "Trans Gusto ;100526;icd 209291"                →  "gusto"
//   "Purchase Yah*mailstor100g 7399 Ny 800-361-5610" → "yah*mailstor100g"
// payeeKey keeps the stable name: the text before the first ; , or |, without a
// leading bank word ("Trans", "Purchase"…), stopping at the first token with no
// letters in it (a store number, a date, a phone number), at most 4 words.

const BANK_WORDS = new Set(['trans', 'purchase', 'pos', 'ach', 'debit', 'recurring', 'checkcard', 'withdrawal', 'preauthorized', 'pre-authorized', 'electronic']);

function keyFrom(text) {
  const head = String(text || '').toLowerCase().split(/[;,|]/)[0];
  const words = head.split(/\s+/).filter(Boolean);
  while (words.length && BANK_WORDS.has(words[0])) words.shift();
  const kept = [];
  for (const w of words) {
    if (!/[a-z]/.test(w)) break;
    kept.push(w);
    if (kept.length === 4) break;
  }
  const key = kept.join(' ');
  return key.length >= 3 ? key : null;
}

// Transaction → the text a learned rule should match, or null.
export function payeeKey(t) {
  return keyFrom(t?.payee) || keyFrom(t?.description);
}

// Rules worth adding, learned from transactions that carry a stored category but that
// no rule covers yet. One per payee key and direction, and only when every such
// transaction under that key agrees on the category, so a vendor with two kinds of
// charges (a payroll service's wages and its taxes) never gets a rule that flips.
//   → [{ pattern, direction, category_id, category, count }]
// Pass `onlyKey` to ask about one payee (after a single categorization).
export function learnableRules(txns, compiled, ledger, { onlyKey = null } = {}) {
  const groups = new Map();
  const taken = new Set((compiled || []).map(r => `${r.needle}|${r.direction}`));
  for (const t of txns || []) {
    if (!t?.category_id || !ledger?.byId.has(t.category_id)) continue;
    if (matchRule(t, compiled)) continue;
    const key = payeeKey(t);
    if (!key || (onlyKey && key !== onlyKey)) continue;
    if (!haystack(t).includes(key)) continue;
    const direction = Number(t.amount) > 0 ? 'in' : 'out';
    const g = groups.get(`${key}|${direction}`) || { pattern: key, direction, ids: new Set(), count: 0 };
    g.ids.add(t.category_id);
    g.count++;
    groups.set(`${key}|${direction}`, g);
  }
  return [...groups.entries()]
    .filter(([k, g]) => g.ids.size === 1 && !taken.has(k))
    .map(([, g]) => {
      const id = [...g.ids][0];
      return { pattern: g.pattern, direction: g.direction, category_id: id, category: ledger.byId.get(id).name, count: g.count };
    })
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern) || a.direction.localeCompare(b.direction));
}

// The rule that decides this transaction, or null.
export function matchRule(t, compiled) {
  const hay = haystack(t);
  if (!hay) return null;
  const dir = Number(t?.amount) > 0 ? 'in' : 'out';
  for (const r of compiled || []) {
    if (r.direction !== 'any' && r.direction !== dir) continue;
    if (hay.includes(r.needle)) return r;
  }
  return null;
}

// Where a transaction's category comes from: 'stored' (set by hand or imported),
// 'rule', or null (uncategorized).
export function categorySource(t, compiled, ledger) {
  if (t?.category_id && ledger?.byId.has(t.category_id)) return 'stored';
  return matchRule(t, compiled) ? 'rule' : null;
}

// Transaction → category name, or null when it has none.
export function categorize(t, compiled, ledger) {
  if (t?.category_id && ledger?.byId.has(t.category_id)) return ledger.byId.get(t.category_id).name;
  return matchRule(t, compiled)?.category ?? null;
}

// ── Overview tiles ──────────────────────────────────────────────────────────

// Transactions → per-category totals, biggest money movement first.
//   { categories: [{ category, total, count, moneyIn, moneyOut }],
//     uncategorized: { count, total } }
// total is net (in minus out); ranking uses its size, so a large income category and
// a large expense category both rank high. Cents are summed as integers to avoid
// floating-point drift across hundreds of rows.
export function summarize(txns, compiled, ledger) {
  const by = new Map();
  let uCount = 0;
  let uCents = 0;
  for (const t of txns || []) {
    const cents = Math.round(Number(t?.amount) * 100);
    if (!Number.isFinite(cents)) continue;
    const cat = categorize(t, compiled, ledger);
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
export function summarizeFlows(txns, compiled, ledger) {
  const moneyIn = [];
  const moneyOut = [];
  for (const t of txns || []) {
    const n = Number(t?.amount);
    if (!Number.isFinite(n) || n === 0) continue;
    (n > 0 ? moneyIn : moneyOut).push(t);
  }
  return { income: summarize(moneyIn, compiled, ledger), expenses: summarize(moneyOut, compiled, ledger) };
}

// Transactions posted on or after `since` (a Date).
export function since(txns, sinceDate) {
  const cut = sinceDate.getTime();
  return (txns || []).filter(t => Date.parse(t?.posted_at) >= cut);
}

// ── Category report (the Quicken "Income/Expense by Category" view) ──────────
//
// Unlike the overview tiles, the report sorts by the category's KIND, not by the sign of
// each transaction: a vendor refund booked to an expense category reduces that expense.
// Each category's total is net. Uncategorized money is split by sign, deposits under
// Income and payments under Expenses, so nothing is silently dropped.
//
//   {
//     income:   { total, count, groups },
//     expenses: { total, count, groups },
//     net, count,
//   }
//   group:  { name, total, count, uncategorized?, members: [member] }   (top-level name)
//   member: { name, label, total, count, txns }                          (full name)
//
// Groups are alphabetical, with Uncategorized first, like Quicken. A group's members are
// the parent itself (when used directly) and then its subcategories. Category names the
// list doesn't know (a rule pointing at a deleted category) go by the sign of their net.
export function buildReport(txns, compiled, ledger) {
  const byName = new Map();
  const unc = { in: { cents: 0, count: 0, txns: [] }, out: { cents: 0, count: 0, txns: [] } };
  let count = 0;

  for (const t of txns || []) {
    const cents = Math.round(Number(t?.amount) * 100);
    if (!Number.isFinite(cents) || cents === 0) continue;
    count++;
    const name = categorize(t, compiled, ledger);
    if (!name) {
      const side = cents > 0 ? unc.in : unc.out;
      side.cents += cents; side.count++; side.txns.push(t);
      continue;
    }
    const row = byName.get(name) || { name, cents: 0, count: 0, txns: [] };
    row.cents += cents; row.count++; row.txns.push(t);
    byName.set(name, row);
  }

  const sections = { income: new Map(), expense: new Map() };
  for (const row of byName.values()) {
    const kind = ledger?.byName.get(row.name.toLowerCase())?.kind || (row.cents >= 0 ? 'income' : 'expense');
    const top = topLevel(row.name);
    const groups = sections[kind];
    const g = groups.get(top) || { name: top, cents: 0, count: 0, members: [] };
    g.cents += row.cents; g.count += row.count;
    g.members.push({ name: row.name, label: row.name === top ? top : row.name.slice(top.length + 1), cents: row.cents, count: row.count, txns: row.txns });
    groups.set(top, g);
  }

  const byDate = (a, b) => String(a.posted_at).localeCompare(String(b.posted_at));
  const alpha = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  const finish = (groups, uncSide) => {
    const list = [...groups.values()]
      .sort((a, b) => alpha(a.name, b.name))
      .map(g => ({
        name: g.name, total: g.cents / 100, count: g.count,
        members: g.members
          .sort((a, b) => (a.name === g.name ? -1 : b.name === g.name ? 1 : alpha(a.label, b.label)))
          .map(m => ({ name: m.name, label: m.label, total: m.cents / 100, count: m.count, txns: m.txns.sort(byDate) })),
      }));
    if (uncSide.count) {
      list.unshift({
        name: UNCATEGORIZED, uncategorized: true, total: uncSide.cents / 100, count: uncSide.count,
        members: [{ name: UNCATEGORIZED, label: UNCATEGORIZED, total: uncSide.cents / 100, count: uncSide.count, txns: uncSide.txns.sort(byDate) }],
      });
    }
    const cents = [...groups.values()].reduce((n, g) => n + g.cents, uncSide.cents);
    return { total: cents / 100, count: list.reduce((n, g) => n + g.count, 0), groups: list };
  };

  const income = finish(sections.income, unc.in);
  const expenses = finish(sections.expense, unc.out);
  return { income, expenses, net: (Math.round(income.total * 100) + Math.round(expenses.total * 100)) / 100, count };
}

// ── Report periods ──────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0');
export const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Period key → { from, to } as YYYY-MM-DD (both inclusive), in local time.
//   this_year · last_year · this_month · last_month · this_quarter · last_quarter
// Returns null for an unknown key (the page then uses its custom dates).
export function periodRange(key, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const q = Math.floor(m / 3);
  const span = (y1, m1, y2, m2) => ({ from: isoDay(new Date(y1, m1, 1)), to: isoDay(new Date(y2, m2 + 1, 0)) });
  switch (key) {
    case 'this_year': return span(y, 0, y, 11);
    case 'last_year': return span(y - 1, 0, y - 1, 11);
    case 'this_month': return span(y, m, y, m);
    case 'last_month': {
      const ly = m === 0 ? y - 1 : y;
      const lm = (m + 11) % 12;
      return span(ly, lm, ly, lm);
    }
    case 'this_quarter': return span(y, q * 3, y, q * 3 + 2);
    case 'last_quarter': {
      const lq = q === 0 ? 3 : q - 1;
      const ly = q === 0 ? y - 1 : y;
      return span(ly, lq * 3, ly, lq * 3 + 2);
    }
    default: return null;
  }
}

// ── CSV ─────────────────────────────────────────────────────────────────────

// Rows (arrays) → CSV text. Text a spreadsheet would run as a formula gets an
// apostrophe in front, because payees come from the bank. Plain numbers pass through.
export function toCsv(rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d[\d,]*(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

// The report as a summary CSV: one line per category, section totals, and the net.
export function reportCsv(report) {
  const rows = [['Section', 'Category', 'Transactions', 'Amount']];
  const add = (label, sec) => {
    for (const g of sec.groups) {
      for (const m of g.members) rows.push([label, m.name, m.count, m.total.toFixed(2)]);
    }
    rows.push([label, `Total ${label.toLowerCase()}`, sec.count, sec.total.toFixed(2)]);
  };
  add('Income', report.income);
  add('Expenses', report.expenses);
  rows.push(['', 'Overall', report.count, report.net.toFixed(2)]);
  return toCsv(rows);
}
