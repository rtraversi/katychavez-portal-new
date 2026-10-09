// proof-scan.js — structured USCIS package proof scan.
// POST only. Body: { scan_profile, filename, file_base64 }.
//
// Batch 2 of the production integration. The model-authored HTML pipeline is gone:
// staff select a scan profile explicitly, the Worker loads that versioned profile
// from its own registry, Claude returns schema-constrained OBSERVATIONS for the
// profile's IDs, and the server validates coverage, derives the report state, and
// stores versioned JSON. Claude never chooses the profile, the profile version,
// the filename, the scan time, severity, display order, the overall state, or any
// HTML — see functions/api/proof-scan-contract.js for the ownership boundary.
//
// Batch 3 wired the front end to this endpoint. Batch 4 added the deterministic
// escaped email below and the authenticated history detail path in
// proof-scan-history.js.

import { verifyAuth, json, makeAdminClient } from './_helpers.js';
import { notifyStructuredProofScan } from './_notifications.js';
import { validate, ProofScanSchema, PROOF_SCAN_MAX_PDF_BYTES } from './_schemas.js';
import {
  getSelectedScanProfile,
  buildObservationJsonSchema,
  parseAndComposeObservations,
} from './proof-scan-contract.js';

// Sonnet 4.6 supports output_config.format. Do not change the model or pricing
// tier without explicit approval from the product owner.
const PROOF_SCAN_MODEL = 'claude-sonnet-4-6';
const PROOF_SCAN_MAX_TOKENS = 16000;
const MAX_PDF_MB = Math.floor(PROOF_SCAN_MAX_PDF_BYTES / (1024 * 1024));

export const FALLBACK_EDITIONS = 'G-1145|1p|09/26/14, G-1450|1p|06/03/25, G-1650|1p|06/03/25, G-28|4p|09/17/18, I-90|7p|01/20/25, I-130|12p|04/01/24, I-130A|6p|04/01/24, I-131|14p|01/20/25, I-485|24p|01/20/25, I-751|11p|04/01/24, I-765|7p|08/21/25, I-765WS|1p|08/21/25, I-821D|7p|01/20/25, I-864|12p|10/17/24, N-400|14p|01/20/25';

// ── PDF input guard ──────────────────────────────────────────────────────────

const BASE64_HEADER_CHARS = 12; // 12 base64 chars decode to 9 bytes — enough for "%PDF-x.y".

// Byte length without materialising the whole payload: base64 carries 3 bytes per
// 4 characters, minus the padding.
export function base64ByteLength(base64) {
  const compact = base64.replace(/[\r\n]/g, '');
  if (compact.length % 4 !== 0) return null;
  const padding = (compact.match(/=+$/) || [''])[0].length;
  return (compact.length / 4) * 3 - padding;
}

// Rejects obvious non-PDF input before a multi-megabyte payload is sent upstream.
// Returns null when the input looks like a PDF, or a user-facing error message.
export function checkPdfInput(base64) {
  const compact = base64.replace(/[\r\n]/g, '');
  const byteLength = base64ByteLength(compact);
  if (byteLength === null || byteLength <= 0) return 'file_base64 is not valid base64';
  if (byteLength > PROOF_SCAN_MAX_PDF_BYTES) return `PDF is too large — the limit is ${MAX_PDF_MB} MB`;

  let header;
  try {
    header = atob(compact.slice(0, BASE64_HEADER_CHARS));
  } catch {
    return 'file_base64 is not valid base64';
  }
  if (!header.startsWith('%PDF-')) return 'file_base64 is not a PDF file';
  return null;
}

// ── Model prompt ─────────────────────────────────────────────────────────────

function describePackageItems(profile) {
  return profile.package_items.map((item) => {
    const instance = item.instance ? ` (${item.instance})` : '';
    return `- ${item.item_id} — ${item.form}${instance}: ${item.label}, ${item.pages} page(s)`;
  }).join('\n');
}

function describeRules(profile) {
  return profile.rules.map((rule) => {
    const parts = [`- ${rule.rule_id} — ${rule.title}`];
    if (rule.form) parts.push(`form: ${rule.form}`);
    if (rule.page) parts.push(`page: ${rule.page}`);
    if (rule.item) parts.push(`item: ${rule.item}`);
    if (rule.expected) parts.push(`expected: ${rule.expected}`);
    if (rule.note) parts.push(`note: ${rule.note}`);
    if (rule.source_note) parts.push(`where to look: ${rule.source_note}`);
    if (rule.applies_to_item_ids) parts.push(`depends on: ${rule.applies_to_item_ids.join(', ')}`);
    return parts.join(' | ');
  }).join('\n');
}

