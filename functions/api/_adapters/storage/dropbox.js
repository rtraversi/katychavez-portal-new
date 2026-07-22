// Dropbox storage adapter — implements the provider contract consumed by the
// Storage Sync engine (functions/api/_storage-pull.js + _storage-sync.js).
//
// PUSH (mirror): portal uploads and finalized drafts get copied into the
// firm's Dropbox, preserving the portal folder structure under a configurable
// root folder. Dropbox is not the source of truth — R2 remains canonical.
// PULL: the 5-minute cron lists changes via cursor and imports new/changed
// files into the portal.
//
// Both directions record every synced (remote_id, rev) in storage_sync_ledger
// — that's the loop guard that stops the mirror's own writes from echoing back
// through the pull as "new" files. For Dropbox, remote_id is the path_lower.
//
// ── Provider contract (the engine only ever calls these) ─────────────────────
//   static provider                       → 'dropbox'
//   static isConfigured(env)              → bool
//   get rootFolder                        → sync root ('' = provider root)
//   listAll()                             → { entries: NormEntry[], cursor }
//   listDelta(cursor)                     → { entries: NormEntry[], cursor, reset }
//   download(entry)                       → { bytes, meta: { rev, content_hash } }
//   upload(remotePath, body)             → { remote_id, remote_path, remote_rev, content_hash }
//   relativeParts(entry)                  → { clientFolder, clientFolderLower, folderPath } | null
//   listClientFolders()                   → [{ name, folder_lower }]   (recon)
//   listFolderEntries(folderName)         → NormEntry[]  (one client's on-demand import)
//   buildDocPath / buildDraftPath         → remote path strings (push)
//
// NormEntry (provider-neutral): { provider, tag:'file'|'deleted', remote_id,
//   remote_path, name, size, rev, content_hash }.
//
// Env vars:
//   DROPBOX_ROOT_FOLDER   — root path in Dropbox (default: /IurisIQ).
//                           For App-folder scoped apps set "" (empty):
//                           paths are relative to the app folder root.
//
//   Option A — direct token (expires ~4h, dev/testing only):
//     DROPBOX_ACCESS_TOKEN
//   Option B — OAuth offline access (production):
//     DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET
//
// Setup: create a Scoped access / App folder app at
// https://www.dropbox.com/developers/apps with files.content.write,
// files.content.read, files.metadata.read; run the one-time OAuth exchange
// (authorize URL with token_access_type=offline, then POST /oauth2/token with
// grant_type=authorization_code) and store the refresh token as a secret.

// Display names for the portal's folder_path slugs when mirroring out.
// An arbitrary folder_path (e.g. one that came from a storage pull) is used
// as-is, so both directions agree on layout.
const FOLDER_LABELS = {
  client_uploads: 'Client Uploads',
  pleadings:      'Pleadings',
  agreements:     'Agreements',
  correspondence: 'Correspondence',
  financial:      'Financial',
  attorney_notes: 'Attorney Notes',
  court_orders:   'Court Orders',
  trial_docs:     'Trial Docs',
  admin:          'Admin',
  other:          'Other',
};

export class DropboxAdapter {
  static provider = 'dropbox';

  constructor(env) {
    this._env        = env;
    this._token      = env.DROPBOX_ACCESS_TOKEN || null;
    // App-folder scoped apps: paths are relative to the app folder, so
    // DROPBOX_ROOT_FOLDER = "" (empty) means "app folder root".
    this.rootFolder  = (env.DROPBOX_ROOT_FOLDER ?? '/IurisIQ').replace(/\/+$/, '');
  }

  static isConfigured(env) {
    return !!(
      env.DROPBOX_ACCESS_TOKEN ||
      (env.DROPBOX_REFRESH_TOKEN && env.DROPBOX_APP_KEY && env.DROPBOX_APP_SECRET)
    );
  }

  // ── Token management ────────────────────────────────────────────────────────

