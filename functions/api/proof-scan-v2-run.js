// proof-scan-v2-run.js: Draft Review, Pre-flight and Physical Scan (specs E.2, E.3).
//
//   POST { case_id, stage, scope?, form?, files: [{ filename, media_type, file_base64, kind? }] }
//        scope is 'whole' or 'individual' for Draft Review and Pre-flight only (D-56);
//        form names the one form of an individual review. File kind is 'package'
//        (default), or at Pre-flight 'marked' (the client's marked-up pages) and
//        'corrected' (D-68). Each file at most 12 MB (D-95).
//        email: true sends the optional stage email (D-61) to the firm's Proof
//        Scan notification address, once the run is stored.
//   GET  ?id=<run id>   a stored run with its Possible issues
//
// The model reports observations only (D-18); the engine decides everything
// (_proof-scan-v2-engine.js). A run is stored in proof_scans inside its case,
// with the rule-set version it used (D-60). Possible issues go to their own
// table, never into the count or an email (D-36). A new run clears that stage's
// sign-off (D-75). Files are read and dropped, never stored (D-84).

import { z } from 'zod';
import { ssnDecrypt } from './_helpers.js';
import {
  requireStaff, readJson, json, guarded, methodNotAllowed, HttpError, checkFiles, fileBlock,
} from './_proof-scan-v2-http.js';
import { validate } from './_schemas.js';
import * as store from './_proof-scan-v2-store.js';
import { loadCase, publicCaseView, gateFor } from './_proof-scan-v2-case.js';
import { REVIEW_STAGES, SCOPED_STAGES, STAGE_LABELS, CASE_TYPE_LABELS, REFERENCE_FIELDS } from './_proof-scan-v2-common.js';
import { callModel, stageRunSchema, stageRunValidator, stageRunPrompt } from './_proof-scan-v2-ai.js';
import { selectRules, evaluateRun, RESULT_SCHEMA_VERSION } from './_proof-scan-v2-engine.js';
import { FALLBACK_EDITIONS } from './_proof-scan-run.js';
import { DEMO_UNAVAILABLE } from './proof-scan-v2-evidence.js';
import { notifyProofScanStage } from './_notifications.js';

const id = z.string().uuid();
const RunSchema = z.object({
  case_id: id,
  stage: z.enum(REVIEW_STAGES),
  scope: z.enum(['whole', 'individual']).optional(),
  form: z.string().trim().min(1).max(40).optional(),
  files: z.array(z.object({
    filename: z.string(),
    media_type: z.string(),
    file_base64: z.string().min(1, 'No file provided'),
    kind: z.enum(['package', 'marked', 'corrected']).optional(),
  }).strict()).min(1, 'Add at least one file.'),
  email: z.boolean().optional(),
}).strict();

const MAX_TOKENS = 16000;

async function formEditions(admin) {
  try {
    const { data } = await admin.from('form_editions').select('form_number, pages, edition_date').order('form_number', { ascending: true });
    if (data?.length) return data.map((r) => `${r.form_number}|${r.pages}p|${r.edition_date}`).join(', ');
  } catch { /* fall back */ }
  return FALLBACK_EDITIONS;
}

function cardSsnMap(people, env) {
  const map = new Map();
  for (const p of people) {
    if (!p.ssn_encrypted) continue;
    try { map.set(p.id, ssnDecrypt(p.ssn_encrypted, env)); }
    catch { map.set(p.id, 'unknown'); }
  }
  return map;
}

function runFilename(files) {
  const first = files[0].filename;
  return (files.length === 1 ? first : `${first} and ${files.length - 1} more`).slice(0, 255);
}

