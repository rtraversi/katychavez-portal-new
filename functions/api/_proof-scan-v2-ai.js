// _proof-scan-v2-ai.js: what Proof Scan v2 asks the model, and how the answer is
// checked. NOT a route.
//
// Raw fetch with output_config.format json_schema, as v1.2 did. The model is
// the `proof` role in _models.js (Sonnet 5.5 by default, MODEL_PROOF to pin a
// portal), never a string here, so retiring a model is a config change.
//
// The call streams. A non-streaming call over a large package is what produced
// the 524s on the live checker; streaming keeps bytes moving for the whole
// generation and is what makes a large max_tokens safe. Current models think
// by default and thinking counts against max_tokens, so budgets are generous.
// Only text deltas are collected, so a leading thinking block never reaches
// the JSON parse.
//
// The model reports OBSERVATIONS ONLY (D-18). It never decides severity,
// wording, counts, the report state, what fills a record, or what is a
// difference. Every answer is validated against a closed schema before the
// server reads a single field of it; anything malformed fails closed.

import { z } from 'zod';
import {
  DOC_TYPES, ROLES, REFERENCE_FIELDS, ROLE_LABELS, formatName,
} from './_proof-scan-v2-common.js';
import { modelFor } from './_models.js';
import { readSseStream } from '../utils/anthropic-stream.js';

const API_URL = 'https://api.anthropic.com/v1/messages';

// Generous: a stage run over a 100+ page package streams for minutes. Kept
// under the job sweeper's stuck threshold (_proof-scan-v2-job.js).
const MODEL_TIMEOUT_MS = 9 * 60_000;

// Models that accept server-side refusal fallback. A safety-classifier false
// positive on an immigration package then reroutes inside the same call rather
// than failing the run. Any other model (a portal pinning MODEL_PROOF to
// something older) is sent the plain request, which those models accept.
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function modelRequest(env, { system, content, schema, maxTokens }) {
  const model = modelFor('proof', env);
  const headers = {
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  const body = {
    model,
    max_tokens: maxTokens,
    stream: true,
    system,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content }],
  };
  if (FALLBACK_MODELS.has(model)) {
    headers['anthropic-beta'] = FALLBACK_BETA;
    body.fallbacks = 'default';
  }
  return { model, headers, body };
}

// ── Wire format ──────────────────────────────────────────────────────────────
// Structured outputs reject a schema with more than 16 union-typed parameters
// (`anyOf [x, null]` counts as one each), and the schemas below carry 31-52.
// They stay the source of truth: the validators and the engine read them.
// Only the copy sent to the API is rewritten, and the answer is decoded back
// before anything validates it:
//  - an object whose fields are ALL nullable strings becomes a list of
//    { field, value } entries. A field left out decodes to null; "" stays "",
//    because on a form null (no such field) and "" (blank field) differ (D-11).
//  - any other nullable string or enum becomes a plain string; "" decodes to null.
const nonNull = (s) => s?.anyOf?.length === 2 && s.anyOf.some((b) => b.type === 'null')
  ? s.anyOf.find((b) => b.type !== 'null') : null;
const isFieldMap = (s) => s?.type === 'object' && s.properties
  && Object.values(s.properties).every((p) => nonNull(p)?.type === 'string' && !nonNull(p).enum);
const withNote = (description, note) => (description ? `${description} ${note}` : note);

export function toWireSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const inner = nonNull(s);
  if (inner) {
    const out = { ...toWireSchema(inner), description: withNote(s.description, 'Use "" for none.') };
    if (out.enum) out.enum = [...out.enum, ''];
    return out;
  }
  if (isFieldMap(s)) {
    const fields = Object.keys(s.properties);
    const notes = fields.map((f) => `- ${f}: ${s.properties[f].description || f.replace(/_/g, ' ')}`).join('\n');
    return {
      type: 'array',
      description: withNote(s.description, `One entry per field that has a value; leave a field out for null. Fields:\n${notes}`),
      items: {
        type: 'object', additionalProperties: false, required: ['field', 'value'],
        properties: { field: { type: 'string', enum: fields }, value: { type: 'string' } },
      },
    };
  }
  if (s.type === 'object' && s.properties) {
    return { ...s, properties: Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toWireSchema(v)])) };
  }
  if (s.type === 'array' && s.items) return { ...s, items: toWireSchema(s.items) };
  return s;
}

