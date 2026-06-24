// get-attorney-signature.js — Proxy attorney signature PNG from R2
// GET or POST — returns image/png bytes directly so img-src 'self' CSP covers it.

import { verifyAuth } from './_helpers.js';

export async function onRequest({ request, env }) {
  const auth = await verifyAuth(request, env, 'read', 'sig_stamp');
  if (auth.httpError) {
    return new Response(JSON.stringify({ error: auth.httpError.message }), {
      status: auth.httpError.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = 'firm/attorney-signature.png';
  const obj = await env.R2.get(key);

  if (!obj) {
    return new Response(JSON.stringify({ error: 'No signature uploaded yet' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const bytes = await obj.arrayBuffer();
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=300',
    },
  });
}
