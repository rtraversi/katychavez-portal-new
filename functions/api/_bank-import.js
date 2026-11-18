// Bank Accounts: importing history from a Quicken export (QIF). NOT a route endpoint
// (underscore prefix); POST /api/bank-feeds { action: 'import' } calls it.
//
// The bank feed only reaches back about 90 days from the day a bank was connected, while
// Quicken holds years. An import fills in the gap without double-counting:
//
//   * Entries dated BEFORE the feed's first transaction in that account are added as
//     transactions (source 'import'), with Quicken's category stored on them.
//   * Entries in the period the feed already covers are matched to the feed's own
//     transaction (same amount, posted within MATCH_WINDOW_DAYS), and Quicken's category
//     is stored on that transaction, unless someone already set one by hand. Nothing is
//     added for them, so nothing is counted twice.
//   * Entries near the start of the feed get the matching treatment first, because the
//     bank can post a day or two after the date Quicken shows.
//   * Entries the feed covers but never saw are reported back and skipped.
//
// Re-running the same file is harmless: added rows carry a key built from the entry
// itself (date, amount, payee, and which repeat it is), so they are only ever added once.

import { normalizeCategoryName } from '../../pages/bank-accounts/categorize.js';

export const MATCH_WINDOW_DAYS = 3;
export const MAX_ENTRIES = 10000;
const INSERT_CHUNK = 500;
const PAGE = 1000;

const DAY_MS = 86400000;
const dayNum = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY_MS);
const toCents = (n) => Math.round(Number(n) * 100);

// FNV-1a, 32-bit, as 8 hex chars: a short stable fingerprint for a payee.
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const clip = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

// Untrusted request body → clean entries. Bad entries are dropped and counted.
//   { entries: [{ date, cents, payee, memo, category, splits }], dropped }
// splits: null, or [{ category, memo, cents }] summing to cents.
export function validateEntries(raw) {
  const entries = [];
  let dropped = 0;
  for (const e of Array.isArray(raw) ? raw : []) {
    const date = typeof e?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !Number.isNaN(dayNum(e.date)) ? e.date : null;
    const cents = toCents(e?.amount);
    if (!date || !Number.isFinite(cents) || cents === 0 || Math.abs(cents) >= 1e11) { dropped++; continue; }
    let splits = null;
    if (Array.isArray(e.splits) && e.splits.length > 1) {
      const parts = e.splits.map(s => ({ category: normalizeCategoryName(s?.category), memo: clip(s?.memo, 300), cents: toCents(s?.amount) }));
      if (parts.every(p => Number.isFinite(p.cents)) && parts.reduce((n, p) => n + p.cents, 0) === cents) splits = parts;
    }
    entries.push({
      date,
      cents,
      payee: clip(e.payee, 200),
      memo: clip(e.memo, 300),
      category: splits ? null : normalizeCategoryName(e.category),
      splits,
    });
  }
  return { entries, dropped };
}

// The key an added row is stored under (bank_transactions.provider_txn_id). The
// occurrence number tells apart two identical entries on the same day.
export function importKey(entry, occurrence, splitIndex = null) {
  const base = `qif:${entry.date}:${entry.cents}:${fnv(String(entry.payee || '').toLowerCase())}:${occurrence}`;
  return splitIndex === null ? base : `${base}:s${splitIndex}`;
}