// Decodes an answer in the wire shape back to the shape `s` describes. Values
// already in that shape pass through, so it is safe on either.
export function fromWire(s, v) {
  if (!s || typeof s !== 'object') return v;
  const inner = nonNull(s);
  if (inner) return v === '' || v == null ? null : fromWire(inner, v);
  if (isFieldMap(s)) {
    if (!Array.isArray(v)) return v;
    const out = Object.fromEntries(Object.keys(s.properties).map((f) => [f, null]));
    for (const e of v) {
      if (e && Object.hasOwn(out, e.field) && out[e.field] === null && typeof e.value === 'string') out[e.field] = e.value;
    }
    return out;
  }
  if (s.type === 'object' && s.properties && v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, s.properties[k] ? fromWire(s.properties[k], x) : x]));
  }
  if (s.type === 'array' && s.items && Array.isArray(v)) return v.map((x) => fromWire(s.items, x));
  return v;
}

// Returns { ok: true, json, meta } or { ok: false, status, error, code }.
// `code` is logged; nothing from the document is.
export async function callModel(env, { system, content, schema, maxTokens = 16000 }) {
  const { model, headers, body } = modelRequest(env, { system, content, schema: toWireSchema(schema), maxTokens });
  let acc;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), MODEL_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, { method: 'POST', signal: abort.signal, headers, body: JSON.stringify(body) });
    // The error body is the API's own message (it never echoes the document)
    // and is the only way to tell a bad request from an outage in the logs.
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    acc = await readSseStream(res);
  } catch (err) {
    console.error('[proof-scan-v2] model call failed:', err.name === 'AbortError' ? 'timed out' : err.message);
    return { ok: false, status: 502, code: 'model_unavailable', error: 'The document checker is unavailable right now. Please try again.' };
  } finally {
    clearTimeout(timer);
  }
  const usage = acc.usage();
  const meta = {
    model: acc.model() || model,
    stop_reason: acc.stopReason() || null,
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
  };
  if (acc.error()) return failed('model_stream_error');
  if (meta.stop_reason !== 'end_turn') return failed(`model_stop_reason_${meta.stop_reason || 'missing'}`);
  const text = acc.text();
  if (!text) return failed('model_response_missing_text');
  try {
    return { ok: true, json: fromWire(schema, JSON.parse(text)), meta };
  } catch {
    return failed('model_response_not_json');
  }
}

export function failed(code) {
  console.error('[proof-scan-v2] could not be completed:', code);
  return { ok: false, status: 502, code, error: 'The document could not be read completely. Nothing was saved. Please try again.' };
}

const nullableString = (description) => ({ anyOf: [{ type: 'string' }, { type: 'null' }], description });
const zText = z.string().max(2000).nullable();

// ── Evidence Zero: read one document (specs E.1) ─────────────────────────────

// What a document can tell us: every reference field (D-100, the marriage date
// and place among them), the full SSN (D-80), and the document's own expiration
// date (D-100 #5; for an EAD that is also ead_expiration).
export const FACT_FIELDS = [...REFERENCE_FIELDS, 'ssn', 'expiration_date'];

