// CF Pages Function: sign-document
// POST { request_id, signature_image }
// Client signs (pending_client) or attorney counter-signs (pending_attorney).

import { verifyAuth, makeR2Client, json } from './_helpers.js';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { createHash } from 'crypto';
import { notifySignatureSigned, notifySignatureCompleted } from './_notifications.js';

async function streamToBuffer(stream) {
  const arrayBuf = await new Response(stream).arrayBuffer();
  return Buffer.from(arrayBuf);
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function buildCertPage(pdfDoc, opts) {
  const { signerName, signerRole, signedAt, ipAddress, documentName,
          documentHashBefore, signatureImageBase64 } = opts;

  const page     = pdfDoc.addPage([612, 792]);
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const margin = 50;
  let y = height - 60;

  page.drawRectangle({ x: 0, y: height - 80, width, height: 80, color: rgb(0.08, 0.15, 0.30) });
  page.drawText('E-SIGNATURE CERTIFICATE', {
    x: margin, y: height - 52, size: 16, font: fontBold, color: rgb(1, 1, 1),
  });
  page.drawText('IurisIQ Portal — Electronically Signed Document', {
    x: margin, y: height - 70, size: 9, font, color: rgb(0.75, 0.85, 1),
  });

  y = height - 110;
  page.drawText('DOCUMENT', { x: margin, y, size: 8, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
  y -= 16;
  page.drawText(documentName || 'Untitled document', { x: margin, y, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
  y -= 30;

  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 24;

  const roleLabel = signerRole === 'attorney' ? 'Attorney Counter-Signature' : 'Client Signature';
  page.drawText(roleLabel.toUpperCase(), { x: margin, y, size: 8, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
  y -= 18;
  page.drawText(signerName, { x: margin, y, size: 13, font: fontBold, color: rgb(0.08, 0.15, 0.30) });
  y -= 18;
  page.drawText(`Signed: ${new Date(signedAt).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' })}`, {
    x: margin, y, size: 10, font, color: rgb(0.2, 0.2, 0.2),
  });
  y -= 16;
  if (ipAddress) {
    page.drawText(`IP: ${ipAddress}`, { x: margin, y, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
    y -= 16;
  }

  if (signatureImageBase64) {
    try {
      const imgBuf = Buffer.from(signatureImageBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
      const pngImg = await pdfDoc.embedPng(imgBuf);
      const scale  = Math.min(200 / pngImg.width, 60 / pngImg.height);
      y -= 10;
      page.drawImage(pngImg, { x: margin, y: y - pngImg.height * scale, width: pngImg.width * scale, height: pngImg.height * scale });
      y -= pngImg.height * scale + 16;
    } catch { /* non-fatal */ }
  }

  y -= 10;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 24;

  page.drawText('INTEGRITY VERIFICATION', { x: margin, y, size: 8, font: fontBold, color: rgb(0.4, 0.4, 0.4) });
  y -= 16;
  page.drawText('SHA-256 of original document:', { x: margin, y, size: 9, font: fontBold, color: rgb(0.3, 0.3, 0.3) });
  y -= 14;
  page.drawText(documentHashBefore, { x: margin, y, size: 7.5, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 24;

  page.drawRectangle({ x: margin, y: y - 44, width: width - margin * 2, height: 44, color: rgb(0.96, 0.98, 1) });
  page.drawText('LEGAL NOTICE', { x: margin + 10, y: y - 14, size: 8, font: fontBold, color: rgb(0.3, 0.4, 0.6) });
  page.drawText('This document was signed electronically in accordance with the Texas Uniform Electronic Transactions Act (UETA).', {
    x: margin + 10, y: y - 28, size: 7.5, font, color: rgb(0.3, 0.3, 0.3),
  });
  page.drawText('Electronic signatures are legally binding under Texas law. This certificate is part of the signed document.', {
    x: margin + 10, y: y - 40, size: 7.5, font, color: rgb(0.3, 0.3, 0.3),
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleSign(request, env);
  } catch (err) {
    console.error('[sign-document] Unhandled error:', err.message, err.stack);
    return json(500, { error: 'An unexpected error occurred. Please try again.' });
  }
}

async function handleSign(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'esign', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const { admin, user, profile, isClient } = auth;

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { request_id, signature_image } = body;
  if (!request_id)      return json(400, { error: 'request_id is required' });
  if (!signature_image) return json(400, { error: 'signature_image is required' });
  if (signature_image.length > 500_000) return json(400, { error: 'Signature image too large.' });

  let req;
  try {
    const { data, error } = await admin
      .from('signature_requests')
      .select('*, document:documents(id, file_name, r2_key), matter:matters(id, client_id)')
      .eq('id', request_id)
      .single();
    if (error || !data) return json(404, { error: 'Signature request not found' });
    req = data;
  } catch { return json(503, { error: 'Service unavailable. Please try again.' }); }

  if (!req.document) return json(500, { error: 'Signature request has no linked document.' });
  if (!req.matter)   return json(500, { error: 'Signature request has no linked matter.' });

  if (req.status === 'completed') return json(409, { error: 'Document has already been fully signed' });
  if (req.status === 'declined')  return json(409, { error: 'Signature request was declined' });
  if (req.status === 'expired')   return json(409, { error: 'Signature request has expired' });
  if (new Date(req.expires_at) < new Date()) return json(409, { error: 'Signature request has expired' });

  let signerRole, signerName, signerUserId = null, signerClientId = null;

  if (isClient) {
    if (req.status !== 'pending_client') return json(409, { error: 'Not awaiting client signature' });
    const { data: clientRow } = await admin.from('clients')
      .select('id, first_name, last_name').eq('auth_id', user.id).eq('id', req.matter.client_id).maybeSingle();
    if (!clientRow) return json(403, { error: 'Forbidden' });
    signerRole     = 'client';
    signerName     = `${clientRow.first_name} ${clientRow.last_name}`.trim();
    signerClientId = clientRow.id;
  } else {
    if (!['Owner','Attorney','Partner Attorney'].includes(profile.roles?.name)) {
      return json(403, { error: 'Forbidden — attorney role required to counter-sign' });
    }
    if (req.status !== 'pending_attorney') return json(409, { error: 'Not awaiting attorney counter-signature' });
    signerRole   = 'attorney';
    signerName   = `${profile.first_name} ${profile.last_name}`.trim();
    signerUserId = profile.id;
  }

  const r2        = makeR2Client(env);
  const bucket    = env.R2_BUCKET_NAME;
  const ipAddress = request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = request.headers.get('user-agent') || null;
  const signedAt  = new Date().toISOString();

  let originalBuf;
  try {
    const obj = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: req.document.r2_key }));
    originalBuf = await streamToBuffer(obj.Body);
  } catch (err) {
    console.error('[sign-document] R2 fetch error:', err.message);
    return json(503, { error: 'Could not retrieve document. Please try again.' });
  }

  const hashBefore = sha256(originalBuf);

  let signedBuf;
  try {
    const pdfDoc = await PDFDocument.load(originalBuf, { ignoreEncryption: true });
    await buildCertPage(pdfDoc, {
      signerName, signerRole, signedAt, ipAddress,
      documentName:         req.document.file_name,
      documentHashBefore:   hashBefore,
      signatureImageBase64: signature_image,
    });
    signedBuf = Buffer.from(await pdfDoc.save());
  } catch (err) {
    console.error('[sign-document] pdf-lib error:', err.message);
    return json(500, { error: 'Failed to process PDF. Please try again.' });
  }

  const hashAfter = sha256(signedBuf);
  const signedKey = req.document.r2_key.replace(/\.pdf$/i, '') + `_signed_${signerRole}_${Date.now()}.pdf`;

  try {
    await r2.send(new PutObjectCommand({ Bucket: bucket, Key: signedKey, Body: signedBuf, ContentType: 'application/pdf' }));
  } catch (err) {
    console.error('[sign-document] R2 upload error:', err.message);
    return json(503, { error: 'Failed to save signed document. Please try again.' });
  }

  const auditLog = {
    request_id, document_id: req.document_id, matter_id: req.matter_id,
    signer_role: signerRole, signer_name: signerName, signed_at: signedAt,
    ip_address: ipAddress, user_agent: userAgent,
    hash_before: hashBefore, hash_after: hashAfter, r2_key_signed: signedKey,
  };

  try {
    await admin.from('signatures').insert({
      signature_request_id: request_id,
      signer_user_id:       signerUserId,
      signer_client_id:     signerClientId,
      signer_role:          signerRole,
      signed_at:            signedAt,
      ip_address:           ipAddress,
      user_agent:           userAgent,
      document_hash_before: hashBefore,
      document_hash_after:  hashAfter,
      signature_image,
      audit_log:            auditLog,
    });
  } catch (err) {
    console.error('[sign-document] signatures insert error:', err.message);
    return json(500, { error: 'Failed to record signature. Please try again.' });
  }

  const isCountersignNeeded = req.requires_countersign && signerRole === 'client';
  const newStatus = isCountersignNeeded ? 'pending_attorney' : 'completed';

  try {
    const docUpdate = { r2_key: signedKey };
    if (newStatus === 'completed') {
      docUpdate.status    = 'signed';
      docUpdate.file_name = req.document.file_name.replace(/\.pdf$/i, '_signed.pdf');
    }
    await admin.from('documents').update(docUpdate).eq('id', req.document_id);
  } catch (err) { console.error('[sign-document] doc update error:', err.message); }

  try {
    await admin.from('signature_requests').update({ status: newStatus }).eq('id', request_id);
  } catch (err) { console.error('[sign-document] status update error:', err.message); }

  if (newStatus === 'pending_attorney') {
    let reqByRow = null;
    try {
      const { data } = await admin.from('users').select('auth_id').eq('id', req.requested_by).maybeSingle();
      reqByRow = data;
    } catch {}
    if (reqByRow?.auth_id) {
      try {
        const { data: authUser } = await admin.auth.admin.getUserById(reqByRow.auth_id);
        if (authUser?.user?.email) {
          await notifySignatureSigned(env, {
            toEmail:      authUser.user.email,
            signerName,
            documentName: req.document.file_name,
            requestId:    request_id,
          });
        }
      } catch (err) { console.error('[sign-document] notify error:', err.message); }
    }
  } else {
    try {
      await notifySignatureCompleted(env, { documentName: req.document.file_name, requestId: request_id });
    } catch (err) { console.error('[sign-document] notify-completed error:', err.message); }
  }

  return json(200, { ok: true, status: newStatus, signedKey });
}
