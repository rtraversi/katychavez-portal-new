// CF Pages Function: save-ssn
// POST { entity_type, entity_id, ssn }
// Encrypts the SSN with AES-256-GCM and logs to sensitive_field_audit.

import { verifyAuth, ssnEncrypt, json } from './_helpers.js';

const ALLOWED_TABLES = new Set([
  'clients',
  'opposing_parties',
  'children',
  'children_other_relationships',
]);

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[save-ssn] Unhandled error:', err);
    return json(500, { error: 'An unexpected error occurred. Please try again.' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'core');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { entity_type, entity_id, ssn } = body;

  if (!entity_type)                     return json(400, { error: 'entity_type is required' });
  if (!ALLOWED_TABLES.has(entity_type)) return json(400, { error: 'Invalid entity_type' });
  if (!entity_id)                       return json(400, { error: 'entity_id is required' });
  if (!ssn)                             return json(400, { error: 'ssn is required' });

  const digits = String(ssn).replace(/\D/g, '');
  if (digits.length !== 9) return json(400, { error: 'SSN must be exactly 9 digits' });

  const { admin, profile } = auth;

  const { data: entity, error: fetchErr } = await admin
    .from(entity_type)
    .select('id')
    .eq('id', entity_id)
    .single();
  if (fetchErr || !entity) return json(404, { error: `${entity_type} record not found` });

  let encrypted;
  try {
    encrypted = ssnEncrypt(digits, env);
  } catch (err) {
    console.error('[save-ssn] Encryption error:', err.message);
    return json(500, { error: 'Encryption service unavailable. Contact support.' });
  }

  const last4 = digits.slice(-4);

  const { error: updateErr } = await admin
    .from(entity_type)
    .update({ ssn_encrypted: encrypted, ssn_last4: last4 })
    .eq('id', entity_id);
  if (updateErr) return json(500, { error: updateErr.message });

  try {
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || null;
    await admin.from('sensitive_field_audit').insert({
      entity_type,
      entity_id,
      field_name:   'ssn',
      action:       'write',
      performed_by: profile.id,
      ip_address:   ip,
    });
  } catch (e) {
    console.error('[save-ssn] Audit log failed:', e.message);
  }

  return json(200, { ok: true, last4 });
}
