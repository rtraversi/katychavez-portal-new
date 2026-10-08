// Proof Scan v2: a well-rounded General checker (D-100), the folder that names
// itself (D-101) and the narrowed "not on the case card yet" note (D-102).
// The model is mocked; every answer below is synthetic. Decisions are checked
// through the real routes and engine against an in-memory database.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { onRequest as runRoute } from '../../functions/api/proof-scan-v2-run.js';
import { onRequest as caseRoute } from '../../functions/api/proof-scan-v2-case.js';
import { onRequest as casesRoute } from '../../functions/api/proof-scan-v2-cases.js';
import { onRequest as personRoute } from '../../functions/api/proof-scan-v2-person.js';
import { onRequest as evidenceRoute } from '../../functions/api/proof-scan-v2-evidence.js';
import { FACT_FIELDS, evidenceZeroSchema, stageRunSchema } from '../../functions/api/_proof-scan-v2-ai.js';
import { REFERENCE_FIELDS, caseLabel } from '../../functions/api/_proof-scan-v2-common.js';
import {
  seededDb, call, STAFF, pdfFile, mockModel, observations, formValues, evidenceFacts,
} from '../support/proof-scan-v2-harness.js';

let db;
beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  helpersMock.makeAdminClient.mockReturnValue(db);
  helpersMock.verifyAuth.mockResolvedValue(STAFF);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

const D100 = ['uscis_account_number', 'country_of_birth', 'country_of_citizenship', 'i94_number', 'i94_expiration',
  'last_entry_date', 'port_of_entry', 'employer', 'marriage_date', 'marriage_place'];

const create = (body) => call(caseRoute, '/api/proof-scan-v2-case', { method: 'POST', body });
const person = (body) => call(personRoute, '/api/proof-scan-v2-person', { method: 'POST', body });
const upload = (case_id, file = pdfFile('doc.pdf')) => call(evidenceRoute, '/api/proof-scan-v2-evidence', { method: 'POST', body: { case_id, ...file } });
const run = (body) => call(runRoute, '/api/proof-scan-v2-run', { method: 'POST', body: { files: [pdfFile()], ...body } });
const form = (name, values, person_role = 'beneficiary') => ({ form: name, file: 'package.pdf', pages: '1', person_role, values: formValues(values) });
const ev = (doc_type, owner_roles, facts, extra = {}) => ({ doc_type, file: 'package.pdf', pages: '90', owner_roles, read_quality: 'clear', facts: evidenceFacts(facts), ...extra });
const read = (facts = {}, top = {}) => ({
  doc_type: 'passport', read_quality: 'clear', unreadable_fields: [], issued_date: null, owner_roles: ['beneficiary'],
  facts: { ...Object.fromEntries(FACT_FIELDS.map((f) => [f, null])), ...facts }, ...top,
});
const kinds = (r) => r.body.result.attention.map((a) => a.kind);
const check = (r, id) => r.body.result.checks.find((c) => c.rule_id === id);

async function generalCase() {
  return (await create({ case_type: 'general' })).body;
}

// ── 1. Full case cards (D-100) ───────────────────────────────────────────────

