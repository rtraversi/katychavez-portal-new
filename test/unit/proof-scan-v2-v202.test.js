// Proof Scan v2.0.2: decisions D-111 to D-128 (docs/proof-scan-v2/DECISIONS-MASTER-RECORD.md).
// Every loosening of "these two values are the same" is paired with a test
// proving a real difference is still caught. Synthetic people only (Ana Rivera,
// Luis Garcia, Lucia Reyes, Jane Doe Douglas). The model is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { onRequest as runRoute } from '../../functions/api/proof-scan-v2-run.js';
import { onRequest as evidenceRoute } from '../../functions/api/proof-scan-v2-evidence.js';
import { onRequest as issueRoute } from '../../functions/api/proof-scan-v2-possible-issue.js';
import { onRequest as suppressionsRoute } from '../../functions/api/proof-scan-v2-suppressions.js';
import { onRequest as editionsRoute } from '../../functions/api/proof-scan-v2-editions.js';
import { run as runEditionCheck } from '../../functions/api/process-form-edition-check.js';
import { parseEditionNotices, acceptedEditions } from '../../functions/api/_uscis-editions.js';
import { buildProofScanStageEmail, stageSummaryLines } from '../../functions/api/_proof-scan-email.js';
import { FACT_FIELDS } from '../../functions/api/_proof-scan-v2-ai.js';
import {
  sameValue, sameDate, normText, compareNames, canonicalCountry, sameEmployer, normalizeDate, toCardValue,
  isNotApplicable, dateOrderFor,
} from '../../functions/api/_proof-scan-v2-common.js';
import { seededDb, call, STAFF, CLIENT, ENV, pdfFile, mockModel, observations, formValues, evidenceFacts, findings,
} from '../support/proof-scan-v2-harness.js';

let db;
beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  helpersMock.makeAdminClient.mockReturnValue(db);
  helpersMock.verifyAuth.mockResolvedValue(STAFF);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

function addCase(case_type) {
  const id = crypto.randomUUID();
  db.rows('proof_scan_cases').push({ id, case_type, label: 'Test', created_at: '2026-10-07T00:00:00Z' });
  return id;
}
function addPerson(caseId, role, fields = {}, extra = {}) {
  const id = crypto.randomUUID();
  const sources = Object.fromEntries(Object.keys(fields).map((k) => [k, { kind: 'document', label: 'Birth certificate' }]));
  db.rows('proof_scan_people').push({
    id, case_id: caseId, role, is_main: false, field_sources: sources, approved_at: '2026-10-07T00:00:00Z',
    changed_since_approval: false, no_evidence: false, ssn_encrypted: null, ssn_last4: null,
    created_at: `2026-10-07T00:00:0${db.rows('proof_scan_people').length}Z`, ...fields, ...extra,
  });
  return id;
}
function addDoc(caseId, ownerIds, doc_type, facts, filename = `${doc_type}.pdf`) {
  const id = crypto.randomUUID();
  db.rows('proof_scan_documents').push({ id, case_id: caseId, doc_type, read_quality: 'clear', unreadable_fields: [], filename,
    facts, status: 'current', replaced_by: null, type_corrected: false, created_at: '2026-10-07T00:00:00Z' });
  for (const pid of ownerIds) db.rows('proof_scan_document_people').push({ document_id: id, person_id: pid, proposed_by: 'ai' });
  return id;
}
const form = (name, values, person_role = 'beneficiary', pages = '1-20') => ({ form: name, file: 'package.pdf', pages, person_role, values: formValues(values) });
const ev = (doc_type, facts, extra = {}) => ({
  doc_type, file: 'evidence.pdf', pages: '3', owner_roles: ['beneficiary'], read_quality: 'clear', facts: evidenceFacts(facts),
  language: 'English', has_english_translation: true, ...extra,
});
const run = (body) => call(runRoute, '/api/proof-scan-v2-run', { method: 'POST', body: { files: [pdfFile()], ...body } });
const physical = (caseId) => run({ case_id: caseId, stage: 'physical_scan' });
const titles = (r) => findings(r.body.result).map((a) => a.title);
const confirms = (r) => r.body.result.checks.filter((c) => c.status === 'please_confirm');
const confirmIds = (r) => confirms(r).map((c) => c.rule_id);

// A General case whose beneficiary card holds nothing, so only evidence and
// forms are compared (PS-304, PS-305).
function generalCase() {
  const caseId = addCase('general');
  addPerson(caseId, 'beneficiary', {}, { is_main: true });
  return caseId;
}
async function evidenceRun(evidence, forms, stage = 'physical_scan') {
  const caseId = generalCase();
  mockModel(vi, [observations({ forms, evidence })]);
  const r = await run({ case_id: caseId, stage, ...(stage === 'physical_scan' ? {} : { scope: 'whole' }) });
  expect(r.status).toBe(200);
  return r;
}

// v2.0.2 rule sets (migration 2005): PS-103 retired.
function retirePs103() {
  for (const r of db.rows('proof_scan_rules')) if (r.rule_id === 'PS-103') r.retired = true;
}

// ── A. False alarms in matching ──────────────────────────────────────────────

