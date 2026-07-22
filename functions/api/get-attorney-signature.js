// get-attorney-signature.js — Proxy a signature PNG from R2.
// GET — returns image/png bytes directly so img-src 'self' CSP covers it.
//
// ?user_id=<users.id> fetches that person's signature (for the Signature Stamp
// picker — requires sig_stamp access). Omit it to fetch your OWN signature
// (core access — every staff member has one).

import { verifyAuth } from './_helpers.js';

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequest({ request, env }) {
  const auth = await verifyAuth(request, env, 'read', 'core');
  if (auth.httpError) return jsonError(auth.httpError.status, auth.httpError.message);

  const requestedId = new URL(request.url).searchParams.get('user_id');
  const targetId = requestedId || auth.profile.id;

  // Fetching someone else's signature (the stamp picker) requires stamp access.
  if (targetId !== auth.profile.id) {
    const stampAuth = await verifyAuth(request, env, 'read', 'sig_stamp');
    if (stampAuth.httpError) return jsonError(stampAuth.httpError.status, stampAuth.httpError.message);
  }

  const key = `firm/signatures/${targetId}.png`;
  const obj = await env.R2.get(key);

  if (!obj) return jsonError(404, 'No signature uploaded yet');

  const bytes = await obj.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
