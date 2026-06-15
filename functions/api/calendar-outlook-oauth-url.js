// GET /api/calendar/outlook-oauth-url
// Generates the Microsoft OAuth authorization URL for the current user.
// Frontend redirects to the returned URL to begin the consent flow.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const SCOPES = [
  'https://graph.microsoft.com/Calendars.ReadWrite',
  'offline_access',
  'User.Read',
].join(' ');

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'calendar');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const state = crypto.randomUUID();
  const admin = makeAdminClient(env);

  const { error } = await admin
    .from('oauth_state')
    .insert({ state, user_id: auth.user.id, provider: 'outlook' });

  if (error) {
    console.error('[outlook-oauth-url] insert state:', error.message);
    return json(500, { error: 'Failed to initialize OAuth flow.' });
  }

  const params = new URLSearchParams({
    client_id:     env.OUTLOOK_CLIENT_ID,
    redirect_uri:  env.OUTLOOK_REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    response_mode: 'query',
    state,
  });

  return json(200, { url: `${MS_AUTH}?${params}` });
}
