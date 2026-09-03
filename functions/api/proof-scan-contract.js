// Pure Proof Scan validation and report-state composition.
//
// This module has no Worker, database, model, email, DOM, or HTML dependency.
// A later batch may call it at the API boundary after loading a selected profile.
import { z } from 'zod';
import { loadScanProfile } from './proof-scan-profiles/index.js';

const StatusSchema = z.enum(['clear', 'needs_attention', 'not_checked']);
const NullableTextSchema = z.string().max(10000).nullable();
const LocationsSchema = z.array(z.string().min(1).max(1000)).max(100);

const PackageItemSchema = z.object({
  item_id: z.string().min(1).max(120),
  form: z.string().min(1).max(120),
  instance: z.string().min(1).max(120).optional(),
  label: z.string().min(1).max(300),
  pages: z.number().int().positive(),
}).strict();

const ProfileRuleSchema = z.object({
  rule_id: z.string().min(1).max(120),
  title: z.string().min(1).max(500),
  severity: z.enum(['fatal', 'warning', 'advisory']),
  check: z.literal('pdf'),
  scope: z.string().min(1).max(120),
  form: z.string().min(1).max(120).optional(),
  page: z.union([z.number().int().positive(), z.string().min(1).max(50)]).optional(),
  item: z.string().min(1).max(120).optional(),
  expected: z.string().min(1).max(1000).optional(),
  pass_text: z.string().min(1).max(1000),
  note: z.string().min(1).max(2000).optional(),
  source_note: z.string().min(1).max(2000).optional(),
  applies_to_item_ids: z.array(z.string().min(1).max(120)).min(1).optional(),
  applicability: z.object({
    pdf_scan: z.literal(true),
  }).strict(),
}).strict();

export const ScanProfileSchema = z.object({
  schema_version: z.literal(1),
  profile_id: z.string().min(1).max(120),
  profile_version: z.number().int().positive(),
  label: z.string().min(1).max(300),
  case_type_mapping: z.object({
    portal_case_type: z.string().min(1).max(120),
  }).strict(),
  source: z.string().min(1).max(2000),
  package_items: z.array(PackageItemSchema).min(1),
  rules: z.array(ProfileRuleSchema).min(1),
  contract: z.object({
    result_schema_version: z.literal(1),
    allowed_statuses: z.array(StatusSchema).length(3),
    overall_pass_field_forbidden: z.literal(true),
    full_ssn_forbidden: z.literal(true),
    profile_rule_count: z.number().int().positive(),
  }).strict(),
}).strict();

const ScanSchema = z.object({
  filename: z.string().min(1).max(512),
  scanned_at: z.string().datetime({ offset: true }),
}).strict();

const ClientObservedSchema = z.object({
  name: NullableTextSchema,
  a_number: NullableTextSchema,
  ead_expires: NullableTextSchema,
  date_of_birth: NullableTextSchema,
  ssn_last4: z.string().regex(/^\d{4}$/).nullable(),
  uscis_account_number: NullableTextSchema,
  phone: NullableTextSchema,
  email: NullableTextSchema,
  address: NullableTextSchema,
}).strict();

const PackageItemObservationSchema = z.object({
  item_id: z.string().min(1).max(120),
  status: StatusSchema,
  locations: LocationsSchema,
  evidence: NullableTextSchema,
  reason: NullableTextSchema,
}).strict();

const RuleObservationSchema = z.object({
  rule_id: z.string().min(1).max(120),
  status: StatusSchema,
  summary: NullableTextSchema,
  locations: LocationsSchema,
  evidence: NullableTextSchema,
  reason: NullableTextSchema,
  // Structured output cannot omit a property, so a rule that identifies nothing
  // sends null. Absent, null and [] are all "identified nothing" — the rule loop
  // below compares lengths, never truthiness, so the three stay equivalent.
  not_checked_item_ids: z.array(z.string().min(1).max(120)).max(50).nullish(),
}).strict();

export const ModelResponseSchema = z.object({
  schema_version: z.literal(1),
  scan_profile: z.string().min(1).max(120),
  profile_version: z.number().int().positive(),
  scan: ScanSchema,
  client_observed: ClientObservedSchema,
  package_items: z.array(PackageItemObservationSchema),
  rule_results: z.array(RuleObservationSchema),
}).strict();

