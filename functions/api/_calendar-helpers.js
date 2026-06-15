// Shared helpers for Google Calendar and Microsoft Graph API calls + token refresh.
// Imported by calendar-events.js and calendar OAuth endpoints.

import { makeAdminClient } from './_helpers.js';

const GOOGLE_TOKEN_ENDPOINT  = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE   = 'https://www.googleapis.com/calendar/v3';

const OUTLOOK_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH_BASE             = 'https://graph.microsoft.com/v1.0';

/**
 * Returns a valid Google access token for the given auth.users.id.
 * Auto-refreshes if expired. Returns null if no tokens found or refresh fails.
 */
export async function getValidGoogleToken(authUserId, env) {
  const admin = makeAdminClient(env);

  const { data: row, error } = await admin
    .from('oauth_tokens')
    .select('access_token, refresh_token, token_expiry')
    .eq('user_id', authUserId)
    .eq('provider', 'google')
    .single();

  if (error || !row) return null;

  const expiryMs = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (expiryMs > Date.now() + 60_000) return row.access_token;

  // Refresh
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  if (!res.ok) {
    console.error('[calendar] token refresh failed:', res.status);
    return null;
  }

  const tokens    = await res.json();
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await admin
    .from('oauth_tokens')
    .update({ access_token: tokens.access_token, token_expiry: newExpiry, updated_at: new Date().toISOString() })
    .eq('user_id', authUserId)
    .eq('provider', 'google');

  return tokens.access_token;
}

/**
 * Call the Google Calendar API.
 * method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
 * path: e.g. '/calendars/primary/events'
 */
export async function callGoogle(accessToken, method, path, body = null) {
  const headers = { 'Authorization': `Bearer ${accessToken}` };
  if (body) headers['Content-Type'] = 'application/json';
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${GOOGLE_CALENDAR_BASE}${path}`, opts);
}

/**
 * Returns a valid Microsoft access token for the given auth.users.id.
 * Auto-refreshes if expired. Returns null if no tokens found or refresh fails.
 */
export async function getValidOutlookToken(authUserId, env) {
  const admin = makeAdminClient(env);

  const { data: row, error } = await admin
    .from('oauth_tokens')
    .select('access_token, refresh_token, token_expiry')
    .eq('user_id', authUserId)
    .eq('provider', 'outlook')
    .single();

  if (error || !row) return null;

  const expiryMs = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
  if (expiryMs > Date.now() + 60_000) return row.access_token;

  // Refresh
  const res = await fetch(OUTLOOK_TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      client_id:     env.OUTLOOK_CLIENT_ID,
      client_secret: env.OUTLOOK_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type:    'refresh_token',
    }),
  });

  if (!res.ok) {
    console.error('[calendar] outlook token refresh failed:', res.status);
    return null;
  }

  const tokens    = await res.json();
  const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await admin
    .from('oauth_tokens')
    .update({ access_token: tokens.access_token, token_expiry: newExpiry, updated_at: new Date().toISOString() })
    .eq('user_id', authUserId)
    .eq('provider', 'outlook');

  return tokens.access_token;
}

/**
 * Call the Microsoft Graph API.
 * method: 'GET' | 'POST' | 'DELETE'
 * path: e.g. '/me/events'
 * Requests UTC datetimes via Prefer header so no timezone conversion is needed.
 */
export async function callGraph(accessToken, method, path, body = null) {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Prefer':        'outlook.timezone="UTC"',
  };
  if (body) headers['Content-Type'] = 'application/json';
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${GRAPH_BASE}${path}`, opts);
}
