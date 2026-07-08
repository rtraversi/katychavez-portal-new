// POST /api/update-password
// { password: string }
// Updates the calling user's password via the admin client, bypassing the
// AAL2 MFA requirement that blocks client-side updateUser() on MFA-enrolled accounts.

import { makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (request.headers.get('authorization') || request.headers.get('Authorization') || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Unauthorized' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { password } = body;
  if (!password || typeof password !== 'string') return json(400, { error: 'password is required' });

  const admin = makeAdminClient(env);

  // Verify the token to get the user ID
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData?.user) return json(401, { error: 'Invalid or expired session' });

  // Use admin client to update — bypasses AAL2 MFA check
  const { error: updateErr } = await admin.auth.admin.updateUserById(authData.user.id, { password });
  if (updateErr) {
    console.error('[update-password] updateUserById error:', updateErr.message);
    return json(500, { error: updateErr.message });
  }

  return json(200, { ok: true });
}
