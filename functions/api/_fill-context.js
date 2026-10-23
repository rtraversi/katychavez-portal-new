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
  // A form on the case twice (1.0.4) is still one form number.
  return [...new Set(activeTemplates
    .filter(t => !G28_FORMLIST_EXCLUDE.has(t.form_key))
    .map(t => t.form_key.toUpperCase()))]
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
//
// Drafter 1.0.4: a form can be on a case twice (two G-1450s), so each entry is
// one COPY: the template's columns (id = template id) plus
//   row_id      the matter_forms row, or null while the list is only the
//               package's suggestion
//   row_key     row_id, or "item:<package item id>" before seeding; unique
//   fee_amount  that copy's amount (whole dollars) or null
// Everything per form (files, versions, edits) belongs to the row.
export async function loadPackageTemplates(admin, matter) {
  const pkg = await loadCaseTypePackage(admin, matter.case_type_id);

  const { data: mfRows, error: mfErr } = await admin
    .from('matter_forms')
    .select(`id, sort_order, required, fee_amount, template:form_templates(${TEMPLATE_COLS})`)
    .eq('matter_id', matter.id)
    .order('sort_order', { ascending: true });
  if (mfErr) return { error: { status: 500, message: 'Failed to load the matter\'s forms' } };

  if (mfRows && mfRows.length) {
    return {
      pkg, seeded: true,
      activeTemplates: mfRows.filter(r => r.template?.active)
        .map(r => ({ ...r.template, row_id: r.id, row_key: r.id, fee_amount: r.fee_amount ?? null })),
    };
  }

  if (!pkg) return { pkg: null, seeded: false, activeTemplates: [] };

  const { data: items, error: itemsErr } = await admin
    .from('form_package_items')
    .select(`id, sort_order, required, template:form_templates(${TEMPLATE_COLS})`)
    .eq('package_id', pkg.id)
    .order('sort_order', { ascending: true });
  if (itemsErr) return { error: { status: 500, message: 'Failed to load form package items' } };

  return {
    pkg, seeded: false,
    activeTemplates: items.filter(i => i.template?.active)
      .map(i => ({ ...i.template, row_id: null, row_key: `item:${i.id}`, fee_amount: null })),
  };
}

// The copies (from loadPackageTemplates) a write targets: row_ids when given,
// else every copy of the given template_ids, else all. Unknown ids drop out.
export function pickCopies(copies, { row_ids, template_ids } = {}) {
  if (Array.isArray(row_ids) && row_ids.length) {
    const wanted = new Set(row_ids);
    return copies.filter(c => wanted.has(c.row_id));
  }
  if (Array.isArray(template_ids) && template_ids.length) {
    const wanted = new Set(template_ids);
    return copies.filter(c => wanted.has(c.id));
  }
  return copies;
}

// The fill context for one copy: the matter's context plus "form", the row
// being filled (1.0.4: each G-1450 fills its own amount).
export function contextForCopy(fillContext, copy) {
  return { ...fillContext, form: { id: copy?.row_id || null, fee_amount: copy?.fee_amount ?? null } };
}

// Copies the case-type package into matter_forms so the matter owns its list.
// One row per package line, so a package listing G-1450 twice gives the case
// two G-1450s, both without an amount (D-21). Idempotent and safe to call
// concurrently: ON CONFLICT (matter_id, package_item_id) is a no-op (1627), so
// a double-click can't duplicate rows.
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
    .select('id, template_id, sort_order, required')
    .eq('package_id', pkg.id)
    .order('sort_order', { ascending: true });
  if (!items || !items.length) return { seeded: false, inserted: 0 };

  const { error } = await admin.from('matter_forms').upsert(
    items.map(i => ({
      matter_id:       matter.id,
      template_id:     i.template_id,
      package_item_id: i.id,
      sort_order:      i.sort_order,
      required:        i.required,
      source:          'package',
      added_by:        userId,
    })),
    { onConflict: 'matter_id,package_item_id', ignoreDuplicates: true },
  );
  if (error) return { error: { status: 500, message: 'Failed to set up this matter\'s form list' } };

  await adoptLegacyRows(admin, matter.id);
  return { seeded: true, inserted: items.length };
}

// Drafts and edits made while a case's list was still the package's
// suggestion have no matter_forms row (migration 1627 left them NULL). Once
// the case is seeded they belong to the first copy of their form.
export async function adoptLegacyRows(admin, matterId) {
  const { data: rows } = await admin
    .from('matter_forms')
    .select('id, template_id, sort_order')
    .eq('matter_id', matterId)
    .order('sort_order', { ascending: true });
  const firstByTemplate = new Map();
  for (const r of rows || []) if (!firstByTemplate.has(r.template_id)) firstByTemplate.set(r.template_id, r.id);
  for (const [templateId, rowId] of firstByTemplate) {
    for (const table of ['generated_forms', 'form_field_edits']) {
      await admin.from(table)
        .update({ matter_form_id: rowId })
        .eq('matter_id', matterId)
        .eq('template_id', templateId)
        .is('matter_form_id', null);
    }
  }
}

// RT-16: the new-client form used to save "Phone" to the old phone column,
// and the client card saves cell_phone; maps read either one. Each falls back
// to the other when empty, so a phone typed in either place fills both.
export function withPhoneFallback(client) {
  if (!client) return {};
  const out = { ...client };
  if (!out.cell_phone && out.phone) out.cell_phone = out.phone;
  if (!out.phone && out.cell_phone) out.phone = out.cell_phone;
  return out;
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
    client:        withPhoneFallback(client),
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

// Loads manual field edits for a matter, grouped by the copy they belong to
// (Drafter 1.0.4: two G-1450s never share edits):
//   { "<matter_form_id>": { "<field_name>": "<value>", ... }, ... }
// Edits from before the case was seeded (matter_form_id NULL) are keyed
// "template:<template_id>"; editsForCopy() hands them to the first copy.
export async function loadManualEdits(admin, matter_id) {
  const { data } = await admin
    .from('form_field_edits')
    .select('template_id, matter_form_id, field_name, value')
    .eq('matter_id', matter_id);
  const byRow = {};
  for (const row of data || []) {
    const key = row.matter_form_id || `template:${row.template_id}`;
    (byRow[key] ||= {})[row.field_name] = row.value;
  }
  return byRow;
}

// The edits for one copy; legacy (unassigned) edits go to the first copy of
// the form only.
export function editsForCopy(byRow, copy, copies) {
  if (copy.row_id && byRow[copy.row_id]) return byRow[copy.row_id];
  const first = copies.find(c => c.id === copy.id);
  return first === copy ? byRow[`template:${copy.id}`] : undefined;
}