export function evidenceZeroSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['doc_type', 'read_quality', 'unreadable_fields', 'issued_date', 'owner_roles', 'facts'],
    properties: {
      doc_type: { type: 'string', enum: DOC_TYPES, description: 'What this document is. "other" when it is none of the listed types.' },
      read_quality: {
        type: 'string', enum: ['clear', 'partial', 'unreadable'],
        description: 'clear = every printed fact is legible; partial = damaged, cut off or partly illegible; unreadable = cannot be read.',
      },
      unreadable_fields: { type: 'array', items: { type: 'string', enum: FACT_FIELDS }, description: 'Facts that are printed but not legible.' },
      issued_date: nullableString('The date the document was issued, exactly as printed, or null.'),
      owner_roles: {
        type: 'array', items: { type: 'string', enum: ROLES },
        description: 'Which people on the case this document is about. Several for a document about more than one person, such as a marriage certificate.',
      },
      facts: {
        type: 'object',
        additionalProperties: false,
        required: FACT_FIELDS,
        properties: Object.fromEntries(FACT_FIELDS.map((f) => [f, nullableString(
          f === 'ssn'
            ? 'The full Social Security number exactly as printed, or null.'
            : `${f.replace(/_/g, ' ')} exactly as printed on the document, or null if it is not printed there.`,
        )])),
      },
    },
  };
}

const EvidenceZeroOutput = z.object({
  doc_type: z.enum(DOC_TYPES),
  read_quality: z.enum(['clear', 'partial', 'unreadable']),
  unreadable_fields: z.array(z.enum(FACT_FIELDS)).max(FACT_FIELDS.length),
  issued_date: zText,
  owner_roles: z.array(z.enum(ROLES)).max(6),
  facts: z.object(Object.fromEntries(FACT_FIELDS.map((f) => [f, z.string().max(300).nullable()]))).strict(),
}).strict();

export function parseEvidenceZero(json) {
  const r = EvidenceZeroOutput.safeParse(json);
  return r.success ? { ok: true, data: r.data } : failed('evidence_zero_schema');
}

function describePeople(people) {
  if (!people.length) return 'No one is on the case yet.';
  return people.map((p) => `- ${ROLE_LABELS[p.role]} (${p.role})${formatName(p) ? `: ${formatName(p)}` : ''}`).join('\n');
}

export function evidenceZeroPrompt({ caseTypeLabel, people }) {
  return `You are reading ONE source document for an immigration law firm's case file. Case type, chosen by the firm: ${caseTypeLabel}.

You report what the document says. You never decide whether anything is right or wrong, never compare it with anything else, and never fill in a value that is not printed on this document.

1. doc_type: what this document is, from the listed types only.
2. read_quality: be strict. A torn, blurred, cut-off, stained or partly illegible document is "partial", even if most of it reads. When in doubt, it is not "clear".
3. unreadable_fields: facts that are printed but cannot be read with confidence.
4. issued_date: the issue date, as printed, or null.
5. owner_roles: which of the people below this document is about. A document about two people (a marriage certificate) lists both. Leave it empty if you cannot tell.
6. facts: every listed fact exactly as printed on THIS document. null when the document does not print it. Never normalise, correct, or complete a value. Address parts such as In Care Of, province, postal code and country are filled only when the document prints them. expiration_date is the document's own expiry (a passport, I-94, EAD or green card), if it has one. The ssn field may carry the full number when it is printed; no other field may.

People on the case:
${describePeople(people)}`;
}

// ── Draft Review, Pre-flight, Physical Scan: check a set of files (E.2, E.3) ─

export const CHECK_STATUSES = ['clear', 'needs_attention', 'blank', 'not_checked'];
export const ITEM_STATUSES = ['present', 'missing', 'unreadable'];
// What a form can show about a person. ssn is the full number (D-80).
export const FORM_VALUE_FIELDS = [...REFERENCE_FIELDS, 'ssn'];
// D-100 #2: evidence is compared with the forms on the full fact list, so the
// model reports every fact a document prints that is on that list.
export const EVIDENCE_FACT_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'date_of_birth', 'a_number',
  'uscis_account_number', 'country_of_birth', 'country_of_citizenship', 'i94_number', 'i94_expiration',
  'last_entry_date', 'port_of_entry', 'employer', 'marriage_date', 'marriage_place', 'expiration_date',
];
// Fields a client may correct by hand (D-68). 'departures' switches on the
// I-821D departures check at Pre-flight (D-71); 'other' is anything else.
export const MARKUP_FIELDS = [...REFERENCE_FIELDS, 'departures', 'other'];
export const FILE_KINDS = { package: 'forms or package', marked: "client's marked-up pages", corrected: 'corrected pages' };

