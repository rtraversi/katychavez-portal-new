// POST   /api/client-intake-opposing-party  — create or update (body.id = update)
// DELETE /api/client-intake-opposing-party?id=xxx&matter_id=xxx
// Client-only. Requires the client's own matter, not yet intake-locked.

import { verifyAuth, json } from './_helpers.js';
import { resolveOwnedMatter, pickFields } from './_client-intake-helpers.js';

const ALLOWED_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'former_maiden_name', 'dob',
  'home_phone', 'work_phone', 'cell_phone', 'email',
  'address_line1', 'address_line2', 'city', 'state', 'zip', 'county',
  'mailing_address_line1', 'mailing_city', 'mailing_state', 'mailing_zip',
  'employer', 'employer_address_line1', 'employer_city', 'employer_state', 'employer_zip',
  'length_of_employment', 'gross_annual_income', 'education',
  'living_with_others', 'length_of_residence',
];

export async function onRequest({ request, env }) {
  if (!['POST', 'DELETE'].includes(request.method)) return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'core', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (!auth.isClient) return json(403, { error: 'Only client accounts can use this endpoint.' });

  const { admin } = auth;

  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const matterId = url.searchParams.get('matter_id');
    if (!id) return json(400, { error: 'id is required.' });

    const resolved = await resolveOwnedMatter(admin, auth.user.id, matterId);
    if (resolved.error) return json(resolved.error.status, { error: resolved.error.message });

    const { error } = await admin.from('opposing_parties').delete().eq('id', id).eq('matter_id', matterId);
    if (error) return json(500, { error: 'Failed to delete.' });
    return json(200, { ok: true });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const resolved = await resolveOwnedMatter(admin, auth.user.id, body.matter_id);
  if (resolved.error) return json(resolved.error.status, { error: resolved.error.message });

  const fields = pickFields(body, ALLOWED_FIELDS);
  if (!fields.first_name) return json(400, { error: 'first_name is required.' });

  if (body.id) {
    const { data, error } = await admin
      .from('opposing_parties')
      .update(fields)
      .eq('id', body.id)
      .eq('matter_id', body.matter_id)
      .select()
      .single();
    if (error) return json(500, { error: 'Failed to save.' });
    return json(200, { ok: true, opposing_party: data });
  }

  const { data, error } = await admin
    .from('opposing_parties')
    .insert({ ...fields, matter_id: body.matter_id })
    .select()
    .single();
  if (error) return json(500, { error: 'Failed to save.' });
  return json(200, { ok: true, opposing_party: data });
}
