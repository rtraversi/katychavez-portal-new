// POST /api/set-matter-stage
// Body: { matter_id, stage_id }  — stage_id null clears the current stage
// Requires stages.write permission.
// Logs every change to matter_stage_history.

import { verifyAuth, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'stages');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, stage_id } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required' });

  const { admin, profile } = auth;

  const { data: matter, error: mErr } = await admin
    .from('matters')
    .select('id, current_stage_id')
    .eq('id', matter_id)
    .single();
  if (mErr || !matter) return json(404, { error: 'Matter not found' });

  const newStageId = stage_id || null;
  if (matter.current_stage_id === newStageId) return json(200, { ok: true });

  const { error: updErr } = await admin
    .from('matters')
    .update({ current_stage_id: newStageId })
    .eq('id', matter_id);
  if (updErr) return json(500, { error: updErr.message });

  let stageName = null;
  if (newStageId) {
    const { data: stage } = await admin
      .from('workflow_stages')
      .select('name')
      .eq('id', newStageId)
      .single();
    stageName = stage?.name || null;
  }

  await admin.from('matter_stage_history').insert({
    matter_id,
    stage_id:   newStageId,
    stage_name: stageName,
    changed_by: profile.id,
  });

  return json(200, { ok: true, stage_id: newStageId, stage_name: stageName });
}