const nullableEnum = (values, description) => ({ anyOf: [{ type: 'string', enum: values }, { type: 'null' }], description });
const stringArray = (description) => ({ type: 'array', items: { type: 'string' }, description });

// Built from the rules and items THIS run sends, so the IDs are closed enums.
// A section with nothing to ask is left out (an empty enum is not a schema).
export function stageRunSchema({ ruleIds, itemIds, withMarkups }) {
  const properties = {};
  const required = [];
  if (ruleIds.length) {
    required.push('rule_results');
    properties.rule_results = {
      type: 'array',
      description: 'Exactly one entry for every listed check ID. No more, no fewer.',
      items: {
        type: 'object', additionalProperties: false,
        required: ['rule_id', 'status', 'summary', 'locations', 'evidence', 'reason'],
        properties: {
          rule_id: { type: 'string', enum: ruleIds },
          status: { type: 'string', enum: CHECK_STATUSES, description: 'clear = read it and it holds; needs_attention = read it and it does not hold; blank = the field the check looks at is empty; not_checked = could not read it or the form is not in these files.' },
          summary: nullableString('When the check does not hold: one short sentence that states what is wrong as a plain fact, e.g. "The I-765 signature page (page 6) is missing." Never restate the check\'s own wording. Null when it holds.'),
          locations: stringArray('Where, e.g. "I-765 page 3". Empty when not applicable.'),
          evidence: nullableString('Short quoted text supporting the status, or null.'),
          reason: nullableString('Why the check is not clear, or null when it is.'),
        },
      },
    };
  }
  if (itemIds.length) {
    required.push('package_items');
    properties.package_items = {
      type: 'array',
      description: 'Exactly one entry for every listed package item ID.',
      items: {
        type: 'object', additionalProperties: false, required: ['item_id', 'status', 'locations'],
        properties: {
          item_id: { type: 'string', enum: itemIds },
          status: { type: 'string', enum: ITEM_STATUSES },
          locations: stringArray('Which file and pages hold it.'),
        },
      },
    };
  }
  required.push('forms_found', 'evidence_found', 'possible_issues');
  properties.forms_found = {
    type: 'array',
    description: 'Every form found, once per form copy, in the order found.',
    items: {
      type: 'object', additionalProperties: false, required: ['form', 'file', 'pages', 'person_role', 'values'],
      properties: {
        form: { type: 'string', description: 'The form number as printed, e.g. "I-821D".' },
        file: { type: 'string', description: 'The filename it is in.' },
        pages: { type: 'string', description: 'Its pages in that file, e.g. "3-9".' },
        person_role: nullableEnum(ROLES, 'Which person on the case this form is about, or null if it is not about a person.'),
        values: {
          type: 'object', additionalProperties: false, required: FORM_VALUE_FIELDS,
          description: 'For each field: null when this form has no such field; "" when the form has the field and it is blank; otherwise the value exactly as printed.',
          properties: Object.fromEntries(FORM_VALUE_FIELDS.map((f) => [f, nullableString(f === 'ssn' ? 'The full SSN as printed, "" if blank, null if the form has no SSN field.' : f.replace(/_/g, ' '))])),
        },
      },
    },
  };
  properties.evidence_found = {
    type: 'array',
    description: 'Supporting documents in these files that are not USCIS forms (an EAD copy, a birth certificate, a marriage certificate).',
    items: {
      type: 'object', additionalProperties: false, required: ['doc_type', 'file', 'pages', 'owner_roles', 'read_quality', 'language', 'has_english_translation', 'facts'],
      properties: {
        doc_type: { type: 'string', enum: DOC_TYPES },
        language: { type: 'string', description: 'The language the document is written in, e.g. "English", "Spanish".' },
        has_english_translation: { type: 'boolean', description: 'For a document not in English: whether a certified English translation of it is in these files. true for an English document.' },
        file: { type: 'string' },
        pages: { type: 'string' },
        owner_roles: { type: 'array', items: { type: 'string', enum: ROLES }, description: 'Whose document it is. Empty if you cannot tell.' },
        read_quality: { type: 'string', enum: ['clear', 'partial', 'unreadable'] },
        facts: {
          type: 'object', additionalProperties: false, required: EVIDENCE_FACT_FIELDS,
          properties: Object.fromEntries(EVIDENCE_FACT_FIELDS.map((f) => [f, nullableString(`${f.replace(/_/g, ' ')} as printed, or null`)])),
        },
      },
    },
  };
  if (withMarkups) {
    required.push('markups');
    properties.markups = {
      type: 'array',
      description: "One entry per handwritten change the client made on the marked-up pages.",
      items: {
        type: 'object', additionalProperties: false,
        required: ['form', 'page', 'field', 'original', 'markup_read', 'read_confidence', 'corrected_page_present', 'corrected'],
        properties: {
          form: { type: 'string' },
          page: { type: 'string' },
          field: { type: 'string', enum: MARKUP_FIELDS },
          original: nullableString('The typed value the client marked, as printed.'),
          markup_read: nullableString('What the handwriting seems to say.'),
          read_confidence: { type: 'string', enum: ['clear', 'uncertain', 'unreadable'], description: 'How sure the handwriting read is. Pen is hard to read: when in doubt, uncertain.' },
          corrected_page_present: { type: 'boolean', description: 'Whether the corrected pages include this form.' },
          corrected: nullableString('What the corrected page now shows for this field, or null when there is no corrected page for the form.'),
        },
      },
    };
  }
  properties.possible_issues = {
    type: 'array',
    description: 'Anything that may be a problem but is not one of the listed checks. Usually empty.',
    items: {
      type: 'object', additionalProperties: false,
      required: ['title', 'description', 'evidence', 'why_it_matters', 'uncertainty', 'reasoning_key'],
      properties: {
        title: { type: 'string', description: 'What was noticed, in a few words.' },
        description: { type: 'string' },
        evidence: { type: 'string', description: 'Where in the files it appears.' },
        why_it_matters: { type: 'string' },
        uncertainty: { type: 'string', description: 'What makes it uncertain.' },
        reasoning_key: { type: 'string', description: 'A short snake_case name for the reasoning pattern, e.g. "signature_date_order".' },
      },
    },
  };
  return { type: 'object', additionalProperties: false, required, properties };
}

