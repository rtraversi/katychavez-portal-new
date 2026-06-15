// GET /api/calendar/oauth-callback
// Google redirects here after the user grants (or denies) permission.
// Exchanges the auth code for tokens, stores them, then redirects to the portal.

import { makeAdminClient } from './_helpers.js';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export async function onRequest({ request, env }) {
  const url    = new URL(request.url);
  const code   = url.searchParams.get('code');
  const state  = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  const portalCalSettings = `${env.PORTAL_URL}/portal?cal_result=`;

  if (errParam) {
    return Response.redirect(`${portalCalSettings}error%3A${encodeURIComponent(errParam)}#settings/calendar`, 302);
  }
  if (!code || !state) {
    return Response.redirect(`${portalCalSettings}error%3Amissing_params#settings/calendar`, 302);
  }

  const admin = makeAdminClient(env);

  // Validate + consume state (CSRF protection)
  const { data: stateRow, error: stateErr } = await admin
    .from('oauth_state')
    .select('user_id, expires_at')
    .eq('state', state)
    .single();

  if (stateErr || !stateRow) {
    return Response.redirect(`${portalCalSettings}error%3Ainvalid_state#settings/calendar`, 302);
  }

  await admin.from('oauth_state').delete().eq('state', state);

  if (new Date(stateRow.expires_at) < new Date()) {
    return Response.redirect(`${portalCalSettings}error%3Astate_expired#settings/calendar`, 302);
  }

  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  env.GOOGLE_REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    console.error('[calendar-oauth-callback] token exchange failed:', tokenRes.status, await tokenRes.text());
    return Response.redirect(`${portalCalSettings}error%3Atoken_exchange#settings/calendar`, 302);
  }

  const tokens = await tokenRes.json();

  // Get account email
  let accountEmail = null;
  try {
    const uRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` },
    });
    if (uRes.ok) accountEmail = (await uRes.json()).email;
  } catch { /* non-fatal */ }

  const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error: upsertErr } = await admin
    .from('oauth_tokens')
    .upsert({
      user_id:       stateRow.user_id,
      provider:      'google',
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry:  tokenExpiry,
      account_email: accountEmail,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

  if (upsertErr) {
    console.error('[calendar-oauth-callback] upsert tokens:', upsertErr.message);
    return Response.redirect(`${portalCalSettings}error%3Asave_failed#settings/calendar`, 302);
  }

  return Response.redirect(`${portalCalSettings}connected#settings/calendar`, 302);
}
