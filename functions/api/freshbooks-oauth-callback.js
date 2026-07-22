// GET /api/freshbooks/oauth-callback
// FreshBooks redirects here after the user grants (or denies) access.
// Exchanges the auth code for tokens, captures the account/business IDs from
// /users/me, stores everything under provider='freshbooks', then redirects
// back to the billing settings page.
//
// FreshBooks differs from Google/Outlook in two ways handled here:
//   • the token endpoint takes a JSON body (not form-encoded)
//   • refresh tokens rotate on every use — we always persist the returned one

import { makeAdminClient } from './_helpers.js';

const FRESHBOOKS_TOKEN_ENDPOINT = 'https://api.freshbooks.com/auth/oauth/token';
const FRESHBOOKS_ME_ENDPOINT    = 'https://api.freshbooks.com/auth/api/v1/users/me';

export async function onRequest({ request, env }) {
  const url      = new URL(request.url);
  const code     = url.searchParams.get('code');
  const state    = url.searchParams.get('state');
  const errParam = url.searchParams.get('error');

  const billingSettings = `${env.PORTAL_URL}/portal?fb_result=`;
  const redirect = (result) => Response.redirect(`${billingSettings}${result}#settings/billing`, 302);

  if (errParam) return redirect(`error%3A${encodeURIComponent(errParam)}`);
  if (!code || !state) return redirect('error%3Amissing_params');

  const admin = makeAdminClient(env);

  // Validate + consume state (CSRF protection)
  const { data: stateRow, error: stateErr } = await admin
    .from('oauth_state')
    .select('user_id, expires_at')
    .eq('state', state)
    .single();

  if (stateErr || !stateRow) return redirect('error%3Ainvalid_state');

  await admin.from('oauth_state').delete().eq('state', state);

  if (new Date(stateRow.expires_at) < new Date()) return redirect('error%3Astate_expired');

  // Exchange code for tokens (JSON body — FreshBooks-specific)
  const tokenRes = await fetch(FRESHBOOKS_TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Api-Version': 'alpha' },
    body:    JSON.stringify({
      grant_type:    'authorization_code',
      client_id:     env.FRESHBOOKS_CLIENT_ID,
      client_secret: env.FRESHBOOKS_CLIENT_SECRET,
      code,
      redirect_uri:  env.FRESHBOOKS_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    console.error('[freshbooks-oauth-callback] token exchange failed:', tokenRes.status, await tokenRes.text());
    return redirect('error%3Atoken_exchange');
  }

  const tokens = await tokenRes.json();
  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('[freshbooks-oauth-callback] token response missing fields');
    return redirect('error%3Atoken_exchange');
  }

  // Capture account_id (accounting) + business_id (time tracking) + email from /users/me
  let accountId = null, businessId = null, accountEmail = null;
  try {
    const meRes = await fetch(FRESHBOOKS_ME_ENDPOINT, {
      headers: { 'Authorization': `Bearer ${tokens.access_token}`, 'Api-Version': 'alpha' },
    });
    if (meRes.ok) {
      const me = (await meRes.json())?.response || {};
      accountEmail = me.email || null;
      const memberships = me.business_memberships || [];
      // Prefer an owner/admin membership; fall back to the first business.
      const m = memberships.find(x => ['owner', 'admin'].includes(x.role)) || memberships[0];
      if (m?.business) {
        accountId  = m.business.account_id != null ? String(m.business.account_id) : null;
        businessId = m.business.id != null ? String(m.business.id) : null;
      }
    } else {
      console.error('[freshbooks-oauth-callback] /users/me failed:', meRes.status);
    }
  } catch (err) {
    console.error('[freshbooks-oauth-callback] /users/me error:', err.message);
  }

  if (!accountId || !businessId) {
    // Without these the adapter can't call the accounting/time-tracking APIs.
    return redirect('error%3Ano_business');
  }

  const tokenExpiry = new Date(Date.now() + (tokens.expires_in || 43200) * 1000).toISOString();

  const { error: upsertErr } = await admin
    .from('oauth_tokens')
    .upsert({
      user_id:       stateRow.user_id,
      provider:      'freshbooks',
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expiry:  tokenExpiry,
      account_email: accountEmail,
      account_id:    accountId,
      business_id:   businessId,
      updated_at:    new Date().toISOString(),
    }, { onConflict: 'user_id,provider' });

  if (upsertErr) {
    console.error('[freshbooks-oauth-callback] upsert tokens:', upsertErr.message);
    return redirect('error%3Asave_failed');
  }

  return redirect('connected');
}