describe('full case cards (D-100)', () => {
  it('the card, the AI schemas and the suggestions carry every per-person fact', () => {
    for (const f of D100) {
      expect(REFERENCE_FIELDS).toContain(f);
      expect(FACT_FIELDS).toContain(f);
      expect(evidenceZeroSchema().properties.facts.required).toContain(f);
      expect(stageRunSchema({ ruleIds: [], itemIds: [], withMarkups: false }).properties.forms_found.items.properties.values.required).toContain(f);
      expect(stageRunSchema({ ruleIds: [], itemIds: [], withMarkups: false }).properties.evidence_found.items.properties.facts.required).toContain(f);
    }
    const ev = stageRunSchema({ ruleIds: [], itemIds: [], withMarkups: false }).properties.evidence_found.items;
    expect(ev.required).toEqual(expect.arrayContaining(['language', 'has_english_translation']));
    expect(ev.properties.facts.required).toContain('expiration_date');
  });

  it('a document fills the facts it carries, dates in column form, sourced to the document', async () => {
    const kase = await generalCase();
    mockModel(vi, [{ output: read({
      first_name: 'LUCIA', last_name: 'REYES', country_of_birth: 'MEXICO', country_of_citizenship: 'MEXICO',
      i94_number: '123456789A1', i94_expiration: '04/01/2027', last_entry_date: '04/02/2021', port_of_entry: 'NOGALES, AZ',
      expiration_date: '01/01/2030',
    }) }]);
    const r = await upload(kase.case.id);
    expect(r.status).toBe(201);
    const p = db.rows('proof_scan_people')[0];
    expect(p).toMatchObject({ country_of_birth: 'MEXICO', i94_number: '123456789A1', i94_expiration: '2027-04-01', last_entry_date: '2021-04-02', port_of_entry: 'NOGALES, AZ' });
    expect(p.field_sources.country_of_birth).toMatchObject({ kind: 'document', label: 'Passport' });
    // The document's own expiry is a fact on its card, not a person fact.
    expect(db.rows('proof_scan_documents')[0].facts.expiration_date).toBe('01/01/2030');
  });

  it('staff can edit every fact, and a newer document proposes a change to one', async () => {
    const kase = await generalCase();
    const pid = kase.people[0].id;
    const r = await person({ action: 'edit', person_id: pid, fields: { employer: 'ACME', marriage_date: '05/15/2021', marriage_place: 'PHOENIX, AZ', uscis_account_number: '0012-3456-7890' } });
    expect(r.status).toBe(200);
    expect(r.body.people[0]).toMatchObject({ employer: 'ACME', marriage_date: '2021-05-15', uscis_account_number: '0012-3456-7890' });
    expect((await person({ action: 'edit', person_id: pid, fields: { i94_expiration: 'soon' } })).status).toBe(400);
    mockModel(vi, [{ output: read({ employer: 'OTHER CO' }, { doc_type: 'intake' }) }]);
    const after = (await upload(kase.case.id)).body;
    expect(after.suggestions.map((s) => [s.field, s.value])).toEqual([['employer', 'OTHER CO']]);
  });
});

// ── 2. Every shared fact matches across forms, per person (D-100 #1, PS-305) ──

