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
  not_checked_item_ids: z.array(z.string().min(1).max(120)).min(1).optional(),
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
    const unavailableTargetIds = targetIds.filter((itemId) => packageObservations.get(itemId).status !== 'clear');
    if (observation.status === 'clear' && unavailableTargetIds.length) {
      issues.push(issue(
        'rule_clear_with_unavailable_target_item',
        ['rule_results', rule.rule_id, 'status'],
        'Rule ' + rule.rule_id + ' cannot be clear until every targeted package item is clear.',
      ));
    }
    if (observation.status === 'not_checked' && targetIds.length) {
      const notCheckedItemIds = observation.not_checked_item_ids || [];
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
    } else if (observation.not_checked_item_ids) {
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
  const primary_report_language = report_state === 'items_need_attention'
    ? String(attention_items.length) + ' ' + (attention_items.length === 1 ? 'item' : 'items') + ' need attention'
    : report_state === 'review_incomplete'
      ? 'Review incomplete'
      : 'No issues found';

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
