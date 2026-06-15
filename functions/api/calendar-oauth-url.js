// GET /api/calendar/oauth-url
// Generates the Google OAuth authorization URL for the current user.
// Frontend redirects to the returned URL to begin the consent flow.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'calendar');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const state = crypto.randomUUID();
  const admin = makeAdminClient(env);

  const { error } = await admin
    .from('oauth_state')
    .insert({ state, user_id: auth.user.id, provider: 'google' });

  if (error) {
    console.error('[calendar-oauth-url] insert state:', error.message);
    return json(500, { error: 'Failed to initialize OAuth flow.' });
  }

  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  });

  return json(200, { url: `${GOOGLE_AUTH}?${params}` });
}
