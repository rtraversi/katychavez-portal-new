// CF Pages Function: decline-signature
// POST { request_id, reason? }
// Only the client (pending_client) can decline.

import { verifyAuth, json } from './_helpers.js';
import { notifySignatureDeclined } from './_notifications.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'esign', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const { admin, user, isClient } = auth;

  if (!isClient) return json(403, { error: 'Only the client can decline a signature request' });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { request_id, reason } = body;
  if (!request_id) return json(400, { error: 'request_id is required' });

  let req;
  try {
    const { data, error } = await admin
      .from('signature_requests')
      .select('id, status, requested_by, document:documents(file_name), matter:matters(client_id)')
      .eq('id', request_id)
      .single();
    if (error || !data) return json(404, { error: 'Signature request not found' });
    req = data;
  } catch { return json(503, { error: 'Service unavailable. Please try again.' }); }

  if (req.status !== 'pending_client') {
    return json(409, { error: 'Only pending client signature requests can be declined' });
  }

  const { data: clientRow } = await admin.from('clients')
    .select('id, first_name, last_name').eq('auth_id', user.id).eq('id', req.matter.client_id).maybeSingle();
  if (!clientRow) return json(403, { error: 'Forbidden' });

  try {
    await admin.from('signature_requests').update({ status: 'declined' }).eq('id', request_id);
  } catch (err) { console.error('[decline-signature] update error:', err.message); }

  let reqByRow = null;
  try {
    const { data } = await admin.from('users').select('auth_id').eq('id', req.requested_by).maybeSingle();
    reqByRow = data;
  } catch {}
  if (reqByRow?.auth_id) {
    try {
      const { data: authUser } = await admin.auth.admin.getUserById(reqByRow.auth_id);
      if (authUser?.user?.email) {
        await notifySignatureDeclined(env, {
          toEmail:      authUser.user.email,
          clientName:   `${clientRow.first_name} ${clientRow.last_name}`.trim(),
          documentName: req.document.file_name,
          reason:       reason?.trim() || null,
        });
      }
    } catch (err) { console.error('[decline-signature] notify error:', err.message); }
  }

  return json(200, { ok: true });
}
