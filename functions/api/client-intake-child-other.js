// POST   /api/client-intake-child-other  — create or update (body.id = update)
// DELETE /api/client-intake-child-other?id=xxx&matter_id=xxx
// Client-only. Records children the CLIENT has from another relationship
// (Sections F/G). party is always forced to 'client' server-side — the
// opposing party's children from other relationships are staff-entered on
// the same table. ssn_encrypted is intentionally excluded — goes through the
// existing encrypted save-ssn/reveal-ssn pathway, not plain client self-entry.
// Requires the client's own matter, not yet intake-locked.

import { verifyAuth, json } from './_helpers.js';
import { resolveOwnedMatter, pickFields } from './_client-intake-helpers.js';

const ALLOWED_FIELDS = ['first_name', 'last_name', 'dob', 'current_residence'];

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

    const { error } = await admin.from('children_other_relationships').delete()
      .eq('id', id).eq('matter_id', matterId).eq('party', 'client');
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
      .from('children_other_relationships')
      .update(fields)
      .eq('id', body.id)
      .eq('matter_id', body.matter_id)
      .eq('party', 'client')
      .select()
      .single();
    if (error) return json(500, { error: 'Failed to save.' });
    return json(200, { ok: true, child_other: data });
  }

  const { data, error } = await admin
    .from('children_other_relationships')
    .insert({ ...fields, matter_id: body.matter_id, party: 'client' })
    .select()
    .single();
  if (error) return json(500, { error: 'Failed to save.' });
  return json(200, { ok: true, child_other: data });
}
