// proof-scan-v2-evidence.js: Evidence Zero, the quiet document and fact
// workspace (D-53, specs E.1).
//
//   POST   { case_id, filename, media_type, file_base64 }   read one document
//   PATCH  { document_id, doc_type?, owner_person_ids? }    staff correct the
//          identified type (Q-45) or whose document it is (D-94)
//   DELETE { document_id }                                  remove a card
//
// The file goes to the model and is then dropped. Only the card and the facts
// it carries are stored (D-84). No attention count, no error language.

import { z } from 'zod';
import { ssnEncrypt, ssnDecrypt } from './_helpers.js';
import {
  requireStaff, readJson, json, guarded, methodNotAllowed, HttpError, clientIp, checkFile, fileBlock,
} from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { loadCase, publicCaseView } from './_proof-scan-v2-case.js';
import { DOC_TYPES, CASE_TYPE_LABELS } from './_proof-scan-v2-common.js';
import { callModel, parseEvidenceZero, evidenceZeroSchema, evidenceZeroPrompt } from './_proof-scan-v2-ai.js';
import { planEvidenceZero } from './_proof-scan-v2-evidence.js';

const id = z.string().uuid();
const ReadSchema = z.object({
  case_id: id,
  filename: z.string(),
  media_type: z.string(),
  file_base64: z.string().min(1, 'No file provided'),
}).strict();
const CorrectSchema = z.object({
  document_id: id,
  doc_type: z.enum(DOC_TYPES).optional(),
  owner_person_ids: z.array(id).min(1).max(6).optional(),
}).strict();
const RemoveSchema = z.object({ document_id: id }).strict();

export const DEMO_UNAVAILABLE = 'Proof Scan v2 reads documents with the AI checker, which is not available in demo mode.';

// The card SSN for each person, decrypted for comparison only and never sent
// anywhere. 'unknown' when it cannot be decrypted, so it is neither replaced
// nor contradicted.
function cardSsnMap(people, env) {
  const map = new Map();
  for (const p of people) {
    if (!p.ssn_encrypted) continue;
    try { map.set(p.id, ssnDecrypt(p.ssn_encrypted, env)); }
    catch { map.set(p.id, 'unknown'); }
  }
  return map;
}

