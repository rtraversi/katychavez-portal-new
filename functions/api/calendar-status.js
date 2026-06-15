// GET /api/calendar/status
// Returns which calendar providers the current user has connected.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'calendar');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const admin = makeAdminClient(env);

  const { data, error } = await admin
    .from('oauth_tokens')
    .select('provider, account_email, updated_at')
    .eq('user_id', auth.user.id);

  if (error) {
    console.error('[calendar-status]', error.message);
    return json(500, { error: 'Failed to load calendar status.' });
  }

  const providers = (data || []).reduce((acc, row) => {
    acc[row.provider] = { email: row.account_email, connectedAt: row.updated_at };
    return acc;
  }, {});

  return json(200, { providers });
}
