// CF Worker: POST /api/form-editions/verify
// Body: { form_number }
//
// Tier 0 of the edition guard — a human records that they checked this form's
// edition against uscis.gov and our stored edition is correct as of now. Sets
// last_verified_at / verified_by; it does NOT change edition_date (that is a
// template change made by re-adding the form). The UI uses last_verified_at to
// nudge when a form hasn't been confirmed in a while.
//
// Gated on write access to the USCIS Forms (draft_forms) module.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const auth = await verifyAuth(request, env, 'write', 'draft_forms');
    if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

    let body;
    try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

    const formNumber = String(body.form_number || '').trim().toUpperCase();
    if (!formNumber) return json(400, { error: 'form_number is required' });

    const admin = makeAdminClient(env);
    const { data, error } = await admin
      .from('form_editions')
      .update({ last_verified_at: new Date().toISOString(), verified_by: auth.profile.id })
      .eq('form_number', formNumber)
      .select('form_number, edition_date, check_status, last_verified_at')
      .maybeSingle();

    if (error) return json(500, { error: error.message });
    if (!data) return json(404, { error: `No edition record for ${formNumber}` });

    return json(200, { ok: true, edition: data });
  } catch (err) {
    console.error('[form-editions-verify]', err);
    return json(500, { error: 'An unexpected error occurred. Please try again.' });
  }
}
