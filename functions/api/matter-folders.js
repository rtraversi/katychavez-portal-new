// CF Worker: POST /api/matter-folders
// Body: { action: 'create' | 'rename' | 'delete' | 'seed', matter_id, ... }
//   create: { path }                 — new empty custom folder
//   rename: { old_path, new_path }   — cascades folder_path across documents + subfolders
//   delete: { path }                 — only when empty (no docs, no subfolders)
//   seed:   {}                       — inserts the firm's default_matter_folders template
//                                      (firm_settings) into this matter; idempotent
//
// Folders are metadata-only: documents.folder_path strings + matter_folders
// rows. R2 keys are never touched. The fixed folder set lives in the UI and
// can't be created/renamed/deleted here (reserved names).

import { verifyAuth, json } from './_helpers.js';

const RESERVED = new Set([
  'all', 'client_uploads', 'pleadings', 'agreements', 'correspondence',
  'financial', 'attorney_notes', 'court_orders', 'trial_docs', 'admin', 'other',
]);
const MAX_DEPTH = 4;
const MAX_SEGMENT = 60;

// Normalize + validate a folder path. Returns the clean path or null.
// Exported for unit tests.
export function cleanPath(raw) {
  if (typeof raw !== 'string') return null;
  const segments = raw.split('/').map(s => s.trim()).filter(Boolean);
  if (!segments.length || segments.length > MAX_DEPTH) return null;
  for (const s of segments) {
    if (s.length > MAX_SEGMENT) return null;
    if (s === '.' || s === '..') return null;
    // No control characters
    if ([...s].some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return null;
  }
  if (RESERVED.has(segments[0].toLowerCase())) return null;
  return segments.join('/');
}

// Escape SQL LIKE wildcards so a folder named "100%" can't match as a pattern.
// Exported for unit tests.
export function likeEscape(s) {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

// Normalize the firm_settings.default_matter_folders value into a clean,
// deduped list of seedable paths. Tolerates non-array/garbage values (the
// column is free-form jsonb edited from the settings page). Exported for
// unit tests.
export function normalizeTemplate(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const path = cleanPath(typeof entry === 'string' ? entry : '');
    if (!path) continue;
    const lower = path.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(path);
  }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[matter-folders]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'uploads');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { action, matter_id } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required' });

  const { admin } = auth;

  const { data: matter } = await admin
    .from('matters').select('id').eq('id', matter_id).single();
  if (!matter) return json(404, { error: 'Matter not found' });

  switch (action) {

    case 'create': {
      const path = cleanPath(body.path);
      if (!path) return json(400, { error: 'Invalid folder name (reserved name, too deep, or bad characters)' });

      const { error } = await admin.from('matter_folders').insert({
        matter_id,
        path,
        created_by: auth.profile.id,
      });
      if (error) {
        if (error.code === '23505') return json(409, { error: 'A folder with that name already exists' });
        return json(500, { error: error.message });
      }
      return json(200, { ok: true, path });
    }

    case 'rename': {
      const oldPath = typeof body.old_path === 'string' ? body.old_path.trim() : '';
      const newPath = cleanPath(body.new_path);
      if (!oldPath || RESERVED.has(oldPath.toLowerCase())) return json(400, { error: 'This folder cannot be renamed' });
      if (!newPath) return json(400, { error: 'Invalid new folder name (reserved name, too deep, or bad characters)' });
      if (oldPath === newPath) return json(200, { ok: true, path: newPath });

      const { data: existing } = await admin
        .from('matter_folders').select('id')
        .eq('matter_id', matter_id).eq('path', oldPath).maybeSingle();
      if (!existing) return json(404, { error: 'Folder not found' });

      const { data: clash } = await admin
        .from('matter_folders').select('id')
        .eq('matter_id', matter_id).eq('path', newPath).maybeSingle();
      if (clash) return json(409, { error: 'A folder with that name already exists' });

      // Exact matches first (the folder row itself + docs directly inside it)…
      await admin.from('matter_folders')
        .update({ path: newPath })
        .eq('matter_id', matter_id).eq('path', oldPath);
      await admin.from('documents')
        .update({ folder_path: newPath })
        .eq('matter_id', matter_id).eq('folder_path', oldPath);

      // …then every descendant path, prefix-swapped. Distinct paths are few
      // (one update per distinct subfolder), so per-path updates stay cheap.
      const [{ data: subFolders }, { data: subDocs }] = await Promise.all([
        admin.from('matter_folders').select('path')
          .eq('matter_id', matter_id).like('path', `${likeEscape(oldPath)}/%`),
        admin.from('documents').select('folder_path')
          .eq('matter_id', matter_id).like('folder_path', `${likeEscape(oldPath)}/%`),
      ]);
      const descendantPaths = [...new Set([
        ...(subFolders || []).map(r => r.path),
        ...(subDocs || []).map(r => r.folder_path),
      ])];
      for (const p of descendantPaths) {
        const swapped = newPath + p.slice(oldPath.length);
        await admin.from('matter_folders')
          .update({ path: swapped })
          .eq('matter_id', matter_id).eq('path', p);
        await admin.from('documents')
          .update({ folder_path: swapped })
          .eq('matter_id', matter_id).eq('folder_path', p);
      }

      return json(200, { ok: true, path: newPath });
    }

    case 'delete': {
      const path = typeof body.path === 'string' ? body.path.trim() : '';
      if (!path || RESERVED.has(path.toLowerCase())) return json(400, { error: 'This folder cannot be deleted' });

      const [{ count: docsExact }, { count: docsNested }, { count: subCount }] = await Promise.all([
        admin.from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('matter_id', matter_id).is('deleted_at', null)
          .eq('folder_path', path),
        admin.from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('matter_id', matter_id).is('deleted_at', null)
          .like('folder_path', `${likeEscape(path)}/%`),
        admin.from('matter_folders')
          .select('id', { count: 'exact', head: true })
          .eq('matter_id', matter_id).like('path', `${likeEscape(path)}/%`),
      ]);
      if (((docsExact || 0) + (docsNested || 0)) > 0) return json(409, { error: 'Folder is not empty — move or delete its files first' });
      if ((subCount || 0) > 0) return json(409, { error: 'Folder has subfolders — delete those first' });

      const { error } = await admin.from('matter_folders')
        .delete().eq('matter_id', matter_id).eq('path', path);
      if (error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    case 'seed': {
      const { data: settings } = await admin
        .from('firm_settings').select('default_matter_folders').limit(1).maybeSingle();
      const template = normalizeTemplate(settings?.default_matter_folders);
      if (!template.length) return json(200, { ok: true, created: 0 });

      let created = 0;
      for (const path of template) {
        const { error } = await admin.from('matter_folders').insert({
          matter_id,
          path,
          created_by: auth.profile.id,
        });
        if (!error) created++;
        else if (error.code !== '23505') return json(500, { error: error.message });
        // 23505 (already exists) — fine, seed is idempotent
      }
      return json(200, { ok: true, created });
    }

    default:
      return json(400, { error: 'action must be create, rename, delete, or seed' });
  }
}
