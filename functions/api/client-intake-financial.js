// POST /api/client-intake-financial
// Client-only. Upserts the single financial_info row for the client's own
// matter (matter_id is UNIQUE on that table). Not yet intake-locked.
// financial_affidavit_status is intentionally excluded — that tracks the
// actual court affidavit process and is staff-managed, not client self-entry.

import { verifyAuth, json } from './_helpers.js';
import { resolveOwnedMatter, pickFields } from './_client-intake-helpers.js';

const ALLOWED_FIELDS = [
  'client_monthly_income', 'opposing_monthly_income',
  'real_estate_gross_value', 'liquid_assets_value',
  'retirement_description', 'retirement_estimated_value',
  'frequent_flyer_miles', 'vehicles_description',
  'other_assets_description', 'total_liabilities', 'weapons_description',
  'client_has_trust_assets', 'client_trust_assets_explain',
  'opposing_has_trust_assets', 'opposing_trust_assets_explain',
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

  const { data, error } = await admin
    .from('financial_info')
    .upsert({ ...fields, matter_id: body.matter_id }, { onConflict: 'matter_id' })
    .select()
    .single();

  if (error) {
    console.error('[client-intake-financial] upsert:', error.message);
    return json(500, { error: 'Failed to save.' });
  }

  return json(200, { ok: true, financial_info: data });
}
