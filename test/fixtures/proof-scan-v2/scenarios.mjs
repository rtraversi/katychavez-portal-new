// Canned AI answers for the Proof Scan v2 local preview. NOT PRODUCTION CODE.
//
// The preview runs the REAL v2 routes and the REAL server engine. Only the
// Anthropic call is replaced: this module answers it with synthetic
// observations, chosen from the uploaded filename and the stage, shaped exactly
// like the model's structured output (same schema, every asked ID answered).
// The server then decides the result from them, as it would in production.
//
// Every person, number and address here is invented. Never put real client
// data in a fixture.

import { FORM_VALUE_FIELDS, EVIDENCE_FACT_FIELDS, FACT_FIELDS } from '../../../functions/api/_proof-scan-v2-ai.js';

const ANA = {
  first_name: 'ANA', middle_name: 'MARIA', last_name: 'RIVERA', date_of_birth: '06/18/1994', a_number: 'A123456789',
  street: '2207 N 16th St', apt_type: 'Apt.', apt_number: '4', city: 'Phoenix', state: 'AZ', zip: '85006',
  phone: '(602) 555-0143', email: 'ana.rivera@example.test', ssn: '900-55-1234', ead_expiration: '11/14/2026',
};
const LUIS = {
  first_name: 'LUIS', middle_name: 'ALBERTO', last_name: 'GARCIA', date_of_birth: '01/09/1998', a_number: 'A208765432',
  street: '515 E Roosevelt St', apt_type: null, apt_number: null, city: 'Tempe', state: 'AZ', zip: '85281',
  phone: '(480) 555-0110', email: 'luis.garcia@example.test', ssn: '900-66-2211', ead_expiration: '03/02/2026',
};
const LUCIA = { first_name: 'LUCIA', middle_name: null, last_name: 'REYES', date_of_birth: '09/30/1993', a_number: 'A234567890',
  street: '1842 W Encanto Blvd', apt_type: 'Apt.', apt_number: '6', city: 'Phoenix', state: 'AZ', zip: '85007' };
const DANIEL = { first_name: 'DANIEL', middle_name: null, last_name: 'MORALES', date_of_birth: '02/11/1990', a_number: null,
  street: '1842 W Encanto Blvd', apt_type: 'Apt.', apt_number: '6', city: 'Phoenix', state: 'AZ', zip: '85007' };

const nulls = (fields) => Object.fromEntries(fields.map((f) => [f, null]));
const pick = (person, fields) => Object.fromEntries(fields.map((f) => [f, person[f] ?? null]));
const NAME = ['first_name', 'middle_name', 'last_name'];
const ADDRESS = ['street', 'apt_type', 'apt_number', 'city', 'state', 'zip'];

// ── Evidence Zero ────────────────────────────────────────────────────────────

function evidenceZeroAnswer(filename, general) {
  const f = filename.toLowerCase();
  const who = f.includes('garcia') || f.includes('luis') ? LUIS : ANA;
  const facts = (o) => ({ ...nulls(FACT_FIELDS), ...o });
  if (general) {
    if (f.includes('marriage')) {
      return { doc_type: 'marriage_certificate', read_quality: 'clear', unreadable_fields: [], issued_date: '05/20/2021',
        owner_roles: ['petitioner', 'beneficiary'], facts: facts({ marriage_date: '05/15/2021' }) };
    }
    const pet = f.includes('daniel') || f.includes('petitioner') || f.includes('morales');
    const p = pet ? DANIEL : LUCIA;
    return { doc_type: 'birth_certificate', read_quality: 'clear', unreadable_fields: [], issued_date: null,
      owner_roles: [pet ? 'petitioner' : 'beneficiary'], facts: facts(pick(p, [...NAME, 'date_of_birth'])) };
  }
  if (f.includes('damaged') || f.includes('blurry')) {
    return { doc_type: 'ead', read_quality: 'partial', unreadable_fields: ['a_number', 'ead_expiration'], issued_date: null,
      owner_roles: ['applicant'], facts: facts(pick(who, [...NAME, 'date_of_birth'])) };
  }
  if (f.includes('intake')) {
    const second = f.includes('updated') || f.includes('new');
    return { doc_type: 'intake', read_quality: 'clear', unreadable_fields: [], issued_date: second ? '09/28/2026' : '08/01/2026',
      owner_roles: ['applicant'],
      facts: facts({ ...pick(who, [...NAME, ...ADDRESS, 'phone', 'email', 'date_of_birth']), ssn: second ? '900-55-4321' : who.ssn }) };
  }
  const newer = f.includes('newer') || f.includes('renewed');
  return { doc_type: 'ead', read_quality: 'clear', unreadable_fields: [], issued_date: newer ? '09/30/2026' : '11/14/2024',
    owner_roles: ['applicant'],
    facts: facts({ ...pick(who, [...NAME, 'date_of_birth', 'a_number']), ead_expiration: newer ? '09/30/2028' : who.ead_expiration }) };
}

