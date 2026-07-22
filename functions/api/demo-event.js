// demo-event.js — logs a visitor event to demo_events table.
// Only active when DEMO_MODE=true. Silently no-ops in production.
// POST { session_id, role, event_type, module, action, ip_hash }

import { makeAdminClient, json } from './_helpers.js';
import { validate, DemoEventSchema } from './_schemas.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (env.DEMO_MODE !== 'true')  return json(200, { ok: true }); // no-op in production

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const v = validate(DemoEventSchema, body);
  if (v.error) return v.error;
  const { session_id, role, event_type, module, action, ip_hash } = v.data;

  try {
    const admin = makeAdminClient(env);
    await admin.from('demo_events').insert({ session_id, role, event_type, module, action, ip_hash });
    return json(200, { ok: true });
  } catch (err) {
    // Non-fatal — never block the visitor for an analytics failure
    console.error('[demo-event] insert error:', err.message);
    return json(200, { ok: true });
  }
}
