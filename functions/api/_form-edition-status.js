// Drafter 1.0.2 (D-11, D-12, D-16): is OUR edition of a USCIS form still
// accepted today? NOT a route. Pure: no network, no database.
//
// `row` is the form's form_editions row, as the package API reads it with
// select('*'), so it works before and after edition_notices exists (that
// column arrives with the checker's migration 2005). `on` is YYYY-MM-DD.
//
// Returns { tag, warning } for the USCIS Forms tab:
//   tag      { label, kind }   kind is a DK.tag kind: ok | crit | warn | mut
//   warning  null, or { level: 'danger' | 'warn', text }
// The badge only ever names our edition (D-12); the line under the title says
// whether, or until when, USCIS takes it (D-11).

import { acceptedEditions, editionKey } from './_uscis-editions.js';

const NOT_ACCEPTED = 'WARNING THIS EDITION IS NO LONGER ACCEPTED BY USCIS';

const dayBefore = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

// "2026-12-31" -> "12/31/26"
export function shortDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : null;
}

// The last day our edition is accepted, when the notice names one: the
// earliest of an accept statement's until, the day before a reject of it
// starts, and the day before an "only accept" of other editions starts.
export function acceptedUntil(ours, statements, on) {
  const ends = [];
  for (const s of statements) {
    if (s.kind === 'accept' && s.edition === ours && s.until && s.until >= on && (!s.from || s.from <= on)) ends.push(s.until);
    if (s.kind === 'reject' && s.edition === ours && s.from && s.from > on) ends.push(dayBefore(s.from));
  }
  // An "only accept" that starts later ends ours, unless ours is one of the
  // editions it keeps from that day on.
  const onlyFrom = new Map();
  for (const s of statements) {
    if (s.kind === 'only' && s.from && s.from > on) onlyFrom.set(s.from, [...(onlyFrom.get(s.from) || []), s.edition]);
  }
  for (const [from, kept] of onlyFrom) if (!kept.includes(ours)) ends.push(dayBefore(from));
  return ends.length ? ends.sort()[0] : null;
}

export function editionStatus(row, on = new Date().toISOString().slice(0, 10)) {
  const ours = row ? editionKey(row.edition_date) : null;
  if (!row || !ours) return { tag: { label: 'Edition unknown', kind: 'warn' }, warning: null };
  const label = `Edition ${ours}`;

  const notices = row.edition_notices;
  if (!notices || !row.upstream_edition) {
    // D-16: no notices read yet (production before migration 2005), so only
    // the weekly check's verdict on the published edition is known.
    const kind = row.check_status === 'current' ? 'ok' : row.check_status === 'stale' ? 'warn' : 'mut';
    return { tag: { label, kind }, warning: null };
  }

  const statements = notices.statements || [];
  const result = acceptedEditions({ published: row.upstream_edition, statements, unreadable: notices.unreadable || [] }, on);
  if (result.unclear) return { tag: { label, kind: 'mut' }, warning: null };
  if (!result.editions.includes(ours)) {
    return { tag: { label, kind: 'crit' }, warning: { level: 'danger', text: NOT_ACCEPTED } };
  }
  const until = acceptedUntil(ours, statements, on);
  return {
    tag: { label, kind: 'ok' },
    warning: until ? { level: 'warn', text: `WARNING THIS EDITION WILL BE ACCEPTED UNTIL ${shortDate(until)}` } : null,
  };
}
