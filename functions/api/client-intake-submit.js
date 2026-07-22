// POST /api/client-intake-submit
// Body: { matter_id }
// Client-only. Locks intake for the matter (intake_submitted_at) and
// notifies the assigned attorney. Idempotency: resolveOwnedMatter already
// rejects if intake_submitted_at is already set.

import { verifyAuth, json } from './_helpers.js';
import { resolveOwnedMatter } from './_client-intake-helpers.js';
import { notifyIntakeSubmitted } from './_notifications.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'core', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (!auth.isClient) return json(403, { error: 'Only client accounts can use this endpoint.' });

  const { admin } = auth;

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const resolved = await resolveOwnedMatter(admin, auth.user.id, body.matter_id);
  if (resolved.error) return json(resolved.error.status, { error: resolved.error.message });

  const { error: updateErr } = await admin
    .from('matters')
    .update({ intake_submitted_at: new Date().toISOString() })
    .eq('id', body.matter_id);

  if (updateErr) {
    console.error('[client-intake-submit] update:', updateErr.message);
    return json(500, { error: 'Failed to submit intake.' });
  }

  try {
    const { data: full } = await admin
      .from('matters')
      .select('case_type, case_number, client:clients(first_name, last_name), attorney:users!matters_assigned_attorney_id_fkey(email)')
      .eq('id', body.matter_id)
      .single();

    if (full?.attorney?.email) {
      const clientName  = full.client ? `${full.client.first_name} ${full.client.last_name}`.trim() : '';
      const matterLabel = `${full.case_type}${full.case_number ? ' · ' + full.case_number : ''}`;
      await notifyIntakeSubmitted(env, { toEmail: full.attorney.email, clientName, matterLabel });
    }
  } catch (err) {
    console.error('[client-intake-submit] notification error:', err.message);
  }

  return json(200, { ok: true });
}
