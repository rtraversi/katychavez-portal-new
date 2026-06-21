-- Migration 1106: Document Drafting Module
-- HTML-based approach: templates stored as template_html in DB, rendered server-side.
-- No Word/WebDAV/R2 dependency — works in any browser, print-to-PDF ready.

-- ── Extend matters ────────────────────────────────────────────────────────────

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS court_number      text,
  ADD COLUMN IF NOT EXISTS date_of_marriage  date;

-- ── draft_templates ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draft_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  name          text        NOT NULL,
  description   text,
  doc_category  text        NOT NULL DEFAULT 'other'
                CHECK (doc_category IN ('petition','letter','agreement','order','financial','other')),
  case_types    text[],
  template_html text        NOT NULL,
  wizard_schema jsonb       NOT NULL DEFAULT '[]',
  sort_order    int         NOT NULL DEFAULT 0,
  active        boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_draft_templates_category ON public.draft_templates (doc_category);

CREATE TRIGGER set_draft_templates_updated_at
  BEFORE UPDATE ON public.draft_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── draft_documents ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draft_documents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  matter_id     uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  template_id   uuid        NOT NULL REFERENCES public.draft_templates(id) ON DELETE RESTRICT,
  generated_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  wizard_data   jsonb       NOT NULL DEFAULT '{}',
  file_name     text        NOT NULL,
  is_final      boolean     NOT NULL DEFAULT false,
  finalized_at  timestamptz,
  finalized_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_draft_docs_matter ON public.draft_documents (matter_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.draft_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_documents  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "draft_tmpl_read"  ON public.draft_templates FOR SELECT USING (can_read('core'));
CREATE POLICY "draft_tmpl_write" ON public.draft_templates FOR ALL    USING (can_write('core'));

CREATE POLICY "draft_docs_read"  ON public.draft_documents FOR SELECT USING (can_read('core'));
CREATE POLICY "draft_docs_write" ON public.draft_documents FOR ALL    USING (can_write('core'));

-- ── Module registration ───────────────────────────────────────────────────────

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES ('doc_drafting', 'Document Drafting', 'Generate court documents from client data.', 'file-plus', 'drafting', 1, 87, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'doc_drafting',
  CASE r.name
    WHEN 'Owner'            THEN 'admin'::public.access_level
    WHEN 'Attorney'         THEN 'write'::public.access_level
    WHEN 'Partner Attorney' THEN 'write'::public.access_level
    WHEN 'Paralegal'        THEN 'write'::public.access_level
    WHEN 'Legal Assistant'  THEN 'read'::public.access_level
  END
FROM public.roles r
WHERE r.name IN ('Owner','Attorney','Partner Attorney','Paralegal','Legal Assistant')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- ── Seed: Original Petition for Divorce ──────────────────────────────────────

INSERT INTO public.draft_templates (name, doc_category, case_types, description, sort_order, template_html, wizard_schema)
VALUES (
  'Original Petition for Divorce',
  'petition',
  ARRAY['divorce'],
  'Standard Texas Original Petition for Divorce. Covers parties, domicile, service, jurisdiction, grounds, children, and prayer.',
  10,
$TEMPLATE$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Original Petition for Divorce</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; margin: 1in; color: #000; max-width: 850px; }
  .caption-court { text-align: center; margin-bottom: 6pt; }
  .caption-table { width: 100%; border-collapse: collapse; margin-bottom: 20pt; }
  .caption-table td { padding: 1pt 4pt; vertical-align: top; line-height: 1.4; }
  .caption-party { width: 44%; }
  .caption-sec { width: 6%; text-align: center; font-size: 13pt; }
  .caption-cause { width: 50%; padding-left: 12pt; }
  .doc-title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 13pt; margin: 16pt 0 20pt; letter-spacing: 0.5px; }
  body { counter-reset: art; }
  .art-header { font-weight: bold; }
  .art-header::before { counter-increment: art; content: counter(art) ". "; }
  p { margin: 10pt 0; text-align: justify; }
  .children-table { width: 100%; border-collapse: collapse; margin: 8pt 0 8pt 20pt; }
  .children-table td { padding: 3pt 8pt; font-size: 11.5pt; }
  .children-table tr:not(:last-child) { border-bottom: 1px solid #ccc; }
  .sig-line { border-top: 1px solid #000; width: 260pt; margin: 40pt 0 4pt; }
  .sig-name { font-size: 11.5pt; }
  .notice { background: #fff8e1; border: 1px solid #f59e0b; padding: 8pt 12pt; margin-bottom: 16pt; font-size: 10.5pt; border-radius: 4px; }
  @media print { .notice { display:none; } body { margin: 0.75in; } @page { margin: 0.75in; } }
</style>
</head>
<body>

<div class="notice">&#x26A0; Review all bracketed placeholders before filing. This document was auto-generated — attorney review required.</div>

<div class="caption-court">IN THE {{court_number}} DISTRICT COURT<br>{{court_county}} COUNTY, TEXAS</div>

<table class="caption-table">
<tr>
  <td class="caption-party">{{petitioner_name}},<br>&nbsp;&nbsp;&nbsp;&nbsp;Petitioner,</td>
  <td class="caption-sec">&#167;<br>&#167;<br>&#167;</td>
  <td class="caption-cause" rowspan="5">CAUSE NO. {{case_number}}</td>
</tr>
<tr>
  <td style="padding-left:0">v.</td>
  <td class="caption-sec">&#167;</td>
</tr>
<tr>
  <td class="caption-party">{{respondent_name}},<br>&nbsp;&nbsp;&nbsp;&nbsp;Respondent.</td>
  <td class="caption-sec">&#167;<br>&#167;<br>&#167;</td>
</tr>
</table>

<div class="doc-title">ORIGINAL PETITION FOR DIVORCE</div>

<p><strong class="art-header">Discovery.</strong> Discovery in this case is intended to be conducted under {{discovery_label}} of Rule 190 of the Texas Rules of Civil Procedure.{{#if discovery_no_children_note}} No children are involved in this divorce case, and the value of the marital estate is more than zero but not more than $250,000.{{/if}}</p>

<p>Preservation of Evidence: Respondent is put on notice to preserve and not destroy, conceal, or alter any evidence or potential evidence relevant to the issues in this case, including tangible documents or items in Respondent's possession or subject to Respondent's control and electronic documents, files, or other data generated by or stored on Respondent's home computer, work computer, storage media, portable systems, electronic devices, online repositories, or cell phone.</p>

{{#if object_to_associate_judge}}
<p><strong class="art-header">Objection to Assignment of Case to Associate Judge.</strong> Petitioner objects to the assignment of this matter to an associate judge for a trial on the merits or presiding at a jury trial.</p>
{{/if}}

<p><strong class="art-header">Parties.</strong> This suit is brought by {{petitioner_name}}, Petitioner.{{#if petitioner_has_dl}} The last three numbers of Petitioner's driver's license number are {{petitioner_dl_last3}}.{{/if}}{{^petitioner_has_dl}} Petitioner has not been issued a driver's license.{{/petitioner_has_dl}}{{#if petitioner_has_ssn}} The last three numbers of Petitioner's Social Security number are {{petitioner_ssn_last3}}.{{/if}}{{^petitioner_has_ssn}} Petitioner has not been issued a Social Security number.{{/petitioner_has_ssn}}</p>

<p>{{respondent_name}} is Respondent.</p>

<p><strong class="art-header">Domicile.</strong> {{#if petitioner_tx_domiciliary}}{{petitioner_name}} has been a domiciliary of Texas for the preceding six-month period and a resident of this county for the preceding ninety-day period.{{/if}}{{^petitioner_tx_domiciliary}}Petitioner is domiciled in another state or nation. Respondent has been a domiciliary of Texas for at least the last six months and is a resident of this county.{{/petitioner_tx_domiciliary}}</p>

<p><strong class="art-header">Service.</strong> {{#if service_personal}}Process should be served on Respondent at {{respondent_full_address}}.{{/if}}{{#if service_none}}No service on Respondent is necessary at this time.{{/if}}{{#if service_substituted}}Citation of Respondent by publication or other substituted service is necessary for the reasons stated in the affidavit attached as Exhibit A.{{/if}}</p>

<p><strong class="art-header">Jurisdiction.</strong> The subject matter in controversy is within the jurisdictional limits of this court.</p>

<p>Petitioner seeks: {{relief_text}}.</p>

<p><strong class="art-header">Protective Order Statement.</strong> No protective order under title 4 of the Texas Family Code, protective order under subchapter A of chapter 7B of the Texas Code of Criminal Procedure, or order for emergency protection under Article 17.292 of the Texas Code of Criminal Procedure is in effect in regard to a party to this suit{{#if has_children}} or a child of a party to this suit{{/if}} and no application for any such order is pending.</p>

<p><strong class="art-header">Dates of Marriage and Separation.</strong> The parties were married on or about {{marriage_date_display}} and ceased to live together as spouses on or about {{separation_date_display}}.</p>

<p><strong class="art-header">Grounds for Divorce.</strong> {{grounds_text}}</p>

<p><strong class="art-header">Children of the Marriage.</strong>
{{^has_children}}There is no child born or adopted of this marriage, and none is expected.{{/has_children}}
{{#if has_children}}Petitioner and Respondent are parents of the following {{children_noun}} of this marriage:
<table class="children-table">
<tr><td><strong>Name</strong></td><td><strong>Date of Birth</strong></td><td><strong>Sex</strong></td></tr>
{{#each children}}<tr><td>{{name}}</td><td>{{dob_display}}</td><td>{{sex_label}}</td></tr>
{{/each}}
</table>
{{#if conservatorship_jmc}}Petitioner and Respondent, on final hearing, should be appointed joint managing conservators.{{#if conservatorship_petitioner_primary}} Petitioner should be designated as the conservator who has the exclusive right to designate the primary residence of the {{children_noun}}.{{/if}} Respondent should be ordered to provide support for the {{children_noun}}, including the payment of child support and medical and dental support in the manner specified by the Court. Petitioner requests that the payments for the support of the {{children_noun}} survive the death of Respondent and become the obligations of Respondent's estate.{{/if}}{{#if conservatorship_sole}}The appointment of Petitioner and Respondent as joint managing conservators would not be in the best interest of the {{children_noun}}. Petitioner, on final hearing, should be appointed sole managing conservator, with all the rights and duties of a parent sole managing conservator, and Respondent should be ordered to provide support for the {{children_noun}}, including the payment of child support and medical and dental support in the manner specified by the Court.{{/if}}{{#if conservatorship_possessory}}Petitioner should be appointed possessory conservator with all the rights and duties of a parent conservator. Petitioner requests the Court to make orders for the terms and conditions of Petitioner's conservatorship and possession of and access to the {{children_noun}}.{{/if}}
{{/if}}
</p>

<p><strong class="art-header">Division of Marital Estate.</strong> Petitioner requests the Court to order a division of the estate of the parties in a manner that the Court deems just and right, as provided by the Texas Family Code.</p>

{{#if name_change}}
<p><strong class="art-header">Request for Change of Name.</strong> Petitioner requests a change of name to {{new_name}}.</p>
{{/if}}

<p><strong class="art-header">Attorney's Fees, Court Costs, Expenses, and Interest.</strong> It was necessary for Petitioner to secure the services of {{attorney_name}}, a licensed attorney, to prepare and prosecute this suit. To effect an equitable division of the estate of the parties and as a part of the division,{{#if has_children}} and for services rendered in connection with conservatorship and support of the {{children_noun}},{{/if}} judgment for reasonable and necessary attorney's fees, court costs, and expenses through trial and appeal should be granted against Respondent and in favor of Petitioner for the use and benefit of Petitioner's attorney and be ordered paid directly to Petitioner's attorney, who may enforce the judgment in the attorney's own name. Petitioner requests postjudgment interest as allowed by law.</p>

<p><strong class="art-header">Prayer.</strong> Petitioner prays that citation and notice issue as required by law and that the Court grant a divorce and all other relief requested in this petition.</p>

<p>Petitioner prays for general relief.</p>

<p style="text-align:right; margin-top:4pt">Respectfully submitted,</p>

<div class="sig-line"></div>
<div class="sig-name">{{attorney_name}}<br>
State Bar No. {{attorney_bar_number}}<br>
{{firm_name}}<br>
{{firm_address}}<br>
{{firm_phone}}<br>
{{firm_email}}<br>
<em>Attorney for Petitioner</em>
</div>

</body>
</html>$TEMPLATE$,

$SCHEMA$[
  {"key":"is_client_petitioner","label":"Client's role in case","type":"select","default":"true","options":[{"value":"true","label":"Petitioner (client filed)"},{"value":"false","label":"Respondent (opposing party filed)"}]},
  {"key":"discovery_level","label":"Discovery level","type":"select","default":"2","options":[{"value":"1","label":"Level 1 — Rule 190.2 (no children, estate ≤$250K)"},{"value":"2","label":"Level 2 — Rule 190.3 (standard)"},{"value":"3","label":"Level 3 — Rule 190.4 (complex)"}]},
  {"key":"object_to_associate_judge","label":"Object to associate judge assignment","type":"toggle","default":false},
  {"key":"domicile_scenario","label":"Texas domicile","type":"select","default":"petitioner","options":[{"value":"petitioner","label":"Petitioner (6 months TX + 90 days county)"},{"value":"respondent","label":"Petitioner out of state; Respondent is TX domiciliary"}]},
  {"key":"service_type","label":"Service on Respondent","type":"select","default":"personal","options":[{"value":"personal","label":"Personal service at Respondent's address"},{"value":"none","label":"No service necessary at this time"},{"value":"substituted","label":"Substituted / publication service"}]},
  {"key":"relief_type","label":"Relief sought","type":"select","default":"monetary_nonmonetary_250k","options":[{"value":"monetary_250k","label":"Monetary only — $250K or less"},{"value":"monetary_nonmonetary_250k","label":"Monetary + non-monetary — $250K or less"},{"value":"monetary_250k_1m","label":"Monetary $250K–$1M"},{"value":"monetary_over_1m","label":"Monetary over $1M"},{"value":"nonmonetary","label":"Non-monetary only"}]},
  {"key":"grounds","label":"Grounds for divorce","type":"select","default":"insupportability","options":[{"value":"insupportability","label":"Insupportability (no-fault)"},{"value":"cruelty","label":"Cruel treatment"},{"value":"adultery","label":"Adultery"},{"value":"felony","label":"Felony conviction"},{"value":"abandonment","label":"Abandonment (1+ years)"},{"value":"living_apart","label":"Living apart (3+ years)"},{"value":"mental_disorder","label":"Mental disorder (3+ years confinement)"}]},
  {"key":"conservatorship","label":"Conservatorship (if children)","type":"select","default":"jmc_petitioner","options":[{"value":"jmc_petitioner","label":"JMC — Petitioner has primary residence"},{"value":"jmc_respondent","label":"JMC — Respondent has primary residence"},{"value":"petitioner_sole","label":"Petitioner sole managing conservator"},{"value":"petitioner_possessory","label":"Petitioner possessory conservator"}]},
  {"key":"name_change","label":"Petitioner requests name change","type":"toggle","default":false},
  {"key":"new_name","label":"New name (if requested)","type":"text","condition":"name_change","placeholder":"Full name to restore"},
  {"key":"marriage_date","label":"Date of marriage","type":"date","source":"matter.date_of_marriage","placeholder":"If not on file"},
  {"key":"separation_date","label":"Date of separation","type":"date","source":"matter.separation_date","placeholder":"If not on file"},
  {"key":"court_number","label":"Court number","type":"text","source":"matter.court_number","placeholder":"e.g. 303rd"},
  {"key":"court_county","label":"Court county","type":"text","source":"matter.court_county","placeholder":"e.g. Dallas"}
]$SCHEMA$::jsonb
);
