// GET /api/freshbooks/oauth-url
// Generates the FreshBooks OAuth authorization URL for the firm-level connection.
// Gated on write access to the billing module (Owner / Attorney). The frontend
// redirects to the returned URL to begin the consent flow.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

const FRESHBOOKS_AUTH = 'https://auth.freshbooks.com/oauth/authorize';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  if (!env.FRESHBOOKS_CLIENT_ID || !env.FRESHBOOKS_REDIRECT_URI) {
    return json(500, { error: 'FreshBooks is not configured on this deployment (missing client ID / redirect URI).' });
  }

  const state = crypto.randomUUID();
  const admin = makeAdminClient(env);

  const { error } = await admin
    .from('oauth_state')
    .insert({ state, user_id: auth.user.id, provider: 'freshbooks' });

  if (error) {
    console.error('[freshbooks-oauth-url] insert state:', error.message);
    return json(500, { error: 'Failed to initialize OAuth flow.' });
  }

  const params = new URLSearchParams({
    client_id:     env.FRESHBOOKS_CLIENT_ID,
    response_type: 'code',
    redirect_uri:  env.FRESHBOOKS_REDIRECT_URI,
    state,
  });

  // Scopes are configured on the FreshBooks app itself; only include the scope
  // param if the deployment explicitly overrides them (space-delimited string).
  if (env.FRESHBOOKS_SCOPES) params.set('scope', env.FRESHBOOKS_SCOPES);

  return json(200, { url: `${FRESHBOOKS_AUTH}?${params}` });
}
