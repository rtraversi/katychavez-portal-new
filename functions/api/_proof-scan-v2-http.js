// _proof-scan-v2-http.js: request plumbing shared by the Proof Scan v2 routes.
// NOT a route.
//
// Auth is exactly v1.2's: staff roles with proof_scan module access, and the
// Client role refused outright even if a misconfigured grant would let it in
// (Batch 5 hardening, carried into v2 by D-85).

import { verifyAuth, json, makeAdminClient } from './_helpers.js';

export { json };

const CLIENT_REFUSED = 'Insufficient permissions for proof_scan module';

// Returns { auth, admin } or { response } to send straight back.
export async function requireStaff(request, env, level = 'read') {
  const auth = await verifyAuth(request, env, level, 'proof_scan');
  if (auth.httpError) return { response: json(auth.httpError.status, { error: auth.httpError.message }) };
  if (auth.profile?.roles?.name === 'Client' || auth.isClient) {
    return { response: json(403, { error: CLIENT_REFUSED }) };
  }
  return { auth, admin: makeAdminClient(env) };
}

export async function readJson(request) {
  try {
    return { body: await request.json() };
  } catch {
    return { response: json(400, { error: 'Invalid JSON' }) };
  }
}

// A route body is one of a few named actions. Unknown methods get 405.
export function methodNotAllowed() {
  return json(405, { error: 'Method not allowed' });
}

export function notFound(what) {
  return json(404, { error: `${what} not found` });
}

const MIGRATION_HINT =
  'Proof Scan v2 storage is not ready. Apply database migrations 2000 to 2003 before using it.';

// Database failures are logged by code and message only (never row content) and
// answered with a neutral message. A missing table or column means the v2
// migrations have not been applied yet; say so plainly.
export function databaseError(where, error) {
  const detail = `${error?.code || ''} ${error?.message || ''}`;
  console.error(`[proof-scan-v2] database error at ${where}:`, error?.code || '', (error?.message || '').slice(0, 200));
  if (/42P01|42703|PGRST20[045]|does not exist|schema cache/i.test(detail)) {
    return json(503, { error: MIGRATION_HINT });
  }
  return json(500, { error: 'Proof Scan could not reach its records. Nothing was changed. Please try again.' });
}

// Wraps a handler so an unexpected throw is a neutral 500, and a StoreError is
// reported through databaseError.
export function guarded(name, handler) {
  return async (context) => {
    try {
      return await handler(context);
    } catch (err) {
      if (err?.isStoreError) return databaseError(err.where, err.cause);
      if (err?.isHttpError) return json(err.status, { error: err.message, ...(err.extra || {}) });
      console.error(`[${name}] unhandled error:`, err?.message);
      return json(500, { error: 'An unexpected error occurred. Please try again.' });
    }
  };
}

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.isHttpError = true;
    this.status = status;
    this.extra = extra;
  }
}

export const clientIp = (request) =>
  request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || null;

// ── Uploaded files ───────────────────────────────────────────────────────────
// Files arrive as base64 in JSON, the v1.2 way. They are read by the model and
// then dropped: nothing here, or anywhere in v2, stores a file (D-84).

export const MAX_FILE_BYTES = 12 * 1024 * 1024;          // per file (D-95, v1.2's limit)
export const MAX_TOTAL_BYTES = 22 * 1024 * 1024;         // per request, under the 32 MB API ceiling once base64'd
export const MAX_FILES = 20;
export const MAX_FILE_MB = 12;
export const MAX_TOTAL_MB = 22;

export const MEDIA_TYPES = {
  'application/pdf': { magic: (b) => b.startsWith('%PDF-'), block: 'document' },
  'image/jpeg': { magic: (b) => b.charCodeAt(0) === 0xff && b.charCodeAt(1) === 0xd8, block: 'image' },
  'image/png': { magic: (b) => b.startsWith('\x89PNG'), block: 'image' },
  'image/webp': { magic: (b) => b.startsWith('RIFF') && b.slice(8, 12) === 'WEBP', block: 'image' },
};

export function base64ByteLength(base64) {
  const compact = String(base64).replace(/[\r\n]/g, '');
  if (compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;
  const padding = (compact.match(/=+$/) || [''])[0].length;
  return (compact.length / 4) * 3 - padding;
}

const FILENAME_RE = /^[^/\\\x00-\x1f\x7f-\x9f\u2028\u2029]{1,255}$/;

// Returns { bytes } or { error } with a message staff can act on.
export function checkFile(file) {
  const name = String(file?.filename ?? '').trim();
  if (!name || !FILENAME_RE.test(name)) return { error: 'Each file needs a plain filename.' };
  const type = MEDIA_TYPES[file?.media_type];
  if (!type) return { error: `${name}: only PDF, JPEG, PNG or WebP files can be read.` };
  const bytes = base64ByteLength(file?.file_base64 || '');
  if (bytes === null || bytes <= 0) return { error: `${name}: the file could not be read.` };
  if (bytes > MAX_FILE_BYTES) {
    return { error: `${name} is larger than ${MAX_FILE_MB} MB. Reduce the file size and try again.` };
  }
  let header;
  try { header = atob(String(file.file_base64).replace(/[\r\n]/g, '').slice(0, 16)); }
  catch { return { error: `${name}: the file could not be read.` }; }
  if (!type.magic(header)) return { error: `${name} is not the kind of file its type says it is.` };
  return { bytes, name };
}

export function checkFiles(files) {
  if (!Array.isArray(files) || !files.length) return { error: 'Add at least one file.' };
  if (files.length > MAX_FILES) return { error: `Add at most ${MAX_FILES} files at a time.` };
  let total = 0;
  for (const f of files) {
    const r = checkFile(f);
    if (r.error) return r;
    total += r.bytes;
  }
  if (total > MAX_TOTAL_BYTES) {
    return { error: `These files add up to more than ${MAX_TOTAL_MB} MB. Reduce them and try again.` };
  }
  return { total };
}

// The model content block for one file.
export function fileBlock(file) {
  const data = String(file.file_base64).replace(/[\r\n]/g, '');
  if (MEDIA_TYPES[file.media_type].block === 'document') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } };
  }
  return { type: 'image', source: { type: 'base64', media_type: file.media_type, data } };
}
