// save-attorney-signature.js — Store attorney signature PNG into R2.
// POST only. Body: { image_base64: string } — base64-encoded PNG.
// Only Owner / Admin roles may save.

import { verifyAuth, json } from './_helpers.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const auth = await verifyAuth(request, env, 'write', 'sig_stamp');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  // Role check — Owner or role with admin access
  const roleName = auth.profile?.roles?.name;
  const isOwner  = roleName === 'Owner';
  const isAdmin  = auth.accessLevel === 'admin';
  if (!isOwner && !isAdmin) {
    return json(403, { error: 'Only Owners can update the attorney signature' });
  }

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

  const key = 'firm/attorney-signature.png';
  await env.R2.put(key, buffer, {
    httpMetadata: { contentType: 'image/png' },
  });

  return json(200, { ok: true });
}
