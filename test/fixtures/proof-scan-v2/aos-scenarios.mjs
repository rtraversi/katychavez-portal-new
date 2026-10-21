// AOS scenarios for the Proof Scan v2 local preview (v2.1). NOT PRODUCTION CODE.
//
// Canned model OBSERVATIONS only, shaped exactly like the real structured
// output. The real routes and the real engine decide every result from them
// (D-18): nothing here is a pre-made report. The four cases reproduce the
// approved mockup (2026-10-16): SANTOS & VEGA, REYES (Miguel & Carmen), NGUYEN
// & TRAN, OKAFOR & BELLO. Every person, number, address and date is invented.

import { FORM_VALUE_FIELDS, EVIDENCE_FACT_FIELDS, FACT_FIELDS } from '../../../functions/api/_proof-scan-v2-ai.js';

const nulls = (fields) => Object.fromEntries(fields.map((f) => [f, null]));
const values = (o) => ({ ...nulls(FORM_VALUE_FIELDS), ...o });
const evFacts = (o) => ({ ...nulls(EVIDENCE_FACT_FIELDS), ...o });
const pick = (p, fields) => Object.fromEntries(fields.map((f) => [f, p[f] ?? null]));
const NAME = ['first_name', 'middle_name', 'last_name'];
const ADDRESS = ['street', 'apt_type', 'apt_number', 'city', 'state', 'zip'];
const english = { language: 'English', has_english_translation: true };
// A document from a country that writes the day first prints its dates that
// way (D-117): the engine reads them by the issuing country.
const dmy = (v) => (v ? v.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$2/$1/$3') : v);
const dayFirst = (facts) => Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, /date|expiration|birth/.test(k) && typeof v === 'string' ? dmy(v) : v]));

