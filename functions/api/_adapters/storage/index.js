// Storage-provider registry — the plug-in point for the Storage Sync module.
// Add a provider by implementing the adapter contract (see dropbox.js) and
// appending its class here. The engine (_storage-pull.js) and the push mirror
// (_storage-sync.js) iterate whatever this file exposes; nothing else needs to
// know which providers exist.

import { DropboxAdapter } from './dropbox.js';
import { GoogleDriveAdapter } from './google-drive.js';

// Order here is the order the engine processes providers in.
const ADAPTERS = [
  DropboxAdapter,
  GoogleDriveAdapter,
];

// Every provider whose credentials are present in this deployment's env.
// (Does NOT check the premium gate — see activeAdapters for that.)
export function configuredAdapters(env) {
  return ADAPTERS.filter((A) => A.isConfigured(env)).map((A) => new A(env));
}

// Sync mode for this deployment. 'manual' (default): nothing runs
// automatically — no pull cron, no upload mirror; staff move files with the
// explicit "Push to storage" / "Import from Storage" actions. 'two_way':
// legacy automatic sync (pull cron + push mirror on upload/finalize).
export function autoSyncEnabled(env) {
  return (env.STORAGE_SYNC_MODE || 'manual') === 'two_way';
}

// Configured providers, but only when the storage_sync premium module is
// enabled for this firm. Returns [] otherwise — both the push mirror and the
// pull cron short-circuit to a no-op when this is empty.
export async function activeAdapters(env, admin) {
  const { data: mod } = await admin
    .from('enabled_modules').select('module_key')
    .eq('module_key', 'storage_sync').maybeSingle();
  if (!mod) return [];
  return configuredAdapters(env);
}

// A single configured adapter by provider key, or null. Used by routes that
// act on one provider's file (e.g. resolving an unmatched entry).
export function adapterFor(env, provider) {
  const A = ADAPTERS.find((a) => a.provider === provider);
  return A && A.isConfigured(env) ? new A(env) : null;
}

// Is ANY storage provider configured on this deployment? (Cheap env check;
// no premium gate.) Powers the "connected?" status pills.
export function anyConfigured(env) {
  return ADAPTERS.some((A) => A.isConfigured(env));
}
