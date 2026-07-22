// POST /api/reset-user-password
// { user_id }
// Sends a password reset email to a staff user. Owner or Staff Admin only.

import { makeAdminClient, json } from './_helpers.js';
import { notifyPasswordReset } from './_notifications.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (request.headers.get('authorization') || request.headers.get('Authorization') || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Unauthorized' });

  const admin = makeAdminClient(env);

  let callerRole;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: 'Invalid token' });
    const { data: profile } = await admin
      .from('users')
      .select('roles(name)')
      .eq('auth_id', data.user.id)
      .single();
    callerRole = profile?.roles?.name;
  } catch (err) {
    console.error('[reset-user-password] auth error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }

  if (!['Owner', 'Staff Admin'].includes(callerRole)) {
    return json(403, { error: 'Owner or Staff Admin role required.' });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON.' }); }
  if (!body.user_id) return json(400, { error: 'user_id is required.' });

  const { data: user, error: userErr } = await admin
    .from('users')
    .select('email')
    .eq('id', body.user_id)
    .single();

  if (userErr || !user) return json(404, { error: 'User not found.' });

  // Generate the recovery link, then send it via Resend
  const { data: linkData, error: resetErr } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: user.email,
    options: { redirectTo: `${env.PORTAL_URL}/portal` },
  });

  if (resetErr) {
    console.error('[reset-user-password] generateLink error:', resetErr.message);
    return json(500, { error: 'Failed to generate reset link. Please try again.' });
  }

  const actionLink = linkData?.properties?.action_link;
  if (!actionLink) {
    console.error('[reset-user-password] no action_link returned');
    return json(500, { error: 'Failed to generate reset link. Please try again.' });
  }

  await notifyPasswordReset(env, { toEmail: user.email, resetLink: actionLink }).catch(err =>
    console.error('[reset-user-password] notify error:', err.message)
  );

  return json(200, { ok: true });
}
