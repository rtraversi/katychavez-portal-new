// Proof Scan v2.1: the AOS case type and the UI pass (D-129 to D-147, Q-59 to
// Q-81). The model is mocked; every answer below is synthetic. Decisions are
// checked through the real routes and engine against an in-memory database.
// Every loosening of "same value" has a test proving a real difference is
// still caught.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { onRequest as runRoute } from '../../functions/api/proof-scan-v2-run.js';
import { onRequest as caseRoute } from '../../functions/api/proof-scan-v2-case.js';
import { onRequest as signoffRoute } from '../../functions/api/proof-scan-v2-signoff.js';
import { onRequest as clearRoute } from '../../functions/api/proof-scan-v2-clear.js';
import { onRequest as patternsRoute } from '../../functions/api/proof-scan-v2-patterns.js';
import { onRequest as rulesRoute } from '../../functions/api/proof-scan-v2-rules.js';
import { onRequest as suppressionsRoute } from '../../functions/api/proof-scan-v2-suppressions.js';
import { onRequest as evidenceRoute } from '../../functions/api/proof-scan-v2-evidence.js';
import { caseLabel } from '../../functions/api/_proof-scan-v2-common.js';
import { FACT_FIELDS } from '../../functions/api/_proof-scan-v2-ai.js';
import { reportView } from '../../functions/api/_proof-scan-v2-view.js';
import { mergeFacts } from '../../functions/api/_proof-scan-v2-merge.js';
import {
  parseAgeTiers, misspeltCardholder, languageDecision, tallyRows, nextTallyState, relationshipMismatch,
} from '../../functions/api/_proof-scan-v2-aos.js';
import { stageSummaryLines } from '../../functions/api/_proof-scan-email.js';
import { buildAosSeedSql, generatedBlock } from '../../scripts/proof-scan-v2-aos-seed.mjs';
import aosSeed from '../../functions/api/proof-scan-profiles/v2-aos-seed.json';
import { stepState } from '../../pages/proof-scan-v2/model.js';
import {
  seededDb, call, STAFF, pdfFile, mockModel, observations, formValues, evidenceFacts, askedRuleIds, askedItemIds, findings,
} from '../support/proof-scan-v2-harness.js';

const sql2006 = Object.values(import.meta.glob('../../supabase/migrations/2006_proof_scan_v2_1.sql', {
  query: '?raw', import: 'default', eager: true,
}))[0];

let db;
beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  helpersMock.makeAdminClient.mockReturnValue(db);
  helpersMock.verifyAuth.mockResolvedValue(STAFF);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

// ── Synthetic AOS case ───────────────────────────────────────────────────────

const docSource = (label, fields) => Object.fromEntries(fields.map((f) => [f, { kind: 'document', label }]));
const BEN = { first_name: 'ELENA', middle_name: null, last_name: 'VEGA', date_of_birth: '1991-11-03', phone: '(919) 555-0142', email: 'elena@example.test' };
const PET = { first_name: 'MARCO', middle_name: null, last_name: 'SANTOS', date_of_birth: '1988-04-12', phone: '(919) 555-0187', email: 'marco@example.test' };

const create = (body) => call(caseRoute, '/api/proof-scan-v2-case', { method: 'POST', body });
async function aosCase(kind = 'spousal', { ben = {}, pet = {} } = {}) {
  const v = (await create({ case_type: 'aos', aos_kind: kind })).body;
  const caseId = v.case.id;
  const b = db.rows('proof_scan_people').find((p) => p.case_id === caseId);
  Object.assign(b, BEN, { field_sources: docSource('Birth certificate', ['first_name', 'last_name', 'date_of_birth']) }, ben);
  db.rows('proof_scan_people').push({
    ...Object.fromEntries(Object.keys(b).map((k) => [k, null])), id: `pet-${caseId}`, case_id: caseId, role: 'petitioner', is_main: false,
    no_evidence: false, changed_since_approval: false, created_at: '2026-10-16T00:00:01Z',
    ...PET, field_sources: docSource('Birth certificate', ['first_name', 'last_name', 'date_of_birth']), ...pet,
  });
  return caseId;
}
const form = (name, values, person_role = 'beneficiary') => ({ form: name, file: 'package.pdf', pages: '1', person_role, values: formValues(values) });
const benName = { first_name: 'ELENA', last_name: 'VEGA' };
const petName = { first_name: 'MARCO', last_name: 'SANTOS' };
const baseForms = (benOver = {}, petOver = {}) => [
  form('I-130', { ...petName, date_of_birth: '04/12/1988', ...petOver }, 'petitioner'),
  form('I-485', { ...benName, date_of_birth: '11/03/1991', ...benOver }),
  form('I-765', { ...benName, date_of_birth: '11/03/1991', ...benOver }),
];
const pay = (fee_for, amount, payer = benName, extra = {}) => ({
  method: 'g1450', fee_for, amount, payer_name: `${payer.first_name} ${payer.last_name}`,
  cardholder_name: 'MARCO SANTOS', cardholder_phone: PET.phone, cardholder_email: PET.email, file: 'package.pdf', pages: '1', ...extra,
});
const goodFees = () => [pay('I-130', '$675', petName), pay('I-485', '$1,440'), pay('I-765', '$260')];
// The applicant reads English: the I-765 box ticked; the 09/18/26 I-485 has no boxes.
const plainEnglish = [
  { form: 'I-485', has_boxes: false, english_box: false, interpreter_box: false, interpreter_section_filled: false, interpreter_signed_dated: 'not_applicable' },
  { form: 'I-765', has_boxes: true, english_box: true, interpreter_box: false, interpreter_section_filled: false, interpreter_signed_dated: 'not_applicable' },
];
const ev = (doc_type, owner_roles, facts, extra = {}) => ({ doc_type, file: 'package.pdf', pages: '90', owner_roles, read_quality: 'clear', facts: evidenceFacts(facts), ...extra });

