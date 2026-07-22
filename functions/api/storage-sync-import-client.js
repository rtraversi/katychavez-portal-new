// /api/storage-sync-import-client
// On-demand, staff-triggered per-client backfill from the firm's connected
// storage provider(s) — the "Import from Dropbox" button on the client card.
// Scoped alternative to the all-or-nothing STORAGE_SYNC_BACKFILL flood: staff
// picks ONE client, confirms the matched folder, always picks the target
// matter explicitly, and only that folder's files are pulled in.
//
// GET  ?client_id=...
//   → { client, matters, candidates: [{ provider, folder_name, folder_lower,
//        via: 'alias'|'exact'|'fuzzy' }] }
//   Match logic mirrors storage-sync-recon.js's folder→client pass, run in
//   reverse (client→folder): an existing storage_sync_aliases row wins
//   outright; otherwise exact then fuzzy "Last, First" comparison against
//   every configured+active provider's top-level folders. No manual folder
//   browse — if nothing matches, staff sees no candidates.
//
// POST { client_id, matter_id, provider, folder_name, folder_lower }
//   → starts a job: lists every file under that one folder (recursive),
//     drops noise files, queues conflicted copies to the normal unmatched
//     review queue, and pulls the first batch through the exact importEntry()
//     pipeline the cron uses (AV scan, staff-only until published, ledger
//     dedup). Also pins the folder → client/matter mapping in
//     storage_sync_aliases so future cron passes route it the same way.
// POST { job_id }
//   → continues an in-progress job's next batch (large folders span calls —
//     same batching shape as storage_sync_state.pending on the cron).
//
// Requires write on the storage_sync module.

import { verifyAuth, json } from './_helpers.js';
import { activeAdapters } from './_adapters/storage/index.js';
import { importEntry, queueUnmatched, isNoiseFile, isConflictedCopy } from './_storage-pull.js';
import { MAX_SYNC_BYTES } from './_scan.js';

// See the matching comment in _storage-pull.js — ~6-7 subrequests per file,
// 20 blew the Worker's per-invocation subrequest ceiling in production
// (WLS, 2026-07-06). Kept low with margin.
const BATCH_SIZE = 5; // files imported per call

export async function onRequest(context) {
  const { request, env } = context;

  const auth = await verifyAuth(request, env, 'write', 'storage_sync');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const admin = auth.admin;

  if (request.method === 'GET') return handleMatch(request, env, admin);
  if (request.method === 'POST') return handleImport(request, env, admin, auth);
  return json(405, { error: 'Method not allowed' });
}

// ── GET: match the client to a provider folder ──────────────────────────────

async function handleMatch(request, env, admin) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');
  if (!clientId) return json(400, { error: 'client_id is required' });

  const { data: client, error: cErr } = await admin
    .from('clients').select('id, first_name, last_name').eq('id', clientId).single();
  if (cErr || !client) return json(404, { error: 'Client not found' });

  const [{ data: matters, error: mErr }, { data: aliases }, adapters] = await Promise.all([
    admin.from('matters').select('id, case_type, case_number, status')
      .eq('client_id', clientId).order('created_at', { ascending: false }),
    admin.from('storage_sync_aliases').select('provider, folder_path_lower').eq('client_id', clientId),
    activeAdapters(env, admin),
  ]);
  if (mErr) return json(500, { error: mErr.message });
  if (!adapters.length) {
    return json(503, { error: 'No storage provider is configured/enabled on this deployment.' });
  }

  const aliasedFolders = new Set((aliases || []).map((a) => `${a.provider}:${a.folder_path_lower}`));
  const candidateStr = norm(`${client.last_name}, ${client.first_name}`);
  const lastTok = norm(client.last_name);
  const firstTok = norm(client.first_name);

  const candidates = [];
  for (const adapter of adapters) {
    const provider = adapter.constructor.provider;
    let folders;
    try {
      folders = await adapter.listClientFolders();
    } catch (err) {
      console.error(`[storage-sync-import-client] listClientFolders(${provider}) failed:`, err.message);
      continue;
    }
    for (const folder of folders) {
      const folderNorm = norm(folder.name);
      let via = null;
      if (aliasedFolders.has(`${provider}:${folder.folder_lower}`)) via = 'alias';
      else if (folderNorm === candidateStr) via = 'exact';
      else if (lastTok && firstTok && folderNorm.includes(lastTok) && folderNorm.includes(firstTok)) via = 'fuzzy';
      if (via) candidates.push({ provider, folder_name: folder.name, folder_lower: folder.folder_lower, via });
    }
  }
  // Best match first: alias > exact > fuzzy.
  const rank = { alias: 0, exact: 1, fuzzy: 2 };
  candidates.sort((a, b) => rank[a.via] - rank[b.via]);

  return json(200, {
    client: { id: client.id, name: `${client.last_name}, ${client.first_name}` },
    matters: matters || [],
    candidates,
  });
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^\w, ]+/g, '').replace(/\s+/g, ' ').trim();
}

// ── POST: start or continue an import job ───────────────────────────────────

async function handleImport(request, env, admin, auth) {
  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  if (body.job_id) return continueJob(env, admin, body.job_id);
  return startJob(env, admin, auth, body);
}