const zShort = z.string().max(300);
const zLocations = z.array(z.string().max(500)).max(50);
const zNullable = z.string().max(2000).nullable();

export function stageRunValidator({ ruleIds, itemIds, withMarkups }) {
  const shape = {
    forms_found: z.array(z.object({
      form: zShort, file: zShort, pages: z.string().max(100), person_role: z.enum(ROLES).nullable(),
      values: z.object(Object.fromEntries(FORM_VALUE_FIELDS.map((f) => [f, z.string().max(300).nullable()]))).strict(),
    }).strict()).max(60),
    evidence_found: z.array(z.object({
      doc_type: z.enum(DOC_TYPES), file: zShort, pages: z.string().max(100),
      owner_roles: z.array(z.enum(ROLES)).max(6), read_quality: z.enum(['clear', 'partial', 'unreadable']),
      language: z.string().trim().min(1).max(60), has_english_translation: z.boolean(),
      facts: z.object(Object.fromEntries(EVIDENCE_FACT_FIELDS.map((f) => [f, z.string().max(300).nullable()]))).strict(),
    }).strict()).max(60),
    possible_issues: z.array(z.object({
      title: z.string().min(1).max(300), description: z.string().max(2000), evidence: z.string().max(2000),
      why_it_matters: z.string().max(2000), uncertainty: z.string().max(2000), reasoning_key: z.string().max(120),
    }).strict()).max(20),
  };
  if (ruleIds.length) {
    shape.rule_results = z.array(z.object({
      rule_id: z.string().max(120), status: z.enum(CHECK_STATUSES), summary: zNullable,
      locations: zLocations, evidence: zNullable, reason: zNullable,
    }).strict());
  }
  if (itemIds.length) {
    shape.package_items = z.array(z.object({
      item_id: z.string().max(120), status: z.enum(ITEM_STATUSES), locations: zLocations,
    }).strict());
  }
  if (withMarkups) {
    shape.markups = z.array(z.object({
      form: zShort, page: z.string().max(50), field: z.enum(MARKUP_FIELDS), original: z.string().max(300).nullable(),
      markup_read: z.string().max(300).nullable(), read_confidence: z.enum(['clear', 'uncertain', 'unreadable']),
      corrected_page_present: z.boolean(), corrected: z.string().max(300).nullable(),
    }).strict()).max(200);
  }
  const schema = z.object(shape).strict();

  return (json) => {
    const r = schema.safeParse(json);
    if (!r.success) return failed('stage_run_schema');
    const data = r.data;
    // D-19, D-20: every ID sent comes back exactly once. Unknown, duplicate or
    // missing IDs fail the run; a missing observation is never a clear.
    const coverage = (rows = [], key, expected) => {
      const seen = new Set();
      for (const row of rows) {
        if (!expected.includes(row[key]) || seen.has(row[key])) return false;
        seen.add(row[key]);
      }
      return seen.size === expected.length;
    };
    if (!coverage(data.rule_results, 'rule_id', ruleIds)) return failed('rule_id_coverage');
    if (!coverage(data.package_items, 'item_id', itemIds)) return failed('item_id_coverage');
    return { ok: true, data: { rule_results: [], package_items: [], markups: [], ...data } };
  };
}