// ── Report-state language ────────────────────────────────────────────────────
//
// The ONE place that turns a derived report state into words. A fresh scan, a
// history row, and an email all read from here, so the three can never disagree
// and no caller can invent a fourth phrase.
//
// The allowed vocabulary is closed on purpose. "Pass", "Approved", "Correct",
// "Ready to file" and "Needs Correction" are not report states and have no
// spelling here — a scan does not decide whether a filing may go out.

export const REPORT_STATES = ['items_need_attention', 'review_incomplete', 'no_issues_found'];

// Shown under every report, in every state. "No issues found" is not approval.
export const STAFF_REVIEW_REMINDER = 'Staff review is still required before filing.';

// Returns null — never a reassuring phrase — for an unknown state, or for
// items_need_attention without a usable count. A caller that gets null must show
// a neutral unavailable message; it must never fall through to a clean result.
export function reportStateLanguage(reportState, attentionCount) {
  if (reportState === 'items_need_attention') {
    if (!Number.isInteger(attentionCount) || attentionCount < 1) return null;
    return `${attentionCount} ${attentionCount === 1 ? 'item needs' : 'items need'} attention`;
  }
  if (reportState === 'review_incomplete') return 'Review incomplete';
  if (reportState === 'no_issues_found') return 'No issues found';
  return null;
}

function issue(code, path, message) {
  return { code, path, message };
}

function invalid(issues) {
  return {
    ok: false,
    report_state: 'scan_could_not_be_completed',
    issues,
  };
}

function zodIssues(error) {
  return error.issues.map(({ code, path, message }) => issue('schema_' + code, path, message));
}

function findIdentifierIssues(items, expectedIds, property, kind) {
  const expected = new Set(expectedIds);
  const seen = new Set();
  const issues = [];

  for (const item of items) {
    const id = item[property];
    if (!expected.has(id)) issues.push(issue('unknown_' + kind + '_id', [property], 'Unknown ' + kind + ' ID: ' + id));
    if (seen.has(id)) issues.push(issue('duplicate_' + kind + '_id', [property], 'Duplicate ' + kind + ' ID: ' + id));
    seen.add(id);
  }

  for (const id of expectedIds) {
    if (!seen.has(id)) issues.push(issue('omitted_expected_' + kind + '_id', [property], 'Missing expected ' + kind + ' ID: ' + id));
  }

  return issues;
}

export function validateScanProfile(profile) {
  const parsed = ScanProfileSchema.safeParse(profile);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };

  const data = parsed.data;
  const issues = [];
  const itemIds = data.package_items.map((item) => item.item_id);
  const ruleIds = data.rules.map((rule) => rule.rule_id);

  if (new Set(itemIds).size !== itemIds.length) {
    issues.push(issue('duplicate_profile_package_item_id', ['package_items'], 'Profile package-item IDs must be unique.'));
  }
  if (new Set(ruleIds).size !== ruleIds.length) {
    issues.push(issue('duplicate_profile_rule_id', ['rules'], 'Profile rule IDs must be unique.'));
  }
  if (data.contract.profile_rule_count !== data.rules.length) {
    issues.push(issue('profile_rule_count_mismatch', ['contract', 'profile_rule_count'], 'Profile rule count does not match its rules.'));
  }

  const itemsById = new Map(data.package_items.map((item) => [item.item_id, item]));
  for (const rule of data.rules) {
    if (!rule.applies_to_item_ids) continue;
    if (new Set(rule.applies_to_item_ids).size !== rule.applies_to_item_ids.length) {
      issues.push(issue('duplicate_rule_target_item_id', ['rules', rule.rule_id, 'applies_to_item_ids'], 'Rule target item IDs must be unique.'));
    }
    for (const itemId of rule.applies_to_item_ids) {
      const target = itemsById.get(itemId);
      if (!target) {
        issues.push(issue('unknown_rule_target_item_id', ['rules', rule.rule_id, 'applies_to_item_ids'], 'Rule targets unknown package item: ' + itemId));
      } else if (rule.form && target.form !== rule.form) {
        issues.push(issue('rule_target_form_mismatch', ['rules', rule.rule_id, 'applies_to_item_ids'], 'Rule form ' + rule.form + ' cannot target ' + target.form + '.'));
      }
    }
  }

  return issues.length ? { ok: false, issues } : { ok: true, data };
}

export function getSelectedScanProfile(profileId) {
  const profile = loadScanProfile(profileId);
  if (!profile) return null;
  const validated = validateScanProfile(profile);
  return validated.ok ? validated.data : null;
}

