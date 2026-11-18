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

import { normalizeCategoryName, ledgerFrom, compileRules, categorize } from '../../pages/bank-accounts/categorize.js';

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
    const row = net.get(k) || { name, cents: 0, count: 0 };
    row.cents += cents;
    row.count++;
    net.set(k, row);
  };
  for (const { entry } of plan.insert) {
    if (entry.splits) entry.splits.forEach(s => add(s.category, s.cents));
    else add(entry.category, entry.cents);
  }
  for (const { entry } of plan.matched) if (!entry.splits) add(entry.category, entry.cents);
  return [...net.values()]
    .map(r => ({ name: r.name, kind: kindFromFile(r.name) || (r.cents >= 0 ? 'income' : 'expense'), count: r.count }))
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

// ── Mapping Quicken's categories onto the firm's list ───────────────────────
//
// The firm's list may already cover what Quicken calls by another name ("Credit Card
// Income" in Quicken is "Card Deposits" on the list). The page offers each Quicken
// category that isn't on the list as "use <existing>" or "create new", and sends the
// choices as { quickenName: existingName }.

// Untrusted { quickenName: existingName } → Map(lowercase quicken name → the existing
// category's own name). Pairs pointing at a name not on the list are ignored.
export function resolveCategoryMap(raw, ledger) {
  const out = new Map();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [from, to] of Object.entries(raw).slice(0, 1000)) {
    const src = normalizeCategoryName(from);
    const target = typeof to === 'string' ? ledger.byName.get(to.trim().toLowerCase()) : null;
    if (src && target) out.set(src.toLowerCase(), target.name);
  }
  return out;
}

// An entry with its categories put through the map. The originals stay on
// sourceCategory, so suggestions can still be worked out from Quicken's own names.
export function mapEntry(entry, map) {
  if (!map.size) return entry;
  const to = (c) => (c && map.get(c.toLowerCase())) || c;
  return {
    ...entry,
    category: to(entry.category),
    splits: entry.splits ? entry.splits.map(s => ({ ...s, category: to(s.category) })) : null,
  };
}

// For entries matched to a bank-feed transaction, what the firm's own rules call that
// same transaction: Quicken name → the list's name that most often stands for it.
//   → Map(lowercase quicken name → existing name)
export function suggestCategoryMap(matched, compiled, ledger) {
  const tally = new Map();
  for (const { entry, txn } of matched || []) {
    if (entry.splits || !entry.category || ledger.byName.has(entry.category.toLowerCase())) continue;
    const portal = categorize(txn, compiled, ledger);
    if (!portal || !ledger.byName.has(portal.toLowerCase())) continue;
    const k = entry.category.toLowerCase();
    const counts = tally.get(k) || new Map();
    counts.set(portal, (counts.get(portal) || 0) + 1);
    tally.set(k, counts);
  }
  const out = new Map();
  for (const [k, counts] of tally) {
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    out.set(k, best[0]);
  }
  return out;
}

// Run (or, with dryRun, only describe) an import into one account.
//   body: { account_id, entries, categories?, category_map?, dry_run? }
// → summary for the page; throws only for the portal's own database failures.
export async function runImport(admin, { accountId, entries: rawEntries, fileCategories, categoryMap, dryRun, userId }) {
  const { entries, dropped } = validateEntries(rawEntries);

  const [bankTxns, imported, cats, rules] = await Promise.all([
    selectAll(() => admin.from('bank_transactions').select('id, posted_at, amount, category_id, payee, description, memo')
      .eq('account_id', accountId).eq('source', 'provider').order('id')),
    selectAll(() => admin.from('bank_transactions').select('provider_txn_id')
      .eq('account_id', accountId).eq('source', 'import').order('id')),
    selectAll(() => admin.from('bank_categories').select('id, name, kind').order('id')),
    selectAll(() => admin.from('bank_category_rules').select('id, pattern, category, category_id, direction, priority, created_at').order('id')),
  ]);
  const ledger = ledgerFrom(cats);
  const compiled = compileRules(rules, ledger);

  // Matching doesn't look at categories, so plan once on Quicken's own names...
  const raw = planImport(entries, bankTxns);
  const existingKeys = new Set(imported.map(r => r.provider_txn_id));
  const rawFresh = raw.insert.filter(p => !existingKeys.has(p.key));
  const quickenCats = newCategoriesFor({ insert: rawFresh, matched: raw.matched }, cats.map(c => c.name), fileCategories);
  const suggested = suggestCategoryMap(raw.matched, compiled, ledger);

  // ...then put the categories through the page's map.
  const map = resolveCategoryMap(categoryMap, ledger);
  const plan = {
    ...raw,
    insert: raw.insert.map(p => ({ ...p, entry: mapEntry(p.entry, map) })),
    matched: raw.matched.map(m => ({ ...m, entry: mapEntry(m.entry, map) })),
  };
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
    // Every Quicken category the import would use that isn't on the list, with what
    // the firm's rules suggest it maps to and what the page chose.
    quicken_categories: quickenCats.map(c => ({
      ...c,
      suggestion: suggested.get(c.name.toLowerCase()) || null,
      mapped_to: map.get(c.name.toLowerCase()) || null,
    })),
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
