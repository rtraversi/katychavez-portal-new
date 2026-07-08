// CF Worker: POST /api/update-my-profile
// Body: { phone?, bar_number?, licensing_authority?, uscis_account_number?, fax? }
//
// Lets any staff user maintain their OWN professional info (the per-attorney
// fields USCIS forms autofill — see migration 1521). Goes through the Worker
// rather than direct supabase-js because the users table must not be
// self-writable wholesale: this endpoint whitelists exactly the professional
// columns, so role/active/email stay admin-only (Settings -> Users).

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

const ALLOWED_FIELDS = ['phone', 'bar_number', 'licensing_authority', 'uscis_account_number', 'fax'];
const MAX_LEN = 120;

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[update-my-profile]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  // Any authenticated staff member may edit their own professional info;
  // 'read' on core is the lowest staff bar. Clients have no users-table row
  // fields to maintain and verifyAuth's profile lookup scopes the update.
  const auth = await verifyAuth(request, env, 'read', 'core');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (!auth.profile?.id) return json(403, { error: 'No staff profile for this account.' });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const update = {};
  for (const key of ALLOWED_FIELDS) {
    if (!(key in body)) continue;
    const raw = body[key];
    if (raw != null && typeof raw !== 'string') return json(400, { error: `${key} must be a string.` });
    const val = (raw || '').trim().slice(0, MAX_LEN);
    update[key] = val || null;
  }
  if (!Object.keys(update).length) return json(400, { error: 'Nothing to update.' });

  const admin = makeAdminClient(env);
  const { error } = await admin.from('users').update(update).eq('id', auth.profile.id);
  if (error) return json(500, { error: error.message });

  return json(200, { updated: Object.keys(update) });
}