// Card fills, correction suggestions and Possible issues, written once the run
// itself is stored. A failure here is reported, never hidden, but does not undo
// a stored result.
async function applyFollowUps(admin, { caseId, runId, people, evaluation }) {
  const created = new Map();
  for (const role of evaluation.newPeople) {
    const p = await store.insertPerson(admin, { case_id: caseId, role, is_main: people.length === 0 && created.size === 0 });
    created.set(role, p);
  }
  const byPerson = new Map();
  for (const fill of evaluation.cardFills) {
    const pid = fill.person_id || created.get(fill.role)?.id;
    if (!pid) continue;
    if (!byPerson.has(pid)) byPerson.set(pid, []);
    byPerson.get(pid).push(fill);
  }
  const all = [...people, ...created.values()];
  for (const [pid, fills] of byPerson) {
    const person = all.find((p) => p.id === pid);
    const sources = { ...(person.field_sources || {}) };
    const patch = {};
    for (const f of fills) {
      if (!REFERENCE_FIELDS.includes(f.field)) continue;
      patch[f.field] = f.value;
      sources[f.field] = f.source;
    }
    patch.field_sources = sources;
    if (person.approved_at) patch.changed_since_approval = true;
    await store.updatePerson(admin, pid, patch);
  }
  const rows = [];
  for (const s of evaluation.suggestions) {
    await store.deleteOpenSuggestionsFor(admin, s.person_id, s.field);
    rows.push({ person_id: s.person_id, field: s.field, value: s.value, source_label: s.label, run_id: runId });
  }
  await store.insertSuggestions(admin, rows);
  return store.insertPossibleIssues(admin, evaluation.possibleIssues.map((p) => ({ ...p, run_id: runId })));
}