// Decide what happens to each entry.
//   entries:  validateEntries(...).entries
//   bankTxns: the feed's own transactions in the account: [{ id, posted_at, amount, category_id }]
// → { cutoff, insert: [{ entry, key }], matched: [{ entry, txn }], unmatched: [entry] }
// cutoff is the day of the feed's first transaction (YYYY-MM-DD), or null when the
// account has none, in which case everything is added.
export function planImport(entries, bankTxns, { windowDays = MATCH_WINDOW_DAYS } = {}) {
  const bank = (bankTxns || []).map(t => ({ txn: t, day: dayNum(t.posted_at), cents: toCents(t.amount), used: false }))
    .filter(b => Number.isFinite(b.day) && Number.isFinite(b.cents))
    .sort((a, b) => a.day - b.day);
  const cutoffDay = bank.length ? bank[0].day : null;
  const cutoff = cutoffDay === null ? null : new Date(cutoffDay * DAY_MS).toISOString().slice(0, 10);

  const seen = new Map();
  const items = entries.map(entry => {
    const fp = `${entry.date}|${entry.cents}|${String(entry.payee || '').toLowerCase()}`;
    const occurrence = seen.get(fp) || 0;
    seen.set(fp, occurrence + 1);
    return { entry, day: dayNum(entry.date), occurrence, match: null };
  });

  // Match in passes of growing distance, so an exact-date pair is never stolen by a
  // looser one.
  if (cutoffDay !== null) {
    const byCents = new Map();
    for (const b of bank) (byCents.get(b.cents) || byCents.set(b.cents, []).get(b.cents)).push(b);
    const candidates = items.filter(it => it.day >= cutoffDay - windowDays);
    for (let d = 0; d <= windowDays; d++) {
      for (const it of candidates) {
        if (it.match) continue;
        const b = (byCents.get(it.entry.cents) || []).find(x => !x.used && Math.abs(x.day - it.day) === d);
        if (b) { b.used = true; it.match = b.txn; }
      }
    }
  }

  const insert = [];
  const matched = [];
  const unmatched = [];
  for (const it of items) {
    if (it.match) matched.push({ entry: it.entry, txn: it.match });
    else if (cutoffDay === null || it.day < cutoffDay) insert.push({ entry: it.entry, key: importKey(it.entry, it.occurrence) });
    else unmatched.push(it.entry);
  }
  return { cutoff, insert, matched, unmatched };
}

// Rows to add for one planned insert: one per split line, or one for the whole entry.
export function rowsForInsert({ entry, key }, accountId) {
  const base = {
    account_id: accountId,
    posted_at: `${entry.date}T12:00:00Z`,
    transacted_at: null,
    payee: entry.payee,
    description: entry.payee,
    source: 'import',
  };
  if (!entry.splits) return [{ ...base, provider_txn_id: key, amount: entry.cents / 100, memo: entry.memo, category: entry.category }];
  return entry.splits.map((s, i) => ({
    ...base,
    provider_txn_id: `${key}:s${i}`,
    amount: s.cents / 100,
    memo: [s.memo, entry.memo, `split ${i + 1} of ${entry.splits.length}`].filter(Boolean).join(' · ').slice(0, 300),
    category: s.category,
  }));
}