export function parseAndComposeScanResult(profile, rawModelResponse) {
  if (typeof rawModelResponse === 'string') {
    try {
      return validateAndComposeScanResult(profile, JSON.parse(rawModelResponse));
    } catch {
      return invalid([issue('invalid_json', [], 'Model response is not valid JSON.')]);
    }
  }
  return validateAndComposeScanResult(profile, rawModelResponse);
}

export function validateAndComposeScanResult(profile, modelResponse) {
  const profileResult = validateScanProfile(profile);
  if (!profileResult.ok) return invalid(profileResult.issues);

  const responseResult = ModelResponseSchema.safeParse(modelResponse);
  if (!responseResult.success) return invalid(zodIssues(responseResult.error));

  const response = responseResult.data;
  const selectedProfile = profileResult.data;
  const issues = [];
  if (response.scan_profile !== selectedProfile.profile_id) {
    issues.push(issue('profile_id_mismatch', ['scan_profile'], 'Response scan profile does not match the selected profile.'));
  }
  if (response.profile_version !== selectedProfile.profile_version) {
    issues.push(issue('profile_version_mismatch', ['profile_version'], 'Response profile version does not match the selected profile.'));
  }

  const expectedPackageItemIds = selectedProfile.package_items.map((item) => item.item_id);
  const expectedRuleIds = selectedProfile.rules.map((rule) => rule.rule_id);
  issues.push(...findIdentifierIssues(response.package_items, expectedPackageItemIds, 'item_id', 'package_item'));
  issues.push(...findIdentifierIssues(response.rule_results, expectedRuleIds, 'rule_id', 'rule'));
  if (issues.length) return invalid(issues);

  const packageObservations = new Map(response.package_items.map((item) => [item.item_id, item]));
  const ruleObservations = new Map(response.rule_results.map((rule) => [rule.rule_id, rule]));

  for (const rule of selectedProfile.rules) {
    const observation = ruleObservations.get(rule.rule_id);
    const targetIds = rule.applies_to_item_ids || [];
    const notCheckedItemIds = observation.not_checked_item_ids || [];
    const unavailableTargetIds = targetIds.filter((itemId) => packageObservations.get(itemId).status !== 'clear');
    if (observation.status === 'clear' && unavailableTargetIds.length) {
      issues.push(issue(
        'rule_clear_with_unavailable_target_item',
        ['rule_results', rule.rule_id, 'status'],
        'Rule ' + rule.rule_id + ' cannot be clear until every targeted package item is clear.',
      ));
    }
    if (observation.status === 'not_checked' && targetIds.length) {
      if (!notCheckedItemIds.length) {
        issues.push(issue(
          'not_checked_rule_missing_target_item_ids',
          ['rule_results', rule.rule_id, 'not_checked_item_ids'],
          'A targeted rule that is not checked must identify the package item IDs it could not evaluate.',
        ));
      }
      for (const itemId of notCheckedItemIds) {
        if (!targetIds.includes(itemId)) {
          issues.push(issue(
            'not_checked_rule_unknown_target_item_id',
            ['rule_results', rule.rule_id, 'not_checked_item_ids'],
            'Rule ' + rule.rule_id + ' cannot identify an item outside its configured targets.',
          ));
        }
      }
    } else if (notCheckedItemIds.length) {
      issues.push(issue(
        'not_checked_item_ids_on_evaluated_rule',
        ['rule_results', rule.rule_id, 'not_checked_item_ids'],
        'Only a not-checked rule may identify unevaluated package items.',
      ));
    }
  }
  if (issues.length) return invalid(issues);

  const package_items = selectedProfile.package_items.map((config) => ({
    ...config,
    ...packageObservations.get(config.item_id),
  }));

  const rule_results = selectedProfile.rules.map((config) => {
    const observation = ruleObservations.get(config.rule_id);
    const not_checked_item_ids = observation.not_checked_item_ids || [];
    const blocked_by_missing_package_item_ids = observation.status === 'not_checked'
      ? not_checked_item_ids.filter((itemId) => packageObservations.get(itemId).status === 'needs_attention')
      : [];
    const independently_unchecked_item_ids = observation.status === 'not_checked'
      ? not_checked_item_ids.filter((itemId) => packageObservations.get(itemId).status !== 'needs_attention')
      : [];
    const suppressed_by_package_item_ids = blocked_by_missing_package_item_ids.length
      && !independently_unchecked_item_ids.length
      ? blocked_by_missing_package_item_ids
      : [];
    return {
      ...config,
      ...observation,
      not_checked_item_ids,
      blocked_by_missing_package_item_ids,
      independently_unchecked_item_ids,
      suppressed_by_package_item_ids,
    };
  });

  const attention_items = [
    ...package_items.filter((item) => item.status === 'needs_attention').map((item) => ({
      type: 'package_item',
      id: item.item_id,
    })),
    ...rule_results.filter((rule) => rule.status === 'needs_attention').map((rule) => ({
      type: 'rule',
      id: rule.rule_id,
    })),
  ];
  const unsuppressed_not_checked = [
    ...package_items.filter((item) => item.status === 'not_checked'),
    ...rule_results.filter((rule) => rule.status === 'not_checked' && !rule.suppressed_by_package_item_ids.length),
  ];

  const report_state = attention_items.length
    ? 'items_need_attention'
    : unsuppressed_not_checked.length
      ? 'review_incomplete'
      : 'no_issues_found';
  const primary_report_language = reportStateLanguage(report_state, attention_items.length);

  return {
    ok: true,
    report_state,
    primary_report_language,
    attention_count: attention_items.length,
    attention_items,
    unsuppressed_not_checked_count: unsuppressed_not_checked.length,
    profile: selectedProfile,
    scan: response.scan,
    client_observed: response.client_observed,
    package_items,
    rule_results,
  };
}

