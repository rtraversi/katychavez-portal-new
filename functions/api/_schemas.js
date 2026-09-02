// Shared Zod request-body schemas + validate() helper. NOT a route (underscore prefix).
//
// Usage in a handler, right after `body = await request.json()`:
//   const v = validate(SomeSchema, body);
//   if (v.error) return v.error;         // 400 with a field-specific message
//   const { field } = v.data;            // parsed + coerced values
//
// Adopt incrementally: convert one handler at a time by replacing its hand-rolled
// `if (!field) return json(400, ...)` checks with a schema + validate() call.

import { z } from 'zod';
import { json } from './_helpers.js';

export function validate(schema, body) {
  const r = schema.safeParse(body);
  if (!r.success) {
    const first = r.error.issues[0];
    const path = first?.path?.length ? `${first.path.join('.')}: ` : '';
    return { error: json(400, { error: `${path}${first?.message || 'Invalid input'}` }) };
  }
  return { data: r.data };
}

// A trimmed, length-bounded, required string.
const text = (max) => z.string().trim().min(1).max(max);

// ── Auth-sensitive ───────────────────────────────────────────────────────────
export const UpdatePasswordSchema = z.object({
  // bcrypt (Supabase) truncates beyond 72 bytes; enforce a floor + that ceiling.
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});

export const MfaRecoverSchema = z.object({
  code: text(100),
});

// ── Messaging (spam / Resend-quota surface) ──────────────────────────────────
export const ClientSendMessageSchema = z.object({
  body: text(5000),
});

export const SendMessageSchema = z.object({
  client_id: text(100),
  body:      text(5000),
});

// ── Public consult booking (scheduling module) ───────────────────────────────
// `start` is validated as a real ISO instant by the handler (it must also match
// a computed slot exactly); the schema only bounds its shape.
export const BookingBookSchema = z.object({
  attorney:        text(100),                    // opaque public slug
  consult_type_id: z.string().uuid(),
  start:           text(40),
  prospect_name:   text(200),
  prospect_email:  z.string().trim().email().max(320),
  prospect_phone:  z.string().trim().max(50).nullish(),
  case_type_id:    z.string().uuid().nullish(),
  notes:           z.string().trim().max(2000).nullish(),
  turnstile_token: z.string().max(5000).nullish(),
  offer:           z.string().trim().max(100).nullish(),  // private booking-offer token
});

// ── Demo analytics beacon (public, DEMO_MODE only) ───────────────────────────
export const DemoEventSchema = z.object({
  session_id: text(100),
  event_type: text(50),
  role:       z.string().max(50).nullish(),
  module:     z.string().max(100).nullish(),
  action:     z.string().max(100).nullish(),
  ip_hash:    z.string().max(128).nullish(),
});

// ── Proof Scan (structured DACA pipeline) ────────────────────────────────────
// Staff pick the scan profile explicitly; it is never inferred from the filename,
// the forms inside the PDF, or the model. Only configured profiles are accepted.
// `.strict()` rejects unknown properties, so a browser cannot smuggle rules,
// severities, titles, or a profile version past the boundary.

export const PROOF_SCAN_PROFILE_IDS = ['daca_renewal'];

// 32 MB is the Anthropic request ceiling for a base64 PDF; hold well under it so
// the prompt, schema and JSON framing still fit. base64 is 4 chars per 3 bytes.
export const PROOF_SCAN_MAX_PDF_BYTES = 12 * 1024 * 1024;
export const PROOF_SCAN_MAX_BASE64_CHARS = Math.ceil(PROOF_SCAN_MAX_PDF_BYTES / 3) * 4 + 8;
const MAX_PDF_MB = Math.floor(PROOF_SCAN_MAX_PDF_BYTES / (1024 * 1024));

export const ProofScanSchema = z.object({
  scan_profile: z.enum(PROOF_SCAN_PROFILE_IDS, {
    message: `must be one of: ${PROOF_SCAN_PROFILE_IDS.join(', ')}`,
  }),
  filename: z.string().trim().min(1).max(255)
    .regex(/\.pdf$/i, 'must be a .pdf file')
    // No path separators or control characters — the name is stored and displayed.
    .regex(/^[^/\\\x00-\x1f]+$/, 'contains characters that are not allowed in a filename'),
  file_base64: z.string()
    .min(1, 'No file provided')
    .max(PROOF_SCAN_MAX_BASE64_CHARS, `PDF is too large — the limit is ${MAX_PDF_MB} MB`)
    .regex(/^[A-Za-z0-9+/\r\n]+={0,2}$/, 'is not valid base64'),
}).strict();
