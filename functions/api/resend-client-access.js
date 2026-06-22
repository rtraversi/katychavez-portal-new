// CF Pages Function: resend-client-access
// POST { client_id }
// Sends a password-reset / portal-access email to a client who already has an auth account.

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
    console.error('[resend-client-access] getUser error:', err.message);
    return json(503, { error: 'Authentication service unavailable. Please try again.' });
  }

  let callerRole;
  try {
    const { data } = await admin.from('users').select('roles(name)').eq('auth_id', caller.id).single();
    callerRole = data?.roles?.name;
  } catch (err) {
    console.error('[resend-client-access] caller role error:', err.message);
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
    if (error || !data) return json(404, { error: 'Client not found' });
    client = data;
  } catch (err) {
    console.error('[resend-client-access] client fetch error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }

  if (!client.active)  return json(400, { error: 'Client is not active' });
  if (!client.email)   return json(400, { error: 'Client has no email address on file' });
  if (!client.auth_id) return json(400, { error: 'Client has not been invited yet — use Invite to portal instead' });

  const portalUrl = env.PORTAL_URL || 'https://divorcedifferently.com';

  let actionLink;
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type:    'recovery',
      email:   client.email,
      options: { redirectTo: portalUrl },
    });
    if (error) throw error;
    actionLink = data?.properties?.action_link;
  } catch (err) {
    console.error('[resend-client-access] generateLink error:', err.message);
    return json(500, { error: 'Failed to generate access link. Please try again.' });
  }

  console.log(`[resend-client-access] access link for ${client.email}: ${actionLink}`);

  const clientName = `${client.first_name} ${client.last_name}`.trim();
  await notifyClientInvited(env, { toEmail: client.email, clientName, inviteLink: actionLink }).catch(err =>
    console.error('[resend-client-access] notification error:', err.message)
  );

  return json(200, { ok: true });
}