// OKAFOR & BELLO: the applicant turns 79 seventeen days after today, whenever
// the preview runs (Q-64 guard 2: within a month of a cutoff is a gentle confirm).
function turns79Soon() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 17);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear() - 79}`;
}

export const PEOPLE = {
  santos: {
    beneficiary: { first_name: 'ELENA', middle_name: 'SOFIA', last_name: 'VEGA', married_last: 'SANTOS', date_of_birth: '11/03/1991', street: '412 Oak Hollow Dr', apt_type: null, apt_number: null, city: 'Raleigh', state: 'NC', zip: '27610', phone: '(919) 555-0142', email: 'elena.vega@example.test', country_of_birth: 'MEXICO', country_of_citizenship: 'MEXICO', a_number: 'A214365870', passport_number: 'G12345678', passport_expiration: '06/30/2029', last_entry_date: '07/15/2019', port_of_entry: 'ATLANTA, GA', i94_number: '987654321A1', marriage_date: '02/18/2023', marriage_place: 'RALEIGH, NC' },
    petitioner: { first_name: 'MARCO', middle_name: 'ANTONIO', last_name: 'SANTOS', date_of_birth: '04/12/1988', street: '412 Oak Hollow Dr', apt_type: null, apt_number: null, city: 'Raleigh', state: 'NC', zip: '27610', phone: '(919) 555-0187', email: 'marco.santos@example.test', country_of_birth: 'UNITED STATES', country_of_citizenship: 'UNITED STATES', employer: 'TRIANGLE TILE CO', marriage_date: '02/18/2023', marriage_place: 'RALEIGH, NC' },
    joint_sponsor: { first_name: 'ROSA', middle_name: 'ISABEL', last_name: 'SANTOS', date_of_birth: '08/09/1962', street: '9 Pine Ridge Rd', city: 'Durham', state: 'NC', zip: '27703', phone: '(919) 555-0120', email: 'rosa.santos@example.test' },
  },
  reyes: {
    beneficiary: { first_name: 'CARMEN', middle_name: 'LUZ', last_name: 'REYES', date_of_birth: '06/21/1965', street: '88 Birch Ln', city: 'Charlotte', state: 'NC', zip: '28205', phone: '(704) 555-0133', email: 'carmen.reyes@example.test', country_of_birth: 'EL SALVADOR', country_of_citizenship: 'EL SALVADOR', passport_number: 'B7654321', passport_expiration: '09/14/2030' },
    petitioner: { first_name: 'MIGUEL', middle_name: null, last_name: 'REYES', date_of_birth: '01/14/1990', street: '88 Birch Ln', city: 'Charlotte', state: 'NC', zip: '28205', phone: '(704) 555-0166', email: 'miguel.reyes@example.test', country_of_birth: 'UNITED STATES', country_of_citizenship: 'UNITED STATES' },
  },
  nguyen: {
    beneficiary: { first_name: 'MINH', middle_name: 'ANH', last_name: 'TRAN', date_of_birth: '03/02/2014', street: '15 Elm Ct', city: 'Cary', state: 'NC', zip: '27511', phone: '(919) 555-0171', email: 'linh.nguyen@example.test', country_of_birth: 'VIETNAM', country_of_citizenship: 'VIETNAM', passport_number: 'C1122334', passport_expiration: '01/10/2031' },
    petitioner: { first_name: 'LINH', middle_name: 'THI', last_name: 'NGUYEN', date_of_birth: '09/30/1984', street: '15 Elm Ct', city: 'Cary', state: 'NC', zip: '27511', phone: '(919) 555-0171', email: 'linh.nguyen@example.test', country_of_birth: 'VIETNAM', country_of_citizenship: 'UNITED STATES' },
  },
  okafor: {
    beneficiary: { first_name: 'GRACE', middle_name: 'ADAEZE', last_name: 'BELLO', date_of_birth: turns79Soon(), street: '300 Lakeview Dr', city: 'Raleigh', state: 'NC', zip: '27609', phone: '(919) 555-0150', email: 'grace.bello@example.test', country_of_birth: 'NIGERIA', country_of_citizenship: 'NIGERIA', passport_number: 'A0099887', passport_expiration: '12/01/2030', marriage_date: '05/04/2024', marriage_place: 'LAGOS, NIGERIA' },
    petitioner: { first_name: 'CHIDI', middle_name: null, last_name: 'OKAFOR', date_of_birth: '02/17/1955', street: '300 Lakeview Dr', city: 'Raleigh', state: 'NC', zip: '27609', phone: '(919) 555-0151', email: 'chidi.okafor@example.test', country_of_birth: 'NIGERIA', country_of_citizenship: 'UNITED STATES', marriage_date: '05/04/2024', marriage_place: 'LAGOS, NIGERIA' },
  },
};

export const caseOf = (name) => {
  const n = String(name || '').toLowerCase();
  return ['santos', 'reyes', 'nguyen', 'okafor'].find((k) => n.includes(k)) || null;
};

// ── Evidence Zero ────────────────────────────────────────────────────────────
export function aosEvidenceZero(filename) {
  const f = filename.toLowerCase();
  const c = caseOf(f) || 'santos';
  const P = PEOPLE[c];
  const facts = (o) => ({ ...nulls(FACT_FIELDS), ...o });
  const base = { read_quality: 'clear', unreadable_fields: [], issued_date: null, doc_title: null, people: [] };
  if (f.includes('marriage')) {
    // The marriage certificate spells the bride's middle name SOPHIA: proposed
    // to her card as a suggestion (D-55), and counted as two documents that
    // disagree at Physical Scan (Q-61 follow-up).
    return { ...base, doc_type: 'marriage_certificate', issuing_country: 'United States', language: 'English', owner_roles: ['petitioner', 'beneficiary'],
      facts: facts({ marriage_date: P.beneficiary.marriage_date, marriage_place: 'WAKE COUNTY, NC' }),
      people: [
        { role: 'beneficiary', first_name: 'ELENA', middle_name: 'SOPHIA', last_name: 'VEGA', date_of_birth: null },
        { role: 'petitioner', first_name: 'MARCO', middle_name: 'ANTONIO', last_name: 'SANTOS', date_of_birth: null },
      ] };
  }
  if (f.includes('passport')) {
    return { ...base, doc_type: 'passport', issuing_country: 'Mexico', language: 'Spanish', owner_roles: ['beneficiary'],
      facts: facts(dayFirst({ ...pick(P.beneficiary, ['first_name', 'last_name', 'date_of_birth', 'passport_number']), expiration_date: P.beneficiary.passport_expiration })) };
  }
  if (f.includes('i94') || f.includes('i-94')) {
    return { ...base, doc_type: 'i94', issuing_country: 'United States', language: 'English', owner_roles: ['beneficiary'],
      facts: facts({ ...pick(P.beneficiary, ['first_name', 'last_name', 'i94_number', 'port_of_entry']), last_entry_date: '07/14/2019' }) };
  }
  if (f.includes('naturalization')) {
    return { ...base, doc_type: 'naturalization_certificate', issuing_country: 'United States', language: 'English', owner_roles: ['joint_sponsor'],
      facts: facts(pick(P.joint_sponsor, [...NAME, 'date_of_birth'])) };
  }
  const pet = f.includes('marco') || f.includes('petitioner');
  const p = pet ? P.petitioner : P.beneficiary;
  return { ...base, doc_type: 'birth_certificate', issuing_country: pet ? 'United States' : 'Mexico', language: pet ? 'English' : 'Spanish',
    owner_roles: [pet ? 'petitioner' : 'beneficiary'], facts: facts(pet ? pick(p, [...NAME, 'date_of_birth', 'country_of_birth']) : dayFirst(pick(p, [...NAME, 'date_of_birth', 'country_of_birth']))) };
}

// ── Stage runs ───────────────────────────────────────────────────────────────

const pay = (method, fee_for, amount, payer, card, file, pages) => ({
  method, fee_for, amount, payer_name: payer ? `${payer.first_name} ${payer.last_name}` : null,
  cardholder_name: card?.name ?? null, cardholder_phone: card?.phone ?? null, cardholder_email: card?.email ?? null, file, pages,
});
const lang = (form, o) => ({ form, has_boxes: form !== 'I-485', english_box: form !== 'I-485', interpreter_box: false, interpreter_section_filled: false, interpreter_signed_dated: 'not_applicable', ...o });
// The I-485 Part 9 answers every scan reports (D-138 tally): counts only.
const SECURITY_NO = [['43.b', 'committed hijacking or sabotage'], ['44', 'intend terrorist activity'], ['53.a', 'ever committed torture'], ['53.b', 'ever committed genocide'], ['30', 'ever engaged in prostitution']];
const answers = (over = {}) => [
  ...SECURITY_NO.map(([item, topic]) => ({ form: 'I-485', item, topic, answer: over[item] || 'no' })),
  { form: 'I-485', item: '23', topic: 'ever committed a crime of any kind', answer: over['23'] || 'no' },
];

function formsFor(c, file, stage, over = {}) {
  const P = PEOPLE[c];
  const ben = { ...P.beneficiary, last_name: P.beneficiary.married_last || P.beneficiary.last_name };
  const pet = P.petitioner;
  const PERSON = [...NAME, 'date_of_birth', ...ADDRESS, 'phone', 'email', 'country_of_birth', 'country_of_citizenship'];
  const forms = [
    { form: 'G-1450', file, pages: '1', person_role: 'petitioner', values: values(pick(pet, NAME)) },
    { form: 'G-1450', file, pages: '2', person_role: 'beneficiary', values: values(pick(ben, NAME)) },
    { form: 'G-1450', file, pages: '3', person_role: 'beneficiary', values: values(pick(ben, NAME)) },
    { form: 'G-1145', file, pages: '4', person_role: 'petitioner', values: values(pick(pet, [...NAME, 'phone', 'email'])) },
    { form: 'G-28', file, pages: '5-8', person_role: 'petitioner', values: values(pick(pet, [...NAME, ...ADDRESS, 'phone', 'email'])) },
    { form: 'G-28', file, pages: '9-12', person_role: 'beneficiary', values: values(pick(ben, [...NAME, ...ADDRESS, 'phone', 'email'])) },
    { form: 'I-130', file, pages: '13-24', person_role: 'petitioner', values: values(pick(pet, [...PERSON, 'marriage_date', 'marriage_place'])) },
    { form: 'I-485', file, pages: '31-54', person_role: 'beneficiary', values: values({ ...pick(ben, [...PERSON, 'a_number', 'passport_number', 'passport_expiration', 'last_entry_date', 'port_of_entry', 'i94_number']), ...(over['I-485'] || {}) }) },
    { form: 'I-765', file, pages: '55-61', person_role: 'beneficiary', values: values({ ...pick(ben, [...PERSON, 'a_number']), ...(over['I-765'] || {}) }) },
    { form: 'I-864', file, pages: '62-73', person_role: 'petitioner', values: values(pick(pet, [...NAME, 'date_of_birth', ...ADDRESS, 'phone', 'email'])) },
  ];
  if (c === 'santos' || c === 'okafor') forms.splice(7, 0, { form: 'I-130A', file, pages: '25-30', person_role: 'beneficiary', values: values(pick(ben, [...NAME, ...ADDRESS, 'date_of_birth', 'marriage_date', 'marriage_place'])) });
  if (c === 'santos' && stage === 'physical_scan') forms.push({ form: 'I-864', file, pages: '74-85', person_role: 'joint_sponsor', values: values(pick(P.joint_sponsor, [...NAME, 'date_of_birth', ...ADDRESS, 'phone', 'email'])) });
  return forms;
}

export function aosStageAnswer({ stage, files, ruleIds, itemIds, withMarkups, withPages }) {
  const first = files[0]?.name || 'package.pdf';
  const c = caseOf(files.map((f) => f.name).join(' ')) || 'santos';
  const P = PEOPLE[c];
  const rules = {};
  const items = {};
  let forms = [];
  let evidence = [];
  let markups = [];
  const possible = [];
  const pages = [];
  const card = (p, phone) => ({ name: `${p.first_name} ${p.last_name}`, phone: phone ?? p.phone, email: p.email });
  let aos = { i130_relationship: 'spouse', petitioner_citizenship: 'birth', prior_divorce_listed: 'no', fee_payments: [], language_statements: [], yes_no_answers: [] };

  if (c === 'santos') {
    const ben = P.beneficiary;
    const pet = P.petitioner;
    // The I-485 and I-765 give her date of birth day first: 03/11/1991 (the
    // birth certificate and the case card say 11/03/1991).
    forms = formsFor(c, first, stage, { 'I-485': { date_of_birth: '03/11/1991' }, 'I-765': { date_of_birth: '03/11/1991' } });
    aos = {
      ...aos,
      fee_payments: [
        pay('g1450', 'I-130', '$675.00', pet, stage === 'draft_review' ? null : card(pet), first, '1'),
        // Q-64: $950 is the under-14 fee; she is 34.
        pay('g1450', 'I-485', '$950.00', { ...ben, last_name: 'SANTOS' }, stage === 'draft_review' ? null : card(pet), first, '2'),
        // D-134: MARCO SANTSO looks like a misspelling of the petitioner.
        pay('g1450', 'I-765', '$260.00', { ...ben, last_name: 'SANTOS' }, stage === 'draft_review' ? null : { name: 'MARCO SANTSO', phone: stage === 'preflight' ? '(919) 555-0199' : pet.phone, email: pet.email }, first, '3'),
        ...(stage === 'physical_scan' ? [pay('money_order', 'unknown', '$85.00', null, null, first, '120')] : []),
      ],
      language_statements: [
        lang('I-130A', stage === 'draft_review' ? {} : { english_box: false, interpreter_box: true, interpreter_section_filled: stage === 'physical_scan', interpreter_signed_dated: stage === 'physical_scan' ? 'yes' : 'not_applicable' }),
        lang('I-485'), lang('I-765'),
      ],
      yes_no_answers: stage === 'physical_scan' ? answers() : [],
    };
    if (stage === 'preflight') {
      rules['AOS-G1450-CARD'] = { status: 'needs_attention', summary: 'The card expiration date is blank on the I-485 fee G-1450.', locations: ['G-1450 page 2'] };
      // The client corrected her phone on the I-485; the I-765 still has the old one.
      forms = forms.map((f) => (f.form === 'I-485' ? { ...f, values: { ...f.values, phone: '(919) 555-0143' } } : f));
      if (withMarkups) {
        markups = [
          { form: 'I-485', page: '2', field: 'phone', original: ben.phone, markup_read: '(919) 555-0143', read_confidence: 'clear', corrected_page_present: true, corrected: '(919) 555-0143' },
          { form: 'I-130', page: '2', field: 'country', original: '', markup_read: 'United States', read_confidence: 'clear', corrected_page_present: true, corrected: '' },
        ];
      }
    }
    if (stage === 'physical_scan') {
      rules['AOS-G28A-001'] = { status: 'needs_attention', summary: "The Applicant box is not ticked on the applicant's G-28.", locations: ['G-28 page 10'] };
      rules['AOS-G28A-003'] = { status: 'needs_attention', summary: 'The office box is ticked for card delivery.', locations: ['G-28 page 11'] };
      rules['AOS-864J-003'] = { status: 'needs_attention', summary: "The co-sponsor's I-864 is not signed.", locations: ['I-864 page 83'] };
      items['AOS-E-W2-J'] = 'missing';
      items['AOS-E-VISA'] = 'missing';
      evidence = [
        { doc_type: 'birth_certificate', file: first, pages: '90-91', owner_roles: ['beneficiary'], read_quality: 'clear', language: 'Spanish', has_english_translation: true, issuing_country: 'Mexico', doc_title: 'Acta de Nacimiento', facts: evFacts(dayFirst(pick(ben, [...NAME, 'date_of_birth', 'country_of_birth']))), people: [] },
        { doc_type: 'birth_certificate', file: first, pages: '92', owner_roles: ['petitioner'], read_quality: 'clear', ...english, issuing_country: 'United States', doc_title: null, facts: evFacts(pick(pet, [...NAME, 'date_of_birth'])), people: [] },
        { doc_type: 'marriage_certificate', file: first, pages: '93', owner_roles: ['petitioner', 'beneficiary'], read_quality: 'clear', ...english, issuing_country: 'United States', doc_title: null,
          facts: evFacts({ marriage_date: ben.marriage_date, marriage_place: 'WAKE COUNTY, NC' }),
          people: [{ role: 'beneficiary', first_name: 'ELENA', middle_name: 'SOPHIA', last_name: 'VEGA', date_of_birth: null }, { role: 'petitioner', first_name: 'MARCO', middle_name: 'ANTONIO', last_name: 'SANTOS', date_of_birth: null }] },
        { doc_type: 'passport', file: first, pages: '94', owner_roles: ['beneficiary'], read_quality: 'clear', language: 'Spanish', has_english_translation: false, issuing_country: 'Mexico', doc_title: null, facts: evFacts(dayFirst({ ...pick(ben, ['first_name', 'last_name', 'passport_number']), expiration_date: ben.passport_expiration })), people: [] },
        { doc_type: 'i94', file: first, pages: '95', owner_roles: ['beneficiary'], read_quality: 'clear', ...english, issuing_country: 'United States', doc_title: null, facts: evFacts({ ...pick(ben, ['first_name', 'i94_number', 'port_of_entry']), last_entry_date: '07/14/2019' }), people: [] },
        { doc_type: 'naturalization_certificate', file: first, pages: '96', owner_roles: ['joint_sponsor'], read_quality: 'clear', ...english, issuing_country: 'United States', doc_title: null, facts: evFacts(pick(P.joint_sponsor, [...NAME, 'date_of_birth'])), people: [] },
      ];
      pages.push({ kind: 'duplicate', file: first, pages: '80, 81' });
      possible.push({ title: "The petitioner's employer letter may be out of date", description: 'The employer letter in the package is dated more than six months before the I-864 was signed.', evidence: `${first}, page 101`, why_it_matters: 'An older letter may not show current employment.', uncertainty: 'The firm may accept a letter of this age.', reasoning_key: 'employer_letter_recency', general_rule: "Check that an employer letter is recent relative to the sponsor's signature." });
    }
    if (stage === 'draft_review') aos.language_statements = [lang('I-130A'), lang('I-485'), lang('I-765')];
  } else if (c === 'reyes') {
    forms = formsFor(c, first, stage);
    // D-131: the relationship box says Spouse on a child-to-parent case.
    aos = { ...aos, i130_relationship: 'spouse', fee_payments: [
      pay('g1450', 'I-130', '$675', P.petitioner, card(P.petitioner), first, '1'),
      pay('g1450', 'I-485', '$1,440', P.beneficiary, card(P.petitioner), first, '2'),
      pay('g1450', 'I-765', '$260', P.beneficiary, card(P.petitioner), first, '3'),
    ], language_statements: [lang('I-485'), lang('I-765')], yes_no_answers: answers() };
    items['AOS-E-VISA'] = 'present';
    evidence = [
      { doc_type: 'birth_certificate', file: first, pages: '90', owner_roles: ['beneficiary'], read_quality: 'clear', language: 'Spanish', has_english_translation: true, issuing_country: 'El Salvador', doc_title: null, facts: evFacts(dayFirst(pick(P.beneficiary, [...NAME, 'date_of_birth']))), people: [] },
      { doc_type: 'birth_certificate', file: first, pages: '91', owner_roles: ['petitioner'], read_quality: 'clear', ...english, issuing_country: 'United States', doc_title: null, facts: evFacts(pick(P.petitioner, [...NAME, 'date_of_birth'])), people: [] },
      { doc_type: 'passport', file: first, pages: '92', owner_roles: ['beneficiary'], read_quality: 'clear', ...english, issuing_country: 'El Salvador', doc_title: null, facts: evFacts(dayFirst({ ...pick(P.beneficiary, ['first_name', 'last_name', 'passport_number']), passport_expiration: P.beneficiary.passport_expiration })), people: [] },
    ];
  } else if (c === 'nguyen') {
    forms = formsFor(c, first, stage);
    aos = { ...aos, i130_relationship: 'child', petitioner_citizenship: 'naturalization', fee_payments: [
      pay('g1450', 'I-130', '$675', P.petitioner, card(P.petitioner), first, '1'),
      // Under 14: only that an I-485 fee is there (Q-64 as amended).
      pay('g1450', 'I-485', '$950', P.beneficiary, card(P.petitioner), first, '2'),
      pay('g1450', 'I-765', '$260', P.beneficiary, card(P.petitioner), first, '3'),
    ], language_statements: [
      // Q-67: the I-485's interpreter section is filled but not signed (the
      // 09/18/26 edition has no boxes); the I-765 has English ticked and the
      // interpreter section filled.
      lang('I-485', { interpreter_section_filled: true, interpreter_signed_dated: 'no' }),
      lang('I-765', { english_box: true, interpreter_section_filled: true, interpreter_signed_dated: 'yes' }),
    ], yes_no_answers: answers() };
    items['AOS-E-VISA'] = 'missing';
    evidence = [
      { doc_type: 'birth_certificate', file: first, pages: '90', owner_roles: ['beneficiary'], read_quality: 'clear', language: 'Vietnamese', has_english_translation: true, issuing_country: 'Vietnam', doc_title: null, facts: evFacts(dayFirst(pick(P.beneficiary, [...NAME, 'date_of_birth']))), people: [] },
      { doc_type: 'naturalization_certificate', file: first, pages: '91', owner_roles: ['petitioner'], read_quality: 'clear', ...english, issuing_country: 'United States', doc_title: null, facts: evFacts(pick(P.petitioner, [...NAME, 'date_of_birth'])), people: [] },
    ];
  } else {
    forms = formsFor(c, first, stage);
    aos = { ...aos, prior_divorce_listed: 'yes', fee_payments: [
      // Q-63: a G-1650 is not an error.
      pay('g1650', 'I-130', '$675', P.petitioner, { name: 'CHIDI OKAFOR', phone: null, email: null }, first, '1'),
      pay('g1450', 'I-485', '$1,440', P.beneficiary, card(P.petitioner), first, '2'),
      pay('g1450', 'I-765', '$260', P.beneficiary, card(P.petitioner), first, '3'),
    ], language_statements: [lang('I-130A'), lang('I-485'), lang('I-765')], yes_no_answers: answers({ 44: 'yes' }) };
    // Item 44 (terrorist activity) is answered Yes: only counted in the answer tally (D-138), never flagged (D-148).
    // Q-72: the I-130A lists an earlier marriage ended by divorce; no divorce certificate.
    items['AOS-E-DIV'] = 'missing';
    evidence = [
      { doc_type: 'birth_certificate', file: first, pages: '90', owner_roles: ['beneficiary'], read_quality: 'clear', ...english, issuing_country: 'Nigeria', doc_title: null, facts: evFacts(dayFirst(pick(P.beneficiary, [...NAME, 'date_of_birth']))), people: [] },
      { doc_type: 'birth_certificate', file: first, pages: '91', owner_roles: ['petitioner'], read_quality: 'clear', ...english, issuing_country: 'Nigeria', doc_title: null, facts: evFacts(dayFirst(pick(P.petitioner, [...NAME, 'date_of_birth']))), people: [] },
      // Q-56: a marriage abroad; the place is never compared.
      { doc_type: 'marriage_certificate', file: first, pages: '92', owner_roles: ['petitioner', 'beneficiary'], read_quality: 'clear', ...english, issuing_country: 'Nigeria', doc_title: null, facts: evFacts(dayFirst({ marriage_date: P.beneficiary.marriage_date, marriage_place: 'IKEJA, LAGOS' })), people: [] },
      // D-100 #5: an expired I-94 is a Possible issue.
      { doc_type: 'i94', file: first, pages: '93', owner_roles: ['beneficiary'], read_quality: 'clear', ...english, issuing_country: 'United States', doc_title: null, facts: evFacts({ first_name: 'GRACE', last_name: 'BELLO', expiration_date: '03/01/2025' }), people: [] },
    ];
  }

  const out = {};
  if (ruleIds.length) {
    out.rule_results = ruleIds.map((rule_id) => {
      const o = rules[rule_id] || {};
      const status = o.status || 'clear';
      return { rule_id, status, summary: o.summary ?? null, locations: o.locations || [], evidence: null, reason: status === 'clear' ? null : (o.reason ?? 'Observed.') };
    });
  }
  if (itemIds.length) out.package_items = itemIds.map((item_id) => ({ item_id, status: items[item_id] || 'present', locations: items[item_id] === 'missing' ? [] : [first] }));
  out.forms_found = forms;
  out.evidence_found = evidence;
  if (withMarkups) out.markups = markups;
  if (withPages) out.page_problems = pages;
  out.possible_issues = possible;
  out.aos = aos;
  return out;
}

export const AOS_SAMPLES = {
  'AOS, SANTOS & VEGA': ['santos-birth-certificate-elena.pdf', 'santos-birth-certificate-marco.pdf', 'santos-marriage-certificate.pdf', 'santos-passport-elena.pdf', 'santos-i94-elena.pdf', 'santos-naturalization-rosa.pdf', 'santos-drafts.pdf', 'santos-preflight-forms.pdf', 'santos-client-markups.pdf', 'santos-corrected-pages.pdf', 'santos-final-package.pdf'],
  'AOS, the other three': ['reyes-final-package.pdf', 'nguyen-tran-final-package.pdf', 'okafor-bello-final-package.pdf'],
};
