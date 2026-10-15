// _uscis-editions.js: which editions of a USCIS form are accepted, read from
// the form's own page on uscis.gov. NOT a route. Pure: no network, no database.
//
// D-127 (Max, 2026-10-15: "it NEEDs to confirm that on uscis's website"). What
// USCIS accepts lives in the page's notice text, in plain English, and changes
// with court orders. Live examples on 2026-10-15:
//   G-28   "you may continue using the 09/17/18 and 05/23/18 editions"
//   I-765  "USCIS continues to accept the ... 08/21/25 edition of Form I-765 and
//          is not accepting the 09/15/26 edition of Forms I-539 and I-765"
//   I-485  "Reject the 01/20/25 and 09/04/26 edition of Form I-485 if it is
//          postmarked ... on or after Sept. 18, 2026; and Only accept the
//          09/18/26 edition of Form I-485 if ... on or after Sept. 18, 2026"
//   I-864  "a 30-day grace period during which we will accept the 10/17/24
//          edition" ... "Beginning Oct. 1, 2026, we will only accept the
//          08/24/26 edition"
//
// The page is turned into STATEMENTS, each about one edition of THIS form:
//   { kind: 'accept' | 'reject' | 'only', edition: 'MM/DD/YY', from, until }
// from / until are YYYY-MM-DD or null. They are stored as they are, and only
// resolved against a date when a scan runs (acceptedEditions), so a grace
// period ends on its own day without waiting for the weekly check.
//
// Never guessed: an edition of this form mentioned in a way none of the
// patterns below understands makes the notice "unreadable", and a person is
// asked to look (unless an "only accept" statement already settles it).