async function stage(caseId, stageName, opts = {}) {
  const calls = mockModel(vi, [observations({ forms: baseForms(), ...opts, aos: { fee_payments: goodFees(), language_statements: plainEnglish, ...(opts.aos || {}) } })]);
  const body = { case_id: caseId, stage: stageName, files: [pdfFile()], ...(stageName === 'physical_scan' ? {} : { scope: 'whole' }) };
  const r = await call(runRoute, '/api/proof-scan-v2-run', { method: 'POST', body });
  return { ...r, calls };
}
const physical = (caseId, opts) => stage(caseId, 'physical_scan', opts);
const check = (r, id) => r.body.result.checks.find((c) => c.rule_id === id);
const confirms = (r) => r.body.result.checks.filter((c) => c.status === 'please_confirm');
const confirmIds = (r) => confirms(r).map((c) => c.rule_id);
const kinds = (r) => r.body.result.attention.map((a) => a.kind);

// ── The rule set (D-129, D-130, migration 2006) ──────────────────────────────

describe('the AOS rule set (D-129, D-130)', () => {
  it('migration 2006 carries the generated block exactly as the JSON describes it', () => {
    expect(generatedBlock(sql2006)).toBe(buildAosSeedSql(aosSeed));
  });

  it('49 checks and 28 package items from the firm\'s sheet; signatures and card details wait for Pre-flight', () => {
    expect(aosSeed.rules).toHaveLength(49);
    expect(aosSeed.package_items).toHaveLength(28);
    for (const r of aosSeed.rules) expect(Object.keys(r.stages).sort()).toEqual(['draft_review', 'physical_scan', 'preflight']);
    const signatures = aosSeed.rules.filter((r) => /signature/i.test(r.title) && !/form-number/i.test(r.title));
    expect(signatures.length).toBeGreaterThan(15);
    // Q-81: signed and dated, at Pre-flight and Physical Scan (D-130).
    for (const r of signatures) {
      expect(r.title).toMatch(/signed and dated/);
      expect(r.stages).toMatchObject({ draft_review: { state: 'later' }, preflight: { state: 'checked' }, physical_scan: { state: 'checked' } });
    }
    expect(aosSeed.rules.find((r) => r.rule_id === 'AOS-G1450-CARD').stages.draft_review.state).toBe('later');
  });

  it('only what Max decided: no Question 61 rule (not confirmable), no bona fides, no photos, I-693 first page only', () => {
    const text = JSON.stringify(aosSeed.rules) + JSON.stringify(aosSeed.package_items);
    expect(text).not.toMatch(/Question 61/);
    expect(text).not.toMatch(/bona fide/i);
    expect(text).not.toMatch(/photo(?! page)/i);
    expect(aosSeed.package_items.find((i) => i.item_id === 'AOS-E-I693').label).toMatch(/first page/);
    expect(aosSeed.rules.find((r) => r.rule_id === 'AOS-485-SEC').item).toBe('43.b-44, 53.a, 53.b');
  });

  it('the kind switches the spousal-only items; co-sponsor, I-864A and I-131 apply only when in the package', () => {
    const when = (id) => [...aosSeed.rules, ...aosSeed.package_items].find((x) => (x.rule_id || x.item_id) === id).applies_when;
    expect(when('AOS-F-I130A')).toBe('spousal');
    expect(when('AOS-E-MC')).toBe('spousal');
    expect(when('AOS-864J-003')).toBe('joint_sponsor');
    expect(when('AOS-864A-001')).toBe('household_member');
    expect(when('AOS-FEE-I131')).toBe('i131');
    expect(when('AOS-E-NATZ-PET')).toBe('naturalized');
    expect(when('AOS-E-DIV')).toBe('divorce');
    expect(aosSeed.package_items.filter((i) => i.missing_confirm).map((i) => i.item_id).sort()).toEqual(['AOS-E-I94', 'AOS-E-VISA']);
  });
});

// ── The case (D-131, D-144) ──────────────────────────────────────────────────

describe('starting an AOS case (D-131, D-144)', () => {
  it('asks for the kind, stores it, and no other case type takes one', async () => {
    expect((await create({ case_type: 'aos' })).status).toBe(400);
    expect((await create({ case_type: 'general', aos_kind: 'spousal' })).status).toBe(400);
    const v = await create({ case_type: 'aos', aos_kind: 'child_to_parent' });
    expect(v.status).toBe(201);
    expect(v.body.case).toMatchObject({ case_type: 'aos', aos_kind: 'child_to_parent', case_type_label: 'Adjustment of Status', aos_kind_label: 'Child to parent' });
    expect(db.rows('proof_scan_people').find((p) => p.case_id === v.body.case.id).role).toBe('beneficiary');
  });

  it('two people with the same last name read "REYES, Miguel & Carmen"', () => {
    const p = (role, first, last, is_main = false) => ({ role, first_name: first, last_name: last, is_main });
    expect(caseLabel('aos', [p('beneficiary', 'CARMEN', 'REYES', true), p('petitioner', 'MIGUEL', 'REYES')])).toBe('REYES, Miguel & Carmen');
    expect(caseLabel('aos', [p('beneficiary', 'ELENA', 'VEGA', true), p('petitioner', 'MARCO', 'SANTOS')])).toBe('SANTOS & VEGA');
    expect(caseLabel('general', [p('beneficiary', 'ANA', 'LOPEZ', true), p('petitioner', 'JUAN', 'LOPEZ')])).toBe('LOPEZ, Juan & Ana');
  });

  it('spousal asks about the I-130A and marriage certificate; child to parent never does (Q-59)', async () => {
    const spousal = await physical(await aosCase('spousal'));
    expect(askedRuleIds(spousal.calls[0].body)).toContain('AOS-130A-001');
    expect(askedItemIds(spousal.calls[0].body)).toEqual(expect.arrayContaining(['AOS-F-I130A', 'AOS-E-MC']));
    const child = await physical(await aosCase('child_to_parent'));
    expect(askedRuleIds(child.calls[0].body)).not.toContain('AOS-130A-001');
    expect(askedItemIds(child.calls[0].body)).not.toEqual(expect.arrayContaining(['AOS-F-I130A']));
    expect(askedItemIds(child.calls[0].body)).not.toContain('AOS-E-MC');
    expect(child.calls[0].body.system).toMatch(/Adjustment of Status, Child to parent/);
  });
});