// ── Observation boundary ─────────────────────────────────────────────────────
//
// Claude returns observations ONLY: client_observed, package_items, rule_results.
// It never authors — and cannot author — the profile ID, the profile version, the
// result schema version, the filename, or the scan time. The server owns all five
// and wraps them around the validated observations here, so a model that tries to
// supply any of them is rejected by ModelObservationsSchema's strictness before it
// can reach composition.

export const ModelObservationsSchema = z.object({
  client_observed: ClientObservedSchema,
  package_items: z.array(PackageItemObservationSchema),
  rule_results: z.array(RuleObservationSchema),
}).strict();

export function assembleScanEnvelope(profile, observations, scan) {
  return {
    schema_version: profile.contract.result_schema_version,
    scan_profile: profile.profile_id,
    profile_version: profile.profile_version,
    scan,
    client_observed: observations.client_observed,
    package_items: observations.package_items,
    rule_results: observations.rule_results,
  };
}

// scan is the server-created { filename, scanned_at } pair, never model output.
export function validateAndComposeObservations(profile, rawObservations, scan) {
  const profileResult = validateScanProfile(profile);
  if (!profileResult.ok) return invalid(profileResult.issues);

  const scanResult = ScanSchema.safeParse(scan);
  if (!scanResult.success) return invalid(zodIssues(scanResult.error));

  const observationsResult = ModelObservationsSchema.safeParse(rawObservations);
  if (!observationsResult.success) return invalid(zodIssues(observationsResult.error));

  return validateAndComposeScanResult(
    profileResult.data,
    assembleScanEnvelope(profileResult.data, observationsResult.data, scanResult.data),
  );
}

export function parseAndComposeObservations(profile, rawObservations, scan) {
  if (typeof rawObservations === 'string') {
    let parsed;
    try {
      parsed = JSON.parse(rawObservations);
    } catch {
      return invalid([issue('invalid_json', [], 'Model response is not valid JSON.')]);
    }
    return validateAndComposeObservations(profile, parsed, scan);
  }
  return validateAndComposeObservations(profile, rawObservations, scan);
}

// ── Model-facing JSON Schema ─────────────────────────────────────────────────
//
// Built from the selected profile so the allowed rule and package-item IDs are
// closed enums the model cannot step outside. Deliberately carries no severity,
// title, display order, overall status, timestamp, filename, profile identity, or
// HTML — those are the profile's and the server's, not Claude's. Anthropic's
// structured-output subset has no minLength/maxLength/minItems/pattern support, so
// bounds and formats (including ssn_last4's four digits) are enforced by the Zod
// layer above rather than declared here.

const nullableString = (description) => ({
  anyOf: [{ type: 'string' }, { type: 'null' }],
  description,
});

