// Shared fill-context assembly for the USCIS form filler.
//
// Used by form-filler-generate.js (to fill PDFs) and form-filler-fields.js
// (to show the editor what autofill WOULD produce per field). Keeps
// _form-fill.js pure (no DB access).

// "This appearance relates to..." — G-28 Part 3 item 1.b wants the form
// numbers the G-28 covers: only the package's main USCIS forms. Supporting/
// administrative forms are never listed: the G-28 itself, G-1145
// (e-notification), and G-1450/G-1650 (card payment authorizations).
// Exposed to field maps as source "package.form_numbers".
const G28_FORMLIST_EXCLUDE = new Set(['g-28', 'g-1145', 'g-1450', 'g-1650']);

export function packageFormNumbers(activeTemplates) {
  return activeTemplates
    .filter(t => !G28_FORMLIST_EXCLUDE.has(t.form_key))
    .map(t => t.form_key.toUpperCase())
    .join(', ');
}

const TEMPLATE_COLS = 'id, form_key, label, r2_key, field_map, firm_overrides, active';

// The case-type package, or null when the matter has no case type or the case
// type has no package configured. Since migration 1605 this is a STARTING
// POINT, not the matter's form list — a matter can have forms without one.
async function loadCaseTypePackage(admin, caseTypeId) {
  if (!caseTypeId) return null;
  const { data } = await admin
    .from('form_packages')
    .select('id, name')
    .eq('case_type_id', caseTypeId)
    .eq('active', true)
    .maybeSingle();
  return data || null;
}

// Resolves the forms that belong to a matter, in order.
//
// Precedence (migration 1605):
//   matter_forms rows        -> the matter owns its list
//   no rows yet              -> fall back to the case-type package as the
//                               suggested set, WITHOUT writing anything
//
// Returns { pkg, activeTemplates, seeded }. `seeded` tells callers whether the
// list is real (matter_forms) or still just the package's suggestion; the
// add/remove API uses it to decide whether to materialize first.
// Returns { error } with an http status/message only on a genuine DB failure.
export async function loadPackageTemplates(admin, matter) {
  const pkg = await loadCaseTypePackage(admin, matter.case_type_id);

  const { data: mfRows, error: mfErr } = await admin
    .from('matter_forms')
    .select(`sort_order, required, template:form_templates(${TEMPLATE_COLS})`)
    .eq('matter_id', matter.id)
    .order('sort_order', { ascending: true });
  if (mfErr) return { error: { status: 500, message: 'Failed to load the matter\'s forms' } };

  if (mfRows && mfRows.length) {
    return { pkg, seeded: true, activeTemplates: mfRows.map(r => r.template).filter(t => t.active) };
  }

  if (!pkg) return { pkg: null, seeded: false, activeTemplates: [] };

  const { data: items, error: itemsErr } = await admin
    .from('form_package_items')
    .select(`sort_order, required, template:form_templates(${TEMPLATE_COLS})`)
    .eq('package_id', pkg.id)
    .order('sort_order', { ascending: true });
  if (itemsErr) return { error: { status: 500, message: 'Failed to load form package items' } };

  return { pkg, seeded: false, activeTemplates: items.map(i => i.template).filter(t => t.active) };
}

// Copies the case-type package into matter_forms so the matter owns its list.
// Idempotent and safe to call concurrently: ON CONFLICT (matter_id,
// template_id) is a no-op, so a double-click can't duplicate rows.
//
// Callers must be write-authorized — this is the materialize half of
// materialize-on-write.
export async function seedMatterForms(admin, matter, userId = null) {
  const { count } = await admin
    .from('matter_forms')
    .select('id', { count: 'exact', head: true })
    .eq('matter_id', matter.id);
  if (count) return { seeded: false, inserted: 0 };

  const pkg = await loadCaseTypePackage(admin, matter.case_type_id);
  if (!pkg) return { seeded: false, inserted: 0 };

  const { data: items } = await admin
    .from('form_package_items')
    .select('template_id, sort_order, required')
    .eq('package_id', pkg.id)
    .order('sort_order', { ascending: true });
  if (!items || !items.length) return { seeded: false, inserted: 0 };

  const { error } = await admin.from('matter_forms').upsert(
    items.map(i => ({
      matter_id:   matter.id,
      template_id: i.template_id,
      sort_order:  i.sort_order,
      required:    i.required,
      source:      'package',
      added_by:    userId,
    })),
    { onConflict: 'matter_id,template_id', ignoreDuplicates: true },
  );
  if (error) return { error: { status: 500, message: 'Failed to set up this matter\'s form list' } };

  return { seeded: true, inserted: items.length };
}

// Assembles the per-matter fill context consumed by applyFieldMap/resolvePath.
export async function buildFillContext(admin, matter, pkg, activeTemplates) {
  const matter_id = matter.id;
  const [{ data: client }, { data: immigration }, { data: familyMembers }, { data: firm }, { data: attorney }, { data: parties }] = await Promise.all([
    admin.from('clients').select('*').eq('id', matter.client_id).single(),
    admin.from('client_immigration').select('*').eq('matter_id', matter_id).maybeSingle(),
    admin.from('client_immigration_family_members').select('*').eq('matter_id', matter_id).order('created_at', { ascending: true }),
    admin.from('firm_settings').select('*').limit(1).maybeSingle(),
    matter.assigned_attorney_id
      ? admin.from('users').select('id, first_name, last_name, email, phone, bar_number, licensing_authority, uscis_account_number, fax').eq('id', matter.assigned_attorney_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // opposing_parties doubles as the immigration parties (the client is the
    // beneficiary): party_role 'primary' = PETITIONER (migration 1602),
    // 'joint_sponsor' = I-864 joint financial sponsor (migration 1604).
    admin.from('opposing_parties').select('*').eq('matter_id', matter_id).order('created_at', { ascending: true }),
  ]);

  const partyRows    = parties || [];
  const petitioner   = partyRows.find(p => (p.party_role || 'primary') !== 'joint_sponsor') || {};
  const jointSponsor = partyRows.find(p => p.party_role === 'joint_sponsor') || {};

  return {
    client:        client || {},
    matter,
    immigration:   immigration || {},
    familyMembers: familyMembers || [],
    firm:          firm || {},
    attorney:      attorney || {},
    petitioner,
    joint_sponsor: jointSponsor,
    // pkg is null for matters with no case type / no configured package; the
    // form list still resolves from matter_forms. Only form_numbers is
    // consumed by field maps (G-28 Part 3, N-400), and it derives from the
    // matter's ACTUAL list — so removing a form drops it from the G-28 too.
    package:       { name: pkg?.name || '', form_numbers: packageFormNumbers(activeTemplates) },
  };
}

// Loads manual field edits for a matter, grouped by template_id:
//   { "<template_id>": { "<field_name>": "<value>", ... }, ... }
export async function loadManualEdits(admin, matter_id, template_id = null) {
  let q = admin
    .from('form_field_edits')
    .select('template_id, field_name, value')
    .eq('matter_id', matter_id);
  if (template_id) q = q.eq('template_id', template_id);
  const { data } = await q;
  const byTemplate = {};
  for (const row of data || []) {
    (byTemplate[row.template_id] ||= {})[row.field_name] = row.value;
  }
  return byTemplate;
}