// ── Fees (Q-63, Q-64) ────────────────────────────────────────────────────────

describe('fees (Q-63, Q-64)', () => {
  it('the I-485 fee by age: a plainly wrong amount is counted; the right one is clear', async () => {
    const id = await aosCase();
    const wrong = await physical(id, { aos: { fee_payments: [pay('I-130', '$675', petName), pay('I-485', '$950'), pay('I-765', '$260')] } });
    expect(check(wrong, 'AOS-FEE-I485')).toMatchObject({ status: 'needs_attention', title: 'The I-485 fee is $950. The applicant is 34, so the fee is $1,440.', expected: '$1,440 (age 14 to 78)' });
    expect(kinds(wrong)).toContain('check');
    const right = await physical(id);
    expect(check(right, 'AOS-FEE-I485').status).toBe('clear');
    expect(check(right, 'AOS-FEE-I130').status).toBe('clear');
  });

  it('within a month of turning 79 is a gentle confirm, never counted (guard 2); a year off is counted', async () => {
    const soon = new Date(Date.now() + 10 * 86_400_000);
    const iso = `${soon.getUTCFullYear() - 79}-${String(soon.getUTCMonth() + 1).padStart(2, '0')}-${String(soon.getUTCDate()).padStart(2, '0')}`;
    const near = await physical(await aosCase('spousal', { ben: { date_of_birth: iso } }), { forms: baseForms({ date_of_birth: null }) });
    expect(check(near, 'AOS-FEE-I485').status).toBe('please_confirm');
    expect(near.body.result.attention.some((a) => a.rule_id === 'AOS-FEE-I485')).toBe(false);
    const older = await physical(await aosCase('spousal', { ben: { date_of_birth: '1940-01-05' } }), { forms: baseForms({ date_of_birth: null }) });
    expect(check(older, 'AOS-FEE-I485')).toMatchObject({ status: 'needs_attention', title: expect.stringContaining('so the fee is $1,140') });
  });

  it('under 14, only that an I-485 fee is there (as amended); none at all is counted', async () => {
    const child = await aosCase('parent_to_child', { ben: { date_of_birth: '2014-03-02' } });
    const any = await physical(child, { forms: baseForms({ date_of_birth: null }), aos: { fee_payments: [pay('I-130', '$675', petName), pay('I-485', '$1,440'), pay('I-765', '$260')] } });
    expect(check(any, 'AOS-FEE-I485').status).toBe('clear');
    const none = await physical(child, { forms: baseForms({ date_of_birth: null }), aos: { fee_payments: [pay('I-130', '$675', petName), pay('I-765', '$260')] } });
    expect(check(none, 'AOS-FEE-I485')).toMatchObject({ status: 'needs_attention', title: 'No payment for the I-485 fee was found.' });
  });

  it('an unsettled date of birth skips the fee by age (guard 1): the card and the birth certificate disagree', async () => {
    const id = await aosCase();
    const r = await physical(id, { evidence: [ev('birth_certificate', ['beneficiary'], { ...benName, date_of_birth: '11/04/1991' })] });
    expect(check(r, 'AOS-FEE-I485').status).toBe('needs_info');
  });

  it('the amounts live in the Rulebook (guard 4): staff edit them; unreadable wording is never guessed', async () => {
    const id = await aosCase();
    const edit = (expected) => call(rulesRoute, '/api/proof-scan-v2-rules', { method: 'PATCH', body: { rule_id: 'AOS-FEE-I485', case_type: 'aos', changes: { expected } } });
    expect((await edit('under 14: $950 · 14 to 78: $1,500 · 79 and older: $1,140')).status).toBe(200);
    expect(check(await physical(id), 'AOS-FEE-I485').title).toBe('The I-485 fee is $1,440. The applicant is 34, so the fee is $1,500.');
    await edit('about fifteen hundred');
    expect(check(await physical(id), 'AOS-FEE-I485').status).toBe('not_checked');
    expect(parseAgeTiers('under 14: $950 · 14 to 78: $1,440 · 79 and older: $1,140')).toMatchObject({ child: 14, adultFee: 1440, senior: 79, seniorFee: 1140 });
  });

  it('a G-1650 is fine; a money order is a gentle confirm (Q-63 as amended); the payer must be the right person', async () => {
    const id = await aosCase();
    const r = await physical(id, { aos: { fee_payments: [
      pay('I-130', '$675', petName, { method: 'g1650' }), pay('I-485', '$1,440'), pay('I-765', '$260'),
      { method: 'money_order', fee_for: 'unknown', amount: '$85', payer_name: null, cardholder_name: null, cardholder_phone: null, cardholder_email: null, file: 'package.pdf', pages: '9' },
    ] } });
    expect(check(r, 'AOS-FEE-I130').status).toBe('clear');
    expect(confirmIds(r)).toContain('confirm:money_order');
    const wrongPayer = await physical(id, { aos: { fee_payments: [pay('I-130', '$675', { first_name: 'ROSA', last_name: 'DIAZ' }), pay('I-485', '$1,440'), pay('I-765', '$260')] } });
    expect(check(wrongPayer, 'AOS-FEE-I130')).toMatchObject({ status: 'needs_attention', title: expect.stringContaining('not the petitioner') });
  });

  it('a married name on the payment is still the applicant (Q-62); another name is not', async () => {
    const id = await aosCase();
    const married = await physical(id, { forms: baseForms({ last_name: 'SANTOS' }), aos: { fee_payments: [pay('I-130', '$675', petName), pay('I-485', '$1,440', { first_name: 'ELENA', last_name: 'SANTOS' }), pay('I-765', '$260', { first_name: 'ELENA', last_name: 'SANTOS' })] } });
    expect(check(married, 'AOS-FEE-I765').status).toBe('clear');
    const other = await physical(id, { aos: { fee_payments: [pay('I-130', '$675', petName), pay('I-485', '$1,440'), pay('I-765', '$260', { first_name: 'LUZ', last_name: 'VEGA' })] } });
    expect(check(other, 'AOS-FEE-I765').status).toBe('needs_attention');
  });
});

