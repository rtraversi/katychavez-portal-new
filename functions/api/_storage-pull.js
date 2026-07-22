// Storage Sync — pull direction (storage → portal). One engine, every provider.
// Runs on the 5-minute cron: for each enabled+configured provider, cursor-based
// delta polling imports changes since the last run. Files are imported in small
// batches (Worker CPU/subrequest limits); leftovers wait in
// storage_sync_state.pending (per provider) and the next run continues. First
// run (no cursor) lists the whole tree — that IS the historical backfill
// (decision 2026-07-04: full backfill, slowly, through the normal pipeline).
//
// Per-file pipeline (scope doc): skip-list → ledger loop check → move check →
// path match → size gate → AV scan → write. Unmatchable files land in
// storage_sync_unmatched for staff review — never guessed at, never lost.
//
// Litigation-integrity rules: provider deletes/renames never delete portal
// data; existing documents get new VERSIONS, never overwrites; pulled files
// are client_visible=false until staff publishes.
//
// Provider neutrality: the engine speaks only NormEntry ({ provider, tag,
// remote_id, remote_path, name, size, rev, content_hash }) and the adapter
// contract (listAll/listDelta/download/relativeParts). remote_id is the
// provider's stable per-file key — path_lower for Dropbox, file-id for Drive.

import { makeAdminClient } from './_helpers.js';
import { activeAdapters, autoSyncEnabled } from './_adapters/storage/index.js';
import { scanR2Object, MAX_SYNC_BYTES } from './_scan.js';
import { pruneVersions } from './_versions.js';

// Each imported file costs ~6-7 subrequests (ledger check, provider download,
// prior-ledger lookup, R2 put, AV scan, document write, ledger upsert) — a
// batch of 20 blew past the Worker's per-invocation subrequest ceiling in
// production (WLS, 2026-07-06: "Too many subrequests by single Worker
// invocation" partway through a real import). Kept low with margin.
const BATCH_SIZE = 5; // files imported per provider per cron run

// Cron entrypoint: pull every active provider, isolated from one another.
export async function runStoragePull(env) {
  // Manual mode: no automatic pull — files come in via "Import from Storage" only.
  if (!autoSyncEnabled(env)) return;
  let admin;
  try {
    admin = makeAdminClient(env);
    const adapters = await activeAdapters(env, admin);
    for (const adapter of adapters) {
      try {
        await pullProvider(env, admin, adapter);
      } catch (err) {
        const provider = adapter.constructor.provider;
        console.error(`[storage-pull:${provider}]`, err.message);
        try {
          await admin.from('storage_sync_state')
            .update({ last_error: err.message, last_run_at: new Date().toISOString() })
            .eq('provider', provider);
        } catch { /* state write is best-effort */ }
      }
    }
  } catch (err) {
    console.error('[storage-pull]', err.message);
  }
}

// ── One provider's delta run ─────────────────────────────────────────────────

