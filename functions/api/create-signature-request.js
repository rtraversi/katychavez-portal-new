// CF Pages Function: create-signature-request
// POST { document_id, requires_countersign?, message? }
// Caller must have write access to esign module.

import { verifyAuth, json } from './_helpers.js';
import { notifySignatureRequested } from './_notifications.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'esign');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const { admin, profile } = auth;

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { document_id, requires_countersign = true, message } = body;
  if (!document_id) return json(400, { error: 'document_id is required' });

  let doc;
  try {
    const { data, error } = await admin
      .from('documents')
      .select('id, file_name, matter_id, r2_key, deleted_at')
      .eq('id', document_id)
      .single();
    if (error || !data) return json(404, { error: 'Document not found' });
    if (data.deleted_at) return json(400, { error: 'Document has been deleted' });
    doc = data;
  } catch { return json(503, { error: 'Service unavailable. Please try again.' }); }

  let client;
  try {
    const { data: m } = await admin.from('matters').select('id, client_id').eq('id', doc.matter_id).single();
    if (!m) return json(404, { error: 'Matter not found' });
    const { data: c } = await admin
      .from('clients')
      .select('id, first_name, last_name, email, auth_id')
      .eq('id', m.client_id)
      .single();
    client = c;
  } catch { return json(503, { error: 'Service unavailable. Please try again.' }); }

  if (!client)         return json(404, { error: 'Client not found' });
  if (!client.email)   return json(400, { error: 'Client has no email address on file' });
  if (!client.auth_id) return json(400, { error: 'Client has not been invited to the portal yet' });

  try {
    const { data: existing } = await admin
      .from('signature_requests')
      .select('id')
      .eq('document_id', document_id)
      .in('status', ['pending_client', 'pending_attorney'])
      .maybeSingle();
    if (existing) return json(409, { error: 'A signature request is already open for this document' });
  } catch { return json(503, { error: 'Service unavailable. Please try again.' }); }

  let req;
  try {
    const { data, error } = await admin
      .from('signature_requests')
      .insert({
        document_id,
        matter_id:            doc.matter_id,
        requested_by:         profile.id,
        requires_countersign: Boolean(requires_countersign),
        message:              message?.trim() || null,
      })
      .select()
      .single();
    if (error) throw error;
    req = data;
  } catch (err) {
    console.error('[create-signature-request] insert error:', err.message);
    return json(500, { error: 'Failed to create signature request' });
  }

  await notifySignatureRequested(env, {
    toEmail:      client.email,
    clientName:   `${client.first_name} ${client.last_name}`.trim(),
    requestedBy:  `${profile.first_name} ${profile.last_name}`.trim(),
    documentName: doc.file_name,
    message:      message?.trim() || null,
  }).catch(err => console.error('[create-signature-request] notify error:', err.message));

  return json(200, { ok: true, requestId: req.id });
}
