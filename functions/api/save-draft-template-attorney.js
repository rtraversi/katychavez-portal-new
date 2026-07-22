// POST /api/save-draft-template-attorney
// Update assigned_attorney_initials on a single draft_template.
// Requires write access on the doc_drafting module.
// Body: { id: uuid, assigned_attorney_initials: string | null }

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'doc_drafting');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { id, assigned_attorney_initials } = body;
  if (!id) return json(400, { error: 'id is required.' });

  const admin = makeAdminClient(env);

  const { error } = await admin
    .from('draft_templates')
    .update({ assigned_attorney_initials: assigned_attorney_initials || null })
    .eq('id', id);

  if (error) {
    console.error('[save-draft-template-attorney] update:', error.message);
    return json(500, { error: 'Failed to update template.' });
  }

  return json(200, { ok: true });
}
