// Proof Scan v2: Evidence Zero (specs E.1, D-53 to D-55, D-84, D-94, D-97).
// The model is mocked: each test queues the exact JSON the AI "returns".
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { onRequest as caseRoute } from '../../functions/api/proof-scan-v2-case.js';
import { onRequest as personRoute } from '../../functions/api/proof-scan-v2-person.js';
import { onRequest as evidenceRoute } from '../../functions/api/proof-scan-v2-evidence.js';
import {
  FACT_FIELDS, evidenceZeroSchema, stageRunSchema, toWireSchema, fromWire,
} from '../../functions/api/_proof-scan-v2-ai.js';
import { storedFacts } from '../../functions/api/_proof-scan-v2-evidence.js';
import { ssnDecrypt } from '../../functions/api/_helpers.js';
import {
  seededDb, call, ENV, STAFF, CLIENT, NO_TOKEN, pdfFile, PNG_B64, oversizePdf, mockModel,
} from '../support/proof-scan-v2-harness.js';

let db;
beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  helpersMock.makeAdminClient.mockReturnValue(db);
  helpersMock.verifyAuth.mockResolvedValue(STAFF);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

const blankFacts = () => Object.fromEntries(FACT_FIELDS.map((f) => [f, null]));
const read = (over = {}) => ({
  doc_type: 'ead', read_quality: 'clear', unreadable_fields: [], issued_date: '01/15/2025', owner_roles: ['applicant'],
  ...over,
  facts: { ...blankFacts(), first_name: 'ANA', middle_name: 'MARIA', last_name: 'RIVERA', date_of_birth: '03/22/1998',
    a_number: '123-456-789', ead_expiration: '01/15/2027', ...(over.facts || {}) },
});

async function newCase(case_type = 'daca_renewal', role) {
  return (await call(caseRoute, '/api/proof-scan-v2-case', { method: 'POST', body: { case_type, ...(role ? { role } : {}) } })).body;
}
const upload = (case_id, file = pdfFile('ead.pdf')) =>
  call(evidenceRoute, '/api/proof-scan-v2-evidence', { method: 'POST', body: { case_id, ...file } });

