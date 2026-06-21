// CF Worker: POST /api/drafting/generate
// Body: { template_id, matter_id, wizard_data }
// Returns: HTML document ready to print/save as PDF

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[drafting-generate]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'doc_drafting');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { template_id, matter_id, wizard_data = {} } = body;
  if (!template_id || !matter_id) return json(400, { error: 'template_id and matter_id are required' });

  const admin = makeAdminClient(env);

  // ── Fetch template ────────────────────────────────────────────────────────
  const { data: tmpl, error: tmplErr } = await admin
    .from('draft_templates')
    .select('id, name, template_html, wizard_schema')
    .eq('id', template_id)
    .single();
  if (tmplErr || !tmpl) return json(404, { error: 'Template not found' });

  // ── Fetch matter + client + OP + children + key_dates + users ─────────────
  const [
    { data: matter },
    { data: users },
  ] = await Promise.all([
    admin.from('matters').select(`
      id, case_number, court_county, court_number, judge_name,
      date_of_marriage, separation_date, assigned_attorney_id,
      client:clients(
        id, first_name, last_name, ssn_last4, driver_license_number, cell_phone,
        address_line1, city, state, zip
      ),
      opposing_parties(
        id, first_name, last_name, ssn_last4, driver_license_number, cell_phone,
        address_line1, city, state, zip, email
      ),
      children(id, first_name, last_name, dob, sex),
      key_dates(date_type, date_value)
    `).eq('id', matter_id).single(),
    admin.from('users').select('id, first_name, last_name, bar_number, email, phone').eq('active', true),
  ]);

  if (!matter) return json(404, { error: 'Matter not found' });

  // ── Persist any court/date info entered in wizard back to the matter ───────
  const matterpatch = {};
  if (wizard_data.court_number && !matter.court_number)
    matterpatch.court_number = wizard_data.court_number;
  if (wizard_data.court_county && !matter.court_county)
    matterpatch.court_county = wizard_data.court_county;
  if (wizard_data.marriage_date && !matter.date_of_marriage)
    matterpatch.date_of_marriage = wizard_data.marriage_date;
  if (wizard_data.separation_date && !matter.separation_date)
    matterpatch.separation_date = wizard_data.separation_date;
  if (Object.keys(matterpatch).length > 0)
    await admin.from('matters').update(matterpatch).eq('id', matter_id);

  // ── Build variables ───────────────────────────────────────────────────────
  const client = matter.client;
  const op     = matter.opposing_parties?.[0] || null;
  const children = matter.children || [];

  const isClientPetitioner = wizard_data.is_client_petitioner !== 'false' && wizard_data.is_client_petitioner !== false;
  const petitioner = isClientPetitioner ? client : op;
  const respondent = isClientPetitioner ? op    : client;

  function fullName(p) {
    return `${p?.first_name || ''} ${p?.last_name || ''}`.trim() || '[Name Not Found]';
  }
  function lastN(str, n) {
    if (!str) return null;
    const clean = str.replace(/\D/g, '');
    return clean.length >= n ? clean.slice(-n) : null;
  }
  function fmtDate(d) {
    if (!d) return '[date not on file]';
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  const hasChildren = children.length > 0;
  const childrenNoun = children.length === 1 ? 'child' : 'children';

  const discoveryLabels = {
    '1': 'Level 1 — Rule 190.2',
    '2': 'Level 2 — Rule 190.3',
    '3': 'Level 3 — Rule 190.4',
  };
  const reliefTexts = {
    monetary_250k:             'only monetary relief of $250,000 or less, excluding interest, statutory or punitive damages and penalties, and attorney fees and costs',
    monetary_nonmonetary_250k: 'monetary relief of $250,000 or less and non-monetary relief',
    monetary_250k_1m:          'monetary relief over $250,000 but not more than $1,000,000',
    monetary_over_1m:          'monetary relief over $1,000,000',
    nonmonetary:               'only non-monetary relief',
  };
  const groundsTexts = {
    insupportability: 'The marriage has become insupportable because of discord or conflict of personalities between Petitioner and Respondent that destroys the legitimate ends of the marriage relationship and prevents any reasonable expectation of reconciliation.',
    cruelty:          'Respondent is guilty of cruel treatment toward Petitioner of a nature that renders further living together insupportable.',
    adultery:         'Respondent has committed adultery.',
    felony:           'Since the marriage, Respondent has been convicted of a felony; has been imprisoned for at least one year in the Texas Department of Criminal Justice, a federal penitentiary, or the penitentiary of another state; and has not been pardoned. Respondent was not convicted on the testimony of Petitioner.',
    abandonment:      'Respondent has left Petitioner with the intention of abandonment and has remained away for at least one year.',
    living_apart:     'Petitioner and Respondent have lived apart without cohabitation for at least three years.',
    mental_disorder:  'Respondent has been confined in a mental hospital in Texas or another state for at least three years, and it appears that Respondent\'s mental disorder is of such a degree and nature that adjustment is unlikely or that, if adjustment occurs, a relapse is probable.',
  };

  const attorney = (users || []).find(u => u.id === matter.assigned_attorney_id);
  const attyName = attorney ? fullName(attorney) : '[Attorney Name]';

  const respAddr = [
    respondent?.address_line1,
    [respondent?.city, respondent?.state].filter(Boolean).join(', '),
    respondent?.zip,
  ].filter(Boolean).join(' ').trim() || '[address not on file]';

  const petDL  = lastN(petitioner?.driver_license_number, 3);
  const petSSN = lastN(petitioner?.ssn_last4, 3);

  const discoveryLevel = String(wizard_data.discovery_level || '2');
  const conservatorship = wizard_data.conservatorship || 'jmc_petitioner';
  const serviceType = wizard_data.service_type || 'personal';
  const reliefType = wizard_data.relief_type || 'monetary_nonmonetary_250k';
  const grounds = wizard_data.grounds || 'insupportability';

  // Key Dates are the canonical source for marriage/separation dates
  const kdMarriage   = matter.key_dates?.find(d => d.date_type === 'marriage')?.date_value;
  const kdSeparation = matter.key_dates?.find(d => d.date_type === 'separation')?.date_value;

  const effectiveMarriageDate   = wizard_data.marriage_date   || kdMarriage   || matter.date_of_marriage;
  const effectiveSeparationDate = wizard_data.separation_date || kdSeparation || matter.separation_date;
  const effectiveCourtNumber    = wizard_data.court_number    || matter.court_number || '[Court Number]';
  const effectiveCourtCounty    = wizard_data.court_county    || matter.court_county || '[County]';

  const vars = {
    court_number:  effectiveCourtNumber,
    court_county:  effectiveCourtCounty.toUpperCase(),
    case_number:   matter.case_number || '[Case Number]',

    petitioner_name:    fullName(petitioner),
    respondent_name:    fullName(respondent),
    petitioner_dl_last3: petDL  || '',
    petitioner_ssn_last3: petSSN || '',
    petitioner_has_dl:  !!petDL,
    petitioner_has_ssn: !!petSSN,
    respondent_full_address: respAddr,

    discovery_label:          discoveryLabels[discoveryLevel] || discoveryLabels['2'],
    discovery_no_children_note: discoveryLevel === '1',

    object_to_associate_judge: wizard_data.object_to_associate_judge === true || wizard_data.object_to_associate_judge === 'true',
    petitioner_tx_domiciliary: (wizard_data.domicile_scenario || 'petitioner') === 'petitioner',
    service_personal:   serviceType === 'personal',
    service_none:       serviceType === 'none',
    service_substituted: serviceType === 'substituted',

    relief_text:  reliefTexts[reliefType] || reliefTexts['monetary_nonmonetary_250k'],
    grounds_text: groundsTexts[grounds]   || groundsTexts['insupportability'],

    marriage_date_display:   fmtDate(effectiveMarriageDate),
    separation_date_display: fmtDate(effectiveSeparationDate),

    has_children:   hasChildren,
    children_noun:  childrenNoun,
    children: children.map(c => ({
      name:      fullName(c),
      dob_display: fmtDate(c.dob),
      sex_label: c.sex === 'M' ? 'Male' : c.sex === 'F' ? 'Female' : c.sex || '',
    })),

    conservatorship_jmc:              conservatorship === 'jmc_petitioner' || conservatorship === 'jmc_respondent',
    conservatorship_petitioner_primary: conservatorship === 'jmc_petitioner',
    conservatorship_sole:             conservatorship === 'petitioner_sole',
    conservatorship_possessory:       conservatorship === 'petitioner_possessory',

    name_change: wizard_data.name_change === true || wizard_data.name_change === 'true',
    new_name:    wizard_data.new_name || '',

    attorney_name:       attyName,
    attorney_bar_number: attorney?.bar_number || '___________',
    firm_name:           '[Firm Name]',
    firm_address:        '[Firm Address]',
    firm_phone:          attorney?.phone || '[Firm Phone]',
    firm_email:          attorney?.email || '[Firm Email]',
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const html = renderTemplate(tmpl.template_html, vars);

  // ── Log generated document ────────────────────────────────────────────────
  await admin.from('draft_documents').insert({
    matter_id,
    template_id,
    generated_by: auth.profile?.id || null,
    wizard_data,
    file_name: `${tmpl.name} — ${fullName(client)}.html`,
  });

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Template engine ───────────────────────────────────────────────────────────

function renderTemplate(template, vars) {
  function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function render(tmpl, ctx) {
    let out = tmpl;

    // #each loops
    out = out.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
      const arr = ctx[key];
      if (!Array.isArray(arr) || arr.length === 0) return '';
      return arr.map(item => render(body, { ...ctx, ...item })).join('');
    });

    // #if conditionals (two passes for nesting)
    for (let i = 0; i < 2; i++) {
      out = out.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => {
        return ctx[key] ? render(body, ctx) : '';
      });
    }

    // ^inverse conditionals
    out = out.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) => {
      return !ctx[key] ? render(body, ctx) : '';
    });

    // Simple variables
    out = out.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = ctx[key];
      return val != null ? esc(val) : '';
    });

    return out;
  }

  return render(template, vars);
}
