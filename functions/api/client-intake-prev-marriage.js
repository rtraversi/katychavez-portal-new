// POST   /api/client-intake-prev-marriage  — create or update (body.id = update)
// DELETE /api/client-intake-prev-marriage?id=xxx&matter_id=xxx
// Client-only. Records the CLIENT's own previous marriages (Section E).
// party is always forced to 'client' server-side — the opposing party's prior
// marriage history, if relevant, is staff-entered on the same table.
// Requires the client's own matter, not yet intake-locked.

import { verifyAuth, json } from './_helpers.js';
import { resolveOwnedMatter, pickFields } from './_client-intake-helpers.js';

const ALLOWED_FIELDS = ['former_spouse_name', 'termination_date', 'termination_method'];

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

    const { error } = await admin.from('previous_marriages').delete()
      .eq('id', id).eq('matter_id', matterId).eq('party', 'client');
    if (error) return json(500, { error: 'Failed to delete.' });
    return json(200, { ok: true });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const resolved = await resolveOwnedMatter(admin, auth.user.id, body.matter_id);
  if (resolved.error) return json(resolved.error.status, { error: resolved.error.message });

  const fields = pickFields(body, ALLOWED_FIELDS);
  if (!fields.former_spouse_name) return json(400, { error: 'former_spouse_name is required.' });

  if (body.id) {
    const { data, error } = await admin
      .from('previous_marriages')
      .update(fields)
      .eq('id', body.id)
      .eq('matter_id', body.matter_id)
      .eq('party', 'client')
      .select()
      .single();
    if (error) return json(500, { error: 'Failed to save.' });
    return json(200, { ok: true, previous_marriage: data });
  }

  const { data, error } = await admin
    .from('previous_marriages')
    .insert({ ...fields, matter_id: body.matter_id, party: 'client' })
    .select()
    .single();
  if (error) return json(500, { error: 'Failed to save.' });
  return json(200, { ok: true, previous_marriage: data });
}
