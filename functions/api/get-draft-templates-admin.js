// GET /api/get-draft-templates-admin
// Returns all draft_templates + attorney users for the Settings > Drafting Templates section.
// Requires read access on the doc_drafting module.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'doc_drafting');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const admin = makeAdminClient(env);

  const [{ data: templates, error: tErr }, { data: users, error: uErr }] = await Promise.all([
    admin
      .from('draft_templates')
      .select('id, name, doc_category, case_types, assigned_attorney_initials, template_set, form_number, group_number, template_docx_r2_key')
      .order('sort_order'),
    admin
      .from('users')
      .select('id, first_name, last_name, roles(name)')
      .eq('active', true)
      .order('first_name'),
  ]);

  if (tErr) {
    console.error('[get-draft-templates-admin] templates:', tErr.message);
    return json(500, { error: 'Failed to load drafting templates.' });
  }

  const attorneys = (users || []).filter(u =>
    ['Owner', 'Attorney', 'Partner Attorney'].includes(u.roles?.name)
  );

  return json(200, { templates: templates || [], attorneys });
}
