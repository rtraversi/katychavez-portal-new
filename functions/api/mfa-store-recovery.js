// POST /api/mfa-store-recovery
// { codes: string[] }  (8 plain-text recovery codes)
// Hashes each code with SHA-256 and stores in user_mfa_recovery_codes,
// replacing any existing codes for the caller.

import { makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (request.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Unauthorized' });

  const admin = makeAdminClient(env);

  // Verify caller
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData?.user) return json(401, { error: 'Invalid token' });
  const authId = authData.user.id;

  const { data: profile } = await admin
    .from('users')
    .select('id')
    .eq('auth_id', authId)
    .single();
  if (!profile) return json(403, { error: 'User not found' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (!Array.isArray(body.codes) || body.codes.length === 0) {
    return json(400, { error: 'codes array is required' });
  }

  // Hash each code with SHA-256 using the Web Crypto API (available in CF Workers)
  const hashes = await Promise.all(body.codes.map(async code => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }));

  // Delete old codes and insert new ones in a single delete + insert
  await admin.from('user_mfa_recovery_codes').delete().eq('user_id', profile.id);
  const { error: insertErr } = await admin.from('user_mfa_recovery_codes').insert(
    hashes.map(h => ({ user_id: profile.id, code_hash: h }))
  );
  if (insertErr) {
    console.error('[mfa-store-recovery] insert error:', insertErr.message);
    return json(500, { error: 'Failed to store recovery codes.' });
  }

  return json(200, { ok: true });
}
