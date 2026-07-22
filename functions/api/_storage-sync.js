// Storage Sync — push direction (portal → storage). The mirror.
// Portal uploads and finalized drafts get copied into every enabled+configured
// storage provider, preserving the portal folder structure. Storage is never
// the source of truth — R2 remains canonical.
//
// Both directions record every synced (provider, remote_id, remote_rev) in
// storage_sync_ledger — the loop guard that stops the mirror's own writes from
// echoing back through the pull as "new" files.
//
// These run via ctx.waitUntil (fire-and-forget) so they never delay the
// upload/finalize response. A provider failure is logged and skipped; it never
// fails the caller or blocks the other providers.

import { activeAdapters } from './_adapters/storage/index.js';

// Mirror a confirmed document upload to every active provider.
// doc must have: id, matter_id, r2_key, folder_path, file_name (name fallback)
export async function syncDocumentToStorage(env, doc, admin) {
  const adapters = await safeActive(env, admin);
  if (!adapters.length) return;
  await pushDocumentToAdapters(env, admin, doc, adapters);
}

// Push one document to the given adapters. Shared by the automatic mirror
// (two_way mode) and the manual "Push to storage" Files-tab action. Returns
// one result per adapter so callers can report per-provider success/failure.
export async function pushDocumentToAdapters(env, admin, doc, adapters) {
  const obj = await env.R2.get(doc.r2_key);
  if (!obj) {
    console.warn('[storage-sync] R2 object not found:', doc.r2_key);
    return adapters.map(a => ({ provider: a.constructor.provider, ok: false, error: 'File not found in storage' }));
  }

  const bytes      = await obj.arrayBuffer();
  const clientName = await fetchClientName(admin, doc.matter_id);
  const fileName   = doc.file_name || doc.name || 'document';

  const results = [];
  for (const adapter of adapters) {
    const provider = adapter.constructor.provider;
    try {
      const remotePath = adapter.buildDocPath(clientName, doc.folder_path || 'other', fileName);
      const meta = await adapter.upload(remotePath, bytes.slice(0));
      await recordLedger(admin, provider, meta, doc.r2_key, doc.id, 'push');
      console.log(`[storage-sync:${provider}] ✓ ${fileName} → ${meta.remote_path}`);
      results.push({ provider, ok: true, remote_path: meta.remote_path || remotePath });
    } catch (err) {
      console.error(`[storage-sync:${provider}] document sync failed:`, err.message);
      results.push({ provider, ok: false, error: err.message });
    }
  }
  return results;
}

// Mirror a finalized draft to every active provider under "Final Documents".
// draftDoc must have: matter_id, file_name, r2_key of latest version
export async function syncFinalDraftToStorage(env, draftDoc, admin) {
  const adapters = await safeActive(env, admin);
  if (!adapters.length) return;

  const obj = await env.R2.get(draftDoc.r2_key);
  if (!obj) { console.warn('[storage-sync] draft R2 object not found:', draftDoc.r2_key); return; }

  const bytes      = await obj.arrayBuffer();
  const clientName = await fetchClientName(admin, draftDoc.matter_id);

  for (const adapter of adapters) {
    try {
      const remotePath = adapter.buildDraftPath(clientName, draftDoc.file_name);
      const meta = await adapter.upload(remotePath, bytes.slice(0));
      await recordLedger(admin, adapter.constructor.provider, meta, draftDoc.r2_key, null, 'push');
      console.log(`[storage-sync:${adapter.constructor.provider}] ✓ draft ${draftDoc.file_name} → ${meta.remote_path}`);
    } catch (err) {
      console.error(`[storage-sync:${adapter.constructor.provider}] draft sync failed:`, err.message);
    }
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function safeActive(env, admin) {
  try {
    return await activeAdapters(env, admin);
  } catch (err) {
    console.error('[storage-sync] provider lookup failed:', err.message);
    return [];
  }
}

// Record a push in the sync ledger — the pull direction's loop guard.
// Uses the RESPONSE metadata (autorename may have changed the path).
async function recordLedger(admin, provider, meta, r2Key, documentId, direction) {
  if (!meta?.remote_id || !meta?.remote_rev) return;
  const { error } = await admin.from('storage_sync_ledger').upsert({
    provider,
    remote_id:    meta.remote_id,
    remote_path:  meta.remote_path || null,
    remote_rev:   meta.remote_rev,
    content_hash: meta.content_hash || null,
    r2_key:       r2Key,
    document_id:  documentId,
    direction,
  }, { onConflict: 'provider,remote_id,remote_rev' });
  if (error) console.error('[storage-sync] ledger write failed:', error.message);
}

async function fetchClientName(admin, matterId) {
  const { data } = await admin
    .from('matters')
    .select('client:clients(first_name, last_name)')
    .eq('id', matterId)
    .single();

  const c = data?.client;
  if (!c) return 'Unknown Client';
  // "Smith, John" format matches typical file system conventions
  return c.last_name ? `${c.last_name}, ${c.first_name}`.trim() : c.first_name || 'Unknown Client';
}