// v2.0.1: the firm's meaning for checks whose wording alone misleads the model.
// D-107: on the G-28, an EAD delivery choice left blank means home, which is fine.
export const RULE_GUIDANCE = {
  'DACA-G28-003': 'All delivery boxes left empty means the EAD goes to the applicant\'s home: that is clear. Home ticked is clear. Report needs_attention only when the office box is ticked.',
};

function describeRule(r, stage) {
  const s = r.stages?.[stage] || {};
  const parts = [`- ${r.rule_id}: ${s.stage_title || r.title}`];
  if (RULE_GUIDANCE[r.rule_id]) parts.push(`firm meaning: ${RULE_GUIDANCE[r.rule_id]}`);
  if (r.form) parts.push(`form: ${r.form}`);
  if (r.page) parts.push(`page: ${r.page}`);
  if (r.item) parts.push(`item: ${r.item}`);
  const expected = s.stage_expected || r.expected;
  if (expected) parts.push(`expected: ${expected}`);
  if (r.note) parts.push(`note: ${r.note}`);
  if (r.source_note) parts.push(`where to look: ${r.source_note}`);
  return parts.join(' | ');
}

function describeCards(people) {
  if (!people.length) return 'No case cards yet.';
  return people.map((p) => {
    const bits = [formatName(p) || '(no name yet)'];
    if (p.date_of_birth) bits.push(`born ${p.date_of_birth}`);
    if (p.a_number) bits.push(`A-Number ${p.a_number}`);
    return `- ${ROLE_LABELS[p.role]} (${p.role}): ${bits.join(', ')}`;
  }).join('\n');
}

