// _proof-scan-v2-ai.js: what Proof Scan v2 asks the model, and how the answer is
// checked. NOT a route.
//
// Same call pattern as v1.2 (raw fetch, output_config.format json_schema, no
// beta header) and the same model, claude-sonnet-4-6. Changing the model is
// Rob's decision (Q-28).
//
// The model reports OBSERVATIONS ONLY (D-18). It never decides severity,
// wording, counts, the report state, what fills a record, or what is a
// difference. Every answer is validated against a closed schema before the
// server reads a single field of it; anything malformed fails closed.

import { z } from 'zod';
import {
  DOC_TYPES, ROLES, REFERENCE_FIELDS, ROLE_LABELS, formatName,
} from './_proof-scan-v2-common.js';

export const MODEL = 'claude-sonnet-4-6';
const API_URL = 'https://api.anthropic.com/v1/messages';

// Returns { ok: true, json, meta } or { ok: false, status, error, code }.
// `code` is logged; nothing from the document is.
export async function callModel(env, { system, content, schema, maxTokens = 8000 }) {
  let data;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error('[proof-scan-v2] model call failed:', err.message);
    return { ok: false, status: 502, code: 'model_unavailable', error: 'The document checker is unavailable right now. Please try again.' };
  }
  const meta = {
    model: data?.model || MODEL,
    stop_reason: data?.stop_reason || null,
    input_tokens: data?.usage?.input_tokens ?? null,
    output_tokens: data?.usage?.output_tokens ?? null,
  };
  if (meta.stop_reason !== 'end_turn') return failed(`model_stop_reason_${meta.stop_reason || 'missing'}`);
  const text = data?.content?.find((b) => b?.type === 'text')?.text;
  if (typeof text !== 'string') return failed('model_response_missing_text');
  try {
    return { ok: true, json: JSON.parse(text), meta };
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

// What a document can tell us. The reference fields, the full SSN (D-80), and the
// marriage date a marriage certificate carries (D-98).
export const FACT_FIELDS = [...REFERENCE_FIELDS, 'ssn', 'marriage_date'];

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
6. facts: every listed fact exactly as printed on THIS document. null when the document does not print it. Never normalise, correct, or complete a value. Address parts such as In Care Of, province, postal code and country are filled only when the document prints them. The ssn field may carry the full number when it is printed; no other field may.

People on the case:
${describePeople(people)}`;
}