export function buildObservationJsonSchema(profile) {
  const validated = validateScanProfile(profile);
  if (!validated.ok) return null;

  const data = validated.data;
  const itemIds = data.package_items.map((item) => item.item_id);
  const ruleIds = data.rules.map((rule) => rule.rule_id);
  const statuses = [...data.contract.allowed_statuses];
  const locations = {
    type: 'array',
    items: { type: 'string' },
    description: 'Where in the PDF this was observed, e.g. "I-765 page 3". Empty when not applicable.',
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['client_observed', 'package_items', 'rule_results'],
    properties: {
      client_observed: {
        type: 'object',
        additionalProperties: false,
        description: 'Values read from the uploaded PDF. Use null for anything not legible in the package.',
        required: [
          'name', 'a_number', 'ead_expires', 'date_of_birth',
          'ssn_last4', 'uscis_account_number', 'phone', 'email', 'address',
        ],
        properties: {
          name: nullableString('Applicant name exactly as printed.'),
          a_number: nullableString('A-Number exactly as printed.'),
          ead_expires: nullableString('EAD expiry date exactly as printed.'),
          date_of_birth: nullableString('Date of birth exactly as printed.'),
          ssn_last4: nullableString('The LAST FOUR DIGITS ONLY of the SSN, as four digits. Never return a full SSN.'),
          uscis_account_number: nullableString('USCIS online account number exactly as printed.'),
          phone: nullableString('Phone number exactly as printed.'),
          email: nullableString('Email address exactly as printed.'),
          address: nullableString('Mailing address exactly as printed.'),
        },
      },
      package_items: {
        type: 'array',
        description: 'Exactly one entry for every listed item ID — no more, no fewer.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['item_id', 'status', 'locations', 'evidence', 'reason'],
          properties: {
            item_id: { type: 'string', enum: itemIds },
            status: {
              type: 'string',
              enum: statuses,
              description: 'clear = present and identifiable; needs_attention = missing; not_checked = could not determine.',
            },
            locations,
            evidence: nullableString('Short quoted text supporting the status, or null.'),
            reason: nullableString('Why the item is not clear. Required whenever status is not clear.'),
          },
        },
      },
      rule_results: {
        type: 'array',
        description: 'Exactly one entry for every listed rule ID — no more, no fewer.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rule_id', 'status', 'summary', 'locations', 'evidence', 'reason', 'not_checked_item_ids'],
          properties: {
            rule_id: { type: 'string', enum: ruleIds },
            status: {
              type: 'string',
              enum: statuses,
              description: 'clear = the expected condition holds; needs_attention = it does not; not_checked = it could not be evaluated.',
            },
            summary: nullableString('One short sentence describing what was observed, or null.'),
            locations,
            evidence: nullableString('Short quoted text supporting the status, or null.'),
            reason: nullableString('Why the rule is not clear. Required whenever status is not clear.'),
            not_checked_item_ids: {
              anyOf: [{ type: 'array', items: { type: 'string', enum: itemIds } }, { type: 'null' }],
              description: 'When status is not_checked on a rule tied to package items, list the item IDs that blocked it. Otherwise null.',
            },
          },
        },
      },
    },
  };
}

// ── Stored result boundary ───────────────────────────────────────────────────
//
// A structured result read back out of `proof_scans.result_json` is treated as
// untrusted input, exactly like a model response. It may have been written by an
// older build, hand-edited, truncated by a failed write, or corrupted in transit.
//
// So it is re-validated in full before anything renders it, and the report state
// is RECOMPUTED from the stored items rather than believed. A stored row whose
// `report_state` says "no_issues_found" while its items say otherwise is rejected
// as inconsistent — never shown, and never quietly downgraded to a clean result.

export const SUPPORTED_RESULT_SCHEMA_VERSION = 1;

const StoredPackageItemSchema = PackageItemSchema.merge(PackageItemObservationSchema);

const StoredRuleResultSchema = ProfileRuleSchema
  .merge(RuleObservationSchema)
  .extend({
    // Server-derived at composition time; re-checked below, never trusted as-is.
    blocked_by_missing_package_item_ids: z.array(z.string().min(1).max(120)).max(50),
    independently_unchecked_item_ids: z.array(z.string().min(1).max(120)).max(50),
    suppressed_by_package_item_ids: z.array(z.string().min(1).max(120)).max(50),
  });

const AttentionItemSchema = z.object({
  type: z.enum(['package_item', 'rule']),
  id: z.string().min(1).max(120),
}).strict();