// ── Cardholder and contact (D-134, Q-78, Q-79) ───────────────────────────────

describe('the G-1450 cardholder and contact (D-134, Q-79)', () => {
  it('the cardholder can be anyone; one that looks like a misspelling of someone on the case is a gentle confirm', async () => {
    const id = await aosCase();
    const typo = await physical(id, { aos: { fee_payments: [...goodFees().slice(0, 2), pay('I-765', '$260', benName, { cardholder_name: 'MARCO SANTSO' })] } });
    expect(confirms(typo).find((c) => c.rule_id.startsWith('confirm:cardholder')).title).toBe('The cardholder reads MARCO SANTSO. Is that a misspelling of the petitioner, MARCO SANTOS?');
    const exact = await physical(id);
    expect(confirmIds(exact).some((x) => x.startsWith('confirm:cardholder'))).toBe(false);
    const stranger = await physical(id, { aos: { fee_payments: goodFees().map((p) => ({ ...p, cardholder_name: 'PRISCILLA OYELARAN' })) } });
    expect(confirmIds(stranger).some((x) => x.startsWith('confirm:cardholder'))).toBe(false);
    expect(misspeltCardholder('SANTOS MARCO', [PET])).toBeNull(); // the same name, other order
  });

  it('email and phone must agree and belong to the petitioner or the beneficiary; either may pay the other\'s fees', async () => {
    const id = await aosCase();
    const benPays = await stage(id, 'preflight', { aos: { fee_payments: goodFees().map((p) => ({ ...p, cardholder_phone: BEN.phone, cardholder_email: BEN.email })) } });
    expect(check(benPays, 'AOS-G1450-CONTACT').status).toBe('clear');
    const stranger = await stage(id, 'preflight', { aos: { fee_payments: goodFees().map((p) => ({ ...p, cardholder_phone: '(919) 555-0199' })) } });
    expect(check(stranger, 'AOS-G1450-CONTACT')).toMatchObject({ status: 'needs_attention', title: 'The G-1450 phone (919) 555-0199 belongs to no one on the case.' });
    // Card details wait for Pre-flight (D-130).
    const draft = await stage(id, 'draft_review');
    expect(check(draft, 'AOS-G1450-CONTACT')).toBeUndefined();
  });
});

// ── English and interpreter (Q-67) ───────────────────────────────────────────

describe('English and interpreter boxes (Q-67 as settled 10-16)', () => {
  const st = (o) => ({ form: 'I-765', has_boxes: true, english_box: false, interpreter_box: false, interpreter_section_filled: false, interpreter_signed_dated: 'not_applicable', ...o });
  it.each([
    ['English ticked, section empty: as intended', { english_box: true }, 'draft_review', 'clear'],
    ['English ticked, section filled: counted', { english_box: true, interpreter_section_filled: true }, 'draft_review', 'needs_attention'],
    ['interpreter ticked, section empty at Draft Review: waiting for signatures', { interpreter_box: true }, 'draft_review', 'clear'],
    ['interpreter ticked, section empty at Pre-flight: counted', { interpreter_box: true }, 'preflight', 'needs_attention'],
    ['interpreter ticked, section empty at Physical Scan: counted', { interpreter_box: true }, 'physical_scan', 'needs_attention'],
    ['interpreter ticked, section filled and signed: fine', { interpreter_box: true, interpreter_section_filled: true, interpreter_signed_dated: 'yes' }, 'physical_scan', 'clear'],
    ['neither ticked: counted, every stage', {}, 'draft_review', 'needs_attention'],
    ['both ticked: counted', { english_box: true, interpreter_box: true }, 'draft_review', 'needs_attention'],
  ])('%s', (_, o, stageName, status) => {
    expect(languageDecision(st(o), stageName).status).toBe(status);
  });

  it('the 09/18/26 I-485 has no boxes: only a filled interpreter section must be signed and dated, later stages', async () => {
    expect(languageDecision(st({ form: 'I-485', has_boxes: false }), 'physical_scan').status).toBe('clear');
    expect(languageDecision(st({ form: 'I-485', has_boxes: false, interpreter_section_filled: true, interpreter_signed_dated: 'no' }), 'physical_scan').status).toBe('needs_attention');
    const r = await physical(await aosCase(), { aos: { fee_payments: goodFees(), language_statements: [st({ form: 'I-765', english_box: true, interpreter_section_filled: true })] } });
    expect(check(r, 'AOS-765-LANG')).toMatchObject({ status: 'needs_attention', title: 'The English box is ticked on the I-765, but the interpreter section is filled in.' });
    expect(check(r, 'AOS-485-LANG').status).toBe('not_checked'); // no statement reported for the I-485: never a guess
  });
});

// ── "If needed" evidence and items (Q-72, Q-74) ──────────────────────────────

