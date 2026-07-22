// Google Drive storage adapter — provider #2 for the Storage Sync engine
// (functions/api/_storage-pull.js + _storage-sync.js). Plugs in at the Phase 2
// seams in ./index.js; the engine only ever speaks the adapter contract and
// provider-neutral NormEntry, so nothing else in the module knows Drive exists.
//
// PUSH (mirror): portal uploads and finalized drafts are copied into the firm's
// Drive under a configurable root folder, preserving the portal folder layout.
// Drive is not the source of truth — R2 remains canonical.
// PULL: the 5-minute cron lists changes via the Changes API cursor and imports
// new/changed files into the matching matter.
//
// Both directions record every synced (remote_id, rev) in storage_sync_ledger —
// the loop guard that stops the mirror's own writes echoing back through the
// pull as "new" files. For Drive, remote_id is the FILE ID (stable across
// renames/moves) and remote_rev is headRevisionId (modifiedTime for native docs
// that have no head revision).
//
// ── How Drive differs from Dropbox (why this adapter is bigger) ───────────────
//   • ID-based, not path-based. A file is a fileId with parent folder IDs, not a
//     path. remote_path (the portal folder layout) is REBUILT by walking the
//     parent chain up to the root folder — see _relDir / the folder map.
//   • Changes API cursor. listDelta pages changes.list; the final page's
//     newStartPageToken becomes the next cursor. An expired token → reset.
//   • Native Google files (Docs/Sheets/Slides) have no binary. They are EXPORTED
//     on download — Docs/Slides/Drawings → PDF, Sheets → XLSX (see GOOGLE_EXPORT)
//     — and the export extension is appended to their name. They carry no
//     md5Checksum, so content-hash move-detection is inert for them (fine).
//
// ── Known v1 limitations (documented, acceptable) ────────────────────────────
//   • A pure Drive-side MOVE keeps the same fileId and does not bump
//     headRevisionId, so the ledger sees it as already-synced and the portal
//     folder_path is not relocated. (Dropbox move-detection does not apply here —
//     it keys on a deleted old path, which Drive never produces for a move.)
//   • Renaming a FOLDER does not emit change events for its children, so their
//     portal folder_path can go stale until the child files themselves change.
//   • Concurrent pushes can race to create the same client/folder → rare
//     duplicate folder. Get-or-create is best-effort (no atomic op in Drive).
//
// ── Provider contract (identical surface to dropbox.js) ──────────────────────
//   static provider / isConfigured(env) · listAll() · listDelta(cursor) ·
//   download(entry) · upload(remotePath, body) · relativeParts(entry) ·
//   listClientFolders() · listFolderEntries(folderName) ·
//   buildDocPath / buildDraftPath
//
// NormEntry (provider-neutral): { provider, tag:'file'|'deleted', remote_id,
//   remote_path, name, size, rev, content_hash }. Drive adds one extra field,
//   mime_type, that only download() reads (to pick export vs. alt=media); the
//   engine ignores unknown fields and persists them harmlessly in state.pending.
//
// ── Env vars ─────────────────────────────────────────────────────────────────
//   GOOGLE_DRIVE_ROOT_FOLDER_ID   — REQUIRED. Folder ID that is the sync root.
//                                   A Shared Drive's ID sets shared-drive mode;
//                                   a My Drive folder ID (or "root") sets My
//                                   Drive mode. Shared vs My Drive is AUTO-
//                                   detected from the folder's driveId.
//
//   Auth — set ONE of the two sets (mirrors Dropbox's dual mode):
//   Mode A — Service account (recommended for a Workspace firm + Shared Drive):
//     GOOGLE_SERVICE_ACCOUNT_EMAIL   — the service account's email
//     GOOGLE_SERVICE_ACCOUNT_KEY     — its PEM private key (\n-escaped is fine)
//     Setup: create a service account, enable the Drive API, add the SA email to
//     the Shared Drive as Content Manager. No interactive OAuth, no per-user token.
//   Mode B — OAuth offline access (a firm working out of one person's My Drive):
//     GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
//     Setup: one-time OAuth consent with scope .../auth/drive and
//     access_type=offline; store the refresh token as a secret.
//
// Phase 3 (flagged): a module-UI toggle to pick "personal (OAuth) vs business
// (service account)" per firm. The seam is already here — both auth paths exist
// and _useSA() selects between them by which env vars are present.