async function readDocument({ request, env, gate }) {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(ReadSchema, parsed.body);
  if (v.error) return v.error;
  const file = v.data;
  const check = checkFile(file);
  if (check.error) return json(400, { error: check.error });
  if (env.DEMO_MODE === 'true') return json(503, { error: DEMO_UNAVAILABLE });

  const { admin } = gate;
  const userId = gate.auth.profile.id;
  const snapshot = await loadCase(admin, file.case_id);
  const caseType = snapshot.case.case_type;

  const answer = await callModel(env, {
    system: evidenceZeroPrompt({ caseTypeLabel: CASE_TYPE_LABELS[caseType], people: snapshot.people }),
    schema: evidenceZeroSchema(),
    content: [fileBlock(file), { type: 'text', text: `File: ${check.name}. Read this one document.` }],
    maxTokens: 4000,
  });
  if (!answer.ok) return json(answer.status, { error: answer.error });
  const read = parseEvidenceZero(answer.json);
  if (!read.ok) return json(read.status, { error: read.error });

  const plan = planEvidenceZero({
    caseType, people: snapshot.people, documents: snapshot.documents, read: read.data,
    filename: check.name, cardSsn: cardSsnMap(snapshot.people, env),
  });
  if (plan.outcome === 'older_not_kept') {
    return json(200, { ...(await publicCaseView(admin, snapshot)), document_id: null, note: plan.note });
  }

  // A role with no card gets one (D-94).
  const created = [];
  for (const p of plan.newPeople) created.push(await store.insertPerson(admin, { case_id: snapshot.case.id, ...p }));
  const ownerId = (o) => o.id || created[o.newIndex].id;
  const ownerIds = plan.owners.map(ownerId);

  const doc = await store.insertDocument(admin, { case_id: snapshot.case.id, ...plan.document, created_by: userId });
  await store.setDocumentOwners(admin, doc.id, ownerIds, caseType === 'daca_renewal' ? 'staff' : 'ai');
  if (plan.replaces) {
    await store.updateDocument(admin, plan.replaces, { status: 'replaced', replaced_by: doc.id });
    await store.deleteOpenSuggestionsFromDocument(admin, plan.replaces);
  }

  const notes = plan.note ? [plan.note] : [];
  const ip = clientIp(request);
  const encrypt = (digits) => {
    try { return ssnEncrypt(digits, env); }
    catch (err) {
      console.error('[proof-scan-v2-evidence] SSN encryption unavailable:', err.message);
      notes.push('The SSN on this document could not be stored securely, so it was left out.');
      return null;
    }
  };

  // Fills, grouped per person.
  const peopleNow = [...snapshot.people, ...created];
  const byPerson = new Map();
  for (const fill of plan.fills) {
    const pid = ownerId(fill.owner);
    if (!byPerson.has(pid)) byPerson.set(pid, []);
    byPerson.get(pid).push(fill);
  }
  for (const [pid, fills] of byPerson) {
    const person = peopleNow.find((p) => p.id === pid);
    const sources = { ...(person.field_sources || {}) };
    const patch = {};
    let ssnWritten = false;
    for (const f of fills) {
      if (f.field === 'ssn') {
        const enc = encrypt(f.value);
        if (!enc) continue;
        patch.ssn_encrypted = enc;
        patch.ssn_last4 = f.value.slice(-4);
        ssnWritten = true;
      } else {
        patch[f.field] = f.value;
      }
      sources[f.field] = { ...f.source, document_id: doc.id };
    }
    if (!Object.keys(patch).length) continue;
    patch.field_sources = sources;
    if (person.approved_at) patch.changed_since_approval = true;
    await store.updatePerson(admin, pid, patch);
    if (ssnWritten) await store.auditSsn(admin, { entityType: 'proof_scan_people', entityId: pid, action: 'write', userId, ip });
  }

  // Differences become suggestions; a newer one replaces an older open one.
  const rows = [];
  for (const s of plan.suggestions) {
    const pid = ownerId(s.owner);
    const row = { person_id: pid, field: s.field, source_label: s.label, document_id: doc.id };
    if (s.field === 'ssn') {
      const enc = encrypt(s.value);
      if (!enc) continue;
      Object.assign(row, { value: null, value_encrypted: enc, value_last4: s.value.slice(-4) });
    } else {
      row.value = s.value;
    }
    await store.deleteOpenSuggestionsFor(admin, pid, s.field);
    rows.push(row);
  }
  await store.insertSuggestions(admin, rows);

  const after = await loadCase(admin, snapshot.case.id);
  return json(201, { ...(await publicCaseView(admin, after)), document_id: doc.id, note: notes.join(' ') || null });
}

async function correctDocument({ request, gate }) {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(CorrectSchema, parsed.body);
  if (v.error) return v.error;
  const { admin } = gate;
  const doc = await store.getDocument(admin, v.data.document_id);
  if (!doc) throw new HttpError(404, 'Document not found');
  const snapshot = await loadCase(admin, doc.case_id);

  if (v.data.doc_type && v.data.doc_type !== doc.doc_type) {
    await store.updateDocument(admin, doc.id, { doc_type: v.data.doc_type, type_corrected: true });
  }
  if (v.data.owner_person_ids) {
    if (snapshot.case.case_type === 'daca_renewal') throw new HttpError(409, 'A DACA renewal case has exactly one person.');
    const ids = [...new Set(v.data.owner_person_ids)];
    if (!ids.every((pid) => snapshot.people.some((p) => p.id === pid))) {
      throw new HttpError(400, 'Every owner must be a person on this case.');
    }
    await store.setDocumentOwners(admin, doc.id, ids, 'staff');
  }
  const after = await loadCase(admin, doc.case_id);
  return json(200, await publicCaseView(admin, after));
}

async function removeDocument({ request, gate }) {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(RemoveSchema, parsed.body);
  if (v.error) return v.error;
  const { admin } = gate;
  const doc = await store.getDocument(admin, v.data.document_id);
  if (!doc) throw new HttpError(404, 'Document not found');
  await store.deleteOpenSuggestionsFromDocument(admin, doc.id);
  await store.setDocumentOwners(admin, doc.id, [], 'staff');
  await store.deleteDocument(admin, doc.id);
  const after = await loadCase(admin, doc.case_id);
  return json(200, await publicCaseView(admin, after));
}

export const onRequest = guarded('proof-scan-v2-evidence', async ({ request, env }) => {
  const handler = { POST: readDocument, PATCH: correctDocument, DELETE: removeDocument }[request.method];
  if (!handler) return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  return handler({ request, env, gate });
});
