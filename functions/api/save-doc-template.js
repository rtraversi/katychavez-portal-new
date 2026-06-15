// POST /api/save-doc-template
// Create, update, or delete a document_checklists row.
// Owner + Attorney (write on doc_templates) only.
//
// Body (create):  { action:'create', case_types, doc_name, doc_category, description, is_required_by_default, sort_order }
// Body (update):  { action:'update', id, case_types, doc_name, doc_category, description, is_required_by_default, sort_order }
// case_types: null = universal; string[] = specific types (e.g. ['divorce','custody'])
// Body (delete):  { action:'delete', id }

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'doc_templates');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { action } = body;
  if (!action) return json(400, { error: 'action is required.' });

  const admin = makeAdminClient(env);

  if (action === 'create') {
    const { case_types, doc_name, doc_category, description, is_required_by_default, sort_order } = body;
    if (!doc_name?.trim()) return json(400, { error: 'doc_name is required.' });

    const resolvedTypes = Array.isArray(case_types) && case_types.length > 0 ? case_types : null;

    const { data, error } = await admin
      .from('document_checklists')
      .insert({
        case_types:              resolvedTypes,
        doc_name:                doc_name.trim(),
        doc_category:            doc_category || 'other',
        description:             description?.trim() || null,
        is_required_by_default:  is_required_by_default !== false,
        sort_order:              sort_order || 0,
      })
      .select()
      .single();

    if (error) {
      console.error('[save-doc-template] create:', error.message);
      return json(500, { error: 'Failed to create template.' });
    }
    return json(200, { template: data });
  }

  if (action === 'update') {
    const { id, case_types, doc_name, doc_category, description, is_required_by_default, sort_order } = body;
    if (!id) return json(400, { error: 'id is required.' });
    if (!doc_name?.trim()) return json(400, { error: 'doc_name is required.' });

    const resolvedTypes = Array.isArray(case_types) && case_types.length > 0 ? case_types : null;

    const { data, error } = await admin
      .from('document_checklists')
      .update({
        case_types:              resolvedTypes,
        doc_name:                doc_name.trim(),
        doc_category:            doc_category || 'other',
        description:             description?.trim() || null,
        is_required_by_default:  is_required_by_default !== false,
        sort_order:              sort_order || 0,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[save-doc-template] update:', error.message);
      return json(500, { error: 'Failed to update template.' });
    }
    return json(200, { template: data });
  }

  if (action === 'delete') {
    const { id } = body;
    if (!id) return json(400, { error: 'id is required.' });

    const { error } = await admin
      .from('document_checklists')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[save-doc-template] delete:', error.message);
      return json(500, { error: 'Failed to delete template.' });
    }
    return json(200, { deleted: true });
  }

  return json(400, { error: `Unknown action: ${action}` });
}
