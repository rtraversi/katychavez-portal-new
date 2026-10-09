// _proof-scan-v2-store.js: every Proof Scan v2 database read and write. NOT a route.
//
// Routes never build queries themselves; they call these. Every call goes
// through the service-role client (the browser never reaches these tables
// directly; migration 2000 / 2001 keep them staff-only even if it tried).
// A failed query throws a StoreError, which the route wrapper turns into a
// neutral message (and a "migrations not applied" hint when tables are missing).

class StoreError extends Error {
  constructor(where, cause) {
    super(`store error at ${where}`);
    this.isStoreError = true;
    this.where = where;
    this.cause = cause;
  }
}

async function run(where, query) {
  const { data, error } = await query;
  if (error) throw new StoreError(where, error);
  return data;
}

const one = (rows) => (Array.isArray(rows) ? rows[0] ?? null : rows ?? null);

// ── Cases ────────────────────────────────────────────────────────────────────

export async function insertCase(admin, row) {
  return one(await run('insert case', admin.from('proof_scan_cases').insert(row).select()));
}

export async function getCase(admin, id) {
  return one(await run('get case', admin.from('proof_scan_cases').select('*').eq('id', id).limit(1)));
}

export async function updateCase(admin, id, patch) {
  return one(await run('update case', admin.from('proof_scan_cases').update(patch).eq('id', id).select()));
}

export async function searchCasesByLabel(admin, term, limit) {
  return run('search cases', admin.from('proof_scan_cases').select('*')
    .ilike('label', `%${term}%`).order('created_at', { ascending: false }).limit(limit));
}

export async function getCasesByIds(admin, ids) {
  if (!ids.length) return [];
  return run('get cases', admin.from('proof_scan_cases').select('*').in('id', ids));
}

export async function recentCases(admin, limit) {
  return run('recent cases', admin.from('proof_scan_cases').select('*')
    .order('created_at', { ascending: false }).limit(limit));
}

// ── People ───────────────────────────────────────────────────────────────────

export async function listPeople(admin, caseId) {
  return run('list people', admin.from('proof_scan_people').select('*')
    .eq('case_id', caseId).order('created_at', { ascending: true }));
}

export async function peopleByANumber(admin, aNumber) {
  return run('people by A-Number', admin.from('proof_scan_people').select('id, case_id').eq('a_number', aNumber));
}

export async function peopleByName(admin, word) {
  const [a, b] = await Promise.all([
    run('people by last name', admin.from('proof_scan_people').select('id, case_id').ilike('last_name', `%${word}%`).limit(50)),
    run('people by first name', admin.from('proof_scan_people').select('id, case_id').ilike('first_name', `%${word}%`).limit(50)),
  ]);
  return [...a, ...b];
}

export async function getPerson(admin, id) {
  return one(await run('get person', admin.from('proof_scan_people').select('*').eq('id', id).limit(1)));
}

export async function insertPerson(admin, row) {
  return one(await run('insert person', admin.from('proof_scan_people').insert(row).select()));
}

export async function updatePerson(admin, id, patch) {
  return one(await run('update person', admin.from('proof_scan_people').update(patch).eq('id', id).select()));
}

export async function deletePerson(admin, id) {
  await run('delete person', admin.from('proof_scan_people').delete().eq('id', id));
}

// ── Documents (Evidence Zero cards; never files, D-84) ───────────────────────

export async function listDocuments(admin, caseId) {
  return run('list documents', admin.from('proof_scan_documents').select('*')
    .eq('case_id', caseId).order('created_at', { ascending: true }));
}

export async function getDocument(admin, id) {
  return one(await run('get document', admin.from('proof_scan_documents').select('*').eq('id', id).limit(1)));
}

export async function insertDocument(admin, row) {
  return one(await run('insert document', admin.from('proof_scan_documents').insert(row).select()));
}

export async function updateDocument(admin, id, patch) {
  return one(await run('update document', admin.from('proof_scan_documents').update(patch).eq('id', id).select()));
}

export async function deleteDocument(admin, id) {
  await run('delete document', admin.from('proof_scan_documents').delete().eq('id', id));
}

export async function listDocumentOwners(admin, documentIds) {
  if (!documentIds.length) return [];
  return run('list document owners', admin.from('proof_scan_document_people').select('*').in('document_id', documentIds));
}

