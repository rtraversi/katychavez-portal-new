// The Monday sync engine: turns a board fetch plus the portal's client list into a
// preview, and turns a confirmed preview into client records.
//
// Split from the route handlers so the classification logic is a pure function that can
// be tested without a database — `buildPreview` is where every decision about what will
// happen is made, and the import step does no thinking of its own beyond writing what
// the preview already decided.
//
// The preview/confirm split is the point of the module. Migration 2000's comment spells
// out why: this creates client records, and an unattended job that can manufacture a
// hundred of them is not something to run on a cron.

import { parseItemName, mapCaseType, classifyNonClient } from './_monday-parse.js';
import { matchItem, findDeparted } from './_monday-match.js';

/**
 * Classify every board item against the portal's clients.
 *
 * Pure — no I/O. Returns four buckets plus counts:
 *
 *   create    parsed cleanly, no existing client — a confirm will create these
 *   link      confidently matches an existing client — a confirm will record the link
 *   review    something a human has to settle; nothing happens to these on confirm
 *   ignored   not a client at all. Recorded so they never surface again, not deleted.
 *
 * `departed` is reported separately: clients whose board item has left the group. Per the
 * 2026-07-20 decision this is a flag and nothing more — no archiving, because a departure
 * is as likely to be a board reorganisation as a closed case.
 */
export function buildPreview(items, clients, { known = new Map() } = {}) {
  const out = { create: [], link: [], review: [], ignored: [] };

  for (const item of items) {
    const prior = known.get(String(item.id));

    // Anything a human already dismissed stays dismissed — otherwise the same handful of
    // working notes would demand attention on every single run.
    if (prior?.status === 'ignored') {
      out.ignored.push({ item, reason: prior.reason || 'Previously ignored' });
      continue;
    }

    const nonClient = classifyNonClient(item);
    if (nonClient) {
      out.ignored.push({ item, reason: nonClient });
      continue;
    }

    const caseTypeKey = mapCaseType(item.caseCode);
    const parsed = parseItemName(item.name, caseTypeKey);

    // An unrecognised case code does not block the client — the matter just opens without
    // a case type, which staff can set. Losing the client over it would be worse.
    const caseTypeIssue =
      item.caseCode && !caseTypeKey
        ? `Case code "${item.caseCode}" has no portal case type — matter will open without one`
        : null;

    if (parsed.confidence !== 'high') {
      out.review.push({ item, parsed, caseTypeKey, reason: parsed.issues.join('; ') });
      continue;
    }

    const match = matchItem(parsed, item, clients);

    if (match.decision === 'linked') continue; // already reconciled, nothing to show
    if (match.decision === 'review') {
      out.review.push({ item, parsed, caseTypeKey, reason: match.reason, candidates: match.candidates });
      continue;
    }
    if (match.decision === 'matched') {
      out.link.push({ item, parsed, caseTypeKey, client_id: match.client_id, reason: match.reason });
      continue;
    }

    out.create.push({
      item,
      parsed,
      caseTypeKey,
      notes: [...(parsed.notes || []), ...(caseTypeIssue ? [caseTypeIssue] : [])],
    });
  }

  const departed = findDeparted(clients, items.map((i) => i.id));

  return {
    ...out,
    departed,
    counts: {
      total: items.length,
      create: out.create.length,
      link: out.link.length,
      review: out.review.length,
      ignored: out.ignored.length,
      departed: departed.length,
    },
  };
}

/**
 * Build the `clients` row for a create entry.
 *
 * Only fields monday actually knows about. Everything else is left for staff — this
 * module never invents data, and a half-filled record is honest about what is missing.
 */
export function clientRowFor(entry) {
  const b = entry.parsed.beneficiary;
  return {
    first_name: b.first_name,
    last_name: [b.last_name, b.suffix].filter(Boolean).join(' '),
    phone: entry.item.phone || null,
    email: entry.item.email || null,
    monday_item_id: String(entry.item.id),
    // Board notes are the only place a "(goes by …)" or an accessibility note survives,
    // and they are exactly the kind of thing that must not be lost in an import.
    notes: entry.notes?.length ? `Imported from monday.com. ${entry.notes.join('. ')}.` : 'Imported from monday.com.',
  };
}

/**
 * Build the `matters` row for a create entry.
 *
 * `case_type` carries the text key alongside `case_type_id` — migration 007 turned the
 * enum into text and the app writes both (see pages/clients/clients.js).
 */
export function matterRowFor(entry, clientId, caseTypeId) {
  return {
    client_id: clientId,
    case_type_id: caseTypeId || null,
    case_type: entry.caseTypeKey || null,
    status: 'intake',
    date_filed: entry.item.dateHired || null,
  };
}
