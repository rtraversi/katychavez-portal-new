// proof-scan-history.js — authenticated Proof Scan history: list and detail.
//
// Batch 4. Before this, the page listed scans here and then went to Supabase from
// the browser for the result body. That direct read is gone: every byte of a
// stored scan now leaves through this file, behind the same auth and ownership
// check as the list.
//
//   POST {}              → { scans: [...] }   the last 10, newest first
//   POST { scan_id }     → one scan's body
//
// A detail response is one of three kinds and never anything else:
//
//   structured  a `result_json` that passed full re-validation. The page renders
//               it through the same report model and renderer a fresh scan uses.
//   legacy      a pre-Batch-2 `result_html`, labelled as such. The page displays
//               it as plain text; the HTML is never parsed or injected.
//   unavailable the row exists but cannot be shown — corrupt, truncated, an
//               unknown schema version, or a profile this build does not
//               configure. A neutral message, never a clean result.

import { verifyAuth, json, makeAdminClient } from './_helpers.js';
import {
  reportStateLanguage,
  validateStoredScanResult,
  SUPPORTED_RESULT_SCHEMA_VERSION,
} from './proof-scan-contract.js';

const HISTORY_LIMIT = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Selected for the list. `result_json` is deliberately absent — it is ~21 KB a
// row, and the list needs a date, a filename and a phrase. `result_schema_version`
// is the cheap structured marker: migration 1302 requires it on every row that
// carries result_json, and no legacy row has ever had it set.
const LIST_COLUMNS = 'id, filename, created_at, status, report_state, attention_count, scan_profile, result_schema_version';

// Legacy `result_html` can be large; only the detail path ever asks for it.
const DETAIL_COLUMNS = 'id, filename, created_at, status, report_state, attention_count, scan_profile, profile_version, result_schema_version, result_json, result_html';

const MIGRATION_REQUIRED =
  'Proof Scan history is not ready. Apply database migrations 1302 and 1303.';

function databaseError(error) {
  const detail = `${error?.code || ''} ${error?.message || ''}`;
  const missing = /42703|PGRST204|result_json|result_schema_version|scan_profile|profile_version|report_state|attention_count/i
    .test(detail);
  return json(500, { error: missing ? MIGRATION_REQUIRED : 'Could not load Proof Scan history.' });
}

// ── Ownership ────────────────────────────────────────────────────────────────
//
// Proof scans are firm work product: a paralegal runs one, an attorney reviews
// it, so the boundary is the staff workspace rather than the individual who
// pressed the button. `scanned_by` stays an audit field, not an access rule.
//
// verifyAuth already refuses anyone without `read` on the proof_scan module, and
// the Client role has no such grant. clientBypass is NOT passed. The explicit
// profile-role refusal below is a second lock if a Client grant is ever
// misconfigured. (`verifyAuth` currently reports isClient:false after an ordinary
// permission check, so the authenticated profile is the authoritative identity.)
// A client never owns a proof scan.
async function authorize(request, env, level) {
  const auth = await verifyAuth(request, env, level, 'proof_scan');
  if (auth.httpError) return { error: json(auth.httpError.status, { error: auth.httpError.message }) };
  if (auth.profile?.roles?.name === 'Client' || auth.isClient) {
    return { error: json(403, { error: 'Insufficient permissions for proof_scan module' }) };
  }
  return { auth };
}

// ── List ─────────────────────────────────────────────────────────────────────

// The row the page draws. `report_language` is composed here from the stored
// state and count, so the phrase in the list is the same phrase the report and
// the email use.
//
// A structured row whose schema version, state or count is missing or unusable
// comes back as kind 'unavailable' with no language at all. That is the whole
// point: a clean state is never inferred from absent metadata.
export function historyRow(row) {
  if (row.result_schema_version == null) {
    return {
      id: row.id,
      filename: row.filename,
      created_at: row.created_at,
      kind: 'legacy',
      report_state: null,
      report_language: null,
      scan_profile: null,
    };
  }
  // A schema version this build does not understand is unavailable, not clean.
  const language = row.result_schema_version === SUPPORTED_RESULT_SCHEMA_VERSION
    ? reportStateLanguage(row.report_state, row.attention_count)
    : null;
  return {
    id: row.id,
    filename: row.filename,
    created_at: row.created_at,
    kind: language === null ? 'unavailable' : 'structured',
    // Only ever sent alongside a language the server composed itself, so the page
    // cannot tone a row it has no validated state for.
    report_state: language === null ? null : row.report_state,
    report_language: language,
    scan_profile: row.scan_profile || null,
  };
}

async function listScans(admin) {
  const { data: scans, error } = await admin
    .from('proof_scans')
    .select(LIST_COLUMNS)
    // v2 runs live inside their case (migration 2001) and render there; this
    // list is the v1.2 checker's own history.
    .is('case_id', null)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error) return databaseError(error);
  return json(200, { scans: (scans || []).map(historyRow) });
}

// ── Detail ───────────────────────────────────────────────────────────────────

const UNAVAILABLE = 'This saved scan cannot be displayed. Run the package again to get a current report.';

function unavailable(reason) {
  console.error('[proof-scan-history] stored result unavailable:', reason);
  return json(200, { kind: 'unavailable', message: UNAVAILABLE });
}

async function detailScan(admin, scanId) {
  const { data: rows, error } = await admin
    .from('proof_scans')
    .select(DETAIL_COLUMNS)
    .eq('id', scanId)
    .limit(1);

  if (error) return databaseError(error);
  const row = rows?.[0];
  if (!row) return json(404, { error: 'Scan not found' });

  // Structured first. A row carrying result_json is a structured scan even if the
  // JSON turns out to be unusable — falling back to its (absent) legacy HTML, or
  // to any reassuring default, is exactly what must not happen.
  if (row.result_json != null) {
    const validated = validateStoredScanResult(row.result_json);
    if (!validated.ok) {
      // Codes only. Issue messages can quote stored observations, and stored
      // observations quote the uploaded document.
      return unavailable(validated.issues.map((entry) => entry.code).slice(0, 20).join(','));
    }
    return json(200, {
      kind: 'structured',
      scan_id: row.id,
      created_at: row.created_at,
      result: validated.data,
    });
  }

  if (typeof row.result_html === 'string' && row.result_html.trim()) {
    return json(200, {
      kind: 'legacy',
      scan_id: row.id,
      filename: row.filename,
      created_at: row.created_at,
      // Raw and labelled as such. The page turns the whole value into one text
      // node; it is never parsed as HTML or assigned to an insertion sink.
      result_html: row.result_html,
    });
  }

  return unavailable('row_has_no_readable_result');
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const gate = await authorize(request, env, 'read');
  if (gate.error) return gate.error;

  // An empty body is the list request the page has always sent.
  let body = {};
  if (request.headers.get('content-type')?.includes('application/json')) {
    try { body = await request.json(); }
    catch { return json(400, { error: 'Invalid JSON' }); }
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { error: 'Invalid JSON' });
  }

  const admin = makeAdminClient(env);
  if (body.scan_id === undefined) return listScans(admin);

  if (typeof body.scan_id !== 'string' || !UUID_RE.test(body.scan_id)) {
    return json(400, { error: 'scan_id must be a scan identifier' });
  }
  return detailScan(admin, body.scan_id);
}