// ── Stage runs ───────────────────────────────────────────────────────────────

const values = (o) => ({ ...nulls(FORM_VALUE_FIELDS), ...o });
const evidenceFacts = (o) => ({ ...nulls(EVIDENCE_FACT_FIELDS), ...o });

// What each DACA form shows about the applicant. Fields a form has no box for are null.
function dacaForm(form, file, pages, p, over = {}) {
  const shape = {
    'G-1450': [...NAME, 'phone', 'email', ...ADDRESS],
    'G-1145': [...NAME, 'phone', 'email'],
    'G-28': [...NAME, 'a_number', ...ADDRESS, 'phone', 'email'],
    'I-821D': [...NAME, 'a_number', 'date_of_birth', 'ssn', ...ADDRESS],
    'I-765': [...NAME, 'a_number', 'date_of_birth', 'ssn', ...ADDRESS],
    'I-765WS': [...NAME, 'a_number'],
  }[form];
  return { form, file, pages, person_role: 'applicant', values: values({ ...pick(p, shape), ...over }) };
}

function stageAnswer({ caseType, stage, scope, form, files, ruleIds, itemIds, withMarkups }) {
  const general = caseType === 'general';
  const first = files[0]?.name || 'package.pdf';
  const who = /garcia|luis/i.test(files.map((f) => f.name).join(' ')) ? LUIS : ANA;
  const rules = {};
  const items = {};
  let forms = [];
  let evidence = [];
  let markups = [];
  const possible = [];

  if (general) {
    forms = [
      { form: 'I-130', file: first, pages: '1-12', person_role: 'petitioner', values: values(pick(DANIEL, [...NAME, 'date_of_birth', ...ADDRESS])) },
      { form: 'I-130A', file: first, pages: '13-18', person_role: 'beneficiary', values: values(pick(LUCIA, [...NAME, 'date_of_birth', ...ADDRESS])) },
      { form: 'I-485', file: first, pages: '19-38', person_role: 'beneficiary', values: values({ ...pick(LUCIA, [...NAME, 'a_number', ...ADDRESS]), date_of_birth: '09/03/1993' }) },
      { form: 'I-864', file: first, pages: '39-48', person_role: 'petitioner', values: values(pick(DANIEL, [...NAME, 'date_of_birth', ...ADDRESS])) },
      { form: 'I-765', file: first, pages: '49-55', person_role: 'beneficiary', values: values(pick(LUCIA, [...NAME, 'a_number', ...ADDRESS])) },
    ];
    if (stage === 'physical_scan') {
      // D-95: the evidence is inside the package. One deliberate difference (D-98):
      // the beneficiary's birth certificate says 09/30/1993; the I-485 says 09/03/1993.
      evidence = [
        { doc_type: 'birth_certificate', file: first, pages: '101-102', owner_roles: ['beneficiary'], read_quality: 'clear', facts: evidenceFacts(pick(LUCIA, [...NAME, 'date_of_birth'])) },
        { doc_type: 'birth_certificate', file: first, pages: '103-104', owner_roles: ['petitioner'], read_quality: 'clear', facts: evidenceFacts(pick(DANIEL, [...NAME, 'date_of_birth'])) },
        { doc_type: 'marriage_certificate', file: first, pages: '105', owner_roles: ['petitioner', 'beneficiary'], read_quality: 'clear', facts: evidenceFacts({ marriage_date: '05/15/2021' }) },
      ];
      possible.push({
        title: 'Tax transcript year may be out of date',
        description: 'The I-864 lists 2024 as the most recent tax year, and the transcript in the package is for 2023.',
        evidence: `${first}, pages 60-66`,
        why_it_matters: 'The sponsor usually provides the most recent tax year.',
        uncertainty: 'The 2024 return may not have been filed yet when the I-864 was signed.',
        reasoning_key: 'tax_year_recency',
      });
    }
  } else if (stage === 'draft_review') {
    const all = [
      dacaForm('G-1450', first, '1', who), dacaForm('G-1450', first, '2', who), dacaForm('G-1145', first, '3', who),
      dacaForm('G-28', first, '4-7', who), dacaForm('I-821D', first, '8-14', who),
      dacaForm('I-765', first, '15-21', who, { a_number: 'A123456798' }),
    ];
    forms = scope === 'individual' ? all.filter((f) => f.form === form).slice(0, 1) : all;
    if (scope === 'individual' && !forms.length) forms = [dacaForm(form, first, '1-7', who)].filter((f) => f.values);
    items['DACA-COMP-I765WS'] = 'missing';
    rules['PS-302'] = { status: 'needs_attention', summary: 'The A-Number on the I-765 is A-123456798. Every other form has A-123456789.', reason: 'Two digits are swapped on the I-765.', locations: ['I-765 page 1'] };
    rules['DACA-G28-003'] = { status: 'blank', reason: 'Part 3 does not say whether the EAD goes to the home or the office.' };
    rules['DACA-821D-009'] = { status: 'needs_attention', summary: 'The I-821D English question is answered NO.', reason: 'Part 5 item 1.a is marked NO.', locations: ['I-821D page 6'] };
    rules['PS-103'] = { status: 'not_checked', reason: 'Page 11 of the I-821D is too faint to tell whether it is blank.' };
    possible.push({
      title: 'Phone number written two ways',
      description: 'The G-28 shows the phone with a country code and the G-1450 does not.',
      evidence: `${first}, pages 1 and 5`,
      why_it_matters: 'Some reviewers read the two as different numbers.',
      uncertainty: 'The digits are the same, so it may not matter.',
      reasoning_key: 'phone_format_mismatch',
    });
  } else if (stage === 'preflight') {
    forms = [
      dacaForm('I-821D', first, '1-7', who, { apt_number: '14' }),
      dacaForm('I-765', first, '8-14', who),
      dacaForm('G-1450', first, '15', who),
    ];
    rules['DACA-G1450-004'] = { status: 'needs_attention', summary: 'The card expiration date is blank on the G-1450.', reason: 'Item 4 has no expiration date.', locations: ['G-1450 page 1'] };
    if (withMarkups) {
      markups = [
        { form: 'I-821D', page: '1', field: 'apt_number', original: '4', markup_read: '14', read_confidence: 'clear', corrected_page_present: true, corrected: '14' },
        { form: 'G-1450', page: '1', field: 'phone', original: '(602) 555-0143', markup_read: '(602) 555-0199', read_confidence: 'clear', corrected_page_present: false, corrected: null },
        { form: 'I-765', page: '2', field: 'city', original: 'Phoenix', markup_read: 'Phx?', read_confidence: 'uncertain', corrected_page_present: true, corrected: 'Phoenix' },
      ];
    }
  } else if (stage === 'physical_scan') {
    forms = [
      dacaForm('G-1450', first, '1', who, { phone: '(602) 555-0199' }), dacaForm('G-1450', first, '2', who),
      dacaForm('G-1145', first, '3', who), dacaForm('G-28', first, '4-7', who), dacaForm('I-821D', first, '8-14', who),
      dacaForm('I-765', first, '15-21', who), dacaForm('I-765WS', first, '22', who),
    ];
    evidence = [{ doc_type: 'ead', file: first, pages: '23-24', owner_roles: ['applicant'], read_quality: 'clear', facts: evidenceFacts(pick(who, [...NAME, 'date_of_birth', 'a_number'])) }];
    rules['DACA-765-007'] = { status: 'needs_attention', summary: 'Item 27 reads (c)(3), not (c)(33).', reason: 'The eligibility category is cut off.', locations: ['I-765 page 3'] };
    possible.push(
      { title: 'Attorney signed before the applicant', description: 'The G-28 attorney date is earlier than the applicant date.', evidence: `${first}, page 7`, why_it_matters: 'Order of signatures.', uncertainty: 'The firm does not require an order.', reasoning_key: 'signature_date_order' },
      { title: 'EAD copy may not be enlarged', description: 'The EAD copy looks close to actual size.', evidence: `${first}, pages 23-24`, why_it_matters: 'The checklist asks for an enlarged colour copy.', uncertainty: 'Scale is hard to judge from a scan.', reasoning_key: 'ead_copy_scale' },
    );
  }

  const out = {};
  if (ruleIds.length) {
    out.rule_results = ruleIds.map((rule_id) => {
      const o = rules[rule_id] || {};
      const status = o.status || 'clear';
      return { rule_id, status, summary: o.summary ?? null, locations: o.locations || [], evidence: o.evidence ?? null, reason: status === 'clear' ? null : (o.reason ?? 'Observed.') };
    });
  }
  if (itemIds.length) out.package_items = itemIds.map((item_id) => ({ item_id, status: items[item_id] || 'present', locations: items[item_id] ? [] : [`${first}`] }));
  out.forms_found = forms;
  out.evidence_found = evidence;
  if (withMarkups) out.markups = markups;
  out.possible_issues = possible;
  return out;
}

