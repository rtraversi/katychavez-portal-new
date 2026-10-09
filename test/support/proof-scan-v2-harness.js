// Shared fixtures for the Proof Scan v2 route tests. Test-only, synthetic data.
//
// Each test file still declares its own vi.mock of _helpers.js (vi.mock is
// hoisted per file); this module supplies everything else: a fake database
// seeded with the real v2 rule sets, request builders, and auth profiles.

import seed from '../../functions/api/proof-scan-profiles/v2-seed.json';
import { createFakeSupabase } from './fake-supabase.js';

// A dummy 256-bit key, used only inside tests.
export const ENV = {
  ANTHROPIC_API_KEY: 'test-key',
  SSN_ENCRYPTION_KEY: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  PORTAL_URL: 'https://portal.example.test',
  PORTAL_FIRM_NAME: 'Test Firm',
};

export const STAFF = { profile: { id: 'staff-1', roles: { name: 'Paralegal' } }, isClient: false };
export const CLIENT = { profile: { id: 'client-1', roles: { name: 'Client' } }, isClient: false };
export const NO_TOKEN = { httpError: { status: 401, message: 'Unauthorized' } };
export const NO_ACCESS = { httpError: { status: 403, message: 'Insufficient permissions for proof_scan module' } };

// The seeded rule tables, the way migration 2003 writes them.
export function seededDb(extra = {}) {
  const db = createFakeSupabase(extra);
  for (const rs of seed.rule_sets) {
    const setId = `rs-${rs.case_type}-1`;
    db.rows('proof_scan_rule_sets').push({
      id: setId, case_type: rs.case_type, version: rs.version, is_current: true,
      label: rs.label, source_note: rs.source_note, created_by: null, created_at: '2026-10-07T00:00:00Z',
    });
    rs.package_items.forEach((item, i) => db.rows('proof_scan_package_items').push({
      id: `pi-${rs.case_type}-${item.item_id}`, rule_set_id: setId, instance: null, ...item, sort_order: i + 1,
    }));
    rs.rules.forEach((r, i) => {
      const { stages, ...rest } = r;
      const pk = `r-${rs.case_type}-${r.rule_id}`;
      db.rows('proof_scan_rules').push({
        id: pk, rule_set_id: setId, form: null, page: null, item: null, expected: null, note: null,
        source_note: null, pass_text: null, retired: false, ...rest, sort_order: i + 1,
      });
      for (const [stage, s] of Object.entries(stages)) {
        db.rows('proof_scan_rule_stage_settings').push({
          id: `ss-${pk}-${stage}`, rule_pk: pk, stage, state: s.state,
          stage_title: s.stage_title ?? null, stage_pass_text: s.stage_pass_text ?? null,
          stage_expected: s.stage_expected ?? null, gentle_if_no: Boolean(s.gentle_if_no),
        });
      }
    });
  }
  db.rows('proof_scan_suppressions').push({
    id: 'sup-r1', reasoning_key: 'signature_date_order',
    label: 'Signature date order, for example an attorney signing before the applicant. Not a requirement at this firm.',
    origin: 'firm_decision', created_by: null, created_at: '2026-10-07T00:00:00Z',
  });
  db.rows('proof_scan_config').push({ id: 'cfg', notify_email: 'alerts@example.test' });
  return db;
}

export function apiRequest(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`http://portal.test${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function call(handler, path, opts = {}, env = ENV) {
  const res = await handler({ request: apiRequest(path, opts), env });
  return { status: res.status, body: await res.json() };
}

// Minimal real file headers, so the magic-byte checks see real types.
export const PDF_B64 = btoa('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
export const PNG_B64 = btoa('\x89PNG\r\n\x1a\n0000000000000000');
export const pdfFile = (filename = 'package.pdf', extra = {}) =>
  ({ filename, media_type: 'application/pdf', file_base64: PDF_B64, ...extra });

// A base64 string that decodes to just over `mb` megabytes, with a PDF header.
export function oversizePdf(mb = 12) {
  const bytes = mb * 1024 * 1024 + 3;
  const head = btoa('%PDF-1.7 ');
  return head + 'A'.repeat(Math.ceil((bytes - 9) / 3) * 4);
}

// A streamed Messages response, the way the API sends one: a thinking block
// first (current models think by default), then the text, then the stop reason
// and usage. callModel must read past the thinking block to the text.
export function sseResponse({ text, model = 'claude-sonnet-5-5', stopReason = 'end_turn', usage = { input_tokens: 1000, output_tokens: 500 } }) {
  const events = [
    { type: 'message_start', message: { model, usage: { input_tokens: usage.input_tokens } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'reading the package' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    // Split mid-text so the accumulator has to join deltas.
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(0, Math.floor(text.length / 2)) } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(Math.floor(text.length / 2)) } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: usage.output_tokens } },
    { type: 'message_stop' },
  ];
  const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

// Mock Anthropic: each call returns the next queued JSON body as the text block.
export function mockModel(vi, responses) {
  const queue = [...responses];
  const calls = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push({ url: String(url), body });
    let next = queue.shift();
    if (next === undefined) throw new Error('unexpected extra model call');
    // A function builds its answer from the request (the IDs this run asked for).
    if (typeof next === 'function') next = { output: next(body) };
    if (next?.httpStatus) return new Response('{}', { status: next.httpStatus });
    return sseResponse({
      text: typeof next === 'string' ? next : JSON.stringify(next?.output ?? next),
      stopReason: next?.stop_reason || 'end_turn',
    });
  });
  return calls;
}

// ── Stage-run observations ───────────────────────────────────────────────────

import { FORM_VALUE_FIELDS, EVIDENCE_FACT_FIELDS } from '../../functions/api/_proof-scan-v2-ai.js';

export const askedRuleIds = (body) => body.output_config.format.schema.properties.rule_results?.items.properties.rule_id.enum || [];
export const askedItemIds = (body) => body.output_config.format.schema.properties.package_items?.items.properties.item_id.enum || [];

// Values a form shows. Fields the form has no box for are null; pass '' for a blank box.
export function formValues(values = {}) {
  return { ...Object.fromEntries(FORM_VALUE_FIELDS.map((f) => [f, null])), ...values };
}
export function evidenceFacts(facts = {}) {
  return { ...Object.fromEntries(EVIDENCE_FACT_FIELDS.map((f) => [f, null])), ...facts };
}

// An answer to a stage-run request: every asked ID clear (or as overridden),
// every asked item present (or as overridden), plus the given forms, evidence,
// markups and possible issues.
export function observations({ rules = {}, items = {}, forms = [], evidence = [], markups, possible = [] } = {}) {
  return (body) => {
    const props = body.output_config.format.schema.properties;
    const out = {};
    const ruleIds = askedRuleIds(body);
    if (props.rule_results) {
      out.rule_results = ruleIds.map((rule_id) => {
        const o = rules[rule_id];
        const status = typeof o === 'string' ? o : o?.status || 'clear';
        return { rule_id, status, summary: null, locations: [], evidence: null, reason: status === 'clear' ? null : 'observed', ...(typeof o === 'object' ? o : {}) };
      });
    }
    if (props.package_items) {
      out.package_items = askedItemIds(body).map((item_id) => ({ item_id, status: items[item_id] || 'present', locations: [] }));
    }
    out.forms_found = forms;
    // English with no translation needed, unless a test says otherwise (D-100 #6).
    out.evidence_found = evidence.map((e) => ({ language: 'English', has_english_translation: true, ...e, facts: evidenceFacts(e.facts) }));
    if (props.markups) out.markups = markups || [];
    out.possible_issues = possible;
    return out;
  };
}