async function pullProvider(env, admin, adapter) {
  const provider = adapter.constructor.provider;

  // Per-provider state (cursor + pending work queue)
  let { data: state } = await admin
    .from('storage_sync_state').select('*').eq('provider', provider).maybeSingle();
  if (!state) {
    const ins = await admin.from('storage_sync_state').insert({ provider }).select().single();
    if (ins.error) throw new Error(`state init: ${ins.error.message}`);
    state = ins.data;
  }

  let pending = Array.isArray(state.pending) ? state.pending : [];
  let cursor  = state.cursor;

  // Refill the work queue from the provider when empty
  if (!pending.length) {
    let result;
    if (!cursor) {
      // First run: full tree walk = the backfill.
      result = await adapter.listAll();
    } else {
      result = await adapter.listDelta(cursor);
      if (result.reset) {
        // Cursor invalidated — re-list from scratch; the ledger's
        // (provider, remote_id, remote_rev) entries prevent duplicate imports.
        console.warn(`[storage-pull:${provider}] cursor reset — re-listing tree`);
        result = await adapter.listAll();
      }
    }
    cursor  = result.cursor;
    pending = result.entries; // already normalized NormEntry[]
  }

  // Deleted keys in this delta window — the move-detection signal.
  const deletedSet = new Set(
    pending.filter((e) => e.tag === 'deleted').map((e) => e.remote_id)
  );

  const files = pending.filter((e) => e.tag === 'file');
  const batch = files.slice(0, BATCH_SIZE);
  let pulled = 0;

  for (const entry of batch) {
    try {
      if (await processEntry(env, admin, adapter, entry, deletedSet)) pulled++;
    } catch (err) {
      console.error(`[storage-pull:${provider}] entry failed:`, entry.remote_path, err.message);
      await queueUnmatched(admin, provider, entry, 'error', err.message);
    }
  }

  // Keep unprocessed files (and the deleted markers while files remain —
  // they're the move-detection window for the rest of this delta).
  const processed = new Set(batch.map((e) => e.remote_id));
  let remaining = pending.filter((e) => (e.tag === 'file' ? !processed.has(e.remote_id) : true));
  if (!remaining.some((e) => e.tag === 'file')) remaining = [];

  await admin.from('storage_sync_state').update({
    cursor,
    pending:      remaining,
    last_run_at:  new Date().toISOString(),
    last_error:   null,
    files_pulled: (state.files_pulled || 0) + pulled,
    updated_at:   new Date().toISOString(),
  }).eq('provider', provider);

  if (pulled || remaining.length) {
    console.log(`[storage-pull:${provider}] pulled ${pulled}, ${remaining.filter((e) => e.tag === 'file').length} queued`);
  }
}

// ── Per-entry pipeline ───────────────────────────────────────────────────────

async function processEntry(env, admin, adapter, entry, deletedSet) {
  const provider = adapter.constructor.provider;

  // 1. Skip-list: Word lock files, temp files, OS noise. Conflicted copies
  //    signal a real conflict — a human decides.
  if (isNoiseFile(entry.name)) return false;
  if (isConflictedCopy(entry.name)) {
    await queueUnmatched(admin, provider, entry, 'conflicted_copy');
    return false;
  }

  // 2. Ledger loop check: exact (provider, remote_id, remote_rev) already
  //    synced — either our own mirror write echoing back, or an entry
  //    re-listed after a cursor reset.
  const { data: seen } = await admin
    .from('storage_sync_ledger').select('id')
    .eq('provider', provider).eq('remote_id', entry.remote_id).eq('remote_rev', entry.rev)
    .maybeSingle();
  if (seen) return false;

  // 3. Move check (v1): same content elsewhere whose old key was deleted in
  //    this delta window → relocate the existing document, no duplicate.
  //    This is the firm's DRAFTS → sent/filed transition.
  if (entry.content_hash && deletedSet.size) {
    const { data: candidates } = await admin
      .from('storage_sync_ledger')
      .select('remote_id, document_id')
      .eq('provider', provider)
      .eq('content_hash', entry.content_hash)
      .not('document_id', 'is', null)
      .order('synced_at', { ascending: false })
      .limit(5);
    const moved = (candidates || []).find((c) => deletedSet.has(c.remote_id));
    if (moved) {
      const rel = adapter.relativeParts(entry);
      await admin.from('documents').update({
        folder_path: rel?.folderPath || null,
        file_name:   entry.name,
        updated_at:  new Date().toISOString(),
      }).eq('id', moved.document_id);
      await upsertLedger(admin, provider, entry, null, moved.document_id);
      console.log(`[storage-pull:${provider}] move: ${moved.remote_id} → ${entry.remote_id}`);
      return true;
    }
  }

  // 4. Path match: first segment → client (alias table first, then
  //    "Last, First"), client → single active matter.
  const rel = adapter.relativeParts(entry);
  if (!rel || !rel.clientFolder) return false; // at root / outside tree — ignore
  const match = await matchClientMatter(admin, provider, rel);
  if (!match.matterId) {
    await queueUnmatched(admin, provider, entry, match.reason, match.detail);
    return false;
  }

  // 5. Size gate: sync downloads buffer in Worker memory, so this stays at the
  //    tighter MAX_SYNC_BYTES (manual portal uploads stream and allow more).
  if ((entry.size || 0) > MAX_SYNC_BYTES) {
    await queueUnmatched(admin, provider, entry, 'over_size', `${(entry.size / 1024 / 1024).toFixed(1)}MB`);
    return false;
  }

  // 6+7. Download → R2 → AV scan → document/version rows + ledger.
  return importEntry(env, admin, adapter, entry, match.matterId, rel.folderPath);
}

