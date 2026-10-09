// _proof-scan-v2-case.js: loading a Proof Scan case as one snapshot. NOT a route.
//
// A case is a folder (D-83): its locked case type, one card per person (D-94),
// the Evidence Zero cards (D-84), open suggestions (D-55), the runs saved into
// it, and each stage's sign-off (D-75). What leaves the server never carries an
// encrypted SSN; only the last four (D-80).

import * as store from './_proof-scan-v2-store.js';
import {
  publicPerson, publicSuggestion, evidenceRequirement, GATE_MESSAGES, CASE_TYPE_LABELS, caseLabel,
} from './_proof-scan-v2-common.js';
import { HttpError } from './_proof-scan-v2-http.js';

export async function loadCase(admin, caseId) {
  const kase = await store.getCase(admin, caseId);
  if (!kase) throw new HttpError(404, 'Case not found');
  const [people, documents] = await Promise.all([
    store.listPeople(admin, caseId),
    store.listDocuments(admin, caseId),
  ]);
  const owners = await store.listDocumentOwners(admin, documents.map((d) => d.id));
  const ownersByDoc = new Map();
  for (const o of owners) {
    if (!ownersByDoc.has(o.document_id)) ownersByDoc.set(o.document_id, []);
    ownersByDoc.get(o.document_id).push(o.person_id);
  }
  const suggestions = await store.listOpenSuggestions(admin, people.map((p) => p.id));
  return {
    case: kase,
    people,
    documents: documents.map((d) => ({ ...d, owner_ids: ownersByDoc.get(d.id) || [] })),
    suggestions,
  };
}

export function gateFor(snapshot) {
  const gate = evidenceRequirement(snapshot.case.case_type, snapshot.people, snapshot.documents);
  return { ...gate, messages: gate.missing.map((k) => GATE_MESSAGES[k]) };
}

// D-101: the folder names itself from its people. Every route that changes a
// case answers with publicCaseView, so the name is brought up to date here.
async function syncLabel(admin, kase, people) {
  const label = caseLabel(kase.case_type, people, kase.created_at);
  if (label === kase.label) return kase;
  await store.updateCase(admin, kase.id, { label });
  return { ...kase, label };
}

export async function publicCaseView(admin, snapshot) {
  snapshot = { ...snapshot, case: await syncLabel(admin, snapshot.case, snapshot.people) };
  const [runs, signoffs] = await Promise.all([
    store.listRuns(admin, snapshot.case.id),
    store.listSignoffs(admin, snapshot.case.id),
  ]);
  return {
    case: { ...snapshot.case, case_type_label: CASE_TYPE_LABELS[snapshot.case.case_type] },
    people: snapshot.people.map(publicPerson),
    documents: snapshot.documents,
    suggestions: snapshot.suggestions.map(publicSuggestion),
    runs,
    signoffs,
    evidence_requirement: gateFor(snapshot),
  };
}

export async function personInCase(admin, personId) {
  const person = await store.getPerson(admin, personId);
  if (!person) throw new HttpError(404, 'Person not found');
  const kase = await store.getCase(admin, person.case_id);
  if (!kase) throw new HttpError(404, 'Case not found');
  return { person, kase };
}
