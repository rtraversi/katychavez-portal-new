// Shared trash / permanent-deletion logic for the File Manager.
//
// Soft delete (delete-document.js) only stamps documents.deleted_at and KEEPS
// the R2 object + version history, so a trashed file can be restored intact.
// Permanent removal happens in exactly two places, both routed through here:
//   • Empty trash / Delete forever  (purge-trash.js, staff-triggered)
//   • 30-day auto-purge cron        (runTrashPurge, daily)
// Both must clean up every R2 object the document owns — the live key AND each
// document_versions.r2_key — because the DB rows cascade on delete but the R2
// objects do not.

import { makeAdminClient, deleteR2Object } from './_helpers.js';

const RETENTION_DAYS = 30;

// Collect the de-duplicated set of R2 keys a document owns: its current key
// plus every version key. Pending/ keys are skipped (no object exists yet) and
// null/blank keys are ignored. Pure function — unit tested.
export function collectPurgeKeys(doc, versions = []) {
  const keys = new Set();
  const add = (k) => {
    if (k && typeof k === 'string' && !k.startsWith('pending/')) keys.add(k);
  };
  add(doc?.r2_key);
  for (const v of (versions || [])) add(v?.r2_key);
  return [...keys];
}

// Permanently delete one document: every R2 object it owns, then the DB row
// (which cascades document_versions rows). R2 failures are logged but don't
// abort — a missing object shouldn't strand the DB row. Returns the R2 key
// count deleted. Throws only if the DB row delete fails.
export async function purgeDocument(env, admin, doc) {
  const { data: versions } = await admin
    .from('document_versions')
    .select('r2_key')
    .eq('document_id', doc.id);

  const keys = collectPurgeKeys(doc, versions || []);
  for (const key of keys) {
    try {
      await deleteR2Object(env, key);
    } catch (err) {
      console.error('[trash] R2 delete failed for', key, err?.message || err);
    }
  }

  const { error } = await admin.from('documents').delete().eq('id', doc.id);
  if (error) throw new Error(error.message);
  return keys.length;
}

// Cron entry point (daily): permanently purge every document that has been in
// the trash longer than the retention window. Batched/limited so one run can't
// blow the CPU budget; the next daily run picks up any remainder.
export async function runTrashPurge(env, retentionDays = RETENTION_DAYS) {
  const admin = makeAdminClient(env);
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();

  const { data: docs, error } = await admin
    .from('documents')
    .select('id, r2_key')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff)
    .limit(500);

  if (error) {
    console.error('[trash-purge] query error:', error.message);
    return { purged: 0, error: error.message };
  }

  let purged = 0;
  for (const doc of (docs || [])) {
    try {
      await purgeDocument(env, admin, doc);
      purged++;
    } catch (err) {
      console.error('[trash-purge] failed for', doc.id, err?.message || err);
    }
  }

  if (purged) console.log('[trash-purge] purged', purged, 'documents past retention');
  return { purged };
}