describe('access and input', () => {
  it('refuses anon and the Client role before reading anything', async () => {
    const kase = await newCase();
    for (const who of [NO_TOKEN, CLIENT]) {
      helpersMock.verifyAuth.mockResolvedValue(who);
      expect((await upload(kase.case.id)).status).toBeGreaterThanOrEqual(401);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refuses a file over 12 MB with a clear message, without calling the AI (D-95)', async () => {
    const kase = await newCase();
    const r = await upload(kase.case.id, pdfFile('big.pdf', { file_base64: oversizePdf(12) }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('big.pdf is larger than 12 MB. Reduce the file size and try again.');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refuses a file whose bytes are not its declared type, or an unsupported type', async () => {
    const kase = await newCase();
    expect((await upload(kase.case.id, pdfFile('x.pdf', { file_base64: PNG_B64 }))).status).toBe(400);
    expect((await upload(kase.case.id, { filename: 'x.docx', media_type: 'application/msword', file_base64: PNG_B64 })).status).toBe(400);
  });

  it('accepts an image (an EAD photo) and sends it as an image block', async () => {
    const kase = await newCase();
    const calls = mockModel(vi, [read()]);
    const r = await upload(kase.case.id, { filename: 'ead.png', media_type: 'image/png', file_base64: PNG_B64 });
    expect(r.status).toBe(201);
    expect(calls[0].body.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
  });

  it('is not available in demo mode', async () => {
    const kase = await newCase();
    const r = await call(evidenceRoute, '/api/proof-scan-v2-evidence', { method: 'POST', body: { case_id: kase.case.id, ...pdfFile() } }, { ...ENV, DEMO_MODE: 'true' });
    expect(r.status).toBe(503);
  });

  it('calls the proof model, streamed, with json_schema output', async () => {
    const kase = await newCase();
    const calls = mockModel(vi, [read()]);
    await upload(kase.case.id);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].body.model).toBe('claude-sonnet-5-5');
    expect(calls[0].body.stream).toBe(true);
    expect(calls[0].body.output_config.format).toEqual({ type: 'json_schema', schema: toWireSchema(evidenceZeroSchema()) });
  });
});

// The API rejects a schema with more than 16 union-typed parameters with a 400,
// which every v2 call hit in production until the wire format existed.
describe('wire format for structured outputs', () => {
  const unions = (s) => (JSON.stringify(s).match(/"anyOf"|"type":\[/g) || []).length;

  it('sends no union-typed parameters for any schema', () => {
    expect(unions(toWireSchema(evidenceZeroSchema()))).toBe(0);
    for (const withMarkups of [false, true]) {
      expect(unions(toWireSchema(stageRunSchema({ ruleIds: ['R1'], itemIds: ['I1'], withMarkups })))).toBe(0);
    }
  });

  it('decodes a field list: left out is null, "" stays blank (D-11)', () => {
    const schema = stageRunSchema({ ruleIds: [], itemIds: [], withMarkups: false });
    const [f] = fromWire(schema, { forms_found: [{
      form: 'I-765', file: 'p.pdf', pages: '1', person_role: '',
      values: [{ field: 'first_name', value: 'ANA' }, { field: 'middle_name', value: '' }, { field: 'first_name', value: 'X' }],
    }], evidence_found: [], possible_issues: [] }).forms_found;
    expect(f.person_role).toBeNull();
    expect(f.values).toMatchObject({ first_name: 'ANA', middle_name: '', last_name: null, ssn: null });
  });

  it('decodes a plain nullable string "" to null and passes the internal shape through', () => {
    const schema = evidenceZeroSchema();
    expect(fromWire(schema, { issued_date: '' }).issued_date).toBeNull();
    const internal = read({ facts: { middle_name: '' } });
    expect(fromWire(schema, internal).facts).toEqual(internal.facts);
  });
});

describe('a clear EAD (D-45, D-53, D-84)', () => {
  it('fills the empty fields it carries, in column form, sourced to the document', async () => {
    const kase = await newCase();
    mockModel(vi, [read()]);
    const r = await upload(kase.case.id);
    expect(r.status).toBe(201);
    const p = r.body.people[0];
    expect(p).toMatchObject({ first_name: 'ANA', last_name: 'RIVERA', date_of_birth: '1998-03-22', a_number: '123456789', ead_expiration: '2027-01-15' });
    expect(p.field_sources.a_number).toEqual({ kind: 'document', label: 'EAD', document_id: r.body.document_id });
    expect(r.body.documents[0]).toMatchObject({ doc_type: 'ead', status: 'current', filename: 'ead.pdf', owner_ids: [p.id] });
  });

  it('stores the card and facts, never the file', async () => {
    const kase = await newCase();
    mockModel(vi, [read()]);
    await upload(kase.case.id);
    const everything = JSON.stringify(db.tables);
    expect(everything).not.toContain(pdfFile().file_base64);
  });

  it('does not overwrite a value already in the record; a difference becomes a suggestion (D-55)', async () => {
    const kase = await newCase();
    const pid = kase.people[0].id;
    await call(personRoute, '/api/proof-scan-v2-person', { method: 'POST', body: { action: 'edit', person_id: pid, fields: { last_name: 'RIVERO' } } });
    mockModel(vi, [read()]);
    const r = await upload(kase.case.id);
    expect(r.body.people[0].last_name).toBe('RIVERO');
    expect(r.body.suggestions).toEqual([expect.objectContaining({ field: 'last_name', value: 'RIVERA', source_label: 'EAD', status: 'open' })]);
  });

  it('treats an A-Number in another format as the same number (N-016)', async () => {
    const kase = await newCase();
    await call(personRoute, '/api/proof-scan-v2-person', { method: 'POST', body: { action: 'edit', person_id: kase.people[0].id, fields: { a_number: 'A123456789' } } });
    mockModel(vi, [read()]);
    expect((await upload(kase.case.id)).body.suggestions).toEqual([]);
  });

  it('replaces a value that only came from draft forms: evidence outranks drafts (D-79)', async () => {
    const kase = await newCase();
    const row = db.rows('proof_scan_people')[0];
    Object.assign(row, { last_name: 'RIVERO', field_sources: { last_name: { kind: 'forms', label: 'I-821D' } } });
    mockModel(vi, [read()]);
    const r = await upload(kase.case.id);
    expect(r.body.people[0].last_name).toBe('RIVERA');
    expect(r.body.suggestions).toEqual([]);
  });

  it('asks for approval again when it fills an approved record', async () => {
    const kase = await newCase();
    await call(personRoute, '/api/proof-scan-v2-person', { method: 'POST', body: { action: 'approve', person_id: kase.people[0].id } });
    mockModel(vi, [read()]);
    expect((await upload(kase.case.id)).body.people[0].changed_since_approval).toBe(true);
  });

  it('flags a printed date it cannot parse instead of guessing', async () => {
    const kase = await newCase();
    mockModel(vi, [read({ facts: { date_of_birth: '22 Smarch 1998' } })]);
    const r = await upload(kase.case.id);
    expect(r.body.people[0].date_of_birth).toBeNull();
    expect(r.body.documents[0].unreadable_fields).toContain('date_of_birth');
  });

  it('adds optional address parts only when the document prints them (D-82)', async () => {
    const kase = await newCase();
    mockModel(vi, [read({ facts: { in_care_of: 'TEST CARER', street: '1 TEST ST' } })]);
    const p = (await upload(kase.case.id)).body.people[0];
    expect(p.in_care_of).toBe('TEST CARER');
    expect(p.province ?? null).toBeNull();
  });
});

describe('an unreadable source (D-54)', () => {
  it('is held for source review and fills and proposes nothing', async () => {
    const kase = await newCase();
    await call(personRoute, '/api/proof-scan-v2-person', { method: 'POST', body: { action: 'edit', person_id: kase.people[0].id, fields: { last_name: 'RIVERO' } } });
    mockModel(vi, [read({ read_quality: 'unreadable' })]);
    const r = await upload(kase.case.id);
    expect(r.status).toBe(201);
    expect(r.body.documents.at(-1).status).toBe('source_review');
    expect(r.body.people[0]).toMatchObject({ last_name: 'RIVERO', first_name: null, a_number: null });
    expect(r.body.suggestions).toEqual([]);
    expect(r.body.note).toContain('could not be read reliably');
  });

  // D-104 (v2.0.1): a partly readable EAD still counts and fills what it read clearly.
  it('a partial read fills empty fields it read clearly, skips unreadable ones, and proposes nothing', async () => {
    const kase = await newCase();
    await call(personRoute, '/api/proof-scan-v2-person', { method: 'POST', body: { action: 'edit', person_id: kase.people[0].id, fields: { last_name: 'RIVERO' } } });
    mockModel(vi, [read({ read_quality: 'partial', unreadable_fields: ['date_of_birth'] })]);
    const r = await upload(kase.case.id);
    expect(r.status).toBe(201);
    expect(r.body.documents.at(-1).status).toBe('current');
    expect(r.body.people[0].last_name).toBe('RIVERO');
    expect(r.body.people[0].first_name).not.toBeNull();
    expect(r.body.people[0].a_number).not.toBeNull();
    expect(r.body.people[0].date_of_birth).toBeNull();
    expect(r.body.suggestions).toEqual([]);
    expect(r.body.note).toContain('could not be read clearly');
  });

  it('never replaces a good card', async () => {
    const kase = await newCase();
    mockModel(vi, [read(), read({ read_quality: 'partial', issued_date: '01/15/2026' })]);
    await upload(kase.case.id);
    const r = await upload(kase.case.id);
    expect(r.body.documents.map((d) => d.status)).toEqual(['current', 'source_review']);
  });
});

describe('replacement (D-55)', () => {
  it('a newer EAD for the same person replaces the older card and its open suggestions', async () => {
    const kase = await newCase();
    mockModel(vi, [read(), read({ issued_date: '01/15/2026', facts: { a_number: '987654321' } })]);
    const first = await upload(kase.case.id);
    const r = await upload(kase.case.id);
    const [older, newer] = r.body.documents;
    expect(older).toMatchObject({ id: first.body.document_id, status: 'replaced', replaced_by: newer.id });
    expect(newer.status).toBe('current');
    expect(r.body.people[0].a_number).toBe('123456789');
    expect(r.body.suggestions).toEqual([expect.objectContaining({ field: 'a_number', value: '987654321', document_id: newer.id })]);
    expect(r.body.note).toBe('The newer EAD replaced the older one.');
  });

  it('an older EAD than the one on file is not kept', async () => {
    const kase = await newCase();
    mockModel(vi, [read({ issued_date: '01/15/2026' }), read({ issued_date: '01/15/2024' })]);
    await upload(kase.case.id);
    const r = await upload(kase.case.id);
    expect(r.status).toBe(200);
    expect(r.body.documents).toHaveLength(1);
    expect(r.body.note).toBe('This EAD is older than the one already on file, so it was not kept.');
  });
});

describe('SSN (D-80, D-97)', () => {
  it('fills an empty SSN encrypted, audited, and stores only the last four on the card', async () => {
    const kase = await newCase();
    mockModel(vi, [read({ doc_type: 'intake', facts: { ssn: '555-12-3456' } })]);
    const r = await upload(kase.case.id);
    expect(r.body.people[0]).toMatchObject({ has_ssn: true, ssn_masked: '***-**-3456' });
    expect(r.body.documents[0].facts.ssn).toBe('***-**-3456');
    const row = db.rows('proof_scan_people')[0];
    expect(ssnDecrypt(row.ssn_encrypted, ENV)).toBe('555123456');
    expect(JSON.stringify(db.tables)).not.toMatch(/555-?12-?3456/);
    expect(db.rows('sensitive_field_audit')).toEqual([expect.objectContaining({ entity_type: 'proof_scan_people', action: 'write', performed_by: 'staff-1' })]);
  });

  it('turns a different SSN into an encrypted suggestion, never plaintext', async () => {
    const kase = await newCase();
    mockModel(vi, [read({ doc_type: 'intake', facts: { ssn: '123456789' } }), read({ doc_type: 'other', facts: { ssn: '987-65-4321' } })]);
    await upload(kase.case.id);
    const r = await upload(kase.case.id);
    expect(r.body.suggestions).toEqual([expect.objectContaining({ field: 'ssn', value: '***-**-4321' })]);
    const s = db.rows('proof_scan_suggestions')[0];
    expect(s.value).toBeNull();
    expect(ssnDecrypt(s.value_encrypted, ENV)).toBe('987654321');
    expect(JSON.stringify(db.tables)).not.toMatch(/987-?65-?4321/);
  });

  it('never stores a full SSN found in another fact', () => {
    expect(storedFacts({ ssn: '123-45-6789', phone: '123-45-6789', email: 'x@example.test' }))
      .toEqual({ ssn: '***-**-6789', email: 'x@example.test' });
  });
});

describe('people (D-94)', () => {
  it('DACA ignores the roles the model proposes: it is one applicant', async () => {
    const kase = await newCase();
    mockModel(vi, [read({ owner_roles: ['petitioner', 'beneficiary'] })]);
    const r = await upload(kase.case.id);
    expect(r.body.people).toHaveLength(1);
    expect(r.body.documents[0].owner_ids).toEqual([kase.people[0].id]);
  });

  it('General: a document for a role with no card creates that card and fills it', async () => {
    const kase = await newCase('general');
    mockModel(vi, [read({ doc_type: 'birth_certificate', owner_roles: ['petitioner'], facts: { first_name: 'PAT', last_name: 'TESTER', a_number: null, ead_expiration: null } })]);
    const r = await upload(kase.case.id);
    const pet = r.body.people.find((p) => p.role === 'petitioner');
    expect(pet).toMatchObject({ first_name: 'PAT', last_name: 'TESTER', is_main: false });
    expect(r.body.people.find((p) => p.role === 'beneficiary').first_name).toBeNull();
    expect(r.body.documents[0].owner_ids).toEqual([pet.id]);
  });

  it('General: a shared document belongs to both people and fills nobody', async () => {
    const kase = await newCase('general');
    mockModel(vi, [read({ doc_type: 'marriage_certificate', owner_roles: ['beneficiary', 'petitioner'], facts: { marriage_date: '06/01/2020' } })]);
    const r = await upload(kase.case.id);
    expect(r.body.documents[0].owner_ids).toHaveLength(2);
    expect(r.body.people.every((p) => p.first_name == null)).toBe(true);
    expect(r.body.documents[0].facts.marriage_date).toBe('06/01/2020');
  });

  it('staff can correct the identified type (Q-45) and the owners', async () => {
    const kase = await newCase('general');
    mockModel(vi, [read({ doc_type: 'other', owner_roles: ['beneficiary'] })]);
    const up = await upload(kase.case.id);
    const pet = (await call(personRoute, '/api/proof-scan-v2-person', { method: 'POST', body: { action: 'add', case_id: kase.case.id, role: 'petitioner' } })).body.people.find((p) => p.role === 'petitioner');
    const r = await call(evidenceRoute, '/api/proof-scan-v2-evidence', { method: 'PATCH', body: {
      document_id: up.body.document_id, doc_type: 'birth_certificate', owner_person_ids: [pet.id] } });
    expect(r.body.documents[0]).toMatchObject({ doc_type: 'birth_certificate', type_corrected: true, owner_ids: [pet.id] });
    expect(db.rows('proof_scan_document_people')[0].proposed_by).toBe('staff');
  });

  it('refuses owners from another case, and owner changes on DACA', async () => {
    const kase = await newCase('general');
    const other = await newCase('general');
    mockModel(vi, [read({ owner_roles: [] })]);
    const up = await upload(kase.case.id);
    const r = await call(evidenceRoute, '/api/proof-scan-v2-evidence', { method: 'PATCH', body: { document_id: up.body.document_id, owner_person_ids: [other.people[0].id] } });
    expect(r.status).toBe(400);
    const daca = await newCase();
    mockModel(vi, [read()]);
    const d = await upload(daca.case.id);
    expect((await call(evidenceRoute, '/api/proof-scan-v2-evidence', { method: 'PATCH', body: { document_id: d.body.document_id, owner_person_ids: [daca.people[0].id] } })).status).toBe(409);
  });

  it('removing a card drops its open suggestions', async () => {
    const kase = await newCase();
    await call(personRoute, '/api/proof-scan-v2-person', { method: 'POST', body: { action: 'edit', person_id: kase.people[0].id, fields: { last_name: 'RIVERO' } } });
    mockModel(vi, [read()]);
    const up = await upload(kase.case.id);
    const r = await call(evidenceRoute, '/api/proof-scan-v2-evidence', { method: 'DELETE', body: { document_id: up.body.document_id } });
    expect(r.body.documents).toEqual([]);
    expect(r.body.suggestions).toEqual([]);
  });
});

describe('fail closed', () => {
  it.each([
    ['an unknown document type', { ...read(), doc_type: 'tax_return' }],
    ['an extra property', { ...read(), verdict: 'ok' }],
    ['a missing fact', (() => { const r = read(); delete r.facts.email; return r; })()],
    ['not JSON at all', 'here is the document'],
  ])('stores nothing when the model returns %s', async (_label, output) => {
    const kase = await newCase();
    mockModel(vi, [typeof output === 'string' ? output : { output }]);
    const r = await upload(kase.case.id);
    expect(r.status).toBe(502);
    expect(db.rows('proof_scan_documents')).toEqual([]);
  });

  it('stores nothing on a truncated answer or an API error', async () => {
    const kase = await newCase();
    mockModel(vi, [{ output: read(), stop_reason: 'max_tokens' }, { httpStatus: 529 }]);
    expect((await upload(kase.case.id)).status).toBe(502);
    expect((await upload(kase.case.id)).status).toBe(502);
    expect(db.rows('proof_scan_documents')).toEqual([]);
  });
});
