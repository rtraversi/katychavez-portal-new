// POST /api/intake-public-submit
// Public endpoint (no bearer auth) — authorized solely by the matter's intake_token.
// Turnstile-gated + IP rate-limited (see _worker RATE_LIMITS). Accepts the whole
// intake in one payload, writes it into the SAME structured tables the portal
// intake uses, then sets intake_submitted_at (the existing lock) and clears the
// token so the link is single-use.
//
// Body: {
//   token, turnstile_token,
//   opposing_party: {…}, marriage: {…}, children: [{…}], financial: {…}
// }
//
// Field whitelists mirror the authenticated client-intake-*.js endpoints exactly.
// SSN / driver's license are intentionally absent — those never come through
// plain client self-entry (they use the encrypted save-ssn pathway).

import { makeAdminClient, json, verifyTurnstile } from './_helpers.js';
import { pickFields } from './_client-intake-helpers.js';
import { notifyIntakeSubmitted } from './_notifications.js';

const OPPOSING_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'former_maiden_name', 'dob',
  'home_phone', 'work_phone', 'cell_phone', 'email',
  'address_line1', 'address_line2', 'city', 'state', 'zip', 'county',
  'mailing_address_line1', 'mailing_city', 'mailing_state', 'mailing_zip',
  'employer', 'employer_address_line1', 'employer_city', 'employer_state', 'employer_zip',
  'length_of_employment', 'gross_annual_income', 'education',
  'living_with_others', 'length_of_residence',
];

const MATTER_FIELDS = [
  'place_of_marriage', 'date_of_marriage', 'has_prenup',
  'prior_divorce_filed', 'prior_protective_order',
  'separation_status', 'separation_date', 'marriage_counselor',
  'separation_agreement', 'separation_agreement_notes',
  'marital_difficulties',
  'prior_attorney_consulted', 'prior_attorney_retained',
];

const CHILD_FIELDS = [
  'first_name', 'last_name', 'dob', 'custody_arrangement',
  'sex', 'place_of_birth', 'current_residence', 'special_needs',
  'health_ins_company', 'health_ins_id', 'health_ins_group',
  'health_ins_type', 'health_ins_type_other', 'health_ins_premium', 'health_ins_premium_payer',
  'paternity_dispute', 'custody_dispute',
];

const FINANCIAL_FIELDS = [
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

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { token } = body;
  if (!token) return json(400, { error: 'Missing token' });

  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ok = await verifyTurnstile(env, body.turnstile_token, ip);
  if (!ok) return json(403, { error: 'Verification failed. Please refresh and try again.' });

  const admin = makeAdminClient(env);

  // Resolve + validate the token (open, not expired, not already submitted).
  let matter;
  try {
    const { data, error } = await admin
      .from('matters')
      .select('id, case_type, case_number, intake_submitted_at, intake_expires_at, assigned_attorney_id, client:clients(first_name, last_name)')
      .eq('intake_token', token)
      .maybeSingle();
    if (error) {
      console.error('[intake-public-submit] resolve error:', error.message);
      return json(500, { error: 'Server error' });
    }
    matter = data;
  } catch (err) {
    console.error('[intake-public-submit] resolve fetch error:', err.message);
    return json(500, { error: 'Server error' });
  }

  if (!matter) return json(404, { error: 'This intake link is not valid.' });
  if (matter.intake_submitted_at) return json(409, { error: 'This intake has already been submitted.' });
  if (matter.intake_expires_at && new Date(matter.intake_expires_at) < new Date()) {
    return json(410, { error: 'This intake link has expired. Contact the firm for a new one.' });
  }

  const matterId = matter.id;

  // ── Opposing party (single) ──────────────────────────────────────────────────
  try {
    const op = pickFields(body.opposing_party || {}, OPPOSING_FIELDS);
    if (op.first_name) {
      // One opposing party per public intake — replace any prior row for idempotency.
      await admin.from('opposing_parties').delete().eq('matter_id', matterId);
      await admin.from('opposing_parties').insert({ ...op, matter_id: matterId });
    }
  } catch (err) {
    console.error('[intake-public-submit] opposing_party write:', err.message);
  }

  // ── Marriage / case-narrative fields on the matter ───────────────────────────
  try {
    const m = pickFields(body.marriage || {}, MATTER_FIELDS);
    if (Object.keys(m).length) {
      await admin.from('matters').update(m).eq('id', matterId);
    }
  } catch (err) {
    console.error('[intake-public-submit] marriage write:', err.message);
  }

  // ── Children (repeatable) ────────────────────────────────────────────────────
  try {
    const kids = Array.isArray(body.children) ? body.children : [];
    const rows = kids
      .map(k => pickFields(k || {}, CHILD_FIELDS))
      .filter(k => k.first_name)
      .map(k => ({ ...k, matter_id: matterId }));
    if (rows.length) {
      await admin.from('children').delete().eq('matter_id', matterId);
      await admin.from('children').insert(rows);
    }
  } catch (err) {
    console.error('[intake-public-submit] children write:', err.message);
  }

  // ── Financial (single, upsert on matter_id) ──────────────────────────────────
  try {
    const fin = pickFields(body.financial || {}, FINANCIAL_FIELDS);
    if (Object.keys(fin).length) {
      await admin.from('financial_info').upsert({ ...fin, matter_id: matterId }, { onConflict: 'matter_id' });
    }
  } catch (err) {
    console.error('[intake-public-submit] financial write:', err.message);
  }

  // ── Lock + burn the token (single-use) ───────────────────────────────────────
  const { error: lockErr } = await admin
    .from('matters')
    .update({ intake_submitted_at: new Date().toISOString(), intake_token: null })
    .eq('id', matterId);
  if (lockErr) {
    console.error('[intake-public-submit] lock error:', lockErr.message);
    return json(500, { error: 'Failed to submit intake. Please try again.' });
  }

  // ── Notify the assigned attorney (best-effort) ───────────────────────────────
  try {
    if (matter.assigned_attorney_id) {
      const { data: att } = await admin.from('users').select('email').eq('id', matter.assigned_attorney_id).single();
      if (att?.email) {
        const clientName  = matter.client ? `${matter.client.first_name || ''} ${matter.client.last_name || ''}`.trim() : '';
        const matterLabel = `${matter.case_type}${matter.case_number ? ' · ' + matter.case_number : ''}`;
        await notifyIntakeSubmitted(env, { toEmail: att.email, clientName, matterLabel });
      }
    }
  } catch (err) {
    console.error('[intake-public-submit] notify error:', err.message);
  }

  const firmName = env.PORTAL_FIRM_NAME || 'the firm';
  return json(200, { ok: true, firm_name: firmName });
}
