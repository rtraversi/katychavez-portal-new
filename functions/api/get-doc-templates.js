// GET /api/get-doc-templates
// Returns all document_checklists rows, grouped by case_type.
// Accessible to Owner, Attorney, Partner Attorney, Paralegal, Legal Assistant.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'doc_templates');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const admin = makeAdminClient(env);

  const { data, error } = await admin
    .from('document_checklists')
    .select('id, case_type, case_types, doc_name, doc_category, description, is_required_by_default, sort_order')
    .order('sort_order');

  if (error) {
    console.error('[get-doc-templates] query:', error.message);
    return json(500, { error: 'Failed to load templates.' });
  }

  return json(200, { templates: data || [] });
}
