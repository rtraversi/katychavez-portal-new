// POST /api/mfa-recover
// { code: string }
// Validates a recovery code for the authenticated (aal1) caller.
// On success: marks the code as used and deletes their TOTP factor
// so they can re-enroll without being stuck behind an MFA gate.

import { makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const token = (request.headers.get('authorization') || '')
    .replace(/^Bearer\s+/i, '').trim();
  if (!token) return json(401, { error: 'Unauthorized' });

  const admin = makeAdminClient(env);

  // Verify caller (aal1 session is sufficient — they can't do aal2, that's the whole point)
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !authData?.user) return json(401, { error: 'Invalid token' });
  const authUserId = authData.user.id;

  const { data: profile } = await admin
    .from('users')
    .select('id')
    .eq('auth_id', authUserId)
    .single();
  if (!profile) return json(403, { error: 'User not found' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  const rawCode = (body.code || '').trim();
  if (!rawCode) return json(400, { error: 'code is required' });

  // Hash the submitted code
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawCode));
  const codeHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  // Find a matching unused recovery code
  const { data: row } = await admin
    .from('user_mfa_recovery_codes')
    .select('id')
    .eq('user_id', profile.id)
    .eq('code_hash', codeHash)
    .is('used_at', null)
    .single();

  if (!row) return json(400, { error: 'Invalid or already-used recovery code.' });

  // Mark code as used
  await admin.from('user_mfa_recovery_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id);

  // Find and delete the user's TOTP factor via the Admin REST API.
  // The Supabase admin JS SDK exposes this through admin.auth.admin.mfa.listFactors
  // and the Admin REST endpoint DELETE /auth/v1/admin/users/{uid}/factors/{fid}.
  try {
    const listRes = await fetch(
      `${env.SUPABASE_URL}/auth/v1/admin/users/${authUserId}/factors`,
      {
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          'apikey': env.SUPABASE_SERVICE_KEY,
        },
      }
    );
    if (listRes.ok) {
      const factors = await listRes.json();
      const totpFactors = Array.isArray(factors) ? factors.filter(f => f.factor_type === 'totp') : [];
      for (const f of totpFactors) {
        await fetch(
          `${env.SUPABASE_URL}/auth/v1/admin/users/${authUserId}/factors/${f.id}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'apikey': env.SUPABASE_SERVICE_KEY,
            },
          }
        );
      }
    }
  } catch (err) {
    console.error('[mfa-recover] factor delete error:', err.message);
    // Non-fatal: code is already marked used; user will need admin help if factor lingers
  }

  return json(200, { ok: true });
}