describe('what is needed is read from the package (Q-72, Q-74)', () => {
  const missing = (ids) => Object.fromEntries(ids.map((i) => [i, 'missing']));
  it('a divorce certificate only when an earlier marriage ended by divorce is listed', async () => {
    const id = await aosCase();
    const notNeeded = await physical(id, { items: missing(['AOS-E-DIV']) });
    expect(findings(notNeeded.body.result).some((a) => a.key === 'item:AOS-E-DIV')).toBe(false);
    const needed = await physical(id, { items: missing(['AOS-E-DIV']), aos: { fee_payments: goodFees(), prior_divorce_listed: 'yes' } });
    expect(needed.body.result.attention.find((a) => a.key === 'item:AOS-E-DIV')).toMatchObject({
      title: 'The divorce certificate is missing from the package.', detail: expect.stringContaining('earlier marriage that ended in divorce'),
    });
  });

  it('a naturalization certificate only when the I-130 says the petitioner naturalized', async () => {
    const id = await aosCase();
    expect(kinds(await physical(id, { items: missing(['AOS-E-NATZ-PET']) }))).not.toContain('missing_item');
    expect(kinds(await physical(id, { items: missing(['AOS-E-NATZ-PET']), aos: { fee_payments: goodFees(), petitioner_citizenship: 'naturalization' } }))).toContain('missing_item');
  });

  it('co-sponsor documents and checks only with a co-sponsor I-864', async () => {
    const id = await aosCase();
    const without = await physical(id, { items: missing(['AOS-E-W2-J']), rules: { 'AOS-864J-003': 'needs_attention' } });
    expect(kinds(without)).not.toContain('missing_item');
    expect(check(without, 'AOS-864J-003')).toBeUndefined();
    const forms = [...baseForms(), form('I-864', { first_name: 'ROSA', last_name: 'SANTOS' }, 'joint_sponsor')];
    const withIt = await physical(id, { forms, items: missing(['AOS-E-W2-J']), rules: { 'AOS-864J-003': { status: 'needs_attention', summary: "The co-sponsor's I-864 is not signed." } } });
    expect(withIt.body.result.attention.map((a) => a.key)).toEqual(expect.arrayContaining(['item:AOS-E-W2-J', 'rule:AOS-864J-003']));
  });

  it('a missing US visa or I-94 is a gentle confirm; any other missing evidence is counted', async () => {
    const r = await physical(await aosCase(), { items: missing(['AOS-E-VISA', 'AOS-E-I94', 'AOS-E-PASSPORT']) });
    expect(confirmIds(r)).toEqual(expect.arrayContaining(['confirm:missing:AOS-E-VISA', 'confirm:missing:AOS-E-I94']));
    expect(r.body.result.attention.map((a) => a.key)).toEqual(['item:AOS-E-PASSPORT']);
  });
});

// ── Possible issues (D-131, Q-55, D-100 #5) ──────────────────────────────────

describe('AOS Possible issues', () => {
  it('the relationship box against the kind is a Possible issue, never counted, and cannot be silenced firm-wide', async () => {
    expect(relationshipMismatch('child_to_parent', 'parent')).toBeNull();
    expect(relationshipMismatch('parent_to_child', 'child')).toBeNull();
    const r = await physical(await aosCase('child_to_parent'), { aos: { fee_payments: goodFees(), i130_relationship: 'spouse' } });
    expect(r.body.result.report_state).toBe('no_issues_found');
    expect(r.body.possible_issues.map((p) => p.reasoning_key)).toContain('relationship_box_kind');
    const s = await call(suppressionsRoute, '/api/proof-scan-v2-suppressions', { method: 'POST', body: { reasoning_key: 'relationship_box_kind', label: 'x' } });
    expect(s.status).toBe(409);
  });
});

// ── Truth per person (Q-61, Q-62) ────────────────────────────────────────────

describe('truth per person (Q-61, Q-62)', () => {
  const marriage = ev('marriage_certificate', ['petitioner', 'beneficiary'], { marriage_date: '02/18/2023' });
  it('a married name backed by a marriage certificate is a gentle confirm, never counted', async () => {
    const r = await physical(await aosCase(), { forms: baseForms({ last_name: 'SANTOS' }), evidence: [marriage] });
    expect(confirmIds(r)).toContain('confirm:married_name:beneficiary');
    expect(findings(r.body.result).some((a) => a.field === 'name' || a.field === 'last_name')).toBe(false);
  });
  it('still caught: no marriage certificate, a last name that is not the spouse\'s, or a non-spousal case', async () => {
    const id = await aosCase();
    const noCert = await physical(id, { forms: baseForms({ last_name: 'SANTOS' }) });
    expect(noCert.body.result.attention.some((a) => a.kind === 'fact' && a.field === 'name')).toBe(true);
    const other = await physical(id, { forms: baseForms({ last_name: 'MORENO' }), evidence: [marriage] });
    expect(other.body.result.attention.some((a) => a.kind === 'fact' && a.field === 'name')).toBe(true);
    const child = await physical(await aosCase('child_to_parent'), { forms: baseForms({ last_name: 'SANTOS' }), evidence: [marriage] });
    expect(child.body.result.attention.some((a) => a.kind === 'fact' && a.field === 'name')).toBe(true);
  });

  it('the I-94 entry date and port are a gentle nudge; its number is still counted', async () => {
    const id = await aosCase();
    const i94 = ev('i94', ['beneficiary'], { first_name: 'ELENA', last_entry_date: '07/14/2019', i94_number: '111222333A1' });
    const r = await physical(id, { forms: baseForms({ last_entry_date: '07/15/2019', i94_number: '111222333A1' }), evidence: [i94] });
    expect(confirmIds(r)).toContain('confirm:i94:last_entry_date:I485');
    expect(r.body.result.report_state).toBe('no_issues_found');
    const num = await physical(id, { forms: baseForms({ i94_number: '999888777A1' }), evidence: [i94] });
    expect(num.body.result.attention.some((a) => a.field === 'i94_number')).toBe(true);
  });

  it('the passport is evidence, not truth: only its number and expiry are compared', async () => {
    const id = await aosCase();
    const passport = ev('passport', ['beneficiary'], { first_name: 'HELENA', last_name: 'VEGAS', passport_number: 'G12345678', expiration_date: '06/30/2029' });
    const r = await physical(id, { forms: baseForms({ passport_number: 'G12345678', passport_expiration: '06/30/2029' }), evidence: [passport] });
    expect(r.body.result.report_state).toBe('no_issues_found');
    const wrong = await physical(id, { forms: baseForms({ passport_number: 'G12345687', passport_expiration: '06/30/2029' }), evidence: [passport] });
    expect(wrong.body.result.attention.map((a) => a.field)).toEqual(['passport_number']);
  });

  it('two documents that disagree about one person are counted (follow-up A); a marriage certificate speaks for each spouse', async () => {
    const id = await aosCase();
    const bc = ev('birth_certificate', ['beneficiary'], { first_name: 'ELENA', middle_name: 'SOFIA', last_name: 'VEGA', date_of_birth: '11/03/1991' });
    const mc = ev('marriage_certificate', ['petitioner', 'beneficiary'], { marriage_date: '02/18/2023' }, {
      people: [{ role: 'beneficiary', first_name: 'ELENA', middle_name: 'SOPHIA', last_name: 'VEGA', date_of_birth: null }],
    });
    const r = await physical(id, { forms: baseForms({ middle_name: 'SOFIA' }), evidence: [bc, mc] });
    expect(r.body.result.attention.find((a) => a.kind === 'document_difference')).toMatchObject({
      person_role: 'beneficiary', field: 'name',
      title: "The beneficiary's name differs between two documents. The birth certificate shows ELENA SOFIA VEGA; the marriage certificate shows ELENA SOPHIA VEGA.",
    });
    const agree = await physical(id, { forms: baseForms({ middle_name: 'SOFIA' }), evidence: [bc, { ...mc, people: [{ ...mc.people[0], middle_name: 'SOFIA' }] }] });
    expect(kinds(agree)).not.toContain('document_difference');
  });
});