export const StoredScanResultSchema = z.object({
  schema_version: z.literal(SUPPORTED_RESULT_SCHEMA_VERSION),
  scan_profile: z.string().min(1).max(120),
  profile_version: z.number().int().positive(),
  profile_label: z.string().min(1).max(300),
  scan: ScanSchema,
  report_state: z.enum(['items_need_attention', 'review_incomplete', 'no_issues_found']),
  primary_report_language: z.string().min(1).max(200),
  attention_count: z.number().int().nonnegative(),
  attention_items: z.array(AttentionItemSchema).max(500),
  unsuppressed_not_checked_count: z.number().int().nonnegative(),
  client_observed: ClientObservedSchema,
  package_items: z.array(StoredPackageItemSchema).min(1),
  rule_results: z.array(StoredRuleResultSchema).min(1),
}).strict();

// Recomputes state from the stored items. Deliberately mirrors composition rather
// than sharing a branch with it, so a stored row can be checked against the rule
// even if it was written by a different build of this file.
function derivedStateOf(stored) {
  const attentionCount =
    stored.package_items.filter((item) => item.status === 'needs_attention').length
    + stored.rule_results.filter((rule) => rule.status === 'needs_attention').length;
  const unsuppressedNotChecked =
    stored.package_items.filter((item) => item.status === 'not_checked').length
    + stored.rule_results.filter((rule) =>
      rule.status === 'not_checked' && !rule.suppressed_by_package_item_ids.length).length;
  const reportState = attentionCount
    ? 'items_need_attention'
    : unsuppressedNotChecked ? 'review_incomplete' : 'no_issues_found';
  return { attentionCount, unsuppressedNotChecked, reportState };
}

// Returns { ok: true, data } or { ok: false, issues }. Callers turn a failure into
// a neutral "this result cannot be displayed" message — never into a clean one.
export function validateStoredScanResult(stored) {
  const parsed = StoredScanResultSchema.safeParse(stored);
  if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };

  const data = parsed.data;
  const issues = [];

  // The profile must still be configured, at the version that produced this row.
  //
  // Coverage is the reason. A stored result carries its own titles and severities,
  // so it could in principle be rendered without the profile — but then a row that
  // lost rules to a truncated write would validate as internally consistent and
  // present as clean, because the checks it is missing are simply not there to
  // contradict it. The profile is what says how many there should have been.
  //
  const storedProfile = loadScanProfile(data.scan_profile, data.profile_version);
  if (!storedProfile) {
    issues.push(issue('unsupported_profile_version', ['profile_version'],
      'This result was produced by a scan profile version this build cannot verify.'));
  } else {
    // Exact coverage, the same rule a fresh scan is held to: every configured
    // rule and package item exactly once, nothing unknown, nothing missing.
    issues.push(...findIdentifierIssues(
      data.package_items, storedProfile.package_items.map((item) => item.item_id),
      'item_id', 'package_item',
    ));
    issues.push(...findIdentifierIssues(
      data.rule_results, storedProfile.rules.map((rule) => rule.rule_id),
      'rule_id', 'rule',
    ));
  }

  const itemIds = data.package_items.map((item) => item.item_id);
  const ruleIds = data.rule_results.map((rule) => rule.rule_id);
  if (new Set(itemIds).size !== itemIds.length) {
    issues.push(issue('duplicate_stored_package_item_id', ['package_items'], 'Stored package-item IDs must be unique.'));
  }
  if (new Set(ruleIds).size !== ruleIds.length) {
    issues.push(issue('duplicate_stored_rule_id', ['rule_results'], 'Stored rule IDs must be unique.'));
  }

  const derived = derivedStateOf(data);
  if (derived.reportState !== data.report_state) {
    issues.push(issue('stored_report_state_mismatch', ['report_state'],
      'Stored report state does not match the stored items.'));
  }
  if (derived.attentionCount !== data.attention_count) {
    issues.push(issue('stored_attention_count_mismatch', ['attention_count'],
      'Stored attention count does not match the stored items.'));
  }
  if (derived.unsuppressedNotChecked !== data.unsuppressed_not_checked_count) {
    issues.push(issue('stored_not_checked_count_mismatch', ['unsuppressed_not_checked_count'],
      'Stored not-checked count does not match the stored items.'));
  }
  if (data.attention_items.length !== data.attention_count) {
    issues.push(issue('stored_attention_items_mismatch', ['attention_items'],
      'Stored attention items do not match the stored attention count.'));
  }
  if (data.primary_report_language !== reportStateLanguage(data.report_state, data.attention_count)) {
    issues.push(issue('stored_report_language_mismatch', ['primary_report_language'],
      'Stored report language does not match the stored report state.'));
  }

  return issues.length ? { ok: false, issues } : { ok: true, data };
}
