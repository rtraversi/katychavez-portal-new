// POST /api/freshbooks/disconnect
// Removes the firm's FreshBooks OAuth connection. Gated on write access to billing.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const admin = makeAdminClient(env);
  const { error } = await admin
    .from('oauth_tokens')
    .delete()
    .eq('provider', 'freshbooks');

  if (error) {
    console.error('[freshbooks-disconnect]', error.message);
    return json(500, { error: 'Failed to disconnect FreshBooks.' });
  }

  return json(200, { ok: true });
}