describe('shared facts across forms (PS-305)', () => {
  it('a fact that differs between two forms about the same person is one attention item', async () => {
    const kase = await generalCase();
    mockModel(vi, [observations({ forms: [
      form('I-485', { first_name: 'LUCIA', country_of_birth: 'MEXICO', phone: '(602) 555-0100' }),
      form('I-765', { first_name: 'LUCIA', country_of_birth: 'GUATEMALA', phone: '602-555-0100' }),
      form('I-130', { first_name: 'DANIEL', country_of_birth: 'UNITED STATES' }, 'petitioner'),
    ] })]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(kinds(r)).toEqual(['form_difference']);
    const item = r.body.result.attention[0];
    expect(item).toMatchObject({ person_role: 'beneficiary', field: 'country_of_birth' });
    expect(item.title).toBe("The forms disagree on the beneficiary's country of birth. It is MEXICO on the I-485, but GUATEMALA on the I-765.");
    expect(check(r, 'PS-305')).toMatchObject({ status: 'needs_attention', counted_by_items: true, consistency: true });
    expect(r.body.result.attention_count).toBe(1);
  });

  it('never compares one person with another, and dates and numbers compare by meaning', async () => {
    const kase = await generalCase();
    mockModel(vi, [observations({ forms: [
      form('I-485', { date_of_birth: '09/30/1993', i94_number: '123456789A1', last_entry_date: 'April 2, 2021' }),
      form('I-765', { date_of_birth: '1993-09-30', i94_number: '123456789a1', last_entry_date: '04/02/2021' }),
      form('I-130', { date_of_birth: '02/11/1990' }, 'petitioner'),
      form('I-864', { date_of_birth: '02/11/1990' }, 'petitioner'),
    ] })]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(r.body.result.attention).toEqual([]);
    expect(check(r, 'PS-305').status).toBe('clear');
  });

  it('leaves name, A-Number and address to PS-301 to PS-303, so A-Number format is never a difference (N-016)', async () => {
    const kase = await generalCase();
    mockModel(vi, [observations({ forms: [
      form('I-485', { a_number: 'A-234-567-890', street: '1 MAIN ST' }),
      form('I-765', { a_number: '234567890', street: '1 Main Street' }),
    ] })]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(kinds(r)).not.toContain('form_difference');
  });

  it('is not reported twice when the case card already disagrees (Draft Review)', async () => {
    const kase = await generalCase();
    const pid = kase.people[0].id;
    await person({ action: 'edit', person_id: pid, fields: { first_name: 'LUCIA', last_name: 'REYES', country_of_birth: 'MEXICO' } });
    mockModel(vi, [observations({ forms: [
      form('I-485', { first_name: 'LUCIA', last_name: 'REYES', country_of_birth: 'MEXICO' }),
      form('I-765', { first_name: 'LUCIA', last_name: 'REYES', country_of_birth: 'GUATEMALA' }),
    ] })]);
    const r = await run({ case_id: kase.case.id, stage: 'draft_review', scope: 'whole' });
    expect(kinds(r)).toEqual(['reference_difference']);
  });

  it('values filled from draft forms are never the truth (D-79, D-99)', async () => {
    const kase = await generalCase();
    mockModel(vi, [
      observations({ forms: [form('I-485', { first_name: 'LUCIA', country_of_birth: 'MEXICO' })] }),
      observations({ forms: [form('I-765', { first_name: 'LUCIA', country_of_birth: 'GUATEMALA' })] }),
    ]);
    await run({ case_id: kase.case.id, stage: 'draft_review', scope: 'whole' });
    const p = db.rows('proof_scan_people')[0];
    expect(p.country_of_birth).toBe('MEXICO');
    expect(p.field_sources.country_of_birth.kind).toBe('forms');
    // A later run with one form is not checked against what the drafts filled.
    const r = await run({ case_id: kase.case.id, stage: 'draft_review', scope: 'whole' });
    expect(r.body.result.attention).toEqual([]);
  });
});

// ── 3. Evidence matches the forms on the full fact list (D-100 #2) ───────────

describe('evidence against forms, full list', () => {
  it('a passport that disagrees with a form on citizenship is attention', async () => {
    const kase = await generalCase();
    mockModel(vi, [observations({
      forms: [form('I-485', { country_of_citizenship: 'GUATEMALA', i94_number: '111' })],
      evidence: [ev('passport', ['beneficiary'], { country_of_citizenship: 'MEXICO' }), ev('i94', ['beneficiary'], { i94_number: '111' })],
    })]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(r.body.result.attention.map((a) => a.title)).toEqual(["The beneficiary's passport shows country of citizenship MEXICO. The I-485 shows GUATEMALA."]);
    expect(r.body.result.evidence_matches.filter((m) => m.ok).map((m) => m.field)).toEqual(['i94_number']);
  });
});

// ── 4. Forms found (D-100 #3) ────────────────────────────────────────────────

describe('forms found', () => {
  it('lists every form, its pages and whose it is, and counts nothing', async () => {
    const kase = await generalCase();
    mockModel(vi, [observations({ forms: [form('I-485', {}), { ...form('I-130', {}, 'petitioner'), pages: '20-31' }] })]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(r.body.result.forms_found.map((f) => [f.form, f.pages, f.person_role])).toEqual([['I-485', '1', 'beneficiary'], ['I-130', '20-31', 'petitioner']]);
    expect(r.body.result.attention_count).toBe(0);
  });
});

// ── 5. Expired evidence goes to Possible issues only (D-100 #5) ──────────────

describe('expired evidence', () => {
  it('is a Possible issue, never counted, and can be suppressed', async () => {
    const kase = await generalCase();
    const package_ = observations({ evidence: [ev('passport', ['beneficiary'], { expiration_date: '03/14/2024' }), ev('green_card', ['petitioner'], { expiration_date: '01/01/2031' })] });
    mockModel(vi, [package_, package_]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(r.body.result.attention).toEqual([]);
    expect(r.body.possible_issues.map((p) => [p.reasoning_key, p.title])).toEqual([['expired_evidence', "The beneficiary's passport expired on 03/14/2024."]]);
    db.rows('proof_scan_suppressions').push({ id: 's2', reasoning_key: 'expired_evidence', label: 'Expired evidence', origin: 'staff' });
    expect((await run({ case_id: kase.case.id, stage: 'physical_scan' })).body.possible_issues).toEqual([]);
  });

  it('an expiring EAD on a DACA renewal is not raised: renewing it is the point', async () => {
    const kase = (await create({ case_type: 'daca_renewal' })).body;
    db.rows('proof_scan_people')[0] = { ...db.rows('proof_scan_people')[0], no_evidence: true, street: '1 A ST', city: 'X', state: 'AZ', zip: '85000', approved_at: '2026-10-07T00:00:00Z' };
    mockModel(vi, [observations({ evidence: [ev('ead', ['applicant'], { expiration_date: '01/01/2025' })] })]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(r.body.possible_issues.filter((p) => p.reasoning_key === 'expired_evidence')).toEqual([]);
  });
});

// ── 6. Foreign-language evidence needs a translation (D-100 #6, PS-306) ──────

describe('translations (PS-306)', () => {
  const spanish = (has_english_translation) => ev('birth_certificate', ['beneficiary'], {}, { language: 'Spanish', has_english_translation });

  it('Physical Scan: a Spanish birth certificate with no translation is counted', async () => {
    const kase = await generalCase();
    mockModel(vi, [observations({ evidence: [spanish(false)] }), observations({ evidence: [spanish(true)] })]);
    let r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(kinds(r)).toEqual(['translation']);
    expect(r.body.result.attention[0].title).toBe("The beneficiary's birth certificate is in Spanish. There is no English translation of it in the package.");
    expect(check(r, 'PS-306')).toMatchObject({ status: 'needs_attention', counted_by_items: true });
    expect(r.body.result.report_state).toBe('items_need_attention');
    r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(r.body.result.attention).toEqual([]);
    expect(check(r, 'PS-306').status).toBe('clear');
  });

  it('Draft Review and Pre-flight: not this stage without evidence, checked with it', async () => {
    const kase = await generalCase();
    mockModel(vi, [observations({ forms: [form('I-485', {})] }), observations({ forms: [form('I-485', {})], evidence: [spanish(false)] }),
      observations({ forms: [form('I-485', {})] })]);
    let r = await run({ case_id: kase.case.id, stage: 'draft_review', scope: 'whole' });
    expect(check(r, 'PS-306')).toBeUndefined();
    expect(r.body.result.attention).toEqual([]);
    r = await run({ case_id: kase.case.id, stage: 'draft_review', scope: 'whole' });
    expect(kinds(r)).toEqual(['translation']);
    r = await run({ case_id: kase.case.id, stage: 'preflight', scope: 'whole' });
    expect(check(r, 'PS-306')).toBeUndefined();
  });

  it('the model is asked for each document\'s language and translation', async () => {
    const kase = await generalCase();
    const calls = mockModel(vi, [observations({})]);
    await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(calls[0].body.system).toContain('whether a certified English translation of it is in these files');
  });
});

// ── 7. The folder names itself (D-101) ───────────────────────────────────────

describe('folder name (D-101)', () => {
  it('Start asks only for the case type; a label is refused', async () => {
    expect((await create({ case_type: 'general', label: 'Typed by staff' })).status).toBe(400);
    const r = await create({ case_type: 'daca_renewal' });
    expect(r.status).toBe(201);
    expect(r.body.case.label).toMatch(/^New case \d{2}\/\d{2}\/\d{4}$/);
  });

  it('DACA: "LAST, First" once a document reveals the name', async () => {
    const kase = (await create({ case_type: 'daca_renewal' })).body;
    mockModel(vi, [{ output: read({ first_name: 'ANA', last_name: 'RIVERA' }, { doc_type: 'ead', owner_roles: ['applicant'] }) }]);
    const r = await upload(kase.case.id);
    expect(r.body.case.label).toBe('RIVERA, Ana');
    expect(db.rows('proof_scan_cases')[0].label).toBe('RIVERA, Ana');
  });

  it('General: both main names once a scan reveals them, and the case is found by either', async () => {
    const kase = await generalCase();
    mockModel(vi, [observations({ forms: [form('I-130', { first_name: 'DANIEL', last_name: 'MORALES' }, 'petitioner'), form('I-485', { first_name: 'LUCIA', last_name: 'REYES' })] })]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(r.body.case_view.case.label).toBe('MORALES & REYES');
    for (const q of ['reyes', 'Lucia', 'MORALES']) {
      const found = await call(casesRoute, '/api/proof-scan-v2-cases', { query: { q } });
      expect(found.body.cases.map((c) => c.label), q).toEqual(['MORALES & REYES']);
    }
  });

  it('names follow the people', () => {
    expect(caseLabel('general', [], '2026-10-08T10:00:00Z')).toBe('New case 10/08/2026');
    expect(caseLabel('general', [{ role: 'beneficiary', is_main: true, last_name: 'Reyes' }], '2026-10-08')).toBe('REYES');
    expect(caseLabel('general', [
      { role: 'beneficiary', is_main: true, last_name: 'Reyes' }, { role: 'petitioner', last_name: 'Morales' }, { role: 'joint_sponsor', last_name: 'Zed' },
    ], '2026-10-08')).toBe('MORALES & REYES');
    expect(caseLabel('daca_renewal', [{ role: 'applicant', is_main: true, first_name: 'ANA MARIA', last_name: 'rivera' }], '2026-10-08')).toBe('RIVERA, Ana Maria');
  });
});

// ── 8. "Not on the case card yet" (D-102) ────────────────────────────────────

describe('never-added note (D-102)', () => {
  it('General never shows it', async () => {
    const kase = await generalCase();
    await person({ action: 'edit', person_id: kase.people[0].id, fields: { first_name: 'LUCIA', last_name: 'REYES' } });
    mockModel(vi, [observations({ forms: [form('I-485', { first_name: 'LUCIA', last_name: 'REYES', email: 'x@example.test' })] })]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    expect(r.body.result.notes.filter((n) => n.kind === 'never_added')).toEqual([]);
  });

  it('DACA lists only fields the forms in this package use', async () => {
    const kase = (await create({ case_type: 'daca_renewal' })).body;
    const pid = kase.people[0].id;
    await person({ action: 'edit', person_id: pid, fields: { first_name: 'ANA', last_name: 'RIVERA', street: '1 A ST', city: 'X', state: 'AZ', zip: '85000' } });
    await person({ action: 'no_evidence', person_id: pid, value: true });
    await person({ action: 'approve', person_id: pid });
    mockModel(vi, [observations({ forms: [form('G-1145', { first_name: 'ANA', last_name: 'RIVERA', phone: '602', email: '' }, 'applicant')] })]);
    const r = await run({ case_id: kase.case.id, stage: 'physical_scan' });
    const note = r.body.result.notes.find((n) => n.kind === 'never_added');
    expect(note.fields).toEqual(['phone', 'email']);
  });
});