const EDITION = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "09/17/18", "9/17/2018" -> "09/17/18"
export function editionKey(value) {
  const m = String(value || '').match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${String(Number(m[3]) % 100).padStart(2, '0')}`;
}

const formKey = (f) => String(f ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function pageText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|li|div|h\d)>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&rsquo;|&lsquo;/gi, "'").replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/\s+/g, ' ');
}

// Clauses: sentences, and the parts of a sentence a semicolon separates.
// Abbreviated months ("Sept. 18") and "U.S." must not end a sentence.
function clauses(text) {
  const guarded = text
    .replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\./g, '$1\u0001')
    .replace(/\bU\.S\./g, 'U\u0001S\u0001')
    .replace(/\b(No|Nos)\./g, '$1\u0001');
  return guarded.split(/(?<=[.;!?])\s+|;\s*/).map((c) => c.replace(/\u0001/g, '.').trim()).filter(Boolean);
}

function calendarDate(text) {
  const m = String(text).match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}
const dayBefore = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

// When a clause's statement applies: "on or after <date>", "beginning <date>",
// "starting <date>" give a start; "until", "through", "on or before" an end;
// "before <date>" ends the day before.
function window(clause) {
  const from = clause.match(/\b(?:on or after|beginning|starting|effective|as of)\s+([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/i);
  const until = clause.match(/\b(?:until|through|on or before)\s+([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/i);
  const before = clause.match(/\bbefore\s+([A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/i);
  const out = { from: from ? calendarDate(from[1]) : null, until: until ? calendarDate(until[1]) : null };
  if (!out.until && before && !/on or before/i.test(clause)) {
    const d = calendarDate(before[1]);
    out.until = d ? dayBefore(d) : null;
  }
  return out;
}

// What a clause says, keyword by keyword, in order. Rejecting phrases come
// first so "not accepting" is never read as "accepting".
const VERB = new RegExp([
  '(?<reject>no longer accept\\w*|not accept\\w*|will not process|not process\\w*|reject\\w*|may not (?:be )?use\\w*|cannot (?:be )?use\\w*|not be accepted)',
  '(?<only>only accept\\w*|accept only)',
  '(?<accept>accept\\w*|continu\\w* (?:to )?(?:use|using|accept\\w*)|may (?:also )?(?:continue (?:to )?)?us(?:e|ing)|can (?:also )?(?:still )?us(?:e|ing))',
  '(?<publish>publish\\w*|edition date:|new edition|revised edition)',
].join('|'), 'gi');

// The forms an edition date belongs to: "08/21/25 edition of Form I-765",
// "09/15/26 edition of Forms I-539 and I-765"; dates chained with "and"
// share the forms named after the last one. No form named: this page's form.
function formsFor(clause, endOfDate) {
  const after = clause.slice(endOfDate);
  const chain = after.match(/^(?:\s*(?:,|and|or)\s*(?:the\s+)?\d{1,2}\/\d{1,2}\/\d{2,4})*\s*editions?\b(?:\s+of\s+(?:the\s+)?forms?\s+((?:[A-Z]-?\d+[A-Z]*)(?:\s*(?:,|and)\s*(?:[A-Z]-?\d+[A-Z]*))*))?/i);
  if (!chain) return { edition: false, forms: null };
  const forms = chain[1] ? chain[1].split(/\s*(?:,|and)\s*/).map(formKey).filter(Boolean) : null;
  return { edition: true, forms };
}

// Returns { statements, unreadable, text }:
//   statements  understood statements about this form's editions
//   unreadable  editions of this form mentioned in a way not understood
//   text        the notice clauses that mention an edition, for a person to read
export function parseEditionNotices(html, formNumber) {
  const own = formKey(formNumber);
  // The "Edition Date 09/17/18" label in Form Details is the published
  // edition, read by extractEdition(); it is not a notice.
  const text = pageText(html).replace(/\bEdition Date\s+\d{1,2}\/\d{1,2}\/\d{2,4}/gi, ' ');
  const statements = [];
  const unreadable = [];
  const kept = [];
  for (const clause of clauses(text)) {
    if (!/edition/i.test(clause) || !EDITION.test(clause)) { EDITION.lastIndex = 0; continue; }
    EDITION.lastIndex = 0;
    const verbs = [...clause.matchAll(VERB)].map((m) => ({ at: m.index, kind: Object.keys(m.groups).find((k) => m.groups[k]) }));
    const { from, until } = window(clause);
    const otherThan = /\bother than\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(clause);
    let mentioned = false;
    for (const m of clause.matchAll(EDITION)) {
      const assoc = formsFor(clause, m.index + m[0].length);
      const before = clause.slice(Math.max(0, m.index - 20), m.index);
      const labelled = /edition date:\s*$/i.test(before) || /\bedition other than\s*$/i.test(before) || /\bnew\s*$|\brevised\s*$/i.test(before);
      if (!assoc.edition && !labelled) continue; // a date, not an edition
      if (assoc.forms && !assoc.forms.includes(own)) continue; // another form's edition
      mentioned = true;
      const edition = editionKey(m[0]);
      if (otherThan && otherThan.index <= m.index && m.index <= otherThan.index + otherThan[0].length) {
        statements.push({ kind: 'only', edition, from, until: null });
        continue;
      }
      const verb = [...verbs].reverse().find((v) => v.at < m.index) || verbs.find((v) => v.at > m.index);
      if (!verb) { unreadable.push(edition); continue; }
      if (verb.kind === 'publish') continue; // "published a new edition (edition date: ...)": the page's own edition
      statements.push({ kind: verb.kind, edition, from: verb.kind === 'accept' ? (from && !until ? from : null) : from, until: verb.kind === 'accept' ? until : null });
    }
    if (mentioned) kept.push(clause);
  }
  return { statements, unreadable: [...new Set(unreadable)], text: kept.join(' ').slice(0, 2000) };
}

const active = (s, on) => (!s.from || s.from <= on) && (!s.until || on <= s.until);

// The editions accepted on a date (YYYY-MM-DD), from the published edition and
// the stored notice. Returns { editions, decided, unclear }:
//   decided  an "only accept" statement settles the list on its own
//   unclear  the notice mentions another edition of this form in a way that
//            was not understood, and nothing settles it: a person must look
export function acceptedEditions({ published, statements = [], unreadable = [] }, on) {
  const pub = editionKey(published);
  const live = statements.filter((s) => active(s, on));
  const only = live.filter((s) => s.kind === 'only').map((s) => s.edition);
  const rejected = new Set(live.filter((s) => s.kind === 'reject').map((s) => s.edition));
  if (only.length) return { editions: [...new Set(only)].filter((e) => !rejected.has(e)), decided: true, unclear: false };
  const out = [];
  const add = (e) => { if (e && !rejected.has(e) && !out.includes(e)) out.push(e); };
  add(pub);
  live.filter((s) => s.kind === 'accept').forEach((s) => add(s.edition));
  const understood = new Set(statements.map((s) => s.edition));
  const unclear = unreadable.some((e) => e !== pub && !understood.has(e));
  return { editions: out, decided: false, unclear };
}
