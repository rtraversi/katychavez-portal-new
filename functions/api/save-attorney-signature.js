// save-attorney-signature.js — Store the current user's signature PNG into R2.
// POST only. Body: { image_base64: string } — base64-encoded PNG.
// Each staff member manages their OWN signature (keyed by users.id). Any active
// staff member (core access) may save theirs; clients are excluded by core gate.

import { verifyAuth, json } from './_helpers.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // Managing your own signature is a profile-level action — gate on core access
  // (all staff roles have it; clients do not), not on the sig_stamp module.
  const auth = await verifyAuth(request, env, 'read', 'core');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { image_base64 } = body;
  if (!image_base64 || typeof image_base64 !== 'string' || image_base64.trim().length === 0) {
    return json(400, { error: 'image_base64 is required' });
  }

  // Decode and validate size
  let buffer;
  try {
    const raw = atob(image_base64.replace(/^data:[^,]+,/, '')); // strip data URI prefix if present
    buffer = Uint8Array.from(raw, c => c.charCodeAt(0));
  } catch {
    return json(400, { error: 'image_base64 is not valid base64' });
  }

  if (buffer.byteLength === 0) return json(400, { error: 'Image is empty' });
  if (buffer.byteLength > MAX_BYTES) return json(400, { error: 'Image exceeds 5 MB limit' });

  const key = `firm/signatures/${auth.profile.id}.png`;
  await env.R2.put(key, buffer, {
    httpMetadata: { contentType: 'image/png' },
  });

  return json(200, { ok: true });
}