// ── Pre-flight corrections with several people (D-72, Q-77) ─────────────────

describe('Pre-flight corrections in an AOS case (Q-77)', () => {
  it('a correction must reach that person\'s other forms; the other person\'s forms are not theirs to carry', async () => {
    const id = await aosCase();
    const forms = [
      form('I-130', { ...petName, phone: PET.phone }, 'petitioner'),
      form('I-485', { ...benName, phone: '(919) 555-0143' }),
      form('I-765', { ...benName, phone: BEN.phone }),
    ];
    const markups = [{ form: 'I-485', page: '2', field: 'phone', original: BEN.phone, markup_read: '(919) 555-0143', read_confidence: 'clear', corrected_page_present: true, corrected: '(919) 555-0143' }];
    mockModel(vi, [observations({ forms, markups, aos: { fee_payments: goodFees(), language_statements: plainEnglish } })]);
    const r = await call(runRoute, '/api/proof-scan-v2-run', { method: 'POST', body: {
      case_id: id, stage: 'preflight', scope: 'whole', files: [pdfFile('forms.pdf'), pdfFile('marked.pdf', { kind: 'marked' })],
    } });
    const carried = r.body.result.corrections.filter((c) => c.status === 'not_carried');
    // Still caught: the beneficiary's own I-765 kept the old phone.
    expect(carried.map((c) => c.other_form)).toEqual(['I-765']);
    // Not the petitioner's I-130, whose phone is the petitioner's own.
    expect(r.body.result.attention.filter((a) => a.kind === 'not_carried' || a.rule_id === 'PS-303').length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(r.body.result.attention)).not.toMatch(/not on the I-130/);
  });
});

// ── One Needs attention list (D-135) ─────────────────────────────────────────

describe('one item per wrong fact (D-135)', () => {
  it('the same wrong date of birth on two forms, against the card and the birth certificate, is one item naming both', async () => {
    const id = await aosCase();
    const bc = ev('birth_certificate', ['beneficiary'], { ...benName, date_of_birth: '11/03/1991' });
    const r = await physical(id, { forms: baseForms({ date_of_birth: '03/11/1991' }), evidence: [bc] });
    const facts = r.body.result.attention.filter((a) => a.kind === 'fact');
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      title: "The beneficiary's date of birth does not match",
      on_forms: [{ value: '03/11/1991', forms: [{ form: 'I-485', n: 1 }, { form: 'I-765', n: 1 }] }],
      sources: [{ value: '11/03/1991', labels: ['the case card', 'the birth certificate'] }],
      fix_on: [{ form: 'I-485', n: 1 }, { form: 'I-765', n: 1 }],
    });
    expect(r.body.result.attention_count).toBe(1);
    expect(r.body.result.primary_report_language).toBe('1 item needs attention');
    // The key carries a hash of the values, never the values themselves.
    expect(facts[0].key).toMatch(/^fact:beneficiary:date_of_birth:[0-9a-f]{8}$/);
    const again = await physical(id, { forms: baseForms({ date_of_birth: '03/11/1991' }), evidence: [bc] });
    expect(again.body.result.attention[0].key).toBe(facts[0].key);
  });

  it('name parts fold into one name, and the forms are counted once per copy', () => {
    const part = (field, form, fv, sv) => ({ role: 'applicant', group: 'name', field, form, forms_value: fv, source: 'the EAD', source_value: sv, part: {} });
    const [fact] = mergeFacts([
      part('first_name', 'G-1450', 'ANA MARIA RIVERA', 'LUIS GARCIA'), part('last_name', 'G-1450', 'ANA MARIA RIVERA', 'LUIS GARCIA'),
      { ...part('first_name', 'G-1450', 'ANA MARIA RIVERA', 'LUIS GARCIA'), copy: '' },
      part('first_name', 'I-765', 'ANA MARIA RIVERA', 'LUIS GARCIA'),
    ]);
    expect(fact.title).toBe("The applicant's name does not match");
    expect(fact.fix_on).toEqual([{ form: 'G-1450', n: 2 }, { form: 'I-765', n: 1 }]);
  });
});

// ── Clears (D-132, D-139, D-143) ─────────────────────────────────────────────

