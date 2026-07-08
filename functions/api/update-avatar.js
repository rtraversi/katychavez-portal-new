// update-avatar.js — save a user's profile photo (base64 data URL)
// POST /api/update-avatar
// Body: { avatar_data_url: string }  (must start with "data:image/")

import { verifyAuth, json, makeAdminClient } from './_helpers.js';

const MAX_BYTES = 512 * 1024; // 512 KB

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'core', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { avatar_data_url } = body;

  if (!avatar_data_url) return json(400, { error: 'avatar_data_url is required' });
  if (!avatar_data_url.startsWith('data:image/')) return json(400, { error: 'Invalid image format' });
  if (avatar_data_url.length > MAX_BYTES) return json(400, { error: 'Image too large (max 512 KB)' });

  const admin = makeAdminClient(env);
  const { error } = await admin
    .from('users')
    .update({ avatar_url: avatar_data_url })
    .eq('auth_id', auth.user.id);

  if (error) {
    console.error('[update-avatar] DB error:', error.message);
    return json(500, { error: 'Failed to save avatar' });
  }

  return json(200, { ok: true });
}
