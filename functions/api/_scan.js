// Malware scanning helper — wraps the attachmentAV Virus/Malware Scan API.
// Import from other functions; NOT a route endpoint (underscore prefix).
//
// The file already sits in R2 when we scan: we generate a short-lived presigned
// GET URL and hand it to attachmentAV's synchronous download endpoint
// (POST /v1/scan/sync/download, max 200MB, 60s timeout). File bytes never flow
// through the Worker, and attachmentAV (ISO 27001, Sophos engine) deletes the
// file immediately after scanning — safe for confidential client documents.
//
// Config:
//   ATTACHMENTAV_API_KEY  — secret, set via: npx wrangler secret put ATTACHMENTAV_API_KEY
//   ATTACHMENTAV_API_URL  — var in wrangler.toml (US region endpoint)
//
// Gracefully degrades: if the key is absent or attachmentAV is unreachable,
// the upload is allowed and the verdict is 'skipped' with a reason — we never
// hard-block uploads on a scanner outage (decision 2026-06-10).

import { makeR2Client, presignedGet } from './_helpers.js';
import { HeadObjectCommand } from '@aws-sdk/client-s3';

const SCAN_TIMEOUT_MS = 60_000;          // attachmentAV sync endpoint caps at 60s
const PRESIGN_TTL_SECONDS = 300;         // scanner fetches the file within seconds

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;   // 25MB policy cap

// ── Actual object size (don't trust the client-declared file_size) ─────────
// Returns size in bytes, or null if the object doesn't exist.

export async function getR2ObjectSize(env, r2Key) {
  if (env.R2) {
    const obj = await env.R2.head(r2Key);
    return obj ? obj.size : null;
  }
  const r2 = makeR2Client(env);
  try {
    const head = await r2.send(new HeadObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: r2Key,
    }));
    return head.ContentLength ?? 0;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
    throw err;
  }
}

// ── Scan an R2 object ───────────────────────────────────────────────────────
// Returns { verdict: 'clean' | 'infected' | 'skipped', detail: {...} }
//   detail always includes provider; on infected adds finding/realfiletype;
//   on skipped adds reason.

export async function scanR2Object(env, r2Key) {
  if (!env.ATTACHMENTAV_API_KEY) {
    console.warn('[scan] ATTACHMENTAV_API_KEY not set — skipping malware scan');
    return { verdict: 'skipped', detail: { provider: 'attachmentav', reason: 'not_configured' } };
  }

  const apiUrl = (env.ATTACHMENTAV_API_URL || 'https://us.developer.attachmentav.com').replace(/\/$/, '');

  let downloadUrl;
  try {
    downloadUrl = await presignedGet(env, r2Key, PRESIGN_TTL_SECONDS);
  } catch (err) {
    console.error('[scan] failed to presign R2 URL:', err.message);
    return { verdict: 'skipped', detail: { provider: 'attachmentav', reason: 'presign_failed' } };
  }

  try {
    const res = await fetch(`${apiUrl}/v1/scan/sync/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ATTACHMENTAV_API_KEY,
      },
      body: JSON.stringify({ download_url: downloadUrl }),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[scan] attachmentAV returned ${res.status}: ${text}`);
      return { verdict: 'skipped', detail: { provider: 'attachmentav', reason: `api_error_${res.status}` } };
    }

    // { status: 'clean'|'infected'|'no', finding?, size?, realfiletype? }
    const result = await res.json();

    if (result.status === 'clean') {
      return {
        verdict: 'clean',
        detail: { provider: 'attachmentav', realfiletype: result.realfiletype || null },
      };
    }

    if (result.status === 'infected') {
      console.warn(`[scan] INFECTED upload ${r2Key} — finding: ${result.finding || 'unknown'}`);
      return {
        verdict: 'infected',
        detail: {
          provider: 'attachmentav',
          finding: result.finding || 'unknown',
          realfiletype: result.realfiletype || null,
        },
      };
    }

    // status 'no' = unscannable (e.g. password-protected file) — allow + record
    console.warn(`[scan] unscannable upload ${r2Key} (status: ${result.status})`);
    return { verdict: 'skipped', detail: { provider: 'attachmentav', reason: 'unscannable' } };

  } catch (err) {
    console.error('[scan] attachmentAV unreachable:', err.message);
    return { verdict: 'skipped', detail: { provider: 'attachmentav', reason: 'unreachable' } };
  }
}
