// DELETE /api/delete-user
// { user_id }
// Permanently removes a staff user from auth + DB. Owner only. Cannot delete yourself.

import { makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'DELETE') return json(405, { error: 'Method not allowed' });

  const token = (request.headers.get('authorization') || request.headers.get('Authorization') || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Unauthorized' });

  const admin = makeAdminClient(env);

  let caller;
  let callerRole;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: 'Invalid token' });
    caller = data.user;
    const { data: profile } = await admin
      .from('users')
      .select('roles(name)')
      .eq('auth_id', caller.id)
      .single();
    callerRole = profile?.roles?.name;
  } catch (err) {
    console.error('[delete-user] auth error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }

  if (callerRole !== 'Owner') {
    return json(403, { error: 'Only Owners can delete users.' });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON.' }); }
  if (!body.user_id) return json(400, { error: 'user_id is required.' });

  const { data: target, error: targetErr } = await admin
    .from('users')
    .select('auth_id, email, roles(name)')
    .eq('id', body.user_id)
    .single();

  if (targetErr || !target) return json(404, { error: 'User not found.' });
  if (target.auth_id === caller.id) return json(400, { error: 'You cannot delete your own account.' });

  if (target.auth_id) {
    const { error: deleteErr } = await admin.auth.admin.deleteUser(target.auth_id);
    if (deleteErr) {
      console.error('[delete-user] deleteUser error:', deleteErr.message);
      return json(500, { error: 'Failed to delete user. Please try again.' });
    }
    // public.users row is cascade-deleted by the FK constraint
  } else {
    // No auth row (invite never accepted) — delete public.users row directly
    await admin.from('users').delete().eq('id', body.user_id);
  }

  return json(200, { ok: true });
}