describe('D-111: a two-digit year is the same date', () => {
  it('MM/DD/YY equals MM/DD/YYYY, both directions', () => {
    expect(sameDate('01/29/25', '01/29/2025')).toBe(true);
    expect(sameDate('01/29/2025', '01/29/25')).toBe(true);
    expect(sameValue('ead_expiration', '01/29/25', '2025-01-29')).toBe(true);
  });

  it('a real difference is still caught: another day, another month, another year', () => {
    expect(sameDate('01/28/25', '01/29/2025')).toBe(false);
    expect(sameDate('02/29/24', '01/29/2024')).toBe(false);
    expect(sameDate('01/29/24', '01/29/2025')).toBe(false);
    expect(sameDate('01/29/25', '01/29/1925')).toBe(true); // the century cannot be told from 25: by design
  });

  it('through the engine: the EAD at 01/29/25 against the form at 01/29/2025 is no difference; 01/29/26 is', async () => {
    const ok = await evidenceRun([ev('ead', { first_name: 'ANA', last_name: 'RIVERA', expiration_date: '01/29/25', i94_expiration: '01/29/25' })],
      [form('I-485', { first_name: 'ANA', last_name: 'RIVERA', i94_expiration: '01/29/2025' })]);
    expect(findings(ok.body.result)).toEqual([]);
    const bad = await evidenceRun([ev('ead', { first_name: 'ANA', last_name: 'RIVERA', i94_expiration: '01/29/26' })],
      [form('I-485', { first_name: 'ANA', last_name: 'RIVERA', i94_expiration: '01/29/2025' })]);
    expect(findings(bad.body.result).map((a) => a.field)).toEqual(['i94_expiration']);
  });

  it('century rule for the card: an expiration is 20YY; a past date is never guessed', () => {
    expect(toCardValue('ead_expiration', '01/29/25')).toEqual({ value: '2025-01-29' });
    expect(toCardValue('i94_expiration', '12/31/30')).toEqual({ value: '2030-12-31' });
    expect(toCardValue('date_of_birth', '01/29/95')).toEqual({ invalid: true });
    expect(toCardValue('marriage_date', '06/01/20')).toEqual({ invalid: true });
    expect(normalizeDate('01/29/25')).toBeNull(); // no field, no century
  });
});

describe('D-117: foreign documents are day first; the forms must be month first', () => {
  const mexican = (dob) => ev('birth_certificate', { first_name: 'LUCIA', last_name: 'REYES', date_of_birth: dob },
    { issuing_country: 'Mexico', language: 'Spanish', has_english_translation: true });

  it('MUST PASS: a Mexican 05/03/1995 (5 March) against a form saying 05/03/1995 is CAUGHT', async () => {
    const r = await evidenceRun([mexican('05/03/1995')], [form('I-485', { first_name: 'LUCIA', last_name: 'REYES', date_of_birth: '05/03/1995' })]);
    expect(findings(r.body.result).map((a) => a.field)).toEqual(['date_of_birth']);
  });

  it('MUST PASS: the same Mexican 05/03/1995 against a form saying 03/05/1995 passes', async () => {
    const r = await evidenceRun([mexican('05/03/1995')], [form('I-485', { first_name: 'LUCIA', last_name: 'REYES', date_of_birth: '03/05/1995' })]);
    expect(findings(r.body.result)).toEqual([]);
  });

  it('a day-first date the form wrote backwards is caught; a US document stays month first', async () => {
    const backwards = await evidenceRun([mexican('29/01/1995')], [form('I-485', { first_name: 'LUCIA', last_name: 'REYES', date_of_birth: '29/01/1995' })]);
    expect(findings(backwards.body.result).map((a) => a.field)).toEqual(['date_of_birth']);
    // A day-first document that printed a date only readable month first is read month first.
    expect(sameDate('09/30/1993', '09/30/1993', { aOrder: 'dmy' })).toBe(true);
    expect(sameValue('date_of_birth', '09/30/1993', '30/09/1993', { aOrder: 'dmy' })).toBe(false); // the form side is strict
    const us = ev('birth_certificate', { first_name: 'LUCIA', last_name: 'REYES', date_of_birth: '05/03/1995' }, { issuing_country: 'United States' });
    expect(findings((await evidenceRun([us], [form('I-485', { first_name: 'LUCIA', last_name: 'REYES', date_of_birth: '05/03/1995' })])).body.result)).toEqual([]);
  });

  it('how a document\'s country is known: the model reports it; unknown and not in English is day first', () => {
    expect(dateOrderFor('MEX')).toBe('dmy');
    expect(dateOrderFor('Mexican')).toBe('dmy');
    expect(dateOrderFor('USA')).toBe('mdy');
    expect(dateOrderFor('Philippines')).toBe('mdy');
    expect(dateOrderFor(null, 'Spanish')).toBe('dmy');
    expect(dateOrderFor(null, 'English')).toBe('mdy');
    expect(dateOrderFor(null, null)).toBe('mdy');
  });

  it('an Evidence Zero document keeps its country, so later stages read its dates day first', async () => {
    const caseId = addCase('general');
    mockModel(vi, [{ output: {
      doc_type: 'birth_certificate', doc_title: 'Acta de Nacimiento', issuing_country: 'Mexico', language: 'Spanish',
      read_quality: 'clear', unreadable_fields: [], issued_date: null, owner_roles: ['beneficiary'],
      facts: { ...Object.fromEntries(FACT_FIELDS.map((f) => [f, null])), first_name: 'LUCIA', last_name: 'REYES', date_of_birth: '05/03/1995' },
    } }]);
    const up = await call(evidenceRoute, '/api/proof-scan-v2-evidence', { method: 'POST', body: { case_id: caseId, ...pdfFile('acta.pdf') } });
    expect(up.status).toBe(201);
    expect(db.rows('proof_scan_people')[0].date_of_birth).toBe('1995-03-05'); // 5 March
    expect(db.rows('proof_scan_documents')[0].facts).toMatchObject({ issuing_country: 'Mexico', doc_title: 'Acta de Nacimiento' });
    mockModel(vi, [observations({ forms: [form('I-485', { first_name: 'LUCIA', last_name: 'REYES', date_of_birth: '05/03/1995' })] })]);
    const r = await physical(caseId);
    // D-135 (v2.1): the case card and the birth certificate are one item, naming both.
    expect(r.body.result.attention.map((a) => a.field)).toEqual(['date_of_birth']);
    expect(r.body.result.attention[0].sources[0].labels).toEqual(['the case card', 'the birth certificate']);
  });
});

