// GET /api/freshbooks/status
// Returns whether the firm has a FreshBooks connection. FreshBooks is a single
// firm-level connection (stored under whichever Owner/Attorney connected it), so
// this is queried by provider, not by the requesting user.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const configured = !!(env.FRESHBOOKS_CLIENT_ID && env.FRESHBOOKS_REDIRECT_URI);

  const admin = makeAdminClient(env);
  const { data, error } = await admin
    .from('oauth_tokens')
    .select('account_email, account_id, business_id, updated_at')
    .eq('provider', 'freshbooks')
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[freshbooks-status]', error.message);
    return json(500, { error: 'Failed to load FreshBooks status.' });
  }

  const row = data?.[0];
  return json(200, {
    configured,
    connected:   !!row,
    email:       row?.account_email || null,
    accountId:   row?.account_id || null,
    businessId:  row?.business_id || null,
    connectedAt: row?.updated_at || null,
  });
}