const DACA_NOTES = `CASE NOTES (DACA renewal)
- Multiple G-1450 forms in one package are normal, one per fee. They are not duplicates. G-1450 is the credit-card form and carries no routing number.
- G-1450 does not require a date beside the signature.
- The I-765WS requires no signature and is never listed on the G-28 as a form of record.
- I-821D items 6, 7 and 8 apply to initial DACA filings only. This is a renewal: do not report them as incomplete.
- Every page of a USCIS form prints its edition date in the footer. Read every one.`;

export function stageRunPrompt({
  caseTypeLabel, caseType, stageLabel, scope, form, rules, stage, items, people, files, withMarkups, suppressions, formEditions,
}) {
  const fileList = files.map((f, i) => `${i + 1}. ${f.filename} (${FILE_KINDS[f.kind || 'package']})`).join('\n');
  return `You are reviewing USCIS filing material for an immigration law firm. Case type, chosen by the firm: ${caseTypeLabel}. Stage: ${stageLabel}.${scope ? ` Scope: ${scope === 'individual' ? `one form only, the ${form}. Ignore the rest of the package.` : 'the whole set of forms provided.'}` : ''}

Do not infer or second-guess the case type or the stage. You report OBSERVATIONS ONLY: the firm's server decides wording, counts, severity and the overall result from what you report. Never guess: if you did not actually read what a check depends on, it is not_checked, never clear.

FILES
${fileList}

${rules.length ? `CHECKS
Report exactly one entry per check ID, using its own ID:
${rules.map((r) => describeRule(r, stage)).join('\n')}

- clear: you read it and the expected condition holds.
- needs_attention: you read it and it does not hold.
- blank: the field the check looks at is empty.
- not_checked: you could not read it, or the form it needs is not in these files.` : 'There are no listed checks for you at this stage. Still report the forms, evidence and any possible issues.'}

${items.length ? `PACKAGE ITEMS
Report exactly one entry per item ID: present, missing, or unreadable.
${items.map((it) => `- ${it.item_id}: ${it.form}${it.instance ? ` (${it.instance})` : ''}, ${it.label}, ${it.pages} page(s)`).join('\n')}
` : ''}
FORMS FOUND
List every form in the files, once per copy, with the person it is about and the values it shows. For each value: null when the form has no such field, "" when the field is there but blank, otherwise exactly as printed. Never normalise, correct, or fill in a value. The ssn value may carry the full number; no other field or text may.

EVIDENCE FOUND
List supporting documents that are not USCIS forms, with whose they are and the facts they print, including the document's own expiration date if it has one. Say what language each is written in and, for one not in English, whether a certified English translation of it is in these files. A damaged or partly illegible document is "partial".
${withMarkups ? `
CLIENT CORRECTIONS
The marked-up files carry the client's handwritten corrections. For every handwritten change, report what was typed, what the handwriting seems to say and how sure you are, and what the corrected pages now show for that field. Handwriting is hard to read: when in doubt, say uncertain. If the corrected pages do not include that form, say so.
` : ''}
POSSIBLE ISSUES
Separately, anything that may be a problem and is not one of the checks above. Usually there are none. Each must say what you noticed, where it appears, why it might matter and what makes it uncertain. Never invent a legal requirement. Never suggest any of this reasoning, which the firm has ruled out:
${suppressions.length ? suppressions.map((s) => `- ${s.reasoning_key}: ${s.label}`).join('\n') : '- (none)'}

CASE CARDS (who is on this case; use them to tell whose form is whose, not as the truth to check against)
${describeCards(people)}

USCIS FORM REFERENCE (the edition USCIS currently publishes for each form; a footer that matches it is current)
${formEditions}
${caseType === 'daca_renewal' ? `\n${DACA_NOTES}` : ''}`;
}