describe('clearing items (D-132, D-139, D-143)', () => {
  const clear = (case_id, stageName, key, cleared = true) => call(clearRoute, '/api/proof-scan-v2-clear', { method: 'POST', body: { case_id, stage: stageName, key, cleared } });
  const twoProblems = { forms: baseForms({ date_of_birth: '03/11/1991' }), rules: { 'AOS-ASM-001': { status: 'needs_attention', summary: 'Page 3 of the I-485 is out of order.' } } };

  it('one click clears; the server decides the result line and every count; Undo takes it back', async () => {
    const id = await aosCase();
    const run = await physical(id, twoProblems);
    expect(run.body.view.line).toEqual({ text: '2 items need attention', tone: 'attention', note: null });
    const [first, second] = run.body.result.attention.map((a) => a.key);
    let r = await clear(id, 'physical_scan', first);
    expect(r.status).toBe(200);
    expect(r.body.view.line).toEqual({ text: '1 item needs attention', tone: 'attention', note: '1 of 2 cleared' });
    expect(r.body.view.strip).toMatchObject({ fix: 1 });
    r = await clear(id, 'physical_scan', second);
    expect(r.body.view.line).toEqual({ text: '2 of 2 cleared, no item needs attention', tone: 'clear', note: null });
    expect(r.body.view.strip.all_cleared).toBe(true);
    // A fully cleared stage counts as done in the tracker; the stored run is untouched.
    expect(r.body.case_view.runs[0]).toMatchObject({ effective_state: 'no_issues_found', open_count: 0, report_state: 'items_need_attention' });
    expect(stepState(r.body.case_view, 'physical_scan')).toBe('done');
    // A clear also shows on the matching row in the form's check list.
    const asm = r.body.view.groups.find((g) => !g.form).rows.find((x) => x.rule_id === 'AOS-ASM-001');
    expect(asm).toMatchObject({ status: 'needs_attention', cleared: true });
    r = await clear(id, 'physical_scan', second, false);
    expect(r.body.view.line.text).toBe('1 item needs attention');
    // Who and when are stored, never shown (D-143).
    expect(db.rows('proof_scan_clears')[0]).toMatchObject({ via: 'hand', cleared_by: 'staff-1', stage: 'physical_scan' });
    expect(JSON.stringify(r.body.view)).not.toMatch(/staff-1/);
  });

  it('stays cleared when a re-run finds the same thing; a different finding is not cleared', async () => {
    const id = await aosCase();
    const run = await physical(id, twoProblems);
    const fact = run.body.result.attention.find((a) => a.kind === 'fact').key;
    await clear(id, 'physical_scan', fact);
    const same = await physical(id, twoProblems);
    expect(same.body.view.attention.find((a) => a.key === fact).cleared).toBe(true);
    const different = await physical(id, { ...twoProblems, forms: baseForms({ date_of_birth: '04/11/1991' }) });
    expect(different.body.view.attention.find((a) => a.kind === 'fact').cleared).toBe(false);
  });

  it('"Mark this stage reviewed" clears every item; unmarking takes back only those, not hand clears; a new run needs a fresh review', async () => {
    const id = await aosCase();
    const run = await physical(id, { ...twoProblems, items: { 'AOS-E-VISA': 'missing' } });
    const handKey = run.body.result.attention[0].key;
    await clear(id, 'physical_scan', handKey);
    const sign = (method) => call(signoffRoute, '/api/proof-scan-v2-signoff', { method, body: { case_id: id, stage: 'physical_scan' } });
    let s = await sign('POST');
    expect(s.body.view.strip.all_cleared).toBe(true);
    expect(s.body.view.confirm.every((c) => c.cleared)).toBe(true);
    expect(db.rows('proof_scan_clears').filter((c) => c.via === 'review').length).toBeGreaterThan(1);
    s = await sign('DELETE');
    expect(s.body.view.attention.filter((a) => a.cleared).map((a) => a.key)).toEqual([handKey]);
    await sign('POST');
    const rerun = await physical(id, twoProblems);
    expect(db.rows('proof_scan_clears').map((c) => c.via)).toEqual(['hand']);
    expect(rerun.body.view.attention.find((a) => a.key === handKey).cleared).toBe(true);
  });

  it('only an item in the stage\'s latest report can be cleared', async () => {
    const id = await aosCase();
    expect((await clear(id, 'physical_scan', 'rule:AOS-ASM-001')).status).toBe(409);
    await physical(id, twoProblems);
    expect((await clear(id, 'physical_scan', 'rule:NOT-A-RULE')).status).toBe(404);
    expect((await clear(id, 'draft_review', 'rule:AOS-ASM-001')).status).toBe(409);
  });

  it('needs info, please confirm and not checked items are clearable too', () => {
    const result = {
      schema_version: 3, report_state: 'review_incomplete', primary_report_language: 'Review incomplete', attention: [],
      checks: [
        { rule_id: 'A', status: 'not_checked', title: 'a', form: null },
        { rule_id: 'confirm:money_order', status: 'please_confirm', title: 'b' },
        { rule_id: 'B', status: 'needs_info', title: 'c', form: 'I-485' },
      ],
      notes: [{ kind: 'needs_info', person_role: 'beneficiary', field: 'phone', title: 'd' }],
    };
    const view = reportView(result, [{ item_key: 'nc:A', via: 'hand' }]);
    expect(view.clearable.sort()).toEqual(['confirm:money_order', 'nc:A', 'ni:beneficiary:phone', 'ni:rule:B']);
    expect(view.line).toEqual({ text: '1 of 1 cleared, no item needs attention', tone: 'clear', note: null });
  });

  it('an Evidence Match document row clears once every item that came from it is cleared (D-140)', async () => {
    const id = await aosCase();
    const bc = ev('birth_certificate', ['beneficiary'], { ...benName, date_of_birth: '11/03/1991' });
    const run = await physical(id, { forms: baseForms({ date_of_birth: '03/11/1991' }), evidence: [bc] });
    const row = () => run.body.view.groups.find((g) => !g.form).rows.find((x) => x.kind === 'evidence');
    expect(row()).toMatchObject({ status: 'needs_attention', cleared: false });
    const r = await clear(id, 'physical_scan', run.body.result.attention[0].key);
    expect(r.body.view.groups.find((g) => !g.form).rows.find((x) => x.kind === 'evidence')).toMatchObject({ cleared: true, title: expect.stringContaining('cleared in Needs attention') });
  });
});

// ── Answer patterns (D-138) ──────────────────────────────────────────────────

