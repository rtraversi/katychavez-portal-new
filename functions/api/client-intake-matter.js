// POST /api/client-intake-matter
// Client-only. Updates Section-C "marriage / case narrative" fields directly
// on the client's own matters row. UPDATE-only — the matter itself is always
// created by staff first, never inserted here. Not yet intake-locked.
//
// adultery/abuse/etc. checkbox fields and the DV screening questionnaire
// (conflict_questionnaire) are intentionally NOT here — that stays a staff-
// administered form (see migration 004 comment), not client self-entry.

import { verifyAuth, json } from './_helpers.js';
import { resolveOwnedMatter, pickFields } from './_client-intake-helpers.js';

const ALLOWED_FIELDS = [
  'place_of_marriage', 'date_of_marriage', 'has_prenup',
  'prior_divorce_filed', 'prior_protective_order',
  'separation_status', 'separation_date', 'marriage_counselor',
  'separation_agreement', 'separation_agreement_notes',
  'marital_difficulties',
  'prior_attorney_consulted', 'prior_attorney_retained',
];

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'core', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (!auth.isClient) return json(403, { error: 'Only client accounts can use this endpoint.' });

  const { admin } = auth;

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const resolved = await resolveOwnedMatter(admin, auth.user.id, body.matter_id);
  if (resolved.error) return json(resolved.error.status, { error: resolved.error.message });

  const fields = pickFields(body, ALLOWED_FIELDS);
  if (!Object.keys(fields).length) return json(400, { error: 'No valid fields provided.' });

  const { data, error } = await admin
    .from('matters')
    .update(fields)
    .eq('id', body.matter_id)
    .select()
    .single();

  if (error) {
    console.error('[client-intake-matter] update:', error.message);
    return json(500, { error: 'Failed to save.' });
  }

  return json(200, { ok: true, matter: data });
}
