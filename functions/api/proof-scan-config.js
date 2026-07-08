// proof-scan-config.js — Read or save custom scan instructions.
// GET  → return { custom_instructions }
// POST → body { custom_instructions } → upsert singleton row

import { verifyAuth, json, makeAdminClient } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method === 'GET') {
    const auth = await verifyAuth(request, env, 'read', 'proof_scan');
    if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

    const admin = makeAdminClient(env);
    const { data: rows } = await admin
      .from('proof_scan_config')
      .select('custom_instructions, notify_email')
      .limit(1);

    return json(200, {
      custom_instructions: rows?.[0]?.custom_instructions || '',
      notify_email:        rows?.[0]?.notify_email        || '',
    });
  }

  if (request.method === 'POST') {
    const auth = await verifyAuth(request, env, 'write', 'proof_scan');
    if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

    let body;
    try { body = await request.json(); }
    catch { return json(400, { error: 'Invalid JSON' }); }

    const custom_instructions = typeof body.custom_instructions === 'string'
      ? body.custom_instructions
      : '';
    const notify_email = typeof body.notify_email === 'string'
      ? body.notify_email.trim()
      : '';

    const admin = makeAdminClient(env);

    // Check if a row exists
    const { data: existing } = await admin
      .from('proof_scan_config')
      .select('id')
      .limit(1);

    if (existing?.length) {
      await admin
        .from('proof_scan_config')
        .update({ custom_instructions, notify_email, updated_at: new Date().toISOString(), updated_by: auth.profile.id })
        .eq('id', existing[0].id);
    } else {
      await admin
        .from('proof_scan_config')
        .insert({ custom_instructions, notify_email, updated_by: auth.profile.id });
    }

    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed' });
}