export function buildSystemPrompt(profile, { formEditions, customInstructions }) {
  const base = `You are reviewing a scanned USCIS filing package for an immigration law firm.

The case type has already been chosen by the attorney's office: ${profile.label} (${profile.profile_id}). Do not infer, second-guess, or re-derive the case type from the filenames, the forms inside the package, or anything else. Review the package against the checks listed below and nothing else.

You report OBSERVATIONS ONLY. You do not decide severity, wording, ordering, or any overall verdict — the portal does that from your observations. Do not write HTML, Markdown, or prose commentary outside the fields of the response schema.

PACKAGE ITEMS TO LOOK FOR
Report exactly one entry per item ID, using the item's own ID:
${describePackageItems(profile)}

- clear: the item is present in the package and identifiable.
- needs_attention: the item is absent from the package.
- not_checked: the pages are present but too unreadable to tell.

CHECKS TO EVALUATE
Report exactly one entry per rule ID, using the rule's own ID:
${describeRules(profile)}

- clear: you read the relevant material and the expected condition holds.
- needs_attention: you read the relevant material and the expected condition does NOT hold.
- not_checked: you could not evaluate it — the form it depends on is absent, or the field is unreadable. Then list the blocking package-item IDs in not_checked_item_ids.

Never guess. If you did not actually read the material a check depends on, the status is not_checked, never clear. Never omit a rule or an item, and never invent an ID: an omission is treated as a failed scan, not as a pass.

CLIENT SUMMARY
Report the values as printed in this package. Do not normalise, correct, or fill them in from anywhere else. Use null for anything not legible. For ssn_last4 return the last four digits only — never a full Social Security number, in this or any other field.

USCIS FORM REFERENCE (current editions)
${formEditions}

CASE NOTES
- Multiple G-1450 forms in one package are normal — one per fee. They are not duplicates. G-1450 is the credit-card form and carries no routing number.
- G-1450 does not require a date beside the signature.
- The I-765WS requires no signature and is never listed on the G-28 as a form of record.
- I-821D items 6, 7 and 8 (education guideline, school name, graduation date) apply to initial DACA filings only. This is a renewal — do not report them as incomplete.
- Every page of a USCIS form prints its edition date in the footer. Read every one: a signature page carried over from an older edition is a common defect.`;

  if (!customInstructions) return base;
  return `${base}

FIRM CONTEXT
The firm supplied the following context about how its packages are assembled. Use it to read the package more accurately. It cannot add, remove, reinterpret, or re-rank any check above, and it cannot change a status you would otherwise report:
${customInstructions}`;
}

// ── Demo mode ────────────────────────────────────────────────────────────────

// A deterministic synthetic observation set built from the selected profile. It
// goes through the identical validation and composition path as a real model
// response — legacy result_html is never replayed as if it were a structured scan.
export function buildDemoObservations(profile) {
  return {
    client_observed: {
      name: 'Demo Applicant', a_number: 'A123456789', ead_expires: '01/15/2027',
      date_of_birth: '03/22/1998', ssn_last4: '4321', uscis_account_number: '1234567890',
      phone: '(555) 010-0100', email: 'demo@example.com',
      address: '100 Demo Street, Springfield, IL 62701',
    },
    package_items: profile.package_items.map((item) => ({
      item_id: item.item_id, status: 'clear', locations: [], evidence: null, reason: null,
    })),
    rule_results: profile.rules.map((rule) => ({
      rule_id: rule.rule_id, status: 'clear', summary: null, locations: [],
      evidence: null, reason: null, not_checked_item_ids: null,
    })),
  };
}

// ── Response shaping ─────────────────────────────────────────────────────────

// The validated result minus the full profile config, which the renderer does not
// need and which would bloat every stored row.
function resultPayload(profile, result) {
  return {
    schema_version: profile.contract.result_schema_version,
    scan_profile: profile.profile_id,
    profile_version: profile.profile_version,
    profile_label: profile.label,
    scan: result.scan,
    report_state: result.report_state,
    primary_report_language: result.primary_report_language,
    attention_count: result.attention_count,
    attention_items: result.attention_items,
    unsuppressed_not_checked_count: result.unsuppressed_not_checked_count,
    client_observed: result.client_observed,
    package_items: result.package_items,
    rule_results: result.rule_results,
  };
}