// ── Import (download → scan → write). Also used by the unmatched-resolve
//    endpoint, which supplies matterId/folderPath explicitly. ────────────────

export async function importEntry(env, admin, adapter, entry, matterId, folderPath) {
  const provider = adapter.constructor.provider;
  const { bytes, meta } = await adapter.download(entry);
  const rev  = meta.rev || entry.rev;
  const hash = meta.content_hash || entry.content_hash || null;

  // Existing document at this remote key → new version. Never overwrite.
  const { data: prior } = await admin
    .from('storage_sync_ledger').select('document_id')
    .eq('provider', provider)
    .eq('remote_id', entry.remote_id)
    .not('document_id', 'is', null)
    .order('synced_at', { ascending: false })
    .limit(1).maybeSingle();

  const documentId = prior?.document_id || crypto.randomUUID();
  const r2Key = `matters/${matterId}/${documentId}/${rev}-${safeKeyName(entry.name)}`;

  await env.R2.put(r2Key, bytes);

  const { verdict, detail } = await scanR2Object(env, r2Key);
  if (verdict === 'infected') {
    await env.R2.delete(r2Key);
    await queueUnmatched(admin, provider, entry, 'infected', detail?.finding || null);
    console.warn(`[storage-pull:${provider}] INFECTED, rejected:`, entry.remote_path);
    return false;
  }

  const now = new Date().toISOString();

  if (prior?.document_id) {
    const { data: maxV } = await admin
      .from('document_versions').select('version_no')
      .eq('document_id', documentId)
      .order('version_no', { ascending: false })
      .limit(1).maybeSingle();
    const versionNo = (maxV?.version_no || 1) + 1;

    const v = await admin.from('document_versions').insert({
      document_id: documentId, version_no: versionNo, r2_key: r2Key,
      file_size: entry.size, content_hash: hash, source: provider,
    });
    if (v.error) { await env.R2.delete(r2Key); throw new Error(v.error.message); }

    // documents.r2_key keeps pointing at the latest version
    await admin.from('documents').update({
      r2_key: r2Key, file_size: entry.size, file_name: entry.name,
      scan_status: verdict, scanned_at: now, updated_at: now,
    }).eq('id', documentId);

    // Keep history bounded — drop versions older than the newest VERSION_CAP.
    await pruneVersions(env, admin, documentId);
  } else {
    const ins = await admin.from('documents').insert({
      id:             documentId,
      matter_id:      matterId,
      name:           stripExt(entry.name),
      file_name:      entry.name,
      file_size:      entry.size,
      r2_key:         r2Key,
      content_type:   guessContentType(entry.name),
      doc_type:       inferDocType(folderPath),
      folder_path:    folderPath || null,
      status:         'received',
      scan_status:    verdict,
      scanned_at:     now,
      client_visible: false,     // NEVER client-facing on arrival
      source:         provider,
    });
    if (ins.error) { await env.R2.delete(r2Key); throw new Error(ins.error.message); }

    const v = await admin.from('document_versions').insert({
      document_id: documentId, version_no: 1, r2_key: r2Key,
      file_size: entry.size, content_hash: hash, source: provider,
    });
    if (v.error) console.error(`[storage-pull:${provider}] version row failed:`, v.error.message);
  }

  await upsertLedger(admin, provider, { ...entry, rev, content_hash: hash }, r2Key, documentId);
  console.log(`[storage-pull:${provider}] ✓ ${entry.remote_path}`);
  return true;
}

