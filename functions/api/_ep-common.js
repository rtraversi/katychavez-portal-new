// Shared pieces of the Estate Planning module (not a route — underscore prefix).

import { verifyAuth } from './_helpers.js';

export const EP_MODULE = 'estate_planning';
export const EP_LINK_TTL_DAYS = 60;          // a will questionnaire is long; people come back to it
export const EP_MAX_BODY_BYTES = 256 * 1024; // answers JSON is a few KB; anything near this is abuse

// The estate-planning case-type keys (2300 + 2301, the same set as 2101). Starter templates are scoped to
// these so they never appear in the generic Draft Document picker on other matters.
export const EP_CASE_TYPE_KEYS = [
  'simple_will', 'will_testamentary_trust', 'revocable_living_trust', 'irrevocable_trust',
  'asset_protection_trust', 'special_needs_trust', 'charitable_trust', 'financial_poa',
  'advance_directive', 'trust_funding', 'plan_review', 'business_succession',
  'beneficiary_review', 'other',
];

// ── Tokens ──────────────────────────────────────────────────────────────────
// 32 random bytes, base64url. Only sha256(token) is stored.

export function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashToken(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token)));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Answers staff type in themselves (POST /api/ep-intake/enter) are an ep_intake_requests
// row like any other, so drafting/editing/printing need nothing new. There is no client
// link, but token_hash is NOT NULL UNIQUE: such rows hold 'staff:' + random hex there.
// That can never equal sha256(token) (64 bare hex chars), so no link opens it, and the
// prefix is how the row is recognised (no migration needed).
export const STAFF_ENTRY_PREFIX = 'staff:';

export function staffEntryHash() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return STAFF_ENTRY_PREFIX + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function isStaffEntered(row) {
  return typeof row?.token_hash === 'string' && row.token_hash.startsWith(STAFF_ENTRY_PREFIX);
}

export function looksLikeToken(t) {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{40,64}$/.test(t);
}

// Where a token-holder stands. `row` is an ep_intake_requests row or null.
export function requestStatus(row, now = new Date()) {
  if (!row) return 'invalid';
  if (row.submitted_at) return 'submitted';
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at) < now) return 'expired';
  return 'open';
}

// ── Staff auth ──────────────────────────────────────────────────────────────
// verifyAuth against the estate_planning module, and never a Client — even one a
// misconfigured role grant would let through.

export async function requireStaff(request, env, level = 'read') {
  const auth = await verifyAuth(request, env, level, EP_MODULE);
  if (auth.httpError) return auth;
  if (auth.isClient || auth.profile?.roles?.name === 'Client') {
    return { httpError: { status: 403, message: 'Staff only' } };
  }
  return auth;
}

export async function readJson(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > EP_MAX_BODY_BYTES) return { error: 'Request too large' };
  const text = await request.text();
  if (text.length > EP_MAX_BODY_BYTES) return { error: 'Request too large' };
  try { return { body: JSON.parse(text || '{}') }; } catch { return { error: 'Invalid JSON' }; }
}

export function portalUrl(env, request) {
  const base = env.PORTAL_URL || (request ? new URL(request.url).origin : '');
  return String(base).replace(/\/+$/, '');
}
