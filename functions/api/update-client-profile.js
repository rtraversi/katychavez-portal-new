// POST /api/update-client-profile
// Client-only: update own contact, address, employer, and emergency contact fields.
// Uses the service key (admin) so no RLS UPDATE policy is needed on clients.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

const ALLOWED_FIELDS = [
  'phone', 'home_phone', 'work_phone', 'cell_phone',
  'address_line1', 'address_line2', 'city', 'state', 'zip', 'county',
  'preferred_contact',
  'employer', 'employer_address_line1', 'employer_city', 'employer_state', 'employer_zip',
  'emergency_contact_name', 'emergency_contact_phone',
];

const PREFERRED_CONTACT_VALUES = new Set(['phone', 'email', 'portal', 'text']);

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'core', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  if (!auth.isClient) return json(403, { error: 'Only client accounts can use this endpoint.' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const updates = {};
  for (const key of ALLOWED_FIELDS) {
    if (!(key in body)) continue;
    const val = body[key];
    if (key === 'preferred_contact' && val && !PREFERRED_CONTACT_VALUES.has(val)) continue;
    updates[key] = typeof val === 'string' ? (val.trim() || null) : val;
  }

  if (!Object.keys(updates).length) return json(400, { error: 'No valid fields provided.' });

  updates.profile_completed_at = new Date().toISOString();

  const admin = makeAdminClient(env);

  const { data: clientRow, error: lookupErr } = await admin
    .from('clients')
    .select('id')
    .eq('auth_id', auth.user.id)
    .single();

  if (lookupErr || !clientRow) {
    console.error('[update-client-profile] lookup:', lookupErr?.message);
    return json(404, { error: 'No client record found for your account.' });
  }

  const { error: updateErr } = await admin
    .from('clients')
    .update(updates)
    .eq('id', clientRow.id);

  if (updateErr) {
    console.error('[update-client-profile] update:', updateErr.message);
    return json(500, { error: 'Failed to save. Please try again.' });
  }

  return json(200, { ok: true });
}
