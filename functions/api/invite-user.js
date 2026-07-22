// CF Pages Function: invite-user
// POST { email, first_name, last_name, role_id, invited_by }
// Caller must be Owner or Staff Admin.

import { makeAdminClient, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (request.headers.get('authorization') || request.headers.get('Authorization') || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Unauthorized' });

  const admin = makeAdminClient(env);

  let caller;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: 'Invalid token' });
    caller = data.user;
  } catch (err) {
    console.error('[invite-user] getUser error:', err.message);
    return json(503, { error: 'Authentication service unavailable. Please try again.' });
  }

  let callerRole, callerUserId;
  try {
    const { data } = await admin
      .from('users')
      .select('id, roles(name)')
      .eq('auth_id', caller.id)
      .single();
    callerRole   = data?.roles?.name;
    callerUserId = data?.id;
  } catch (err) {
    console.error('[invite-user] caller profile error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }

  if (!['Owner', 'Staff Admin'].includes(callerRole)) {
    return json(403, { error: 'Forbidden — Owner or Staff Admin role required' });
  }

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { email, first_name, last_name, role_id } = body;
  if (!email || !role_id) return json(400, { error: 'email and role_id are required' });

  let role;
  try {
    const { data, error } = await admin.from('roles').select('id,name').eq('id', role_id).single();
    if (error || !data) return json(400, { error: 'Invalid role_id' });
    role = data;
  } catch (err) {
    console.error('[invite-user] role lookup error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }

  // Privilege-escalation guard: only an Owner may create another Owner. A Staff
  // Admin must not be able to mint an account more privileged than itself by
  // passing role_id = Owner in the body.
  if (role.name === 'Owner' && callerRole !== 'Owner') {
    return json(403, { error: 'Only an Owner can invite another Owner.' });
  }

  let invited;
  try {
    const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { first_name, last_name },
      redirectTo: `${portalUrl}/reset-password`,
    });
    if (error) return json(400, { error: error.message });
    invited = data;
  } catch (err) {
    console.error('[invite-user] inviteUserByEmail error:', err.message);
    return json(503, { error: 'Failed to send invite. Please try again.' });
  }

  try {
    await admin.from('users').update({
      first_name: first_name || email.split('@')[0],
      last_name:  last_name  || '',
      role_id,
      invited_by: callerUserId,
      invited_at: new Date().toISOString(),
    }).eq('auth_id', invited.user.id);
  } catch (err) {
    console.error('[invite-user] profile update error:', err.message);
  }

  return json(200, { ok: true, userId: invited.user.id });
}