export async function setDocumentOwners(admin, documentId, personIds, proposedBy) {
  await run('clear document owners', admin.from('proof_scan_document_people').delete().eq('document_id', documentId));
  if (!personIds.length) return [];
  return run('set document owners', admin.from('proof_scan_document_people')
    .insert(personIds.map((person_id) => ({ document_id: documentId, person_id, proposed_by: proposedBy }))).select());
}

export async function removePersonFromDocuments(admin, personId) {
  await run('remove person from documents', admin.from('proof_scan_document_people').delete().eq('person_id', personId));
}

// ── Suggestions (D-55, D-97) ─────────────────────────────────────────────────

export async function listOpenSuggestions(admin, personIds) {
  if (!personIds.length) return [];
  return run('list suggestions', admin.from('proof_scan_suggestions').select('*')
    .in('person_id', personIds).eq('status', 'open').order('created_at', { ascending: true }));
}

export async function getSuggestion(admin, id) {
  return one(await run('get suggestion', admin.from('proof_scan_suggestions').select('*').eq('id', id).limit(1)));
}

export async function insertSuggestions(admin, rows) {
  if (!rows.length) return [];
  return run('insert suggestions', admin.from('proof_scan_suggestions').insert(rows).select());
}

export async function updateSuggestion(admin, id, patch) {
  return one(await run('update suggestion', admin.from('proof_scan_suggestions').update(patch).eq('id', id).select()));
}

// A newer proposal for the same field replaces an older open one (Lab behaviour).
export async function deleteOpenSuggestionsFor(admin, personId, field) {
  await run('replace suggestion', admin.from('proof_scan_suggestions').delete()
    .eq('person_id', personId).eq('field', field).eq('status', 'open'));
}

export async function deleteOpenSuggestionsFromDocument(admin, documentId) {
  await run('drop document suggestions', admin.from('proof_scan_suggestions').delete()
    .eq('document_id', documentId).eq('status', 'open'));
}

// ── Runs (proof_scans rows inside a case) ────────────────────────────────────
// A staged run is a row from the moment it is queued (_proof-scan-v2-job.js),
// so a case can hold queued, processing and error rows as well as finished
// ones. Only a finished run ('structured') is a report: the case view, the
// tracker and sign-off see those alone. The page follows an unfinished run
// through getRun by id.

const RUN_LIST_COLUMNS = 'id, created_at, stage, scope, rule_set_version, report_state, attention_count, filename';

export async function listRuns(admin, caseId) {
  return run('list runs', admin.from('proof_scans').select(RUN_LIST_COLUMNS)
    .eq('case_id', caseId).eq('status', 'structured').order('created_at', { ascending: false }).limit(100));
}

export async function getRun(admin, id) {
  return one(await run('get run', admin.from('proof_scans')
    .select('id, case_id, created_at, status, error_detail, stage, scope, rule_set_version, report_state, attention_count, result_json, job')
    .eq('id', id).limit(1)));
}

export async function latestRun(admin, caseId, stage) {
  return one(await run('latest run', admin.from('proof_scans').select('id, stage, case_id, created_at')
    .eq('case_id', caseId).eq('stage', stage).eq('status', 'structured')
    .order('created_at', { ascending: false }).limit(1)));
}

// queued -> processing as one conditional UPDATE: two starters racing on the
// same run get one winner. Only v2 rows (case_id set) are ever claimed here.
export async function claimRun(admin, id) {
  return one(await run('claim run', admin.from('proof_scans')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'queued').not('case_id', 'is', null)
    .select('id, case_id, stage, scope, rule_set_version, filename, scanned_by, attempts, job')));
}

