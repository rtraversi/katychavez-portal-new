// POST /api/calendar/disconnect
// Removes stored OAuth tokens for the given provider.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'calendar');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let provider = 'google';
  try {
    const body = await request.json();
    if (body?.provider) provider = body.provider;
  } catch { /* default to google */ }

  const admin = makeAdminClient(env);
  const { error } = await admin
    .from('oauth_tokens')
    .delete()
    .eq('user_id', auth.user.id)
    .eq('provider', provider);

  if (error) {
    console.error('[calendar-disconnect]', error.message);
    return json(500, { error: 'Failed to disconnect calendar.' });
  }

  return json(200, { ok: true });
}
