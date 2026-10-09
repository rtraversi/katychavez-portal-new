// proof-scan-upload.js — stages a package in R2 so the scan never carries it.
//
//   PUT  /api/proof-scan-upload            body: the raw PDF bytes
//     → { upload_id }
//   POST /api/proof-scan { upload_id, filename }  reads those bytes back out
//
// The filename rides with the scan request, not the upload — the staged object
// is anonymous bytes and nothing here needs to name it.
//
// Why not /api/get-upload-url → /api/confirm-upload: that trio is matter-scoped.
// It inserts a `documents` row and enforces matter ownership, and a proof-scan
// package is not a matter document — it is a transient input that should leave
// nothing behind but the `proof_scans` row. This is the same shape (browser PUTs
// bytes, the Worker writes R2) without the documents table hanging off it.
//
// What it replaces: the file used to travel as base64 inside a JSON body — ~33%
// more bytes over the wire, a full base64 copy built in the browser, and two or
// three more live in the isolate while `request.json()` parsed it. Here the body
// streams straight into R2. It is also the prerequisite for making the scan an
// async job, since a queued job cannot carry the file in its message
// (PROOF-SCAN-HANDOFF.md §12 step 4).

import { verifyAuth, json } from './_helpers.js';

export const TMP_PREFIX = 'proof-scan-tmp/';
export const tmpKey = (id) => `${TMP_PREFIX}${id}`;

// 23 MiB, not 24: the scan still base64-encodes these bytes for the Anthropic
// document block, and base64 of 24 MiB is exactly Anthropic's 32 MiB request
// limit — leaving nothing for the system prompt or the JSON around it.
export const MAX_PDF_BYTES = 23 * 1024 * 1024;

export const mib = bytes => (bytes / 1024 / 1024).toFixed(1);

export const tooLargeMessage = bytes =>
  `This package is ${mib(bytes)} MB, over the ${mib(MAX_PDF_BYTES)} MB limit a single scan can accept. `
  + 'Split it — scanning the forms and the evidence separately works — and run each part.';

// What may be staged. The live checker sends PDFs; Proof Scan v2 also reads
// photos of documents (an EAD, a birth certificate), so the Content-Type header
// picks one of these and anything else is stored as a PDF, as before. The type
// is a claim: whatever reads the object back checks the magic bytes.
export const STAGED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Guard against an id from elsewhere being used to read or clobber an arbitrary
// R2 key: the id becomes part of the object key, so only accept a real UUID.
export const isUploadId = (id) => typeof id === 'string' && UUID_RE.test(id);

// Daily cron: drop staged packages that were never scanned (tab closed between
// the upload and the scan). A scan deletes its own object when it finishes.
export async function runProofScanTmpCleanup(env) {
  if (!env.R2) return;
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let cursor;
  do {
    const page = await env.R2.list({ prefix: TMP_PREFIX, cursor });
    const stale = page.objects
      .filter(o => new Date(o.uploaded).getTime() < cutoff)
      .map(o => o.key);
    if (stale.length) await env.R2.delete(stale);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function onRequest({ request, env }) {
  if (request.method !== 'PUT') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'proof_scan');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  // DEMO_MODE replays a stored scan and never reads the file, so a demo portal
  // does not need storage configured to click through the page.
  if (env.DEMO_MODE === 'true') return json(200, { upload_id: crypto.randomUUID(), bytes: 0 });

  if (!env.R2) {
    console.error('[proof-scan-upload] env.R2 binding is undefined — add [[r2_buckets]] binding = "R2" to wrangler.toml');
    return json(500, { error: 'Storage binding not configured' });
  }

  // Declared size, checked before a byte is stored. It is a claim, not proof —
  // the real object is measured below — but refusing here means an oversized
  // package never crosses the wire at all.
  const declared = Number(request.headers.get('content-length')) || 0;
  if (declared > MAX_PDF_BYTES) return json(413, { error: tooLargeMessage(declared) });
  if (!request.body) return json(400, { error: 'No file provided' });

  const uploadId = crypto.randomUUID();
  const key      = tmpKey(uploadId);
  const declaredType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const contentType  = STAGED_TYPES.has(declaredType) ? declaredType : 'application/pdf';

  let stored;
  try {
    stored = await env.R2.put(key, request.body, {
      httpMetadata: { contentType },
    });
  } catch (err) {
    console.error('[proof-scan-upload] R2 put failed:', err.message);
    return json(500, { error: 'The upload could not be stored. Please try again.' });
  }

  // A missing or wrong Content-Length would let a large body through the check
  // above, so the stored object is the one that counts.
  const size = stored?.size ?? 0;
  if (!size || size > MAX_PDF_BYTES) {
    try { await env.R2.delete(key); } catch { /* best effort */ }
    return size
      ? json(413, { error: tooLargeMessage(size) })
      : json(400, { error: 'No file was received. Please try again.' });
  }

  return json(200, { upload_id: uploadId, bytes: size });
}
