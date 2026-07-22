// POST   /api/client-intake-opposing-counsel  — create or update (body.id = update)
// DELETE /api/client-intake-opposing-counsel?id=xxx&matter_id=xxx
// Client-only. Requires the client's own matter, not yet intake-locked.
// A matter can have more than one row here — the other side's attorney,
// plus any collaborative-law neutrals (role field distinguishes them).

import { verifyAuth, json } from './_helpers.js';
import { resolveOwnedMatter, pickFields } from './_client-intake-helpers.js';

const ALLOWED_FIELDS = [
  'attorney_name', 'firm', 'phone', 'email',
  'address_line1', 'address_city', 'address_state', 'address_zip',
  'role',
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

    const { error } = await admin.from('opposing_counsels').delete().eq('id', id).eq('matter_id', matterId);
    if (error) return json(500, { error: 'Failed to delete.' });
    return json(200, { ok: true });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const resolved = await resolveOwnedMatter(admin, auth.user.id, body.matter_id);
  if (resolved.error) return json(resolved.error.status, { error: resolved.error.message });

  const fields = pickFields(body, ALLOWED_FIELDS);
  if (!fields.attorney_name) return json(400, { error: 'attorney_name is required.' });

  if (body.id) {
    const { data, error } = await admin
      .from('opposing_counsels')
      .update(fields)
      .eq('id', body.id)
      .eq('matter_id', body.matter_id)
      .select()
      .single();
    if (error) return json(500, { error: 'Failed to save.' });
    return json(200, { ok: true, opposing_counsel: data });
  }

  const { data, error } = await admin
    .from('opposing_counsels')
    .insert({ ...fields, matter_id: body.matter_id })
    .select()
    .single();
  if (error) return json(500, { error: 'Failed to save.' });
  return json(200, { ok: true, opposing_counsel: data });
}