describe('D-118, D-126: countries, accents, ports, "(none)"', () => {
  it('country codes and nationality words are the country', () => {
    expect(canonicalCountry('MEX')).toBe('MEXICO');
    expect(canonicalCountry('Mexican')).toBe('MEXICO');
    expect(canonicalCountry('México')).toBe('MEXICO');
    expect(canonicalCountry('US')).toBe('UNITED STATES');
    expect(canonicalCountry('American')).toBe('UNITED STATES');
    expect(sameValue('country_of_citizenship', 'MEX', 'MEXICO')).toBe(true);
    expect(sameValue('country_of_birth', 'Mexican', 'MEXICO')).toBe(true);
    expect(sameValue('country_of_citizenship', 'USA', 'UNITED STATES')).toBe(true);
  });

  it('a real difference is still caught: another country, by name or by code', () => {
    expect(sameValue('country_of_citizenship', 'GTM', 'MEXICO')).toBe(false);
    expect(sameValue('country_of_birth', 'Guatemalan', 'MEXICO')).toBe(false);
    expect(sameValue('country_of_birth', 'NIGER', 'NIGERIA')).toBe(false);
    expect(sameValue('country_of_birth', 'Atlantis', 'MEXICO')).toBe(false);
  });

  it('accents never count, and a real difference in the letters is still caught', () => {
    expect(normText('José Ramírez')).toBe('jose ramirez');
    expect(sameValue('first_name', 'José', 'JOSE')).toBe(true);
    expect(sameValue('last_name', 'Ramírez', 'RAMIREZ')).toBe(true);
    expect(sameValue('last_name', 'Peña', 'PENA')).toBe(true);
    expect(sameValue('first_name', 'José', 'Josué')).toBe(false);
    expect(sameValue('last_name', 'Ramírez', 'Ramos')).toBe(false);
  });

  it('a CBP port code is the port; a different port, or a code not in the table, is still caught', () => {
    expect(sameValue('port_of_entry', 'CHM', 'Champlain, NY')).toBe(true);
    expect(sameValue('port_of_entry', 'SYS', 'SAN YSIDRO, CA')).toBe(true);
    expect(sameValue('port_of_entry', 'CHM', 'Blaine, WA')).toBe(false);
    expect(sameValue('port_of_entry', 'QQQ', 'Champlain, NY')).toBe(false);
  });

  it('"(none)" on a form is a blank field, never a value; a real omission is still caught', async () => {
    expect(isNotApplicable('(none)')).toBe(true);
    expect(isNotApplicable('N/A')).toBe(true);
    expect(isNotApplicable('Nona')).toBe(false);
    expect(sameValue('middle_name', '(none)', '')).toBe(true);
    // The card has a middle name; the form says "(none)": still reported, as a blank.
    const caseId = addCase('general');
    addPerson(caseId, 'beneficiary', { first_name: 'LUIS', middle_name: 'ALBERTO', last_name: 'GARCIA' }, { is_main: true });
    mockModel(vi, [observations({ forms: [form('I-130', { first_name: 'LUIS', middle_name: '(none)', last_name: 'GARCIA' })] })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(findings(r.body.result).map((a) => [a.field, a.kind])).toEqual([['middle_name', 'reference_difference']]);
    expect(r.body.result.forms_found[0].values.middle_name).toBe('(none)'); // what was printed is kept
  });
});

describe('D-112: capitals are never a difference; the reported flag was the last-name split', () => {
  const card = (fields) => {
    const caseId = addCase('general');
    addPerson(caseId, 'beneficiary', fields, { is_main: true });
    return caseId;
  };

  it('capitals alone: "Jane Doe Douglas" with a two-part last name against "Jane DOE DOUGLAS" is no difference', async () => {
    const caseId = card({ first_name: 'Jane', middle_name: null, last_name: 'Doe Douglas' });
    mockModel(vi, [observations({ forms: [form('I-130', { first_name: 'JANE', middle_name: '', last_name: 'DOE DOUGLAS' })] })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(findings(r.body.result)).toEqual([]);
  });

  it('the cause: "Doe" held as a middle name, the forms carry DOE DOUGLAS as the last name. A gentle confirm, never counted', async () => {
    const caseId = card({ first_name: 'Jane', middle_name: 'Doe', last_name: 'Douglas' });
    mockModel(vi, [observations({ forms: [form('I-130', { first_name: 'JANE', middle_name: '', last_name: 'DOE DOUGLAS' })] })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(findings(r.body.result)).toEqual([]);
    expect(confirmIds(r)).toContain('confirm:name_split:beneficiary');
    expect(r.body.result.report_state).toBe('no_issues_found');
  });

  it('a real difference in the name is still caught, in capitals or not', async () => {
    const caseId = card({ first_name: 'Jane', middle_name: null, last_name: 'Doe Douglas' });
    mockModel(vi, [observations({ forms: [form('I-130', { first_name: 'JANE', middle_name: '', last_name: 'DOE DOUGLASS' })] })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(findings(r.body.result).map((a) => a.field)).toEqual(['last_name']);
    expect(compareNames({ first_name: 'Jane', last_name: 'Doe' }, { first_name: 'JANE', last_name: 'DOW' })).toBe('different');
  });

  it('Physical Scan reads the split the same way', async () => {
    const caseId = card({ first_name: 'Jane', middle_name: 'Doe', last_name: 'Douglas' });
    mockModel(vi, [observations({ forms: [form('I-130', { first_name: 'JANE', middle_name: '', last_name: 'DOE DOUGLAS' })] })]);
    const r = await physical(caseId);
    expect(findings(r.body.result)).toEqual([]);
    expect(confirmIds(r)).toContain('confirm:name_split:beneficiary');
  });
});

describe('D-120: a document printing first and middle name together is not a difference', () => {
  it('"ANA MARIA" as the first name on the evidence equals first ANA, middle MARIA on the form', async () => {
    const r = await evidenceRun([ev('birth_certificate', { first_name: 'ANA MARIA', last_name: 'RIVERA' })],
      [form('I-485', { first_name: 'ANA', middle_name: 'MARIA', last_name: 'RIVERA' })]);
    expect(findings(r.body.result)).toEqual([]);
  });

  it('a real difference is still caught: another middle name, another first name', async () => {
    const r = await evidenceRun([ev('birth_certificate', { first_name: 'ANA LUISA', last_name: 'RIVERA' })],
      [form('I-485', { first_name: 'ANA', middle_name: 'MARIA', last_name: 'RIVERA' })]);
    expect(findings(r.body.result).map((a) => a.field)).toEqual(['first_name']);
    expect(compareNames({ first_name: 'ANA MARIA', last_name: 'RIVERA' }, { first_name: 'ANNA', middle_name: 'MARIA', last_name: 'RIVERA' })).toBe('different');
  });
});

describe('Q-56: city of birth, only when the birth is in the US', () => {
  it('a US city of birth is compared, and a different city is caught', async () => {
    const r = await evidenceRun([ev('birth_certificate', { first_name: 'LUIS', last_name: 'GARCIA', city_of_birth: 'Durham, NC' }, { issuing_country: 'United States' })],
      [form('I-130', { first_name: 'LUIS', last_name: 'GARCIA', city_of_birth: 'RALEIGH', country_of_birth: 'UNITED STATES' })]);
    expect(findings(r.body.result).map((a) => a.field)).toEqual(['city_of_birth']);
    const same = await evidenceRun([ev('birth_certificate', { first_name: 'LUIS', last_name: 'GARCIA', city_of_birth: 'Raleigh, North Carolina' }, { issuing_country: 'US' })],
      [form('I-130', { first_name: 'LUIS', last_name: 'GARCIA', city_of_birth: 'RALEIGH, NC', country_of_birth: 'UNITED STATES' })]);
    expect(findings(same.body.result)).toEqual([]);
  });

  it('a city outside the US is never compared', async () => {
    const r = await evidenceRun([ev('birth_certificate', { first_name: 'LUCIA', last_name: 'REYES', city_of_birth: 'Leon, Guanajuato' }, { issuing_country: 'Mexico', language: 'Spanish' })],
      [form('I-485', { first_name: 'LUCIA', last_name: 'REYES', city_of_birth: 'GUADALAJARA', country_of_birth: 'MEXICO' })]);
    expect(findings(r.body.result)).toEqual([]);
  });

  it('the card carries a city of birth (it is a case-card fact now)', async () => {
    const caseId = addCase('general');
    addPerson(caseId, 'beneficiary', { first_name: 'LUIS', last_name: 'GARCIA', city_of_birth: 'Raleigh', country_of_birth: 'UNITED STATES' }, { is_main: true });
    mockModel(vi, [observations({ forms: [form('I-130', { first_name: 'LUIS', last_name: 'GARCIA', city_of_birth: 'DURHAM', country_of_birth: 'UNITED STATES' })] })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(findings(r.body.result).map((a) => a.field)).toEqual(['city_of_birth']);
  });
});

describe('D-116: a county on the certificate against a city on the forms', () => {
  it('is always a gentle confirm, never counted, whatever city the forms name', async () => {
    for (const city of ['RALEIGH', 'CARY']) {
      const r = await evidenceRun([ev('marriage_certificate', { marriage_place: 'Wake County, NC', marriage_date: '06/01/2020' }, { owner_roles: ['beneficiary'] })],
        [form('I-130', { marriage_place: city, marriage_date: '06/01/2020' })]);
      expect(findings(r.body.result)).toEqual([]);
      expect(confirmIds(r)).toContain('confirm:county:beneficiary:marriage_place');
    }
  });

  it('a different city against a city is still caught; a marriage outside the US is not compared', async () => {
    const r = await evidenceRun([ev('marriage_certificate', { marriage_place: 'Durham, NC' })], [form('I-130', { marriage_place: 'RALEIGH, NC' })]);
    expect(findings(r.body.result).map((a) => a.field)).toEqual(['marriage_place']);
    const abroad = await evidenceRun([ev('marriage_certificate', { marriage_place: 'Monterrey, Nuevo Leon, Mexico' }, { issuing_country: 'Mexico', language: 'Spanish' })],
      [form('I-130', { marriage_place: 'SALTILLO, MEXICO' })]);
    expect(findings(abroad.body.result)).toEqual([]);
  });
});

describe('D-119, Q-53: employers, judged the way a person would', () => {
  it('a shorter or everyday name passes', () => {
    expect(sameEmployer('Walmart', 'Wal-mart Associates and Co.')).toBe(true);
    expect(sameEmployer('WALMART', 'Wal-Mart Associates, Inc.')).toBe(true);
    expect(sameEmployer('Amazon', 'Amazon.com Services LLC')).toBe(true);
    expect(sameEmployer('UPS', 'United Parcel Service, Inc.')).toBe(true);
    expect(sameEmployer('Duke University', 'Duke University Health System')).toBe(true);
  });

  it('a glaring typo or another employer is caught', () => {
    expect(sameEmployer('Walmrat', 'Wal-mart Associates and Co.')).toBe(false);
    expect(sameEmployer('Target', 'Walmart Inc.')).toBe(false);
    expect(sameEmployer('Duke Energy', 'Duke University')).toBe(false);
  });

  it('through the engine: the short name passes; a typo, or the employer left off the form, is counted', async () => {
    const stub = ev('pay_stub', { first_name: 'LUIS', last_name: 'GARCIA', employer: 'Wal-mart Associates and Co.' }, { owner_roles: ['sponsor'] });
    const mk = (employer) => [form('I-864', { first_name: 'LUIS', last_name: 'GARCIA', employer }, 'sponsor')];
    const caseFor = () => { const id = addCase('general'); addPerson(id, 'sponsor', {}, { is_main: true }); return id; };
    for (const [employer, expected] of [['WALMART', []], ['WALMRAT', ['employer']], ['', ['employer']]]) {
      const caseId = caseFor();
      mockModel(vi, [observations({ forms: mk(employer), evidence: [stub] })]);
      const r = await physical(caseId);
      expect(findings(r.body.result).map((a) => a.field), employer || 'blank').toEqual(expected);
    }
  });
});

// ── B. New gentle confirms ───────────────────────────────────────────────────

describe('Q-48, Q-54: caps and first names on the forms (gentle, never counted)', () => {
  it('a last name or a country not in caps is a gentle confirm; in caps it is not', async () => {
    const r = await evidenceRun([], [form('I-130', { first_name: 'Luis', last_name: 'Garcia', country_of_birth: 'Mexico' })]);
    expect(confirmIds(r)).toEqual(expect.arrayContaining(['confirm:caps:last_name', 'confirm:caps:country']));
    expect(findings(r.body.result)).toEqual([]);
    const caps = await evidenceRun([], [form('I-130', { first_name: 'Luis', last_name: 'GARCIA', country_of_birth: 'MEXICO' })]);
    expect(confirmIds(caps)).not.toContain('confirm:caps:last_name');
    expect(confirmIds(caps)).not.toContain('confirm:caps:country');
  });

  it('two words in the first-name field is a gentle confirm; one word is not', async () => {
    const r = await evidenceRun([], [form('I-130', { first_name: 'ANA MARIA', last_name: 'RIVERA' })]);
    expect(confirmIds(r)).toContain('confirm:first_name_words');
    expect(findings(r.body.result)).toEqual([]);
    const one = await evidenceRun([], [form('I-130', { first_name: 'MARY-JANE', last_name: 'RIVERA' })]);
    expect(confirmIds(one)).not.toContain('confirm:first_name_words');
  });
});

// ── C. Rule changes ──────────────────────────────────────────────────────────

describe('D-123, Q-55: blank or duplicate pages are a Possible issue, never counted', () => {
  const withPages = (base, pages) => (body) => ({ ...base(body), ...(body.output_config.format.schema.properties.page_problems ? { page_problems: pages } : {}) });

  it('with PS-103 retired, the model is asked about pages and the server raises one Possible issue', async () => {
    retirePs103();
    const caseId = generalCase();
    const calls = mockModel(vi, [withPages(observations(), [{ kind: 'blank', file: 'package.pdf', pages: '14' }, { kind: 'duplicate', file: 'package.pdf', pages: '15, 16' }])]);
    const r = await physical(caseId);
    expect(calls[0].body.output_config.format.schema.properties.page_problems).toBeDefined();
    expect(findings(r.body.result)).toEqual([]);
    expect(r.body.result.checks.some((c) => c.rule_id === 'PS-103')).toBe(false);
    const issue = r.body.possible_issues.find((p) => p.reasoning_key === 'blank_or_duplicate_pages');
    expect(issue.evidence).toContain('page 14');
    expect(issue.evidence).toContain('pages 15, 16');
  });

  it('cannot be silenced firm-wide: "never suggest" is refused, and a suppression row would not hide it', async () => {
    retirePs103();
    const caseId = generalCase();
    mockModel(vi, [withPages(observations(), [{ kind: 'blank', file: 'package.pdf', pages: '2' }])]);
    const r = await physical(caseId);
    const issue = r.body.possible_issues.find((p) => p.reasoning_key === 'blank_or_duplicate_pages');
    const never = await call(issueRoute, '/api/proof-scan-v2-possible-issue', { method: 'POST', body: { issue_id: issue.id, action: 'dismiss', reason: 'never_suggest_reasoning' } });
    expect(never.status).toBe(409);
    expect(db.rows('proof_scan_suppressions').some((s) => s.reasoning_key === 'blank_or_duplicate_pages')).toBe(false);
    const once = await call(issueRoute, '/api/proof-scan-v2-possible-issue', { method: 'POST', body: { issue_id: issue.id, action: 'dismiss', reason: 'not_an_issue_here' } });
    expect(once.status).toBe(200);
    const add = await call(suppressionsRoute, '/api/proof-scan-v2-suppressions', { method: 'POST', body: { label: 'pages', reasoning_key: 'blank_or_duplicate_pages' } });
    expect(add.status).toBe(409);
    // Even a row put there by hand does not hide it.
    db.rows('proof_scan_suppressions').push({ id: 's-x', reasoning_key: 'blank_or_duplicate_pages', label: 'x', origin: 'staff' });
    mockModel(vi, [withPages(observations(), [{ kind: 'blank', file: 'package.pdf', pages: '2' }])]);
    expect((await physical(caseId)).body.possible_issues.some((p) => p.reasoning_key === 'blank_or_duplicate_pages')).toBe(true);
  });

  it('while PS-103 is still a counted check (rule set v1), nothing changes', async () => {
    const caseId = generalCase();
    const calls = mockModel(vi, [observations({ rules: { 'PS-103': 'needs_attention' } })]);
    const r = await physical(caseId);
    expect(calls[0].body.output_config.format.schema.properties.page_problems).toBeUndefined();
    expect(findings(r.body.result).map((a) => a.rule_id)).toContain('PS-103');
  });
});

describe('D-124: PS-306 does not apply to passports', () => {
  it('a Spanish passport with no translation is not counted; a Spanish birth certificate still is', async () => {
    const r = await evidenceRun([
      ev('passport', { first_name: 'LUCIA', last_name: 'REYES' }, { language: 'Spanish', has_english_translation: false, issuing_country: 'Mexico' }),
      ev('birth_certificate', { first_name: 'LUCIA', last_name: 'REYES' }, { language: 'Spanish', has_english_translation: false, issuing_country: 'Mexico', pages: '7' }),
    ], [form('I-485', { first_name: 'LUCIA', last_name: 'REYES' })]);
    expect(findings(r.body.result).map((a) => a.kind)).toEqual(['translation']);
    expect(findings(r.body.result)[0].title).toContain('birth certificate');
  });
});

// ── D. Evidence labels ───────────────────────────────────────────────────────

describe('D-121: every evidence finding names the document and where both sides are', () => {
  it('a tax return is a tax return, with file and page on both sides', async () => {
    const r = await evidenceRun([ev('tax_return', { first_name: 'LUIS', last_name: 'GARCIA' }, { file: 'taxes.pdf', pages: '2-5' })],
      [form('I-864', { first_name: 'LUIS', last_name: 'GARCIA', middle_name: '' }, 'beneficiary', '30-39'), form('I-130', { first_name: 'LUIS', last_name: 'GARCIA' })]);
    expect(findings(r.body.result)).toEqual([]);
    const bad = await evidenceRun([ev('tax_return', { first_name: 'LUIS', last_name: 'GARCIA' }, { file: 'taxes.pdf', pages: '2-5' })],
      [form('I-864', { first_name: 'LUIS', last_name: 'GARCIAS' }, 'beneficiary', '30-39')]);
    expect(titles(bad)).toEqual(["The beneficiary's tax return (taxes.pdf, pages 2-5) shows last name GARCIA. The I-864 (package.pdf, pages 30-39) shows GARCIAS."]);
  });

  it('"other" uses the document\'s own title; "Other document" only when there is none', async () => {
    const titled = await evidenceRun([ev('other', { last_name: 'GARCIA', first_name: 'LUIS' }, { doc_title: 'Earnings Statement' })],
      [form('I-864', { first_name: 'LUIS', last_name: 'GARZA' })]);
    expect(titles(titled)[0]).toContain('earnings statement (evidence.pdf, page 3)');
    const plain = await evidenceRun([ev('other', { last_name: 'GARCIA', first_name: 'LUIS' })], [form('I-864', { first_name: 'LUIS', last_name: 'GARZA' })]);
    expect(titles(plain)[0]).toContain('other document');
  });
});

// ── E. Stage locks (DACA) ────────────────────────────────────────────────────

describe('D-113, Q-49, Q-50: Draft Review and Pre-flight ask gently for the EAD only when there is none anywhere', () => {
  const dacaCase = (extra = {}) => {
    const caseId = addCase('daca_renewal');
    const pid = addPerson(caseId, 'applicant', {}, { is_main: true, approved_at: null, ...extra });
    return { caseId, pid };
  };

  it('an EAD in the package: no ask', async () => {
    const { caseId } = dacaCase();
    mockModel(vi, [observations({ evidence: [ev('ead', { first_name: 'ANA', last_name: 'RIVERA' }, { owner_roles: ['applicant'] })] })]);
    const r = await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' });
    expect(confirmIds(r)).not.toContain('confirm:ead_missing');
  });

  it('an EAD uploaded in Evidence Zero: no ask', async () => {
    const { caseId, pid } = dacaCase();
    addDoc(caseId, [pid], 'ead', { first_name: 'ANA', last_name: 'RIVERA' });
    mockModel(vi, [observations()]);
    expect(confirmIds(await run({ case_id: caseId, stage: 'preflight', scope: 'whole' }))).not.toContain('confirm:ead_missing');
  });

  it('"no evidence for this case", marked on purpose, is not asked again', async () => {
    const { caseId } = dacaCase({ no_evidence: true });
    mockModel(vi, [observations()]);
    expect(confirmIds(await run({ case_id: caseId, stage: 'draft_review', scope: 'whole' }))).not.toContain('confirm:ead_missing');
  });
});

// ── F. Stage email ───────────────────────────────────────────────────────────

describe('D-114, Q-51: the stage email', () => {
  const people = [
    { role: 'beneficiary', is_main: true, first_name: 'Lucia', last_name: 'Reyes' },
    { role: 'petitioner', is_main: false, first_name: 'Mateo', last_name: 'Morales' },
  ];
  const base = { stage: 'physical_scan', case_type: 'general', not_checked_count: 0 };

  it('names the case by last names only, links to that case, and lists what needs attention without personal info', () => {
    const result = {
      ...base, report_state: 'items_need_attention', attention_count: 3, primary_report_language: '3 items need attention',
      attention: [
        { kind: 'evidence_difference', field: 'date_of_birth', form: 'I-485', doc_type: 'birth_certificate', person_role: 'beneficiary',
          title: "The beneficiary's birth certificate (acta.pdf, page 3) shows date of birth 03/05/1995. The I-485 shows 05/03/1995." },
        { kind: 'check', rule_id: 'PS-101', rule_title: 'Edition date is current on every page.', form: null, title: 'The I-485 page 3 is the 01/20/25 edition.' },
        { kind: 'case_card_difference', field: 'a_number', forms: ['I-130'], person_role: 'petitioner', title: 'The package shows A-123456789.' },
      ],
    };
    const id = '11111111-2222-4333-8444-555555555555';
    const m = buildProofScanStageEmail(result, { portalUrl: 'https://portal.example.test', caseId: id, people });
    expect(m.subject).toBe('Proof Scan: REYES & MORALES: Physical Scan: 3 items need attention');
    expect(m.html).toContain(`https://portal.example.test/portal?ps2case=${id}#proof-scan-v2`);
    expect(m.html).toContain('The birth certificate and the I-485 differ on the beneficiary&#39;s date of birth.');
    expect(m.html).toContain('Not met: Edition date is current on every page');
    for (const secret of ['Lucia', 'Mateo', '1995', '03/05', '01/20/25', '123456789', 'acta.pdf', 'page 3']) expect(m.html, secret).not.toContain(secret);
    expect(m.subject).not.toContain('Lucia');
  });

  it('a clean result says it is good to go', () => {
    const m = buildProofScanStageEmail({ ...base, report_state: 'no_issues_found', attention_count: 0, primary_report_language: 'No issues found', attention: [] },
      { portalUrl: 'https://portal.example.test', people });
    expect(m.html).toContain('Good to go.');
  });

  it('every attention kind has a line built from its fields alone', () => {
    const kinds = ['missing_item', 'reference_difference', 'case_card_difference', 'evidence_difference', 'form_difference', 'translation', 'correction', 'not_carried', 'check', 'mystery'];
    const lines = stageSummaryLines({ ...base, attention: kinds.map((kind) => ({ kind, form: 'I-130', field: 'last_name', forms: ['I-130'], title: 'SECRET TITLE 1234' })), not_checked_count: 2 });
    expect(lines.length).toBeGreaterThanOrEqual(kinds.length);
    for (const l of lines) { expect(l).not.toContain('SECRET'); expect(l).not.toContain('['); }
  });
});

// ── G. Privacy ───────────────────────────────────────────────────────────────

describe('D-125, Q-57: nothing from the case leaves it', () => {
  async function issueRun(possible) {
    const caseId = addCase('general');
    addPerson(caseId, 'sponsor', { first_name: 'LUIS', last_name: 'GARCIA' }, { is_main: true });
    mockModel(vi, [observations({ forms: [form('I-864', { first_name: 'LUIS', last_name: 'GARCIA', date_of_birth: '04/04/1970' }, 'sponsor')], possible })]);
    return physical(caseId);
  }
  const issue = (over) => ({ title: 'Sponsor DOB differs', description: 'd', evidence: 'e', why_it_matters: 'w', uncertainty: 'u', reasoning_key: 'sponsor_dob', general_rule: null, ...over });

  it('the general rule wording is kept only when it carries nothing from the case', async () => {
    const r = await issueRun([
      issue({ reasoning_key: 'a', general_rule: "Check that a sponsor's date of birth matches the sponsor's own evidence." }),
      issue({ reasoning_key: 'b', general_rule: 'Check that Garcia was born on 04/04/1970.' }),
      issue({ reasoning_key: 'c', general_rule: 'Check LUIS against the evidence.' }),
    ]);
    expect(r.body.possible_issues.map((p) => p.general_rule)).toEqual(["Check that a sponsor's date of birth matches the sponsor's own evidence.", null, null]);
  });

  it('a reasoning key keeps its general words only, and a suppression stores that reasoning, never the headline', async () => {
    const r = await issueRun([issue({ title: 'GARCIA born 04/04/1970 differs', reasoning_key: 'garcia_dob_mismatch_1970' })]);
    const p = r.body.possible_issues[0];
    expect(p.reasoning_key).toBe('dob_mismatch');
    const d = await call(issueRoute, '/api/proof-scan-v2-possible-issue', { method: 'POST', body: { issue_id: p.id, action: 'dismiss', reason: 'never_suggest_reasoning' } });
    expect(d.status).toBe(200);
    expect(d.body.suppression).toMatchObject({ reasoning_key: 'dob_mismatch', label: 'Dob mismatch.' });
    expect(JSON.stringify(d.body.suppression)).not.toMatch(/GARCIA|1970/);
  });
});

// ── H. USCIS editions ────────────────────────────────────────────────────────

// The notice sentences as uscis.gov printed them on 2026-10-15 (public text).
const PAGE = {
  'G-28': '<div class="alert-message"><p>We will publish a new edition of this form soon. In the meantime, you may continue using the 09/17/18 and 05/23/18 editions despite the expiration date.</p></div><div>Form Details Edition Date 09/17/18</div>',
  'I-765': '<div class="alert-message"><p>Under a Sept. 14, 2026, order, USCIS continues to accept the 08/28/24 edition of Form I-539 and 08/21/25 edition of Form I-765 and is not accepting the 09/15/26 edition of Forms I-539 and I-765.</p></div><div>Edition Date 08/21/25</div>',
  'I-485': '<div class="alert-message"><p>On Sept. 18, 2026, USCIS published a revised edition of Form I-485 (edition date: 09/18/26). There is no grace period for the revised edition. Please note that USCIS will: Reject the 01/20/25 and 09/04/26 edition of Form I-485 if it is postmarked or electronically submitted on or after Sept. 18, 2026; and Only accept the 09/18/26 edition of Form I-485 if it is postmarked or electronically submitted on or after Sept. 18, 2026.</p></div><div>Edition Date 09/18/26</div>',
  'I-864': '<div class="alert-message"><p>On Aug. 31, 2026, USCIS published a new edition of Form I-864 (edition date: 08/24/26). USCIS is providing a 30-day grace period during which we will accept the 10/17/24 edition of Form I-864.</p><p>Beginning Oct. 1, 2026, we will only accept the 08/24/26 edition of Form I-864. USCIS will not process any 10/17/24 edition of Form I-864 postmarked or electronically submitted on or after Oct. 1, 2026.</p></div><div>Form Details Edition Date 08/24/26</div>',
};
const accepted = (form, published, on) => acceptedEditions({ published, ...parseEditionNotices(PAGE[form], form) }, on).editions;

describe('D-127: the editions USCIS accepts, read from its own page', () => {
  it('reads the four live examples of 2026-10-15', () => {
    expect(accepted('G-28', '09/17/18', '2026-10-15')).toEqual(['09/17/18', '05/23/18']);
    expect(accepted('I-765', '08/21/25', '2026-10-15')).toEqual(['08/21/25']);
    // Had the page published 09/15/26: the court order still means 08/21/25 only.
    expect(accepted('I-765', '09/15/26', '2026-10-15')).toEqual(['08/21/25']);
    expect(accepted('I-485', '09/18/26', '2026-10-15')).toEqual(['09/18/26']);
    expect(accepted('I-864', '08/24/26', '2026-10-15')).toEqual(['08/24/26']);
  });

  it('uses the scan date for grace periods', () => {
    expect(accepted('I-864', '08/24/26', '2026-09-30')).toEqual(['08/24/26', '10/17/24']);
    expect(accepted('I-864', '08/24/26', '2026-10-01')).toEqual(['08/24/26']);
    expect(accepted('I-485', '09/18/26', '2026-09-17')).toEqual(['09/18/26']);
  });

  it('an edition mentioned in a way not understood is flagged for a person, never guessed', () => {
    const html = '<div class="alert-message"><p>The 03/01/26 edition of Form I-131 may be filed by certain applicants described below.</p></div>';
    const n = parseEditionNotices(html, 'I-131');
    expect(n.unreadable).toEqual(['03/01/26']);
    expect(acceptedEditions({ published: '01/20/25', ...n }, '2026-10-15')).toEqual({ editions: ['01/20/25'], decided: false, unclear: true });
  });

  it('a run sends every accepted edition to the model, and asks staff to check an unclear notice', async () => {
    db.rows('form_editions').push(
      { form_number: 'G-28', pages: 4, edition_date: '09/17/18', upstream_edition: '09/17/18', check_status: 'current', edition_notices: parseEditionNotices(PAGE['G-28'], 'G-28') },
      { form_number: 'I-131', pages: 14, edition_date: '01/20/25', upstream_edition: '01/20/25', check_status: 'current', edition_notices: { statements: [], unreadable: ['03/01/26'], text: '' } },
    );
    const caseId = generalCase();
    const calls = mockModel(vi, [observations({ forms: [form('I-131', { first_name: 'ANA', last_name: 'RIVERA' })] })]);
    const r = await physical(caseId);
    expect(calls[0].body.system).toContain('G-28|4p|09/17/18 or 05/23/18');
    expect(confirmIds(r)).toContain('confirm:edition_alert:I131');
    expect(findings(r.body.result)).toEqual([]);
  });
});

describe('D-122, D-128: the edition check keeps the last good read, and staff can run it now', () => {
  function editionsDb() {
    db.rows('form_editions').push(
      { id: 'fe-1', form_number: 'G-28', pages: 4, edition_date: '09/17/18', upstream_edition: '09/17/18', check_status: 'current',
        edition_notices: parseEditionNotices(PAGE['G-28'], 'G-28'), last_checked_at: '2026-10-12T15:00:00Z' },
    );
  }

  it('a page that cannot be read keeps the last good edition and notices', async () => {
    editionsDb();
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 503 }));
    await runEditionCheck(ENV, db);
    const row = db.rows('form_editions')[0];
    expect(row.check_status).toBe('error');
    expect(row.upstream_edition).toBe('09/17/18');
    expect(row.edition_notices.statements.length).toBe(2);
  });

  it('a page that reads stores the notices it found', async () => {
    editionsDb();
    globalThis.fetch = vi.fn(async () => new Response(PAGE['G-28'], { status: 200 }));
    const out = await runEditionCheck(ENV, db);
    expect(out).toMatchObject({ checked: 1, unclear: [] });
    expect(db.rows('form_editions')[0].edition_notices.statements.map((s) => s.edition)).toEqual(['09/17/18', '05/23/18']);
  });

  it('the button: staff only, runs the check now, and not twice in a minute', async () => {
    editionsDb();
    helpersMock.verifyAuth.mockResolvedValueOnce(CLIENT);
    expect((await call(editionsRoute, '/api/proof-scan-v2-editions', { method: 'POST', body: {} })).status).toBe(403);
    globalThis.fetch = vi.fn(async () => new Response(PAGE['G-28'], { status: 200 }));
    const first = await call(editionsRoute, '/api/proof-scan-v2-editions', { method: 'POST', body: {} });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ checked: 1, changed: [], unclear: [] });
    expect((await call(editionsRoute, '/api/proof-scan-v2-editions', { method: 'POST', body: {} })).status).toBe(429);
  });
});