// Native Google formats have no binary — they are exported. { mime, ext }.
const GOOGLE_EXPORT = {
  'application/vnd.google-apps.document':     { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.drawing':      { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.spreadsheet':  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx',
  },
};

// Display names for the portal's folder_path slugs when mirroring out.
// (Same table as the Dropbox adapter — both directions must agree on layout.)
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

const API    = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Fields requested for every file — enough for NormEntry + path + versioning.
const FILE_FIELDS =
  'id,name,mimeType,size,md5Checksum,headRevisionId,version,modifiedTime,parents,trashed,driveId';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class GoogleDriveAdapter {
  static provider = 'google_drive';

  constructor(env) {
    this._env         = env;
    this.rootFolderId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    this._tok         = null;
    this._tokExp      = 0;     // epoch seconds
    this._driveId     = null;  // resolved lazily; null = My Drive mode
    this._driveIdDone = false;
  }

  static isConfigured(env) {
    const sa = env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const oauth = env.GOOGLE_OAUTH_REFRESH_TOKEN &&
                  env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET;
    return !!((sa || oauth) && env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  }

  _useSA() {
    return !!(this._env.GOOGLE_SERVICE_ACCOUNT_EMAIL && this._env.GOOGLE_SERVICE_ACCOUNT_KEY);
  }

  // ── Token management (either service-account JWT or OAuth refresh) ───────────

  async _token() {
    if (this._tok && this._tokExp > Date.now() / 1000) return this._tok;
    const { token, exp } = this._useSA()
      ? await this._serviceAccountToken()
      : await this._oauthToken();
    this._tok    = token;
    this._tokExp = exp;
    return token;
  }

  async _serviceAccountToken() {
    const email = this._env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const pem   = String(this._env.GOOGLE_SERVICE_ACCOUNT_KEY).replace(/\\n/g, '\n');
    const now   = Math.floor(Date.now() / 1000);

    const enc     = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const claim   = {
      iss:   email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud:   TOKEN_URL,
      iat:   now,
      exp:   now + 3600,
    };
    const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claim)}`;

    const key = await crypto.subtle.importKey(
      'pkcs8', pemToDer(pem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned),
    );
    const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;

    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:  jwt,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google service-account token failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    const d = await res.json();
    return { token: d.access_token, exp: now + (d.expires_in || 3600) - 60 };
  }

  async _oauthToken() {
    const { GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } = this._env;
    const now = Math.floor(Date.now() / 1000);
    const res = await fetch(TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN,
        client_id:     GOOGLE_OAUTH_CLIENT_ID,
        client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google OAuth token refresh failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    const d = await res.json();
    return { token: d.access_token, exp: now + (d.expires_in || 3600) - 60 };
  }

  // ── Drive JSON helper ────────────────────────────────────────────────────────

  async _api(path, params = {}) {
    const token = await this._token();
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API}/${path}${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Google Drive ${path} failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    return res.json();
  }

  // Shared Drive vs My Drive is decided by the root folder's driveId.
  async _ensureDriveId() {
    if (this._driveIdDone) return this._driveId;
    const meta = await this._api(`files/${this.rootFolderId}`,
      { fields: 'id,name,driveId', supportsAllDrives: 'true' });
    this._driveId     = meta.driveId || null;
    this._driveIdDone = true;
    return this._driveId;
  }

  // Common list params — include Shared Drive items when applicable.
  async _sharedParams() {
    const driveId = await this._ensureDriveId();
    const base = { supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' };
    return driveId ? { ...base, corpora: 'drive', driveId } : base;
  }

  // ── Full listing (pull backfill) ─────────────────────────────────────────────

  // First run: capture the change cursor FIRST (so nothing is missed during the
  // walk), pre-load every folder into the path cache, then page all files and
  // keep only those under the sync root.
  async listAll() {
    const cursor    = await this._startPageToken();
    const folderMap = await this._loadFolderMap();
    const base      = await this._sharedParams();

    const entries = [];
    let pageToken;
    do {
      const data = await this._api('files', {
        ...base,
        q:        `mimeType!='${FOLDER_MIME}' and trashed=false`,
        fields:   `nextPageToken, files(${FILE_FIELDS})`,
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      });
      for (const f of data.files || []) {
        const dir = await this._relDir(f.parents, folderMap);
        if (dir === null) continue;               // not under our root subtree
        const e = fileEntry(f, dir);
        if (e) entries.push(e);
      }
      pageToken = data.nextPageToken;
    } while (pageToken);

    return { entries, cursor };
  }

  // Delta since a saved cursor. reset=true → the engine falls back to listAll().
  async listDelta(cursor) {
    const driveId = await this._ensureDriveId();
    const cache   = new Map();   // folder-id → { name, parent } (filled on demand)
    const entries = [];
    let pageToken = cursor;

    try {
      for (;;) {
        const data = await this._api('changes', {
          pageToken,
          supportsAllDrives:         'true',
          includeItemsFromAllDrives: 'true',
          includeRemoved:            'true',
          pageSize:                  '1000',
          fields: `nextPageToken, newStartPageToken, changes(removed, fileId, file(${FILE_FIELDS}))`,
          ...(driveId ? { driveId } : {}),
        });

        for (const ch of data.changes || []) {
          const e = await this._normalizeChange(ch, cache);
          if (e) entries.push(e);
        }

        if (data.nextPageToken) { pageToken = data.nextPageToken; continue; }
        return { entries, cursor: data.newStartPageToken, reset: false };
      }
    } catch (err) {
      // Expired / invalid page token → re-list from scratch (ledger dedups).
      if (/\((400|404|410)\)/.test(String(err.message)) || /page ?token/i.test(String(err.message))) {
        return { entries: [], cursor: null, reset: true };
      }
      throw err;
    }
  }

  async _normalizeChange(ch, cache) {
    const f = ch.file;
    // Removed / trashed / unshared → a deleted marker (feeds move-detection; the
    // pull pipeline never deletes portal data on it).
    if (ch.removed || !f || f.trashed) {
      return {
        provider: 'google_drive', tag: 'deleted', remote_id: ch.fileId,
        remote_path: null, name: null, size: null, rev: null, content_hash: null,
      };
    }
    if (f.mimeType === FOLDER_MIME) return null;    // folder change — skip
    const dir = await this._relDir(f.parents, cache);
    if (dir === null) return null;                  // outside our root subtree
    return fileEntry(f, dir);
  }

  // Top-level folders under the sync root → { name, folder_lower } (recon report).
  async listClientFolders() {
    const base = await this._sharedParams();
    const out  = [];
    let pageToken;
    do {
      const data = await this._api('files', {
        ...base,
        q:        `mimeType='${FOLDER_MIME}' and trashed=false and '${this.rootFolderId}' in parents`,
        fields:   'nextPageToken, files(id,name)',
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      });
      for (const f of data.files || []) out.push({ name: f.name, folder_lower: f.name.toLowerCase() });
      pageToken = data.nextPageToken;
    } while (pageToken);
    return out;
  }

  // Every file recursively under ONE named top-level folder → NormEntry[].
  // Used by the on-demand per-client import (staff-confirmed folder → matter).
  // Unlike listAll() (which preloads every folder in the drive), this walks
  // only the matched folder's own subtree via BFS, seeding _relDir's cache as
  // it goes — remote_path comes back root-relative, matching listAll()'s
  // convention, so relativeParts() needs no changes.
  async listFolderEntries(folderName) {
    const base = await this._sharedParams();
    const safe = String(folderName).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const top = await this._api('files', {
      ...base,
      q:        `mimeType='${FOLDER_MIME}' and trashed=false and name='${safe}' and '${this.rootFolderId}' in parents`,
      fields:   'files(id,name)',
      pageSize: '10',
    });
    const folder = top.files && top.files[0];
    if (!folder) return [];

    const cache   = new Map([[folder.id, { name: folder.name, parent: this.rootFolderId }]]);
    const entries = [];
    const queue   = [folder.id];

    while (queue.length) {
      const parentId = queue.shift();
      let pageToken;
      do {
        const data = await this._api('files', {
          ...base,
          q:        `trashed=false and '${parentId}' in parents`,
          fields:   `nextPageToken, files(${FILE_FIELDS})`,
          pageSize: '1000',
          ...(pageToken ? { pageToken } : {}),
        });
        for (const f of data.files || []) {
          if (f.mimeType === FOLDER_MIME) {
            cache.set(f.id, { name: f.name, parent: parentId });
            queue.push(f.id);
          } else {
            const dir = await this._relDir(f.parents, cache);
            if (dir === null) continue; // shouldn't happen inside our own subtree
            const e = fileEntry(f, dir);
            if (e) entries.push(e);
          }
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
    }
    return entries;
  }

  // ── Path resolution (fileId parents → a root-relative folder path) ───────────

  // Load every folder once (backfill) so path building never misses.
  async _loadFolderMap() {
    const map  = new Map();
    const base = await this._sharedParams();
    let pageToken;
    do {
      const data = await this._api('files', {
        ...base,
        q:        `mimeType='${FOLDER_MIME}' and trashed=false`,
        fields:   'nextPageToken, files(id,name,parents)',
        pageSize: '1000',
        ...(pageToken ? { pageToken } : {}),
      });
      for (const f of data.files || []) {
        map.set(f.id, { name: f.name, parent: (f.parents && f.parents[0]) || null });
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
    return map;
  }

  // Fetch one folder's { name, parent }, caching (incl. negative results).
  async _folderNode(id, cache) {
    if (cache.has(id)) return cache.get(id);
    let node = null;
    try {
      const m = await this._api(`files/${id}`, { fields: 'id,name,parents', supportsAllDrives: 'true' });
      node = { name: m.name, parent: (m.parents && m.parents[0]) || null };
    } catch { /* unreadable → treated as out-of-tree */ }
    cache.set(id, node);
    return node;
  }

  // Walk parents up to the sync root; return the root-relative DIRECTORY path
  // ('' when the file sits directly under the root), or null if the file is not
  // under the root subtree. `cacheOrMap` is a Map (prebuilt for backfill, or an
  // on-demand cache for delta — both keyed id → { name, parent } | null).
  async _relDir(parents, cacheOrMap) {
    const segs = [];
    let cur = (parents && parents[0]) || null;
    let guard = 0;
    while (cur && cur !== this.rootFolderId && guard++ < 100) {
      const node = cacheOrMap.has(cur) ? cacheOrMap.get(cur) : await this._folderNode(cur, cacheOrMap);
      if (!node) return null;
      segs.unshift(node.name);
      cur = node.parent;
    }
    if (cur !== this.rootFolderId) return null;
    return segs.join('/');
  }

  // Split a NormEntry's (already root-relative) remote_path into
  // { clientFolder, clientFolderLower, folderPath }.
  relativeParts(entry) {
    const parts = String(entry.remote_path || '').replace(/^\/+/, '').split('/');
    if (parts.length < 2) return null;             // file at the root — ignore
    return {
      clientFolder:      parts[0],
      clientFolderLower: parts[0].toLowerCase(),
      folderPath:        parts.slice(1, -1).join('/'),
    };
  }

  // ── Download (pull) ──────────────────────────────────────────────────────────

  // Download a NormEntry. Native Google files are exported; binaries stream via
  // alt=media. mime_type rides on the entry for the pull path; the unmatched-
  // resolve path rebuilds a bare entry, so we fetch metadata when it's absent.
  async download(entry) {
    let mime = entry.mime_type;
    let rev  = entry.rev;
    let hash = entry.content_hash;

    if (!mime) {
      const meta = await this._api(`files/${entry.remote_id}`,
        { fields: 'mimeType,headRevisionId,md5Checksum,modifiedTime', supportsAllDrives: 'true' });
      mime = meta.mimeType;
      rev  = rev  || meta.headRevisionId || meta.modifiedTime || null;
      hash = hash || meta.md5Checksum || null;
    }

    const token  = await this._token();
    const native = GOOGLE_EXPORT[mime];
    const url = native
      ? `${API}/files/${entry.remote_id}/export?mimeType=${encodeURIComponent(native.mime)}`
      : `${API}/files/${entry.remote_id}?alt=media&supportsAllDrives=true`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Google Drive download failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    return {
      bytes: await res.arrayBuffer(),
      // Exported bytes have no provider hash (md5 is of the native source).
      meta:  { rev: rev || null, content_hash: native ? null : (hash || null) },
    };
  }

  // ── Upload (push) ────────────────────────────────────────────────────────────

  // Upload bytes to a root-relative path (from buildDocPath/buildDraftPath).
  // Folder chain is get-or-created under the root; the file is always CREATED
  // (never overwritten) — R2 stays canonical and we never clobber firm files.
  async upload(remotePath, fileBody) {
    const parts    = String(remotePath).replace(/^\/+/, '').split('/');
    const fileName = parts.pop();
    const parentId = await this._ensureFolderPath(parts);
    const token    = await this._token();

    const boundary = `iurisiq_${crypto.randomUUID()}`;
    const metadata = { name: fileName, parents: [parentId] };
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      fileBody,
      `\r\n--${boundary}--`,
    ]);

    const res = await fetch(
      `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,name,headRevisionId,md5Checksum`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (!res.ok) {
      throw new Error(`Google Drive upload failed (${res.status}): ${await res.text().catch(() => res.status)}`);
    }
    const m = await res.json();
    return {
      remote_id:    m.id,
      remote_path:  remotePath,
      // Every upload is a fresh file → a headRevisionId is always present, but
      // fall back defensively so recordLedger never drops a push.
      remote_rev:   m.headRevisionId || m.id,
      content_hash: m.md5Checksum || null,
    };
  }

  async _ensureFolderPath(segments) {
    let parent = this.rootFolderId;
    for (const raw of segments) {
      const name = String(raw).trim();
      if (name) parent = await this._getOrCreateFolder(name, parent);
    }
    return parent;
  }

  async _getOrCreateFolder(name, parentId) {
    const base = await this._sharedParams();
    const safe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const data = await this._api('files', {
      ...base,
      q:        `mimeType='${FOLDER_MIME}' and trashed=false and name='${safe}' and '${parentId}' in parents`,
      fields:   'files(id,name)',
      pageSize: '10',
    });
    if (data.files && data.files.length) return data.files[0].id;

    const token = await this._token();
    const res = await fetch(`${API}/files?supportsAllDrives=true&fields=id`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!res.ok) {
      throw new Error(`Google Drive folder create failed (${res.status}): ${await res.text().catch(() => '')}`);
    }
    return (await res.json()).id;
  }

  // ── Change cursor ────────────────────────────────────────────────────────────

  async _startPageToken() {
    const driveId = await this._ensureDriveId();
    const d = await this._api('changes/startPageToken',
      { supportsAllDrives: 'true', ...(driveId ? { driveId } : {}) });
    return d.startPageToken;
  }

  // ── Push path builders (root-relative — the root is an ID, not a segment) ────

  buildDocPath(clientName, folderPath, fileName) {
    const safeClient = sanitizePathPart(clientName || 'Unknown Client');
    const raw        = String(folderPath || 'other');
    const folder     = FOLDER_LABELS[raw] ||
      raw.split('/').map(sanitizePathPart).filter(Boolean).join('/') || 'Other';
    return `${safeClient}/${folder}/${sanitizePathPart(fileName)}`;
  }

  buildDraftPath(clientName, fileName) {
    const safeClient = sanitizePathPart(clientName || 'Unknown Client');
    return `${safeClient}/Final Documents/${sanitizePathPart(fileName)}`;
  }
}

// ── Normalization ──────────────────────────────────────────────────────────────

// Drive file (+ its resolved root-relative dir) → NormEntry, or null if it's a
// native type we don't export (Forms, shortcuts, …). Native docs get the export
// extension appended so the portal shows "Letter.pdf", not "Letter".
function fileEntry(f, dir) {
  const native = GOOGLE_EXPORT[f.mimeType];
  if (f.mimeType && f.mimeType.startsWith('application/vnd.google-apps.') && !native) return null;

  let name = f.name;
  if (native && !new RegExp(`\\.${native.ext}$`, 'i').test(name)) name = `${name}.${native.ext}`;

  return {
    provider:     'google_drive',
    tag:          'file',
    remote_id:    f.id,                                   // stable file id
    remote_path:  dir ? `${dir}/${name}` : name,          // root-relative
    name,
    size:         f.size != null ? Number(f.size) : null, // native docs: null
    rev:          f.headRevisionId || f.modifiedTime || f.version || null,
    content_hash: f.md5Checksum || null,                  // null for native docs
    mime_type:    f.mimeType,                             // read only by download()
  };
}

// ── Shared helpers ──────────────────────────────────────────────────────────────

function sanitizePathPart(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || '_';
}

// base64url of a Uint8Array/ArrayBuffer (JWT header/claim/signature).
function b64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// PEM (PKCS#8) → DER ArrayBuffer for crypto.subtle.importKey.
function pemToDer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/, '')
                 .replace(/-----END [^-]+-----/, '')
                 .replace(/\s+/g, '');
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return der.buffer;
}