// ── Matching ─────────────────────────────────────────────────────────────────

async function matchClientMatter(admin, provider, rel) {
  // Alias table first — folders that structurally can't name-match
  // (e.g. PF matters named by family name).
  const { data: alias } = await admin
    .from('storage_sync_aliases').select('client_id, matter_id')
    .eq('provider', provider)
    .eq('folder_path_lower', rel.clientFolderLower)
    .maybeSingle();
  if (alias?.matter_id) return { matterId: alias.matter_id };

  let clientId = alias?.client_id || null;

  if (!clientId) {
    const m = /^(.+?),\s*(.+)$/.exec(rel.clientFolder);
    if (!m) return { reason: 'no_client_match', detail: 'folder is not "Last, First"' };
    const [, last, first] = m;
    const { data: clients } = await admin
      .from('clients').select('id')
      .ilike('last_name', last.trim())
      .ilike('first_name', first.trim());
    if (!clients?.length) return { reason: 'no_client_match', detail: null };
    if (clients.length > 1) return { reason: 'no_client_match', detail: 'multiple clients share this name' };
    clientId = clients[0].id;
  }

  const { data: matters } = await admin
    .from('matters').select('id')
    .eq('client_id', clientId)
    .in('status', ['intake', 'active'])
    .order('created_at', { ascending: false });
  if (!matters?.length) return { reason: 'no_active_matter', detail: null };
  if (matters.length > 1) return { reason: 'multiple_matters', detail: `${matters.length} active matters` };
  return { matterId: matters[0].id };
}

// ── Skip-list (shared with the on-demand per-client import route) ──────────

export function isNoiseFile(name) {
  const nm = name || '';
  return /^~\$/.test(nm) || /\.tmp$/i.test(nm) || nm === '.DS_Store' || nm === 'desktop.ini';
}

export function isConflictedCopy(name) {
  return /conflicted copy/i.test(name || '');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export async function queueUnmatched(admin, provider, entry, reason, detail = null) {
  const { error } = await admin.from('storage_sync_unmatched').upsert({
    provider,
    remote_id:    entry.remote_id,
    remote_path:  entry.remote_path,
    file_name:    entry.name,
    file_size:    entry.size,
    remote_rev:   entry.rev,
    content_hash: entry.content_hash,
    reason, detail,
  }, { onConflict: 'provider,remote_id,remote_rev', ignoreDuplicates: true });
  if (error) console.error(`[storage-pull:${provider}] unmatched queue write failed:`, error.message);
}

async function upsertLedger(admin, provider, entry, r2Key, documentId) {
  const { error } = await admin.from('storage_sync_ledger').upsert({
    provider,
    remote_id:    entry.remote_id,
    remote_path:  entry.remote_path || null,
    remote_rev:   entry.rev,
    content_hash: entry.content_hash || null,
    r2_key:       r2Key,
    document_id:  documentId,
    direction:    'pull',
  }, { onConflict: 'provider,remote_id,remote_rev' });
  if (error) console.error(`[storage-pull:${provider}] ledger write failed:`, error.message);
}

// Top-level folder → doc_type, best-effort. folder_path is the real
// organizational source of truth; the folder set is open-ended by design.
function inferDocType(folderPath) {
  const top = String(folderPath || '').split('/')[0].toLowerCase().trim();
  if (top === 'pleadings') return 'pleading';
  if (top === 'correspondence') return 'correspondence';
  if (top === 'financial info' || top === 'financial') return 'financial';
  if (top === 'agreements') return 'agreement';
  if (top === 'court orders') return 'court_order';
  return 'other';
}

function stripExt(name) {
  const i = String(name).lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function safeKeyName(name) {
  return String(name).replace(/[^\w.\-() ]/g, '_');
}

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  txt: 'text/plain', csv: 'text/csv',
};
function guessContentType(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}
