// /api/storage-sync-unmatched
// GET  → list pending unmatched storage files (staff review queue, all providers)
// POST → { id, action: 'resolve', matter_id, create_alias? } imports the file
//        into the given matter (and optionally maps its top-level folder to
//        that client/matter permanently — the folder-alias path for folders
//        that can't name-match, e.g. PF matters).
//        { id, action: 'ignore' } marks it ignored (never asked again for
//        this provider+remote_id+rev).
//
// Requires write on the storage_sync module.

import { verifyAuth, json } from './_helpers.js';
import { adapterFor } from './_adapters/storage/index.js';
import { importEntry } from './_storage-pull.js';
import { MAX_SYNC_BYTES } from './_scan.js';

export async function onRequest(context) {
  const { request, env } = context;

  const auth = await verifyAuth(request, env, 'write', 'storage_sync');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const admin = auth.admin;

  if (request.method === 'GET') {
    const { data, error } = await admin
      .from('storage_sync_unmatched')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) return json(500, { error: error.message });
    return json(200, { files: data });
  }

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { id, action } = body;
  if (!id || !['resolve', 'ignore'].includes(action)) {
    return json(400, { error: 'id and action (resolve|ignore) are required' });
  }

  const { data: row, error: rowErr } = await admin
    .from('storage_sync_unmatched').select('*').eq('id', id).single();
  if (rowErr || !row) return json(404, { error: 'Unmatched file not found' });
  if (row.status !== 'pending') return json(409, { error: `Already ${row.status}` });

  const now = new Date().toISOString();

  if (action === 'ignore') {
    const { error } = await admin.from('storage_sync_unmatched')
      .update({ status: 'ignored', resolved_by: auth.profile.id, resolved_at: now })
      .eq('id', id);
    if (error) return json(500, { error: error.message });
    return json(200, { ok: true, status: 'ignored' });
  }

  // ── resolve ────────────────────────────────────────────────────────────────
  const { matter_id, create_alias } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required to resolve' });

  const { data: matter, error: mErr } = await admin
    .from('matters').select('id, client_id').eq('id', matter_id).single();
  if (mErr || !matter) return json(404, { error: 'Matter not found' });

  const adapter = adapterFor(env, row.provider);
  if (!adapter) {
    return json(503, { error: `${row.provider} is not configured on this deployment.` });
  }

  // Size gate — mirror the cron's processEntry() cap (step 5). Assign calls
  // importEntry() directly, so without this an over-size file would attempt a
  // download + scan and fail with a raw timeout instead of a clear message.
  if ((row.file_size || 0) > MAX_SYNC_BYTES) {
    return json(413, {
      error: `This file is ${(row.file_size / 1024 / 1024).toFixed(1)}MB, above the `
        + `${(MAX_SYNC_BYTES / 1024 / 1024).toFixed(0)}MB sync size limit. Download it from `
        + `${row.provider} and add it to the matter manually.`,
    });
  }

  try {
    // Rebuild the pipeline's NormEntry + relative folder path
    const entry = {
      provider:     row.provider,
      tag:          'file',
      remote_id:    row.remote_id,
      remote_path:  row.remote_path,
      name:         row.file_name,
      size:         row.file_size,
      rev:          row.remote_rev,
      content_hash: row.content_hash,
    };
    const rel = adapter.relativeParts(entry);
    const folderPath = rel?.folderPath || '';

    const ok = await importEntry(env, admin, adapter, entry, matter.id, folderPath);
    if (!ok) {
      // importEntry queues its own reason (e.g. infected) — surface generically
      return json(422, { error: 'File could not be imported (see review queue for reason).' });
    }

    // Find the document the import created/updated for the response + row
    const { data: ledger } = await admin
      .from('storage_sync_ledger').select('document_id')
      .eq('provider', row.provider)
      .eq('remote_id', row.remote_id)
      .not('document_id', 'is', null)
      .order('synced_at', { ascending: false })
      .limit(1).maybeSingle();

    await admin.from('storage_sync_unmatched').update({
      status: 'resolved',
      resolved_document_id: ledger?.document_id || null,
      resolved_by: auth.profile.id,
      resolved_at: now,
    }).eq('id', id);

    // Optional permanent mapping: this folder → this client/matter.
    if (create_alias && rel?.clientFolderLower) {
      const { error: aErr } = await admin.from('storage_sync_aliases').upsert({
        provider:          row.provider,
        folder_path_lower: rel.clientFolderLower,
        client_id:  matter.client_id,
        matter_id:  matter.id,
        created_by: auth.profile.id,
      }, { onConflict: 'provider,folder_path_lower' });
      if (aErr) console.error('[storage-sync-unmatched] alias write failed:', aErr.message);
    }

    return json(200, { ok: true, status: 'resolved', document_id: ledger?.document_id || null });
  } catch (err) {
    console.error('[storage-sync-unmatched] resolve failed:', err.message);
    return json(500, { error: `Import failed: ${err.message}` });
  }
}
