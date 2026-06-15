// CF Pages Function: invite-client
// POST { client_id }
// Sends a Supabase invite to the client, links auth_id, sends welcome notification.

import { makeAdminClient, json } from './_helpers.js';
import { notifyClientInvited } from './_notifications.js';

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
    console.error('[invite-client] getUser error:', err.message);
    return json(503, { error: 'Authentication service unavailable. Please try again.' });
  }

  let callerRole;
  try {
    const { data } = await admin.from('users').select('roles(name)').eq('auth_id', caller.id).single();
    callerRole = data?.roles?.name;
  } catch (err) {
    console.error('[invite-client] caller profile error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }

  if (!['Owner', 'Attorney', 'Partner Attorney', 'Staff Admin'].includes(callerRole)) {
    return json(403, { error: 'Forbidden — Attorney or Owner role required' });
  }

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { client_id } = body;
  if (!client_id) return json(400, { error: 'client_id is required' });

  let client;
  try {
    const { data, error } = await admin
      .from('clients')
      .select('id, first_name, last_name, email, auth_id, active')
      .eq('id', client_id)
      .single();
    if (error) {
      console.error('[invite-client] client query error:', error.code, error.message);
      return json(404, { error: 'Client not found' });
    }
    if (!data) return json(404, { error: 'Client not found' });
    client = data;
  } catch (err) {
    console.error('[invite-client] client fetch error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }

  if (!client.active) return json(400, { error: 'Client is not active' });
  if (!client.email)  return json(400, { error: 'Client has no email address on file' });
  if (client.auth_id) return json(409, { error: 'Client already has portal access' });

  let clientRoleId;
  try {
    const { data } = await admin.from('roles').select('id').eq('name', 'Client').single();
    if (!data) return json(500, { error: 'Client role not found — run migration 005' });
    clientRoleId = data.id;
  } catch (err) {
    console.error('[invite-client] role fetch error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }

  let invited;
  try {
    const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';
    const { data, error } = await admin.auth.admin.inviteUserByEmail(client.email, {
      data: { first_name: client.first_name, last_name: client.last_name },
      redirectTo: `${portalUrl}/reset-password`,
    });
    if (error) return json(400, { error: error.message });
    invited = data;
  } catch (err) {
    console.error('[invite-client] inviteUserByEmail error:', err.message);
    return json(503, { error: 'Failed to send invite. Please try again.' });
  }

  try {
    await admin.from('clients').update({ auth_id: invited.user.id }).eq('id', client_id);
  } catch (err) {
    console.error('[invite-client] auth_id link error:', err.message);
  }

  try {
    await admin.from('users').update({
      first_name: client.first_name,
      last_name:  client.last_name,
      role_id:    clientRoleId,
    }).eq('auth_id', invited.user.id);
  } catch (err) {
    console.error('[invite-client] profile update error:', err.message);
  }

  const clientName = `${client.first_name} ${client.last_name}`.trim();
  await notifyClientInvited(env, { toEmail: client.email, clientName }).catch(err =>
    console.error('[invite-client] notification error:', err.message)
  );

  return json(200, { ok: true, userId: invited.user.id });
}