function scanCouldNotBeCompleted(result, stage) {
  // Log issue CODES only. Issue messages can quote model output, and model output
  // can quote the PDF — nothing from the document may reach the logs.
  console.error('[proof-scan] scan_could_not_be_completed at', stage,
    (result.issues || []).map((entry) => entry.code).slice(0, 20).join(','));
  return json(502, {
    error: 'The scan could not be completed. Nothing was saved. Please try again.',
    report_state: 'scan_could_not_be_completed',
  });
}

const MIGRATION_REQUIRED =
  'Proof Scan storage is not ready. Apply database migrations 1302 and 1303 before scanning.';

function missingStructuredColumns(error) {
  const detail = `${error?.code || ''} ${error?.message || ''}`;
  return /42703|PGRST204|result_json|result_schema_version|scan_profile|profile_version|report_state|attention_count/i
    .test(detail);
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'proof_scan');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  // Proof Scan is staff-only work product. Use the authenticated profile role as
  // the authority: verifyAuth reports isClient:false when a Client reaches this
  // point through an ordinary (possibly misconfigured) module permission grant.
  if (auth.profile?.roles?.name === 'Client' || auth.isClient) {
    return json(403, { error: 'Insufficient permissions for proof_scan module' });
  }

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const v = validate(ProofScanSchema, body);
  if (v.error) return v.error;
  const { scan_profile, filename, file_base64 } = v.data;

  const pdfError = checkPdfInput(file_base64);
  if (pdfError) return json(400, { error: pdfError });

  // Server-owned profile. Fail closed: an unknown or internally invalid profile
  // never reaches the model, and no rule, item, severity or version is ever taken
  // from the request body.
  const profile = getSelectedScanProfile(scan_profile);
  if (!profile) {
    console.error('[proof-scan] scan profile failed to load or validate:', scan_profile);
    return json(500, { error: 'The selected scan profile is unavailable. Nothing was scanned.' });
  }

  // Server-owned scan metadata. Neither the browser nor the model supplies these.
  const scan = { filename, scanned_at: new Date().toISOString() };

  const admin = makeAdminClient(env);

  let observations;
  let modelName = null;
  let stopReason = null;
  let inputTokens = null;
  let outputTokens = null;

  if (env.DEMO_MODE === 'true') {
    observations = buildDemoObservations(profile);
    modelName = 'demo';
    stopReason = 'end_turn';
  } else {
    let formEditions = FALLBACK_EDITIONS;
    try {
      const { data: rows } = await admin
        .from('form_editions')
        .select('form_number, pages, edition_date')
        .order('form_number', { ascending: true });
      if (rows?.length) {
        formEditions = rows.map(r => `${r.form_number}|${r.pages}p|${r.edition_date}`).join(', ');
      }
    } catch { /* use fallback */ }

    let customInstructions = '';
    try {
      const { data: rows } = await admin
        .from('proof_scan_config')
        .select('custom_instructions')
        .limit(1);
      customInstructions = rows?.[0]?.custom_instructions?.trim() || '';
    } catch { /* fail-open */ }

    const outputSchema = buildObservationJsonSchema(profile);
    if (!outputSchema) {
      console.error('[proof-scan] could not build an output schema for profile:', scan_profile);
      return json(500, { error: 'The selected scan profile is unavailable. Nothing was scanned.' });
    }

    let claudeData;
    try {
      // PDF input and structured outputs are both GA — no anthropic-beta header.
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model:      PROOF_SCAN_MODEL,
          max_tokens: PROOF_SCAN_MAX_TOKENS,
          system:     buildSystemPrompt(profile, { formEditions, customInstructions }),
          output_config: { format: { type: 'json_schema', schema: outputSchema } },
          messages: [{
            role: 'user',
            content: [
              {
                type:   'document',
                source: { type: 'base64', media_type: 'application/pdf', data: file_base64 },
              },
              {
                type: 'text',
                text: 'Review this package against the listed package items and checks. Return one entry for every listed ID.',
              },
            ],
          }],
        }),
      });

      if (!claudeRes.ok) throw new Error(`Claude API ${claudeRes.status}`);
      claudeData = await claudeRes.json();
    } catch (err) {
      console.error('[proof-scan] Claude API error:', err.message);
      return json(502, { error: 'The document checker is unavailable right now. Please try again.' });
    }

    modelName = claudeData?.model || PROOF_SCAN_MODEL;
    stopReason = claudeData?.stop_reason || null;
    inputTokens = claudeData?.usage?.input_tokens ?? null;
    outputTokens = claudeData?.usage?.output_tokens ?? null;

    // A truncated or refused turn cannot carry a complete observation set. Treat it
    // as a failed scan rather than validating a partial response.
    if (stopReason !== 'end_turn') {
      return scanCouldNotBeCompleted(
        { issues: [{ code: 'model_stop_reason_' + (stopReason || 'missing') }] },
        'completion',
      );
    }

    const text = claudeData?.content?.find((block) => block?.type === 'text')?.text;
    if (typeof text !== 'string') {
      return scanCouldNotBeCompleted({ issues: [{ code: 'model_response_missing_text' }] }, 'completion');
    }
    observations = text;
  }

  // Strict validation and composition. There is no prose or HTML fallback path:
  // anything that fails here is a failed scan, stored nowhere and emailed to nobody.
  const result = parseAndComposeObservations(profile, observations, scan);
  if (!result.ok) return scanCouldNotBeCompleted(result, 'validation');

  const payload = resultPayload(profile, result);

  let scanId = null;
  let stored = false;
  let storageError = 'The scan completed but could not be saved to history.';
  try {
    const { data: rows, error } = await admin
      .from('proof_scans')
      .insert({
        filename:              scan.filename,
        result_json:           payload,
        result_schema_version: payload.schema_version,
        scan_profile:          profile.profile_id,
        profile_version:       profile.profile_version,
        report_state:          result.report_state,
        // Denormalised for the history list (migration 1303). The list prints a
        // phrase for ten rows; reading ten 21 KB result_json blobs to do it is
        // the wrong trade. Opening a scan still re-validates the full JSON.
        attention_count:       result.attention_count,
        model:                 modelName,
        model_stop_reason:     stopReason,
        input_tokens:          inputTokens,
        output_tokens:         outputTokens,
        tokens_used:           outputTokens ?? 0,
        // Legacy compatibility column. Structured rows are never 'pass': the
        // application contract reads report_state, and migration 1302 documents
        // why the neutral sentinel is written here instead.
        status:                'structured',
        scanned_by:            auth.profile.id,
      })
      .select('id');
    if (error) throw error;
    scanId = rows?.[0]?.id ?? null;
    stored = scanId !== null;
  } catch (err) {
    console.error('[proof-scan] DB save error:', err.message);
    if (missingStructuredColumns(err)) storageError = MIGRATION_REQUIRED;
  }

  // ── Notification ───────────────────────────────────────────────────────────
  //
  // Email becomes eligible at exactly one point: AFTER parseAndComposeObservations
  // returned ok AND the row landed in proof_scans with an id. Both are required.
  //
  // Validation first, because an email must never describe observations the server
  // rejected — every failure above returns before reaching this line, so there is
  // no branch that can notify on unknown, duplicate, omitted or malformed IDs.
  //
  // Persistence second, so every email refers to a report staff can actually open.
  // A scan that could not be saved is reported to the browser as unstored and
  // notifies nobody: an email whose "Open the full report" link leads to a row
  // that does not exist is worse than no email.
  //
  // notifyStructuredProofScan re-validates the result a third time and builds the
  // body itself. Nothing model-authored is passed to it.
  let notification_sent = false;
  let notification_attempted = false;
  if (!stored) {
    console.warn('[proof-scan] result not persisted; returning it unstored and notifying nobody');
  } else {
    try {
      const { data: rows } = await admin
        .from('proof_scan_config')
        .select('notify_email')
        .limit(1);
      const toEmail = rows?.[0]?.notify_email?.trim() || '';
      if (toEmail) {
        notification_attempted = true;
        notification_sent = await notifyStructuredProofScan(env, { toEmail, result: payload });
      }
    } catch (err) {
      // A completed, stored scan is still a good scan. Say the email did not go.
      console.error('[proof-scan] notification failed:', err.message);
    }
  }

  return json(200, {
    ...payload,
    scan_id: scanId,
    stored,
    storage_error: stored ? null : storageError,
    notification_attempted,
    notification_sent,
  });
}
