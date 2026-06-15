// CF Pages Function: confirm-upload
// POST { document_id, file_size?, was_placeholder? }
// Called after the browser successfully PUTs to R2.
// Verifies real object size, runs a malware scan (attachmentAV via presigned
// URL — see _scan.js), then sets status → 'received'. Infected files are
// deleted from R2 and quarantined before they ever become visible.

import { verifyAuth, deleteR2Object, json } from './_helpers.js';
import { scanR2Object, getR2ObjectSize, MAX_UPLOAD_BYTES } from './_scan.js';
import { notifyDocumentUploaded, notifyChecklistItemReceived, notifyMalwareBlocked } from './_notifications.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[confirm-upload] Unhandled error:', err);
    return json(500, { error: `Unexpected error: ${err?.message || err}` });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'uploads', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { document_id, file_size, was_placeholder } = body;
  if (!document_id) return json(400, { error: 'document_id is required' });

  const { admin, profile } = auth;

  const { data: doc, error: fetchErr } = await admin
    .from('documents')
    .select('id, status, uploaded_by, deleted_at, matter_id, r2_key, name, file_name')
    .eq('id', document_id)
    .single();

  if (fetchErr || !doc) return json(404, { error: 'Document not found' });
  if (doc.deleted_at)  return json(410, { error: 'Document has been deleted' });
  if (doc.status !== 'pending') return json(409, { error: `Document is already ${doc.status}` });
  if (doc.r2_key.startsWith('pending/')) return json(409, { error: 'No file has been uploaded for this document' });

  // ── Verify the object actually landed, at a size we allow ────────────────
  // The presigned PUT can't enforce size — a tampered client could declare
  // 1MB in get-upload-url and PUT 5GB. Check the real object, not the claim.
  const actualSize = await getR2ObjectSize(env, doc.r2_key);
  if (actualSize === null) return json(409, { error: 'File was not received by storage. Please try uploading again.' });

  if (actualSize > MAX_UPLOAD_BYTES) {
    await rejectUpload(admin, env, doc, was_placeholder, {
      scan_status: 'pending',
      scan_detail: { rejected: 'oversize', actual_bytes: actualSize },
    });
    return json(413, { error: `File is too large (${(actualSize / 1024 / 1024).toFixed(1)}MB). Maximum size is 25MB.` });
  }

  // ── Malware scan (before the document ever becomes visible) ──────────────
  const { verdict, detail } = await scanR2Object(env, doc.r2_key);

  if (verdict === 'infected') {
    await rejectUpload(admin, env, doc, was_placeholder, {
      scan_status: 'infected',
      scan_detail: detail,
      scanned_at: new Date().toISOString(),
    });

    try {
      const matterInfo = await fetchMatterInfo(admin, document_id, doc.matter_id);
      if (matterInfo?.attorneyEmail) {
        await notifyMalwareBlocked(env, {
          toEmail:      matterInfo.attorneyEmail,
          uploaderName: `${profile.first_name} ${profile.last_name}`.trim(),
          clientName:   matterInfo.clientName,
          fileName:     doc.file_name,
          matterLabel:  matterInfo.matterLabel,
          finding:      detail.finding,
        });
      }
    } catch (notifyErr) {
      console.error('[confirm-upload] malware notification error:', notifyErr.message);
    }

    return json(422, { error: 'This file failed our security scan and has been removed. Please verify your device is free of malware and try a different copy of the document.' });
  }

  // ── Clean (or scan skipped — graceful degradation) ────────────────────────
  const update = {
    status:      'received',
    scan_status: verdict,           // 'clean' | 'skipped'
    scan_detail: detail,
    scanned_at:  new Date().toISOString(),
    file_size:   actualSize,
  };
  if (!actualSize && file_size && Number(file_size) > 0) update.file_size = Number(file_size);

  const { error: updateErr } = await admin
    .from('documents')
    .update(update)
    .eq('id', document_id);

  if (updateErr) return json(500, { error: updateErr.message });

  if (auth.isClient) {
    try {
      const { data: fullDoc } = await admin
        .from('documents')
        .select('name, file_name, is_checklist_item:r2_key, matter:matters(case_type, case_number, client:clients(first_name, last_name), attorney:users!matters_assigned_attorney_id_fkey(email, first_name, last_name))')
        .eq('id', document_id)
        .single();

      if (fullDoc?.matter?.attorney?.email) {
        const { matter } = fullDoc;
        const clientName  = `${matter.client.first_name} ${matter.client.last_name}`.trim();
        const matterLabel = `${matter.case_type}${matter.case_number ? ' · ' + matter.case_number : ''}`;
        const uploaderName = `${profile.first_name} ${profile.last_name}`.trim();

        const wasChecklist = fullDoc.is_checklist_item?.startsWith('matters/') &&
          !fullDoc.is_checklist_item?.startsWith('pending/');

        if (wasChecklist) {
          await notifyChecklistItemReceived(env, {
            toEmail: matter.attorney.email,
            clientName, documentLabel: fullDoc.name, matterLabel,
          });
        } else {
          await notifyDocumentUploaded(env, {
            toEmail: matter.attorney.email,
            uploaderName, clientName, fileName: fullDoc.file_name, matterLabel,
          });
        }
      }
    } catch (notifyErr) {
      console.error('[confirm-upload] notification error:', notifyErr.message);
    }
  }

  return json(200, { ok: true });
}

// ── Reject an upload (infected or oversize) ──────────────────────────────────
// Deletes the object from R2, then either reverts the row to a checklist
// placeholder (so the client can re-upload) or soft-deletes it — the row
// remains as the quarantine/audit record either way.

async function rejectUpload(admin, env, doc, wasPlaceholder, scanFields) {
  try {
    await deleteR2Object(env, doc.r2_key);
  } catch (err) {
    console.error(`[confirm-upload] failed to delete rejected object ${doc.r2_key}:`, err.message);
  }

  const update = wasPlaceholder
    ? {
        // Restore re-uploadable placeholder (file_name is NOT NULL — mirror
        // the apply-checklist placeholder shape); keep the verdict in
        // scan_detail.last_rejected so the event stays traceable.
        r2_key:       `pending/${doc.matter_id}/${doc.id}`,
        file_name:    doc.name,
        file_size:    null,
        content_type: 'application/octet-stream',
        scan_status:  'pending',
        scan_detail:  { last_rejected: scanFields.scan_detail, at: new Date().toISOString() },
      }
    : {
        deleted_at: new Date().toISOString(),
        ...scanFields,
      };

  const { error } = await admin.from('documents').update(update).eq('id', doc.id);
  if (error) console.error('[confirm-upload] failed to update rejected document:', error.message);
}

// ── Matter info for the malware notification ────────────────────────────────

async function fetchMatterInfo(admin, documentId, matterId) {
  const { data: matter } = await admin
    .from('matters')
    .select('case_type, case_number, client:clients(first_name, last_name), attorney:users!matters_assigned_attorney_id_fkey(email)')
    .eq('id', matterId)
    .single();

  if (!matter) return null;
  return {
    attorneyEmail: matter.attorney?.email || null,
    clientName:    matter.client ? `${matter.client.first_name} ${matter.client.last_name}`.trim() : '',
    matterLabel:   `${matter.case_type}${matter.case_number ? ' · ' + matter.case_number : ''}`,
  };
}
