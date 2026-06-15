// GET /api/calendar/outlook-oauth-callback
// Microsoft redirects here after the user grants (or denies) permission.
// Exchanges the auth code for tokens, stores them, then redirects to the portal.

import { makeAdminClient } from './_helpers.js';

const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export async function onRequest({ request, env }) {
  const url      = new URL(request.url);
  const code     = url.searchParams.get('code');
  const state    = url.searchParams.get('state');
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
    .select('user_id, expires_at, provider')
    .eq('state', state)
    .single();

  if (stateErr || !stateRow || stateRow.provider !== 'outlook') {
    return Response.redirect(`${portalCalSettings}error%3Ainvalid_state#settings/calendar`, 302);
  }

  await admin.from('oauth_state').delete().eq('state', state);

  if (new Date(stateRow.expires_at) < new Date()) {
    return Response.redirect(`${portalCalSettings}error%3Astate_expired#settings/calendar`, 302);
  }

  // Exchange code for tokens
  const tokenRes = await fetch(MS_TOKEN, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      code,
      client_id:     env.OUTLOOK_CLIENT_ID,
      client_secret: env.OUTLOOK_CLIENT_SECRET,
      redirect_uri:  env.OUTLOOK_REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    console.error('[outlook-oauth-callback] token exchange:', tokenRes.status, await tokenRes.text());
    return Response.redirect(`${portalCalSettings}error%3Atoken_exchange#settings/calendar`, 302);
  }

  const tokens = await tokenRes.json();

  // Get account email from Microsoft Graph
  let accountEmail = null;
  try {
    const uRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` },
    });
    if (uRes.ok) {
      const me = await uRes.json();
      accountEmail = me.mail || me.userPrincipalName || null;
    }
  } catch { /* non-fatal */ }

  const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  const { error: upsertErr } = await admin
    .from('oauth_tokens')
    .upsert({
      user_id:       stateRow.user_id,
      provider:      'outlook',
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry:  tokenExpiry,
      account_email: accountEmail,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

  if (upsertErr) {
    console.error('[outlook-oauth-callback] upsert tokens:', upsertErr.message);
    return Response.redirect(`${portalCalSettings}error%3Asave_failed#settings/calendar`, 302);
  }

  return Response.redirect(`${portalCalSettings}outlook_connected#settings/calendar`, 302);
}
