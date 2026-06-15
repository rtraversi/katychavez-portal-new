// CF Pages Function: get-signature-request
// GET /api/get-signature-request?id=<uuid>
// Staff with esign read access OR the client for this matter.

import { verifyAuth, makeR2Client, json } from './_helpers.js';
import { getSignedUrl }     from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json(400, { error: 'id is required' });

  const auth = await verifyAuth(request, env, 'read', 'esign', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const { admin, user, isClient } = auth;

  let req;
  try {
    const { data, error } = await admin
      .from('signature_requests')
      .select(`
        id, status, requires_countersign, message, expires_at, created_at,
        document:documents(id, file_name, r2_key),
        matter:matters(id, client_id),
        requested_by_user:users!requested_by(first_name, last_name),
        signatures(id, signer_role, signed_at, ip_address, user_agent, document_hash_before, document_hash_after, audit_log)
      `)
      .eq('id', id)
      .single();
    if (error || !data) return json(404, { error: 'Signature request not found' });
    req = data;
  } catch { return json(503, { error: 'Service unavailable. Please try again.' }); }

  if (isClient) {
    const { data: clientRow } = await admin
      .from('clients').select('id').eq('auth_id', user.id).eq('id', req.matter.client_id).maybeSingle();
    if (!clientRow) return json(403, { error: 'Forbidden' });
  }

  if (new Date(req.expires_at) < new Date() && req.status.startsWith('pending')) {
    try { await admin.from('signature_requests').update({ status: 'expired' }).eq('id', id); } catch {}
    req.status = 'expired';
  }

  let downloadUrl = null;
  try {
    const r2 = makeR2Client(env);
    downloadUrl = await getSignedUrl(r2, new GetObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key:    req.document.r2_key,
      ResponseContentDisposition: `inline; filename="${req.document.file_name}"`,
    }), { expiresIn: 900 });
  } catch (err) {
    console.error('[get-signature-request] presign error:', err.message);
  }

  return json(200, {
    id:                   req.id,
    status:               req.status,
    requires_countersign: req.requires_countersign,
    message:              req.message,
    expires_at:           req.expires_at,
    created_at:           req.created_at,
    document:             { id: req.document.id, file_name: req.document.file_name },
    requested_by:         req.requested_by_user,
    signatures:           req.signatures,
    download_url:         downloadUrl,
  });
}