// ── The model, as the routes see it ─────────────────────────────────────────

export function modelAnswer(body) {
  const schema = body.output_config?.format?.schema || {};
  const system = String(body.system || '');
  const general = /Case type, chosen by the firm: General/.test(system);
  const texts = (body.messages?.[0]?.content || []).filter((b) => b.type === 'text').map((b) => b.text);
  if ((schema.required || []).includes('doc_type')) {
    const name = (texts.join(' ').match(/File: (.+?)\. Read this one document/) || [])[1] || 'document.pdf';
    return evidenceZeroAnswer(name, general);
  }
  const stage = /Stage: Draft Review/.test(system) ? 'draft_review' : /Stage: Pre-flight/.test(system) ? 'preflight' : 'physical_scan';
  const scope = /Scope: one form only/.test(system) ? 'individual' : 'whole';
  const form = (system.match(/one form only, the (.+?)\. Ignore/) || [])[1] || null;
  const files = texts.map((tx) => tx.match(/^File \d+: (.+) \((\w+)\)$/)).filter(Boolean).map((m) => ({ name: m[1], kind: m[2] }));
  const props = schema.properties || {};
  return stageAnswer({
    caseType: general ? 'general' : 'daca_renewal', stage, scope, form, files,
    ruleIds: props.rule_results?.items?.properties?.rule_id?.enum || [],
    itemIds: props.package_items?.items?.properties?.item_id?.enum || [],
    withMarkups: Boolean(props.markups),
  });
}

// Sample files the preview offers for download. Any PDF works; these names
// pick a scenario. The content is a tiny synthetic PDF.
export const SAMPLES = {
  'DACA, Evidence Zero': ['ead-ana-rivera.pdf', 'intake-ana-rivera.pdf', 'ead-newer-ana-rivera.pdf', 'intake-updated-ana-rivera.pdf', 'ead-damaged.pdf'],
  'DACA, stages': ['daca-drafts.pdf', 'corrected-forms.pdf', 'client-markups.pdf', 'corrected-pages.pdf', 'final-package-scan.pdf'],
  'General': ['birth-certificate-lucia.pdf', 'birth-certificate-daniel.pdf', 'marriage-certificate.pdf', 'aos-package-scan.pdf'],
  'Size limit': ['too-big-13mb.pdf'],
};

export function samplePdf(name) {
  if (name === 'too-big-13mb.pdf') {
    const head = Buffer.from('%PDF-1.4\n% synthetic oversize sample\n');
    return Buffer.concat([head, Buffer.alloc(13 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF\n')]);
  }
  return Buffer.from(`%PDF-1.4\n% Proof Scan v2 preview sample: ${name}\n% Synthetic. Contains no client data.\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
}
