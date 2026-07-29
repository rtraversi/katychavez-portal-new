// Matching a monday.com board item against the clients already in the portal.
//
// This is the load-bearing half of the sync. Neither side carried a link before this
// module, so the first run has to reconcile an existing portal client list against the
// board by content alone — and getting it wrong is expensive in both directions:
//
//   a missed match  -> a duplicate client, splitting one person's matters and documents
//   a false match   -> a board item's data attached to the WRONG person's record
//
// The second is much worse, so the rule throughout is: match only when there is exactly
// one candidate and nothing contradicts it. Everything else goes to a human. On a first
// run against a real list that leaves a review queue of a dozen or so, which is an
// afternoon's work once, versus silent corruption that surfaces months later.
//
// Note on phone numbers: they are NOT unique on this board. Families share a number and
// an email — three such pairs exist in the live data. So phone can confirm or contradict
// a name match, and can break a tie between same-name candidates, but it can never
// establish a match on its own.

import { normalizePhone, normalizeEmail } from './_monday-parse.js';

/** Strip accents, punctuation and case so "Núñez" and "NUNEZ" compare equal. */
export function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The blocking key two records must share to be considered the same person at all:
 * full surname plus first initial.
 *
 * Surname alone over-collects on a list this size (many Garcias, many Martinezes), and
 * full first+last under-collects because given names are recorded inconsistently —
 * "J Severiano" here, "Jose Severiano" there. First initial plus full surname is the
 * compromise that survives both.
 */
export function matchKey(firstName, lastName) {
  const last = normalizeName(lastName);
  const first = normalizeName(firstName);
  if (!last) return null;
  return `${last}|${first ? first[0] : ''}`;
}

/**
 * Match one parsed board item against the portal's existing clients.
 *
 * `clients` is the candidate list, each `{ id, first_name, last_name, phone, email,
 * monday_item_id }`. Returns one of:
 *
 *   { decision: 'linked',  client_id, reason }   already carries this monday_item_id
 *   { decision: 'matched', client_id, reason }   confident single match — link it
 *   { decision: 'new',                reason }   no candidate — safe to create
 *   { decision: 'review',  candidates, reason }  a human has to settle it
 */
export function matchItem(parsed, item, clients) {
  const itemPhone = normalizePhone(item?.phone);
  const itemEmail = normalizeEmail(item?.email);

  // Already reconciled on a previous run — nothing to decide.
  const alreadyLinked = clients.find((c) => c.monday_item_id && c.monday_item_id === String(item?.id));
  if (alreadyLinked) {
    return { decision: 'linked', client_id: alreadyLinked.id, reason: 'Already linked to this board item' };
  }

  const beneficiary = parsed?.beneficiary;
  if (!beneficiary?.last_name) {
    return { decision: 'review', candidates: [], reason: 'No surname to match on' };
  }

  const key = matchKey(beneficiary.first_name, beneficiary.last_name);
  let candidates = clients.filter((c) => matchKey(c.first_name, c.last_name) === key);

  // A client already pointing at a *different* board item is not available to match —
  // linking it here would silently repoint an existing reconciliation.
  const takenByOther = candidates.filter((c) => c.monday_item_id && c.monday_item_id !== String(item?.id));
  candidates = candidates.filter((c) => !c.monday_item_id);

  if (candidates.length === 0) {
    if (takenByOther.length) {
      return {
        decision: 'review',
        candidates: takenByOther,
        reason: 'The only same-name client is already linked to a different board item',
      };
    }
    return { decision: 'new', reason: 'No existing client with this surname and first initial' };
  }

  if (candidates.length === 1) {
    const c = candidates[0];
    const cPhone = normalizePhone(c.phone);
    const cEmail = normalizeEmail(c.email);

    // Contact details that actively disagree are a contradiction, not a detail. Two
    // different people can share a surname and an initial.
    const phoneConflict = itemPhone && cPhone && itemPhone !== cPhone;
    const emailConflict = itemEmail && cEmail && itemEmail !== cEmail;
    if (phoneConflict && emailConflict) {
      return {
        decision: 'review',
        candidates,
        reason: 'Name matches but both phone and email differ — may be a different person',
      };
    }

    if (itemPhone && cPhone && itemPhone === cPhone) {
      return { decision: 'matched', client_id: c.id, reason: 'Name and phone both match' };
    }
    if (itemEmail && cEmail && itemEmail === cEmail) {
      return { decision: 'matched', client_id: c.id, reason: 'Name and email both match' };
    }
    if (phoneConflict) {
      return { decision: 'review', candidates, reason: 'Name matches but the phone number differs' };
    }
    if (emailConflict) {
      return { decision: 'review', candidates, reason: 'Name matches but the email differs' };
    }
    // Single name match, nothing to corroborate it and nothing contradicting it. On a
    // list where most portal records have no email and some have no phone, this is the
    // common case — and a bare name match is not enough to link automatically.
    return {
      decision: 'review',
      candidates,
      reason: 'Single name match with no phone or email to confirm it',
    };
  }

  // Several same-name candidates. Contact details may break the tie — but only if
  // exactly one of them agrees, since families share numbers here.
  const byPhone = itemPhone ? candidates.filter((c) => normalizePhone(c.phone) === itemPhone) : [];
  if (byPhone.length === 1) {
    return { decision: 'matched', client_id: byPhone[0].id, reason: 'Several same-name clients; phone identified one' };
  }
  const byEmail = itemEmail ? candidates.filter((c) => normalizeEmail(c.email) === itemEmail) : [];
  if (byEmail.length === 1) {
    return { decision: 'matched', client_id: byEmail[0].id, reason: 'Several same-name clients; email identified one' };
  }

  return {
    decision: 'review',
    candidates,
    reason: `${candidates.length} clients share this name and contact details do not single one out`,
  };
}

/**
 * Find portal clients that were linked to the board but whose item is no longer in the
 * group.
 *
 * Decision 2026-07-20: this FLAGS and changes nothing. A client can leave the group
 * because the case closed, or because someone reorganised the board — and archiving on
 * that signal would hide live matters, documents and forms.
 */
export function findDeparted(clients, boardItemIds) {
  const present = new Set(boardItemIds.map(String));
  return clients.filter((c) => c.monday_item_id && !present.has(String(c.monday_item_id)));
}
