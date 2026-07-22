// GET /api/storage-sync-status
// Staff-visible sync health, per provider: last run, error state, files pulled,
// backlog — plus the cross-provider review-queue depth and recent activity.
// Requires write on the storage_sync module (any staff role).

import { verifyAuth, json } from './_helpers.js';
import { configuredAdapters, anyConfigured } from './_adapters/storage/index.js';

const PROVIDER_LABELS = {
  dropbox:      'Dropbox',
  google_drive: 'Google Drive',
  onedrive:     'OneDrive',
  idrive:       'iDrive',
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'storage_sync');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const [{ data: states }, unmatched, pulls] = await Promise.all([
    auth.admin.from('storage_sync_state').select('*'),
    auth.admin.from('storage_sync_unmatched')
      .select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    auth.admin.from('storage_sync_ledger')
      .select('provider, remote_path, direction, synced_at')
      .order('synced_at', { ascending: false }).limit(10),
  ]);

  const stateByProvider = new Map((states || []).map((s) => [s.provider, s]));

  // One card per configured provider (present whether or not it has run yet).
  const providers = configuredAdapters(env).map((adapter) => {
    const p = adapter.constructor.provider;
    const s = stateByProvider.get(p);
    const pendingFiles = Array.isArray(s?.pending)
      ? s.pending.filter((e) => e.tag === 'file').length
      : 0;
    return {
      provider:         p,
      label:            PROVIDER_LABELS[p] || p,
      configured:       true,
      last_run_at:      s?.last_run_at || null,
      last_error:       s?.last_error || null,
      files_pulled:     s?.files_pulled || 0,
      backlog:          pendingFiles,
      backfill_started: !!s?.cursor,
    };
  });

  return json(200, {
    configured:        anyConfigured(env),
    providers,
    unmatched_pending: unmatched?.count ?? 0,
    recent:            pulls?.data || [],
  });
}