describe('answer patterns become suggested rules (D-138)', () => {
  const answers = (over = {}) => [
    { form: 'I-485', item: '53.b', topic: 'ever committed genocide', answer: over['53.b'] || 'no' },
    { form: 'I-485', item: '23', topic: 'crime against ELENA in 2019', answer: over['23'] || 'yes' },
  ];
  it('counts only, from Physical Scans; 5 No and no Yes is suggested; a Yes withdraws it', async () => {
    const id = await aosCase();
    await stage(id, 'draft_review', { aos: { fee_payments: goodFees(), yes_no_answers: answers() } });
    expect(db.rows('proof_scan_answer_tally')).toHaveLength(0);
    for (let i = 0; i < 5; i += 1) await physical(id, { aos: { fee_payments: goodFees(), yes_no_answers: answers() } });
    const rows = db.rows('proof_scan_answer_tally');
    expect(rows.find((r) => r.item === '53.b')).toMatchObject({ no_count: 5, yes_count: 0, state: 'suggested' });
    const crime = rows.find((r) => r.item === '23');
    expect(crime).toMatchObject({ yes_count: 5, state: 'watching' });
    // General words only: no name, no number from the case.
    expect(crime.topic).toBe('crime against in');
    for (const r of rows) expect(Object.keys(r).some((k) => /case_id|run|person|client/.test(k))).toBe(false);
    await physical(id, { aos: { fee_payments: goodFees(), yes_no_answers: answers({ '53.b': 'yes' }) } });
    expect(db.rows('proof_scan_answer_tally').find((r) => r.item === '53.b').state).toBe('watching');
    expect(nextTallyState({ state: 'declined', no_count: 9, yes_count: 0 })).toBe('declined');
    expect(tallyRows([{ form: 'I-485', item: '61', topic: 'education', answer: 'blank' }], new Set())).toEqual([]);
  });

  it('staff approve (a rule is added to a new version) or decline; nothing switches on by itself', async () => {
    const id = await aosCase();
    for (let i = 0; i < 5; i += 1) await physical(id, { aos: { fee_payments: goodFees(), yes_no_answers: answers() } });
    const row = db.rows('proof_scan_answer_tally').find((r) => r.item === '53.b');
    const book = await call(rulesRoute, '/api/proof-scan-v2-rules', { query: { case_type: 'aos' } });
    expect(book.body.patterns.map((p) => p.item)).toEqual(expect.arrayContaining(['53.b', '23']));
    const decide = (decision, rid = row.id) => call(patternsRoute, '/api/proof-scan-v2-patterns', { method: 'POST', body: { id: rid, decision } });
    const ok = await decide('approve');
    expect(ok.body).toMatchObject({ rule_id: 'AOS-ADD-001', versions: { aos: 2 } });
    const rule = db.rows('proof_scan_rules').find((r) => r.rule_id === 'AOS-ADD-001');
    expect(rule).toMatchObject({ origin: 'answer_pattern', form: 'I-485', item: '53.b', expected: 'No', scope: 'case_type' });
    expect((await decide('decline')).status).toBe(409);
    const crime = db.rows('proof_scan_answer_tally').find((r) => r.item === '23');
    expect((await decide('approve', crime.id)).status).toBe(409);
  });
});

// ── Evidence Zero in an AOS case (Q-61) ──────────────────────────────────────

describe('Evidence Zero in an AOS case (Q-61)', () => {
  const read = (o) => ({ read_quality: 'clear', unreadable_fields: [], issued_date: null, doc_title: null, issuing_country: 'United States', language: 'English', people: [], ...o,
    facts: { ...Object.fromEntries(FACT_FIELDS.map((f) => [f, null])), ...(o.facts || {}) } });
  const upload = (caseId) => call(evidenceRoute, '/api/proof-scan-v2-evidence', { method: 'POST', body: { case_id: caseId, ...pdfFile('doc.pdf') } });

  it('a passport fills only its number and expiry, never the name or date of birth', async () => {
    const id = (await create({ case_type: 'aos', aos_kind: 'spousal' })).body.case.id;
    mockModel(vi, [{ output: read({ doc_type: 'passport', owner_roles: ['beneficiary'], facts: { first_name: 'ELENA', last_name: 'VEGA', date_of_birth: '11/03/1991', passport_number: 'G1', expiration_date: '06/30/2029' } }) }]);
    expect((await upload(id)).status).toBe(201);
    expect(db.rows('proof_scan_people').find((p) => p.case_id === id)).toMatchObject({ first_name: null, date_of_birth: null, passport_number: 'G1', passport_expiration: '2029-06-30' });
  });

  it('a marriage certificate proposes a different middle name to the card, fills nothing', async () => {
    const id = await aosCase('spousal', { ben: { middle_name: 'SOFIA' } });
    mockModel(vi, [{ output: read({ doc_type: 'marriage_certificate', owner_roles: ['petitioner', 'beneficiary'], facts: { marriage_date: '02/18/2023' },
      people: [{ role: 'beneficiary', first_name: 'ELENA', middle_name: 'SOPHIA', last_name: 'VEGA', date_of_birth: null }] }) }]);
    await upload(id);
    expect(db.rows('proof_scan_suggestions').map((x) => [x.field, x.value])).toEqual([['middle_name', 'SOPHIA']]);
    expect(db.rows('proof_scan_documents')[0].facts.people[0]).toMatchObject({ role: 'beneficiary', middle_name: 'SOPHIA' });
  });
});

// ── The stage email (D-114, Q-51) ────────────────────────────────────────────

describe('the stage email', () => {
  it('a merged fact is one line from its structured fields, never a value', () => {
    const lines = stageSummaryLines({ case_type: 'aos', attention: [
      { kind: 'fact', person_role: 'beneficiary', field: 'date_of_birth', forms: ['I-485', 'I-765'], title: 'x 03/11/1991' },
      { kind: 'missing_item', form: null, title: 'The divorce certificate is missing' },
    ] });
    expect(lines).toEqual(["The forms differ on the beneficiary's date of birth (I-485, I-765).", 'A document is missing from the package.']);
  });
});

// ── The old checker is untouched (D-88) ──────────────────────────────────────

describe('the old checker (D-88)', () => {
  it('the v2 page no longer imports the shared report renderer, so report.js is unchanged', () => {
    const sources = import.meta.glob('../../pages/proof-scan-v2/*.js', { query: '?raw', import: 'default', eager: true });
    for (const src of Object.values(sources)) expect(src).not.toMatch(/from\s+['"][^'"]*proof-scan\/report\.js['"]/);
  });
});