// Categories the plan needs that the list lacks, with a kind for each: the file's own
// category list when it says (or the nearest parent it lists), else the sign of the
// money that will land there.
export function newCategoriesFor(plan, existingNames, fileCategories) {
  const have = new Set([...existingNames].map(n => n.toLowerCase()));
  const fileKind = new Map((fileCategories || []).map(c => [String(c.name).toLowerCase(), c.kind === 'income' ? 'income' : 'expense']));
  const kindFromFile = (name) => {
    const parts = name.toLowerCase().split(':');
    for (let n = parts.length; n > 0; n--) {
      const k = fileKind.get(parts.slice(0, n).join(':'));
      if (k) return k;
    }
    return null;
  };
  const net = new Map();
  const add = (name, cents) => {
    if (!name || have.has(name.toLowerCase())) return;
    const k = name.toLowerCase();
    const row = net.get(k) || { name, cents: 0 };
    row.cents += cents;
    net.set(k, row);
  };
  for (const { entry } of plan.insert) {
    if (entry.splits) entry.splits.forEach(s => add(s.category, s.cents));
    else add(entry.category, entry.cents);
  }
  for (const { entry } of plan.matched) if (!entry.splits) add(entry.category, entry.cents);
  return [...net.values()]
    .map(r => ({ name: r.name, kind: kindFromFile(r.name) || (r.cents >= 0 ? 'income' : 'expense') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function selectAll(build) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < PAGE) return out;
  }
}

// Run (or, with dryRun, only describe) an import into one account.
//   body: { account_id, entries, categories?, dry_run? }
// → summary for the page; throws only for the portal's own database failures.
export async function runImport(admin, { accountId, entries: rawEntries, fileCategories, dryRun, userId }) {
  const { entries, dropped } = validateEntries(rawEntries);

  const [bankTxns, imported, cats] = await Promise.all([
    selectAll(() => admin.from('bank_transactions').select('id, posted_at, amount, category_id')
      .eq('account_id', accountId).eq('source', 'provider').order('id')),
    selectAll(() => admin.from('bank_transactions').select('provider_txn_id')
      .eq('account_id', accountId).eq('source', 'import').order('id')),
    selectAll(() => admin.from('bank_categories').select('id, name').order('id')),
  ]);

  const plan = planImport(entries, bankTxns);
  const existingKeys = new Set(imported.map(r => r.provider_txn_id));
  const fresh = plan.insert.filter(p => !existingKeys.has(p.key));
  const newCats = newCategoriesFor({ insert: fresh, matched: plan.matched }, cats.map(c => c.name), fileCategories);
  const matchable = plan.matched.filter(m => !m.entry.splits && m.entry.category);

  const dates = entries.map(e => e.date).sort();
  const summary = {
    entries: entries.length,
    dropped,
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    cutoff: plan.cutoff,
    add: fresh.length,
    already_added: plan.insert.length - fresh.length,
    matched: plan.matched.length,
    match_categorize: matchable.filter(m => !m.txn.category_id).length,
    match_already_set: matchable.filter(m => m.txn.category_id).length,
    match_split: plan.matched.filter(m => m.entry.splits).length,
    unmatched: plan.unmatched.length,
    unmatched_samples: plan.unmatched.slice(0, 12).map(e => ({ date: e.date, payee: e.payee, amount: e.cents / 100 })),
    new_categories: newCats,
  };
  if (dryRun) return { dry_run: true, ...summary };

  // 1. Categories.
  // One at a time: the unique index is on lower(name), which an upsert can't target,
  // and a name someone added a moment ago (23505) is fine to skip.
  for (const c of newCats) {
    const r = await admin.from('bank_categories').insert({ name: c.name, kind: c.kind, created_by: userId || null });
    if (r.error && r.error.code !== '23505') throw new Error(`bank_categories insert failed: ${r.error.message}`);
  }
  const allCats = await selectAll(() => admin.from('bank_categories').select('id, name').order('id'));
  const idOf = new Map(allCats.map(c => [c.name.toLowerCase(), c.id]));
  const now = new Date().toISOString();

  // 2. Added history.
  const rows = fresh.flatMap(p => rowsForInsert(p, accountId)).map(({ category, ...r }) => {
    const id = category ? idOf.get(category.toLowerCase()) || null : null;
    return { ...r, category_id: id, category_set_at: id ? now : null, category_set_by: id ? userId || null : null };
  });
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const { error } = await admin.from('bank_transactions')
      .upsert(rows.slice(i, i + INSERT_CHUNK), { onConflict: 'account_id,provider_txn_id', ignoreDuplicates: true });
    if (error) throw new Error(`bank_transactions insert failed: ${error.message}`);
  }

  // 3. Categories onto the feed's own transactions, never over one already set.
  const byCat = new Map();
  for (const m of matchable) {
    if (m.txn.category_id) continue;
    const id = idOf.get(m.entry.category.toLowerCase());
    if (!id) continue;
    (byCat.get(id) || byCat.set(id, []).get(id)).push(m.txn.id);
  }
  let categorized = 0;
  for (const [catId, ids] of byCat) {
    for (let i = 0; i < ids.length; i += INSERT_CHUNK) {
      const { data, error } = await admin.from('bank_transactions')
        .update({ category_id: catId, category_set_at: now, category_set_by: userId || null })
        .in('id', ids.slice(i, i + INSERT_CHUNK)).is('category_id', null).select('id');
      if (error) throw new Error(`bank_transactions category update failed: ${error.message}`);
      categorized += data?.length || 0;
    }
  }

  return { dry_run: false, ...summary, added_rows: rows.length, categorized, categories_created: newCats.length };
}