async function startRun({ request, env, gate }) {
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = validate(RunSchema, parsed.body);
  if (v.error) return v.error;
  const body = v.data;
  const scoped = SCOPED_STAGES.has(body.stage);
  if (scoped && !body.scope) return json(400, { error: 'Choose individual or whole review.' });
  if (!scoped && body.scope) return json(400, { error: 'Physical Scan always checks the whole package; it has no scope.' });
  if (body.scope === 'individual' && !body.form) return json(400, { error: 'Name the form for an individual review.' });
  if (body.stage !== 'preflight' && body.files.some((f) => f.kind && f.kind !== 'package')) {
    return json(400, { error: 'Marked-up and corrected pages belong to Pre-flight.' });
  }
  const check = checkFiles(body.files);
  if (check.error) return json(400, { error: check.error });
  if (env.DEMO_MODE === 'true') return json(503, { error: DEMO_UNAVAILABLE });

  const { admin } = gate;
  const snapshot = await loadCase(admin, body.case_id);
  const caseType = snapshot.case.case_type;
  const requirement = gateFor(snapshot);
  if (!requirement.ready) {
    return json(409, { error: 'The evidence requirement is not met yet.', evidence_requirement: requirement });
  }

  const ruleSet = await store.loadCurrentRuleSet(admin, caseType);
  if (!ruleSet) throw new HttpError(503, 'No rule set is configured for this case type. Apply migration 2003.');

  const scope = scoped ? body.scope : null;
  const hasMarkedFiles = body.files.some((f) => f.kind === 'marked');
  const selection = selectRules({ ruleSet, stage: body.stage, scope, form: body.form, hasMarkedFiles });
  const ruleIds = selection.ask.map((r) => r.rule_id);
  const itemIds = selection.items.map((i) => i.item_id);
  const withMarkups = body.stage === 'preflight' && hasMarkedFiles;
  const suppressions = await store.listSuppressions(admin);

  const content = [];
  body.files.forEach((f, i) => {
    content.push({ type: 'text', text: `File ${i + 1}: ${f.filename.trim()} (${f.kind || 'package'})` });
    content.push(fileBlock(f));
  });
  content.push({ type: 'text', text: 'Review these files. Return one entry for every listed check and package item ID.' });

  const answer = await callModel(env, {
    system: stageRunPrompt({
      caseTypeLabel: CASE_TYPE_LABELS[caseType], caseType, stageLabel: STAGE_LABELS[body.stage], stage: body.stage,
      scope, form: body.form, rules: selection.ask, items: selection.items, people: snapshot.people,
      files: body.files, withMarkups, suppressions, formEditions: await formEditions(admin),
    }),
    schema: stageRunSchema({ ruleIds, itemIds, withMarkups }),
    content,
    maxTokens: MAX_TOKENS,
  });
  if (!answer.ok) return json(answer.status, { error: answer.error, report_state: 'scan_could_not_be_completed' });
  const obs = stageRunValidator({ ruleIds, itemIds, withMarkups })(answer.json);
  if (!obs.ok) return json(obs.status, { error: 'The scan could not be completed. Nothing was saved. Please try again.', report_state: 'scan_could_not_be_completed' });

  const evaluation = evaluateRun({
    caseType, stage: body.stage, scope, form: body.form, ruleSet, selection,
    people: snapshot.people, documents: snapshot.documents, openSuggestions: snapshot.suggestions,
    cardSsn: cardSsnMap(snapshot.people, env), obs: obs.data, hasMarkedFiles,
    suppressedKeys: suppressions.map((s) => s.reasoning_key),
    files: body.files.map((f) => ({ filename: f.filename.trim(), kind: f.kind })), scannedAt: new Date().toISOString(),
  });
  const { result } = evaluation;

  let runId = null;
  try {
    const row = await store.insertRun(admin, {
      filename: runFilename(body.files),
      status: 'structured',
      result_json: result,
      result_schema_version: RESULT_SCHEMA_VERSION,
      scan_profile: caseType,
      profile_version: ruleSet.version,
      report_state: result.report_state,
      attention_count: result.attention_count,
      model: answer.meta.model,
      model_stop_reason: answer.meta.stop_reason,
      input_tokens: answer.meta.input_tokens,
      output_tokens: answer.meta.output_tokens,
      tokens_used: answer.meta.output_tokens ?? 0,
      scanned_by: gate.auth.profile.id,
      case_id: snapshot.case.id,
      stage: body.stage,
      scope,
      rule_set_version: ruleSet.version,
    });
    runId = row?.id ?? null;
  } catch (err) {
    console.error('[proof-scan-v2-run] run not stored:', err?.cause?.code || err.message);
  }
  if (!runId) {
    // The result is shown but nothing else is written: no card change, no
    // suggestion, no sign-off change, no email, for a run nobody can reopen.
    return json(200, {
      run_id: null, stored: false, storage_error: 'The review completed but could not be saved to the case.',
      result, possible_issues: evaluation.possibleIssues,
    });
  }

  // D-75: a fresh run needs a fresh sign-off (the database trigger does the
  // same; this keeps it true even before the trigger exists).
  let followUpError = null;
  let possibleIssues = [];
  try {
    await store.deleteSignoff(admin, snapshot.case.id, body.stage);
    possibleIssues = await applyFollowUps(admin, { caseId: snapshot.case.id, runId, people: snapshot.people, evaluation });
  } catch (err) {
    console.error('[proof-scan-v2-run] follow-up writes failed:', err?.cause?.code || err.message);
    followUpError = 'The review was saved, but some case card updates could not be saved.';
  }

  // D-61: optional, and only once the run is stored, so the link always opens
  // a real report. Built from the stored result alone.
  let notificationAttempted = false;
  let notificationSent = false;
  if (body.email) {
    try {
      const toEmail = await store.getNotifyEmail(admin);
      if (toEmail) {
        notificationAttempted = true;
        notificationSent = await notifyProofScanStage(env, { toEmail, result });
      }
    } catch (err) {
      console.error('[proof-scan-v2-run] notification failed:', err.message);
    }
  }

  const after = await loadCase(admin, snapshot.case.id);
  return json(200, {
    run_id: runId, stored: true, storage_error: null, follow_up_error: followUpError,
    notification_attempted: notificationAttempted, notification_sent: notificationSent,
    result, possible_issues: possibleIssues, case_view: await publicCaseView(admin, after),
  });
}

async function getRun({ request, gate }) {
  const runId = new URL(request.url).searchParams.get('id');
  if (!id.safeParse(runId).success) return json(400, { error: 'id must be a run id' });
  const run = await store.getRun(gate.admin, runId);
  if (!run || !run.case_id) throw new HttpError(404, 'Run not found');
  const possibleIssues = await store.listPossibleIssues(gate.admin, run.id);
  return json(200, { run, possible_issues: possibleIssues });
}

export const onRequest = guarded('proof-scan-v2-run', async ({ request, env }) => {
  if (request.method === 'GET') {
    const gate = await requireStaff(request, env, 'read');
    if (gate.response) return gate.response;
    return getRun({ request, gate });
  }
  if (request.method === 'POST') {
    const gate = await requireStaff(request, env, 'write');
    if (gate.response) return gate.response;
    return startRun({ request, env, gate });
  }
  return methodNotAllowed();
});