async function startJob(env, admin, auth, body) {
  const { client_id, matter_id, provider, folder_name, folder_lower } = body;
  if (!client_id || !matter_id || !provider || !folder_name || !folder_lower) {
    return json(400, { error: 'client_id, matter_id, provider, folder_name, and folder_lower are required' });
  }

  const { data: matter, error: mErr } = await admin
    .from('matters').select('id, client_id').eq('id', matter_id).single();
  if (mErr || !matter) return json(404, { error: 'Matter not found' });
  if (matter.client_id !== client_id) return json(400, { error: 'Matter does not belong to this client' });

  const adapters = await activeAdapters(env, admin);
  const adapter = adapters.find((a) => a.constructor.provider === provider);
  if (!adapter) return json(503, { error: `${provider} is not configured/enabled on this deployment.` });

  let entries;
  try {
    entries = await adapter.listFolderEntries(folder_name);
  } catch (err) {
    console.error('[storage-sync-import-client] listFolderEntries failed:', err.message);
    return json(500, { error: `Could not list folder: ${err.message}` });
  }

  const pending = [];
  for (const entry of entries) {
    if (isNoiseFile(entry.name)) continue;
    if (isConflictedCopy(entry.name)) {
      await queueUnmatched(admin, provider, entry, 'conflicted_copy');
      continue;
    }
    pending.push(entry);
  }

  const { data: job, error: jErr } = await admin
    .from('storage_sync_client_import_jobs')
    .insert({
      client_id, matter_id, provider, folder_name, folder_lower,
      pending, created_by: auth.profile.id,
    })
    .select().single();
  if (jErr) return json(500, { error: jErr.message });

  // Pin this folder → client/matter going forward, same as an unmatched-queue
  // resolve with create_alias — the whole point of this route is a folder the
  // cron couldn't (or shouldn't yet have) auto-matched.
  const { error: aErr } = await admin.from('storage_sync_aliases').upsert({
    provider, folder_path_lower: folder_lower, client_id, matter_id,
    created_by: auth.profile.id,
  }, { onConflict: 'provider,folder_path_lower' });
  if (aErr) console.error('[storage-sync-import-client] alias write failed:', aErr.message);

  const result = await runBatch(env, admin, adapter, job);
  return json(200, result);
}

async function continueJob(env, admin, jobId) {
  const { data: job, error: jErr } = await admin
    .from('storage_sync_client_import_jobs').select('*').eq('id', jobId).single();
  if (jErr || !job) return json(404, { error: 'Import job not found' });
  if (job.status !== 'running') return json(409, { error: `Job already ${job.status}` });

  const adapters = await activeAdapters(env, admin);
  const adapter = adapters.find((a) => a.constructor.provider === job.provider);
  if (!adapter) return json(503, { error: `${job.provider} is not configured/enabled on this deployment.` });

  const result = await runBatch(env, admin, adapter, job);
  return json(200, result);
}

// ── Shared batch runner ──────────────────────────────────────────────────────

async function runBatch(env, admin, adapter, job) {
  const provider = job.provider;
  const pending = Array.isArray(job.pending) ? job.pending : [];
  const batch = pending.slice(0, BATCH_SIZE);
  const rest = pending.slice(BATCH_SIZE);

  let imported = 0, skipped = 0, errors = 0, lastError = job.last_error || null;

  for (const entry of batch) {
    try {
      const { data: seen } = await admin
        .from('storage_sync_ledger').select('id')
        .eq('provider', provider).eq('remote_id', entry.remote_id).eq('remote_rev', entry.rev)
        .maybeSingle();
      if (seen) { skipped++; continue; }

      if ((entry.size || 0) > MAX_SYNC_BYTES) {
        await queueUnmatched(admin, provider, entry, 'over_size', `${(entry.size / 1024 / 1024).toFixed(1)}MB`);
        skipped++; continue;
      }

      const rel = adapter.relativeParts(entry);
      const ok = await importEntry(env, admin, adapter, entry, job.matter_id, rel?.folderPath || '');
      if (ok) imported++; else skipped++; // importEntry queues its own reason (e.g. infected)
    } catch (err) {
      errors++; lastError = err.message;
      console.error(`[storage-sync-import-client:${provider}] entry failed:`, entry.remote_path, err.message);
      // Without this, a failed entry just vanished — never retried, no record
      // anywhere. Best-effort: if the whole invocation is already past the
      // subrequest ceiling this write can fail too, but it costs nothing to try.
      try { await queueUnmatched(admin, provider, entry, 'error', err.message); } catch { /* best-effort */ }
    }
  }

  const status = rest.length ? 'running' : 'completed';
  const { data: updated, error: uErr } = await admin
    .from('storage_sync_client_import_jobs')
    .update({
      pending: rest,
      imported_count: job.imported_count + imported,
      skipped_count:  job.skipped_count + skipped,
      error_count:    job.error_count + errors,
      last_error:     lastError,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .select().single();
  if (uErr) console.error('[storage-sync-import-client] job update failed:', uErr.message);

  return {
    job_id: job.id,
    status,
    imported_count: updated?.imported_count ?? job.imported_count + imported,
    skipped_count:  updated?.skipped_count  ?? job.skipped_count + skipped,
    error_count:    updated?.error_count    ?? job.error_count + errors,
    remaining: rest.length,
  };
}
