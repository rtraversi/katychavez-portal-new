// POST /api/send-intake
// Body: { matter_id }
// Staff-only. Generates (or rotates) a public intake token on the matter, stamps
// intake_sent_at + a 14-day intake_expires_at, and emails the client a link to
// the public pre-portal intake form (/intake?token=). No portal account required.
//
// Rotating the token on every call means a "Resend" invalidates any prior link.
// Mirrors invite-client.js for the caller auth + role gate.

import { makeAdminClient, json } from './_helpers.js';
import { notifyIntakeRequest } from './_notifications.js';

const INTAKE_TTL_DAYS = 14;
const ALLOWED_ROLES = ['Owner', 'Attorney', 'Partner Attorney', 'Staff Admin'];

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const bearer = (request.headers.get('authorization') || request.headers.get('Authorization') || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return json(401, { error: 'Unauthorized' });

  const admin = makeAdminClient(env);

  let caller;
  try {
    const { data, error } = await admin.auth.getUser(bearer);
    if (error || !data?.user) return json(401, { error: 'Invalid token' });
    caller = data.user;
  } catch (err) {
    console.error('[send-intake] getUser error:', err.message);
    return json(503, { error: 'Authentication service unavailable. Please try again.' });
  }

  let callerRole;
  try {
    const { data } = await admin.from('users').select('roles(name)').eq('auth_id', caller.id).single();
    callerRole = data?.roles?.name;
  } catch (err) {
    console.error('[send-intake] caller profile error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }
  if (!ALLOWED_ROLES.includes(callerRole)) {
    return json(403, { error: 'Forbidden — Attorney or Owner role required' });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const { matter_id } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required' });

  let matter;
  try {
    const { data, error } = await admin
      .from('matters')
      .select('id, intake_submitted_at, client:clients(first_name, last_name, email)')
      .eq('id', matter_id)
      .single();
    if (error || !data) return json(404, { error: 'Matter not found' });
    matter = data;
  } catch (err) {
    console.error('[send-intake] matter fetch error:', err.message);
    return json(503, { error: 'Service unavailable. Please try again.' });
  }

  if (matter.intake_submitted_at) {
    return json(409, { error: 'Intake has already been submitted for this matter.' });
  }
  const client = matter.client;
  if (!client?.email) return json(400, { error: 'Client has no email address on file' });

  const newToken = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + INTAKE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { error: updErr } = await admin
    .from('matters')
    .update({
      intake_token:      newToken,
      intake_sent_at:    now.toISOString(),
      intake_expires_at: expires.toISOString(),
    })
    .eq('id', matter_id);
  if (updErr) {
    console.error('[send-intake] token update error:', updErr.message);
    return json(500, { error: 'Failed to prepare intake link.' });
  }

  const portalUrl  = (env.PORTAL_URL || 'https://divorcedifferently.com').replace(/\/+$/, '');
  const link       = `${portalUrl}/intake?token=${newToken}`;
  const clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim();

  await notifyIntakeRequest(env, { toEmail: client.email, clientName, link }).catch(err =>
    console.error('[send-intake] notification error:', err.message)
  );

  return json(200, { ok: true, sent_at: now.toISOString(), expires_at: expires.toISOString() });
}
