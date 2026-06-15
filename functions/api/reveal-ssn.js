// CF Pages Function: reveal-ssn
// POST { entity_type, entity_id }
// Decrypts ssn_encrypted and returns the formatted SSN. Every call is audit-logged.

import { verifyAuth, ssnDecrypt, json } from './_helpers.js';

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
    console.error('[reveal-ssn] Unhandled error:', err);
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

  const { entity_type, entity_id } = body;

  if (!entity_type)                     return json(400, { error: 'entity_type is required' });
  if (!ALLOWED_TABLES.has(entity_type)) return json(400, { error: 'Invalid entity_type' });
  if (!entity_id)                       return json(400, { error: 'entity_id is required' });

  const { admin, profile } = auth;

  const { data: entity, error: fetchErr } = await admin
    .from(entity_type)
    .select('ssn_encrypted')
    .eq('id', entity_id)
    .single();

  if (fetchErr || !entity)   return json(404, { error: 'Record not found' });
  if (!entity.ssn_encrypted) return json(404, { error: 'No SSN on file for this record' });

  let plaintext;
  try {
    plaintext = ssnDecrypt(entity.ssn_encrypted, env);
  } catch (err) {
    console.error('[reveal-ssn] Decryption error:', err.message);
    return json(500, { error: 'Failed to decrypt SSN. Contact support.' });
  }

  const ssn = `${plaintext.slice(0,3)}-${plaintext.slice(3,5)}-${plaintext.slice(5)}`;

  try {
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || null;
    await admin.from('sensitive_field_audit').insert({
      entity_type,
      entity_id,
      field_name:   'ssn',
      action:       'read',
      performed_by: profile.id,
      ip_address:   ip,
    });
  } catch (e) {
    console.error('[reveal-ssn] Audit log failed:', e.message);
  }

  return json(200, { ssn });
}