// Writes a terminal state onto a run this worker holds. Guarded on
// 'processing' so a run the sweeper has since requeued is not overwritten.
export async function finishRun(admin, id, patch) {
  return one(await run('finish run', admin.from('proof_scans')
    .update({ ...patch, completed_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'processing').select('id')));
}

export async function updateRunFields(admin, id, patch) {
  await run('update run', admin.from('proof_scans').update(patch).eq('id', id));
}

export async function insertRun(admin, row) {
  return one(await run('insert run', admin.from('proof_scans').insert(row).select('id')));
}

// ── Sign-offs (D-75) ─────────────────────────────────────────────────────────

export async function listSignoffs(admin, caseId) {
  return run('list sign-offs', admin.from('proof_scan_signoffs').select('*').eq('case_id', caseId));
}

export async function deleteSignoff(admin, caseId, stage) {
  await run('delete sign-off', admin.from('proof_scan_signoffs').delete().eq('case_id', caseId).eq('stage', stage));
}

export async function insertSignoff(admin, row) {
  return one(await run('insert sign-off', admin.from('proof_scan_signoffs').insert(row).select()));
}

// ── Possible issues (D-59, D-86) ─────────────────────────────────────────────

export async function insertPossibleIssues(admin, rows) {
  if (!rows.length) return [];
  return run('insert possible issues', admin.from('proof_scan_possible_issues').insert(rows).select());
}

export async function listPossibleIssues(admin, runId) {
  return run('list possible issues', admin.from('proof_scan_possible_issues').select('*')
    .eq('run_id', runId).order('created_at', { ascending: true }));
}

export async function getPossibleIssue(admin, id) {
  return one(await run('get possible issue', admin.from('proof_scan_possible_issues').select('*').eq('id', id).limit(1)));
}

export async function updatePossibleIssue(admin, id, patch) {
  return one(await run('update possible issue', admin.from('proof_scan_possible_issues').update(patch).eq('id', id).select()));
}

// ── Suppressions (D-59) ──────────────────────────────────────────────────────

export async function listSuppressions(admin) {
  return run('list suppressions', admin.from('proof_scan_suppressions').select('*').order('created_at', { ascending: true }));
}

export async function getSuppressionByKey(admin, key) {
  return one(await run('get suppression', admin.from('proof_scan_suppressions').select('*').eq('reasoning_key', key).limit(1)));
}

export async function insertSuppression(admin, row) {
  return one(await run('insert suppression', admin.from('proof_scan_suppressions').insert(row).select()));
}

// ── Rule sets (D-60, D-76) ───────────────────────────────────────────────────

// The current version for a case type, with its package items, live rules and
// each rule's stage settings, as one plain object. Null if none is seeded.
export async function loadCurrentRuleSet(admin, caseType) {
  const set = one(await run('load rule set', admin.from('proof_scan_rule_sets').select('*')
    .eq('case_type', caseType).eq('is_current', true).limit(1)));
  if (!set) return null;
  return loadRuleSetChildren(admin, set);
}

export async function loadRuleSetVersion(admin, caseType, version) {
  const set = one(await run('load rule set version', admin.from('proof_scan_rule_sets').select('*')
    .eq('case_type', caseType).eq('version', version).limit(1)));
  if (!set) return null;
  return loadRuleSetChildren(admin, set);
}

async function loadRuleSetChildren(admin, set) {
  const [items, rules] = await Promise.all([
    run('load package items', admin.from('proof_scan_package_items').select('*')
      .eq('rule_set_id', set.id).order('sort_order', { ascending: true })),
    run('load rules', admin.from('proof_scan_rules').select('*')
      .eq('rule_set_id', set.id).order('sort_order', { ascending: true })),
  ]);
  const settings = rules.length
    ? await run('load stage settings', admin.from('proof_scan_rule_stage_settings').select('*')
      .in('rule_pk', rules.map((r) => r.id)))
    : [];
  const byRule = new Map();
  for (const s of settings) {
    if (!byRule.has(s.rule_pk)) byRule.set(s.rule_pk, {});
    byRule.get(s.rule_pk)[s.stage] = {
      state: s.state,
      stage_title: s.stage_title ?? null,
      stage_pass_text: s.stage_pass_text ?? null,
      stage_expected: s.stage_expected ?? null,
      gentle_if_no: Boolean(s.gentle_if_no),
    };
  }
  return {
    id: set.id,
    case_type: set.case_type,
    version: set.version,
    label: set.label,
    package_items: items,
    rules: rules.map((r) => ({ ...r, stages: byRule.get(r.id) || {} })),
  };
}

export async function maxRuleSetVersion(admin, caseType) {
  const row = one(await run('max rule set version', admin.from('proof_scan_rule_sets').select('version')
    .eq('case_type', caseType).order('version', { ascending: false }).limit(1)));
  return row?.version || 0;
}

export async function ruleIdsWithPrefix(admin, prefix) {
  const rows = await run('rule ids', admin.from('proof_scan_rules').select('rule_id').ilike('rule_id', `${prefix}%`));
  return rows.map((r) => r.rule_id);
}

// Writes a complete new version (not yet current), then makes it current.
// Not one transaction: if a step fails, the new version stays non-current and
// unused, and the old version is still the current one. Nothing is half-switched
// until the final two updates, which are ordered so a failure between them leaves
// no current version for this case type rather than two.
export async function writeRuleSetVersion(admin, caseType, nextVersion, ruleSet, createdBy) {
  const set = one(await run('insert rule set', admin.from('proof_scan_rule_sets').insert({
    case_type: caseType, version: nextVersion, is_current: false,
    label: ruleSet.label, source_note: ruleSet.source_note ?? null, created_by: createdBy,
  }).select()));

  if (ruleSet.package_items.length) {
    await run('copy package items', admin.from('proof_scan_package_items').insert(ruleSet.package_items.map((item, i) => ({
      rule_set_id: set.id, item_id: item.item_id, form: item.form, instance: item.instance ?? null,
      label: item.label, pages: item.pages, kind: item.kind || 'form', sort_order: i + 1,
    }))).select());
  }

  const rules = ruleSet.rules.length
    ? await run('copy rules', admin.from('proof_scan_rules').insert(ruleSet.rules.map((r, i) => ({
      rule_set_id: set.id, rule_id: r.rule_id, title: r.title, severity: r.severity,
      check_kind: r.check_kind || 'pdf', form: r.form ?? null, page: r.page ?? null, item: r.item ?? null,
      expected: r.expected ?? null, pass_text: r.pass_text ?? null, note: r.note ?? null,
      source_note: r.source_note ?? null, applies_to_item_ids: r.applies_to_item_ids || [],
      scope: r.scope, origin: r.origin, retired: Boolean(r.retired), sort_order: i + 1,
    }))).select())
    : [];

  const pkByRuleId = new Map(rules.map((r) => [r.rule_id, r.id]));
  const settings = ruleSet.rules.flatMap((r) => Object.entries(r.stages || {}).map(([stage, s]) => ({
    rule_pk: pkByRuleId.get(r.rule_id), stage, state: s.state,
    stage_title: s.stage_title ?? null, stage_pass_text: s.stage_pass_text ?? null,
    stage_expected: s.stage_expected ?? null, gentle_if_no: Boolean(s.gentle_if_no),
  })));
  if (settings.length) await run('copy stage settings', admin.from('proof_scan_rule_stage_settings').insert(settings).select());

  await run('retire current version', admin.from('proof_scan_rule_sets').update({ is_current: false })
    .eq('case_type', caseType).eq('is_current', true));
  await run('make version current', admin.from('proof_scan_rule_sets').update({ is_current: true }).eq('id', set.id));
  return set;
}

export async function insertRuleChanges(admin, rows) {
  if (!rows.length) return [];
  return run('log rule changes', admin.from('proof_scan_rule_changes').insert(rows).select());
}

// ── Config and audit ─────────────────────────────────────────────────────────

export async function getNotifyEmail(admin) {
  const row = one(await run('get config', admin.from('proof_scan_config').select('notify_email').limit(1)));
  return row?.notify_email?.trim() || '';
}

// Every SSN write and reveal is logged (D-80), exactly as save-ssn.js and
// reveal-ssn.js do. A failed audit insert is logged and never blocks the action,
// matching the portal's existing behaviour.
export async function auditSsn(admin, { entityType, entityId, action, userId, ip }) {
  try {
    const { error } = await admin.from('sensitive_field_audit').insert({
      entity_type: entityType, entity_id: entityId, field_name: 'ssn',
      action, performed_by: userId, ip_address: ip,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error('[proof-scan-v2] SSN audit log failed:', err.message);
  }
}

export async function ruleChangesForIssue(admin, possibleIssueId) {
  return run('rule changes for issue', admin.from('proof_scan_rule_changes').select('id')
    .eq('possible_issue_id', possibleIssueId).limit(1));
}
