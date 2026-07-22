// Shared version-history helpers for the File Manager.
//
// Every save point for a document writes a new document_versions row + a fresh
// R2 object and repoints documents.r2_key at it (webdav.js PUT, _storage-pull.js
// importEntry, restore-version.js). To bound storage we keep only the newest
// VERSION_CAP versions per document and prune the rest at each write point.

import { deleteR2Object } from './_helpers.js';

export const VERSION_CAP = 20;

// Decide what to prune, given a document's versions (newest-first) and the live
// document key. Returns the version-row ids to delete and the R2 keys safe to
// delete. Key-aware: a key is only deleted if NO retained version and NOT the
// live document still points at it — this keeps a "restore" that re-points at an
// older version's key (see restore-version.js) from having its object deleted
// out from under it. Pure function — unit tested.
export function planVersionPrune(versions, cap = VERSION_CAP, liveKey = null) {
  if (!versions || versions.length <= cap) return { dropIds: [], keysToDelete: [] };

  const keep = versions.slice(0, cap);
  const drop = versions.slice(cap);

  const keptKeys = new Set(keep.map(v => v.r2_key).filter(Boolean));
  if (liveKey) keptKeys.add(liveKey);

  const keysToDelete = [];
  for (const v of drop) {
    if (!v.r2_key || v.r2_key.startsWith('pending/') || keptKeys.has(v.r2_key)) continue;
    keysToDelete.push(v.r2_key);
  }
  return { dropIds: drop.map(v => v.id), keysToDelete };
}

// Prune a document's history to the newest `cap` versions, deleting both the
// dropped rows and their (safe-to-remove) R2 objects. Returns rows dropped.
export async function pruneVersions(env, admin, documentId, cap = VERSION_CAP) {
  const { data: versions } = await admin
    .from('document_versions')
    .select('id, version_no, r2_key')
    .eq('document_id', documentId)
    .order('version_no', { ascending: false });

  if (!versions || versions.length <= cap) return 0;

  const { data: doc } = await admin
    .from('documents').select('r2_key').eq('id', documentId).single();

  const { dropIds, keysToDelete } = planVersionPrune(versions, cap, doc?.r2_key || null);
  if (!dropIds.length) return 0;

  const { error: delErr } = await admin
    .from('document_versions')
    .delete()
    .in('id', dropIds);
  if (delErr) {
    console.error('[versions] prune row delete failed:', delErr.message);
    return 0;
  }

  for (const key of keysToDelete) {
    try {
      await deleteR2Object(env, key);
    } catch (err) {
      console.error('[versions] prune R2 delete failed for', key, err?.message || err);
    }
  }

  return dropIds.length;
}
