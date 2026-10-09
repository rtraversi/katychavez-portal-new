// _proof-scan-v2-evidence.js: what one Evidence Zero document changes. NOT a route.
//
// Pure. Given the case as it stands and the model's validated read of one
// document, it returns a PLAN: the card to store, whose it is, which older card
// it replaces, which empty fields it fills, and which differences become
// suggestions. The route carries the plan out. Ported from the v2 Lab's
// addDocument (ui-lab-v2/evidence-zero.js).
//
//   D-54  a source that cannot be read reliably is held for review: it fills
//         nothing and proposes nothing, so an OCR guess never becomes a difference
//   D-45  the document fills the empty fields it carries
//   D-55  where the record already holds a different value, the new one is only
//         proposed; a newer document of the same type for the same people
//         replaces the older card
//   D-94  a document belongs to one person or several; a role with no card gets
//         one; a shared document (marriage certificate) fills nobody's card
//   D-97  a different SSN becomes an encrypted suggestion
//   D-84  only the card and its facts are kept, never the file; the stored facts
//         never hold a full SSN

import {
  REFERENCE_FIELDS, DOC_TYPE_LABELS, toCardValue, sameValue, normalizeDate, ssnDigits,
  maskSsn, truthValue, mainPerson, redactSsn,
} from './_proof-scan-v2-common.js';
import { containsFullSsn } from './proof-scan-contract.js';

// The facts stored on the card. The SSN keeps only its last four; any other
// fact that looks like a full SSN is dropped rather than stored.
export function storedFacts(facts) {
  const out = {};
  for (const [field, raw] of Object.entries(facts || {})) {
    if (raw == null || String(raw).trim() === '') continue;
    const value = String(raw).trim().slice(0, 300);
    if (field === 'ssn') {
      const d = String(value).replace(/\D/g, '');
      if (d.length >= 4) out.ssn = maskSsn(d.slice(-4));
      continue;
    }
    if (containsFullSsn(value, field)) continue;
    out[field] = redactSsn(value);
  }
  return out;
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

// people: rows of proof_scan_people. documents: rows with owner_ids.
// read: validated model output. cardSsn: Map(person id -> 9 digits | null),
// decrypted by the route for comparison only.
export function planEvidenceZero({ caseType, people, documents, read, filename, cardSsn = new Map() }) {
  const label = DOC_TYPE_LABELS[read.doc_type];
  const clear = read.read_quality === 'clear';
  // D-104: "partial" still counts as the document on file and fills the empty
  // fields it read clearly; only "unreadable" is held for source review (D-54).
  const usable = clear || read.read_quality === 'partial';
  const document = {
    doc_type: read.doc_type,
    read_quality: read.read_quality,
    unreadable_fields: [...read.unreadable_fields],
    filename,
    facts: storedFacts(read.facts),
    status: usable ? 'current' : 'source_review',
  };

  // Owners. DACA is one person (D-94), whatever the model proposed.
  const newPeople = [];
  let owners;
  const main = mainPerson(people);
  if (caseType === 'daca_renewal' || !read.owner_roles.length) {
    owners = main ? [{ id: main.id }] : [{ newIndex: newPeople.push({ role: caseType === 'daca_renewal' ? 'applicant' : 'beneficiary', is_main: true }) - 1 }];
  } else {
    owners = [...new Set(read.owner_roles)].map((role) => {
      const found = people.find((p) => p.role === role);
      if (found) return { id: found.id };
      return { newIndex: newPeople.push({ role, is_main: false }) - 1 };
    });
  }

  const plan = { outcome: 'stored', document, newPeople, owners, replaces: null, fills: [], suggestions: [], note: null };

  // D-54: nothing more for a source that cannot be read at all.
  if (!usable) {
    plan.note = `The ${label} could not be read reliably, so nothing was taken from it. Please look at the original.`;
    return plan;
  }
  if (!clear) {
    plan.note = read.unreadable_fields.length
      ? `Part of the ${label} could not be read clearly, so those fields were left for you. Everything it showed clearly was filled in.`
      : `The ${label} was not perfectly clear, so only empty fields were filled in. Please check them against the original.`;
  }

  // D-55: replacement within the Proof Scan workspace.
  const ownerIds = owners.filter((o) => o.id).map((o) => o.id);
  const everyOwnerExists = ownerIds.length === owners.length;
  const older = everyOwnerExists
    ? documents.find((d) => d.status === 'current' && d.doc_type === read.doc_type && sameSet(d.owner_ids || [], ownerIds))
    : null;
  // A partly readable copy never replaces a clear one already on file: it is
  // kept for review only, and the good card stays as it is.
  if (older && !clear && older.read_quality === 'clear') {
    document.status = 'source_review';
    return { ...plan, note: `A clearer ${label} is already on file, so this copy was kept for review only.` };
  }
  if (older) {
    const olderIssued = normalizeDate(older.facts?.issued_date);
    const thisIssued = normalizeDate(read.issued_date);
    if (olderIssued && thisIssued && olderIssued > thisIssued) {
      return { ...plan, outcome: 'older_not_kept', note: `This ${label} is older than the one already on file, so it was not kept.` };
    }
    plan.replaces = older.id;
    plan.note = `The newer ${label} replaced the older one.`;
  }
  if (read.issued_date) document.facts.issued_date = String(read.issued_date).slice(0, 40);

  // A shared document fills nobody's card.
  if (owners.length !== 1) return plan;
  const owner = owners[0];
  const person = owner.id ? people.find((p) => p.id === owner.id) : {};
  const unreadable = new Set(read.unreadable_fields);
  const source = { kind: 'document', label };

  for (const field of REFERENCE_FIELDS) {
    if (unreadable.has(field)) continue;
    const c = toCardValue(field, read.facts[field]);
    // Printed but not in a form the record can hold (a date it cannot parse):
    // flagged on the card for staff, never guessed at.
    if (c.invalid) {
      if (!document.unreadable_fields.includes(field)) document.unreadable_fields.push(field);
      continue;
    }
    if (c.value == null) continue;
    // Values copied from draft forms, or filled by a scan, were never evidence:
    // the document outranks them (D-45, D-79).
    const current = truthValue(person, field);
    if (current == null) plan.fills.push({ owner, field, value: c.value, source });
    // A partly readable document never proposes changes to what is already there (D-54).
    else if (clear && !sameValue(field, current, c.value)) plan.suggestions.push({ owner, field, value: c.value, label });
  }

  if (!unreadable.has('ssn')) {
    const d = ssnDigits(read.facts.ssn);
    if (d) {
      const have = owner.id ? cardSsn.get(owner.id) : null;
      // 'unknown' = on file but could not be decrypted: never replace or contradict it.
      if (have === 'unknown') { /* leave it */ }
      else if (!have) plan.fills.push({ owner, field: 'ssn', value: d, source });
      else if (clear && have !== d) plan.suggestions.push({ owner, field: 'ssn', value: d, label });
    }
  }
  return plan;
}