  async _getToken() {
    if (this._token) return this._token;

    const { DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET } = this._env;
    if (!DROPBOX_REFRESH_TOKEN || !DROPBOX_APP_KEY || !DROPBOX_APP_SECRET) {
      throw new Error('Dropbox not configured — set DROPBOX_ACCESS_TOKEN or the DROPBOX_REFRESH_TOKEN trio');
    }

    const res = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: DROPBOX_REFRESH_TOKEN,
        client_id:     DROPBOX_APP_KEY,
        client_secret: DROPBOX_APP_SECRET,
      }),
    });

    if (!res.ok) {
      throw new Error(`Dropbox token refresh failed (${res.status}): ${await res.text()}`);
    }

    const data   = await res.json();
    this._token  = data.access_token;
    return this._token;
  }

  // ── RPC helper (JSON body endpoints) ────────────────────────────────────────

  async _rpc(endpoint, body) {
    const token = await this._getToken();
    const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Dropbox ${endpoint} failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    return res.json();
  }

  // ── Normalized delta listing (pull) ─────────────────────────────────────────

  // Full listing from the sync root → normalized entries + resumable cursor.
  // First-run backfill: this IS the historical import.
  async listAll() {
    const { entries, cursor } = await this._listFolderRaw(this.rootFolder || '', { recursive: true });
    return { entries: entries.map(normalizeEntry).filter(Boolean), cursor };
  }

  // Delta since a saved cursor. reset=true means the provider invalidated the
  // cursor and the engine should fall back to a full listAll().
  async listDelta(cursor) {
    const all = [];
    let cur = cursor;
    try {
      let data = await this._rpc('files/list_folder/continue', { cursor: cur });
      all.push(...data.entries);
      while (data.has_more) {
        data = await this._rpc('files/list_folder/continue', { cursor: data.cursor });
        all.push(...data.entries);
      }
      return { entries: all.map(normalizeEntry).filter(Boolean), cursor: data.cursor, reset: false };
    } catch (err) {
      if (String(err.message).includes('reset')) return { entries: [], cursor: null, reset: true };
      throw err;
    }
  }

  // Top-level client folders under the sync root → { name, folder_lower }.
  // Used by the reconciliation report.
  async listClientFolders() {
    const { entries } = await this._listFolderRaw(this.rootFolder || '');
    return entries
      .filter((e) => e['.tag'] === 'folder')
      .map((e) => ({ name: e.name, folder_lower: e.path_lower.split('/').pop() }));
  }

  // Every file recursively under ONE named top-level folder → NormEntry[].
  // Used by the on-demand per-client import (staff-confirmed folder → matter),
  // as opposed to listAll()'s whole-root walk. remote_path/remote_id come back
  // root-relative exactly like listAll(), so relativeParts() needs no changes.
  // _listFolderRaw always requests include_deleted (the cron's own move-
  // detection needs those tombstones) — this route has no use for them and
  // would otherwise try to download an already-gone path, so drop non-files.
  async listFolderEntries(folderName) {
    const path = `${this.rootFolder || ''}/${folderName}`.replace(/\/+/g, '/');
    const { entries } = await this._listFolderRaw(path, { recursive: true });
    return entries.map(normalizeEntry).filter((e) => e && e.tag === 'file');
  }

  // Raw list_folder (+ continue) — Dropbox-shaped entries. Internal.
  async _listFolderRaw(path = '', { recursive = false } = {}) {
    const entries = [];
    let data = await this._rpc('files/list_folder', {
      path, recursive, include_deleted: true,
    });
    entries.push(...data.entries);
    while (data.has_more) {
      data = await this._rpc('files/list_folder/continue', { cursor: data.cursor });
      entries.push(...data.entries);
    }
    return { entries, cursor: data.cursor };
  }

  // ── File download (pull) ────────────────────────────────────────────────────

  // Download a NormEntry. Returns { bytes, meta:{ rev, content_hash } }.
  async download(entry) {
    const pathOrRev = entry.rev ? `rev:${entry.rev}` : entry.remote_id;
    const token = await this._getToken();
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method:  'POST',
      headers: {
        'Authorization':   `Bearer ${token}`,
        'Dropbox-API-Arg': httpHeaderSafeJson({ path: pathOrRev }),
      },
    });
    if (!res.ok) {
      throw new Error(`Dropbox download failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    let dbxMeta = {};
    try { dbxMeta = JSON.parse(res.headers.get('Dropbox-API-Result') || '{}'); } catch { /* keep {} */ }
    return {
      bytes: await res.arrayBuffer(),
      meta:  { rev: dbxMeta.rev || null, content_hash: dbxMeta.content_hash || null },
    };
  }

  // ── File upload (push) ──────────────────────────────────────────────────────

  // Upload bytes to a remote path. Returns normalized metadata — with
  // autorename the ACTUAL path can differ from the requested one, so ledger
  // writes must use the returned values.
  async upload(remotePath, fileBody) {
    const token = await this._getToken();
    // 'add' + autorename: never clobber a file the firm already has at this
    // path — a collision produces "file (1).pdf" instead of a silent overwrite.
    const arg = httpHeaderSafeJson({ path: remotePath, mode: 'add', autorename: true, mute: true });

    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method:  'POST',
      headers: {
        'Authorization':   `Bearer ${token}`,
        'Dropbox-API-Arg': arg,
        'Content-Type':    'application/octet-stream',
      },
      body: fileBody,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => res.status);
      throw new Error(`Dropbox upload failed (${res.status}): ${errText}`);
    }

    const m = await res.json();
    return {
      remote_id:    m.path_lower,
      remote_path:  m.path_display || remotePath,
      remote_rev:   m.rev,
      content_hash: m.content_hash || null,
    };
  }

  // ── Path helpers ────────────────────────────────────────────────────────────

  // Split a NormEntry's path (relative to the sync root) into
  // { clientFolder, clientFolderLower, folderPath } using display casing.
  relativeParts(entry) {
    const rootLower = (this.rootFolder || '').toLowerCase();
    let relLower   = entry.remote_id;
    let relDisplay = entry.remote_path;
    if (rootLower && relLower.startsWith(rootLower)) {
      relLower   = relLower.slice(rootLower.length);
      relDisplay = relDisplay.slice(rootLower.length);
    }
    const partsLower   = relLower.replace(/^\/+/, '').split('/');
    const partsDisplay = relDisplay.replace(/^\/+/, '').split('/');
    if (partsLower.length < 2) return null; // file sitting at the root
    return {
      clientFolder:      partsDisplay[0],
      clientFolderLower: partsLower[0],
      // Everything between the client folder and the file = portal folder_path
      folderPath: partsDisplay.slice(1, -1).join('/'),
    };
  }

  // Path for a matter document: /{root}/{Last, First}/{folders…}/{filename}
  // folder_path may be a known slug ('pleadings') or an arbitrary path that
  // came from a storage pull ('DRAFTS' or 'Financial Info/Husband's Info') —
  // arbitrary paths are preserved so both directions agree on layout.
  buildDocPath(clientName, folderPath, fileName) {
    const safeClient = sanitizePathPart(clientName || 'Unknown Client');
    const raw        = String(folderPath || 'other');
    const folder     = FOLDER_LABELS[raw] ||
      raw.split('/').map(sanitizePathPart).filter(Boolean).join('/') || 'Other';
    const safeFile   = sanitizePathPart(fileName);
    return `${this.rootFolder}/${safeClient}/${folder}/${safeFile}`;
  }

  // Path for a finalized draft: /{root}/{Last, First}/Final Documents/{filename}
  buildDraftPath(clientName, fileName) {
    const safeClient = sanitizePathPart(clientName || 'Unknown Client');
    const safeFile   = sanitizePathPart(fileName);
    return `${this.rootFolder}/${safeClient}/Final Documents/${safeFile}`;
  }
}

// ── Normalization ────────────────────────────────────────────────────────────

// Dropbox raw entry → NormEntry. Folders carry no work → null (dropped).
function normalizeEntry(e) {
  if (!e || !e['.tag']) return null;
  if (e['.tag'] === 'folder') return null;
  return {
    provider:     'dropbox',
    tag:          e['.tag'],                         // 'file' | 'deleted'
    remote_id:    e.path_lower,                      // stable per-file key
    remote_path:  e.path_display || e.path_lower,
    name:         e.name,
    size:         e.size ?? null,
    rev:          e.rev ?? null,
    content_hash: e.content_hash ?? null,
  };
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function sanitizePathPart(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || '_';
}

// Dropbox requires HTTP-header values to be ASCII; non-ASCII chars in
// Dropbox-API-Arg must be escaped as \uXXXX (their "HTTP header safe JSON").
// Without this, a client named Muñoz or José fails the request outright.
export function httpHeaderSafeJson(obj) {
  return JSON.stringify(obj).replace(/[^\x00-\x7f]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
