-- Migration 1600-n400: N-400 template + Naturalization package + field map
--
-- Application for Naturalization (case_type key = 'naturalization').
-- Package: G-1145 (10), G-28 (20), N-400 (30), G-1450 (40) -- the G-28
-- Part 3 form list fills per package at generate time (package.form_numbers),
-- so it reads "G-1145, G-1450, N-400" for naturalization matters. No code
-- changes: the form-filler pipeline is package-generic.
--
-- Sources verified against per-field tooltips (dumped from the normalized
-- AcroForm). Notable decisions, following the I-821D/I-765 precedent:
--   - Part 1 eligibility basis (5-yr LPR / spouse of USC / VAWA / military):
--     attorney's call -- blank. Same for the USCIS field-office dropdown.
--   - Page-header A-Number boxes (14, one per sheet) <- immigration.a_number.
--   - Part 2: legal name/DOB/countries/SSN data-mapped. "Other names used",
--     name-change request, sex, parent-USC-before-18, disability exemption,
--     and the SSA card consent pair stay blank. Date became LPR and the
--     applicant's own USCIS online account number have no data column yet --
--     blank; candidate future client_immigration columns.
--   - Part 3 residence: row 1 (current physical address) <- client address;
--     country = literal United States. 5-year history rows, dates, and the
--     mailing-address block(s) stay blank (only one address on file; the
--     "mailing same as physical" Yes is the attorney's call).
--   - Part 4 biographic (ethnicity/race/height/weight/eye/hair): blank.
--   - Part 5 employment: row 1 <- client.employer + employer_city/state/zip.
--     Dates and occupation blank (no columns).
--   - Parts 6-9 (travel history, marital history, children, and the entire
--     criminal / security / moral-character / oath-willingness battery):
--     deliberately blank for attorney review -- a "No" is never auto-checked.
--     Spouse/children rows can't map safely by family-member index; a
--     relationship-aware source (immigration.spouse.<col>) is a future
--     _form-fill.js enhancement.
--   - Part 10 contact <- client phone/cell/email (digits transforms).
--   - Part 11 interpreter: blank. Part 12 preparer <- attorney + firm name.
--   - Part 14 header name (pre-populated from page 1; read-only flag cleared
--     at normalize time) <- client name. All signature/date fields blank
--     (wet signature required).
--   - Firms can layer standing literals (e.g. oath-willingness Yes answers)
--     via Settings -> template defaults (firm_overrides), which sit over this
--     map at generate time.
--
-- 426 map entries (41 data-mapped, 385 deliberately blank);
-- 14 XFA barcode fields stamped+removed at normalize time. Field inventory:
-- normalized/n-400.fields.json. Requires the a_number/digits/state_abbrev/
-- date_slash transforms shipped in functions/api/_form-fill.js.

-- ── Template row ──────────────────────────────────────────────────────────────

INSERT INTO public.form_templates (form_key, label) VALUES
  ('n-400', 'Form N-400 — Application for Naturalization')
ON CONFLICT (form_key) DO NOTHING;

-- ── Naturalization package (case_type key = 'naturalization') ─────────────────

INSERT INTO public.form_packages (case_type_id, name)
SELECT ct.id, 'Naturalization Package'
FROM public.case_types ct
WHERE ct.key = 'naturalization'
ON CONFLICT (case_type_id) DO NOTHING;

INSERT INTO public.form_package_items (package_id, template_id, sort_order)
SELECT fp.id, ft.id, x.sort_order
FROM public.form_packages fp
JOIN public.case_types ct ON ct.id = fp.case_type_id AND ct.key = 'naturalization'
JOIN (VALUES
  ('g-1145', 10),
  ('g-28',   20),
  ('n-400',  30),
  ('g-1450', 40)
) AS x(form_key, sort_order) ON true
JOIN public.form_templates ft ON ft.form_key = x.form_key
ON CONFLICT (package_id, template_id) DO NOTHING;

-- ── Field map ─────────────────────────────────────────────────────────────────

UPDATE public.form_templates
SET r2_key      = 'form-templates/n-400.pdf',
    field_count = 426,
    field_map   = '{
  "form1[0].#subform[0].Part1_Eligibility[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].#area[0].Line1_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].Part1_Eligibility[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1Line5_OtherExplain[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].DropDownList1[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_Line1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].P2_Line1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].P2_Line1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].Line3_MiddleName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Line3_GivenName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Line3_MiddleName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Line3_GivenName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Line2_FamilyName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Line2_FamilyName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#area[1].Line1_AlienNumber[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[1].P2_Line8_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].P2_Line7_Gender[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line7_Gender[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line6_USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line9_DateBecamePermanentResident[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line11_CountryOfNationality[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[1].P2_Line10_claimdisability[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line10_claimdisability[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line12a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line12a_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line12b_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full",
    "transform": "digits"
  },
  "form1[0].#subform[1].Line12\\.c_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line12\\.c_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line11_claimdisability[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line11_claimdisability[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line10_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[1].Part2Line4a_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part2Line4a_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line34_NameChange[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line34_NameChange[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part2Line3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].#area[2].Line1_AlienNumber[2]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[2].P7_Line2_Race[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line2_Race[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line2_Race[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line2_Race[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line2_Race[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line1_Ethnicity[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line1_Ethnicity[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line4_Pounds2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line3_HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line3_HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line4_Pounds1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line4_Pounds3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line5_Eye[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line5_Eye[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line5_Eye[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line5_Eye[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line5_Eye[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line5_Eye[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line5_Eye[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line5_Eye[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line5_Eye[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Hair[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Hair[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Hair[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Hair[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Hair[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Hair[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Hair[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Hair[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Hair[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_PhysicalAddress1[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[2].P4_Line3_PhysicalAddress2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_PhysicalAddress3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_CityTown3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_CityTown2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_CityTown1[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[2].P4_Line3_From1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_From2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_From3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_To2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_To3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3_Line2a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3_Line2a_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_ZipCode1[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[2].P4_Line3_ZipCode2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_ZipCode3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_State1[0]": {
    "type": "text",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[2].P4_Line3_State2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_State3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_Country1[0]": {
    "type": "text",
    "source": "literal:United States"
  },
  "form1[0].#subform[2].P4_Line3_Country2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_Country3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_InCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_DatesofResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_DatesofResidence[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line3_From1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].#area[3].Line1_AlienNumber[3]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[3].P5_Line1b_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line1_State[1]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_InCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part9Line3_TimesMarried[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line1_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line1_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line1_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line1_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line1_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line1_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P7_Line2_Forces[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P7_Line2_Forces[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line4a_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line4a_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line4a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line4d_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line4e_DateEnterMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line5_Citizen[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line5_Citizen[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line5b_DateBecame[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line5a_When[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P10_Line5a_When[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].#area[4].Line1_AlienNumber[4]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[4].#area[5].P7_Line6_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P10_Line4g_Employer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line1_TotalChildren[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_EmployerName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_EmployerName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_EmployerName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_From1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_From2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_From3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_OccupationFieldStudy1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_OccupationFieldStudy2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_OccupationFieldStudy3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_OccupationFieldStudy1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_OccupationFieldStudy2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_OccupationFieldStudy3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P9_Line5a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P9_Line5a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_ChildTwo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_ChildTwo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_ChildThree[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_ChildThree[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_EmployerName1[0]": {
    "type": "text",
    "source": "client.employer"
  },
  "form1[0].#subform[4].P5_EmployerName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_EmployerName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_City3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_City2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_City1[0]": {
    "type": "text",
    "source": "client.employer_city"
  },
  "form1[0].#subform[4].P7_From1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_From2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_From3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_To2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_To3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_OccupationFieldStudy1[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_OccupationFieldStudy2[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_OccupationFieldStudy3[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_State1[0]": {
    "type": "text",
    "source": "client.employer_state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[4].P7_State2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_State3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_ZipCode1[0]": {
    "type": "text",
    "source": "client.employer_zip"
  },
  "form1[0].#subform[4].P7_ZipCode2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_ZipCode3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Country3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Country2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Country1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateReturn1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateReturn3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateReturn5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_Countries6[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateLeft6[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateReturn6[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateLeft5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_Countries5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_Countries4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateLeft4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateReturn4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateLeft3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_Countries3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_Countries2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateLeft2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateReturn2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P8_Line1_DateLeft1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_Line1_Countries1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].#area[6].Line1_AlienNumber[5]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[5].P9_Line2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_Line2[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_Line1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_Line1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_Line3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_Line3[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_Line4[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_Line4[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_5a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_5a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_5b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_5b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P12_6a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P12_6a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P12_6b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P12_6b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P12_6c[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P12_6c[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.b\\.[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.b\\.[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.c[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.c[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.e[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.e[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.f[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.f[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.g[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line7\\.g[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P11_7d[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P11_7d[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].#area[7].Line1_AlienNumber[6]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[6].P9_Line8a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line8a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line9[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line9[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line10b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line10c[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line10c[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line10b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line10a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line10a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line8b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line8b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line11[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line11[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line12[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line12[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line13[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line13[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line14[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P9_Line14[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].#area[8].Line1_AlienNumber[7]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[7].P9_Line15a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P9_Line15a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P9_Line15b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P9_Line15b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_why1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_why2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_why3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_why4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_why5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Date1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Date2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Date3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Date4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Date5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome5[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome4[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome5[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome4[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome3[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome2[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_Outcome1[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_DateOfConv5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_DateOfConv4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_DateOfConv3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_DateOfConv2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line29_DateOfConv1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line16[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P12_Line16[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].#area[9].Line1_AlienNumber[8]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[8].P11_Line17A[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P11_Line17A[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P11_Line17B[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P11_Line17B[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P11_Line17C[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P11_Line17C[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17d[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17d[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17e[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17e[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17h[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17h[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17g[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17g[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17f[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line17f[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line21[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line21[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line20[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line20[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P9_Line22a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P9_Line22a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P9_Line22c_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P9_Line22c_SSNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9_Line22b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9_Line22b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line19[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line19[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line18[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line18[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line23[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line23[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line24[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line24[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line25[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P12_Line25[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].#area[10].Line1_AlienNumber[9]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[9].P12_Line26a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line26a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line26b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line26b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line26c[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line26c[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P11_Line26d[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P11_Line26d[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line27[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line27[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line28[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line28[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P9_Line29[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P9_Line29[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line30a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line30a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line30b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line30b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line31[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line32[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line32[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line31[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line35[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line36[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line36[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line35[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line34[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line34[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line37[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line37[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line33[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P12_Line33[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P9_NobilityTitles[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].#area[11].Line1_AlienNumber[10]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[10].P12_SignatureApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P13_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P12_Line5_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[10].P12_Line3_Telephone[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[10].P12_Line3_Mobile[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[10].P10_Line3_HouseHoldSize[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P11_Line1_TotalChildren[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P10_Line5b_NameOfHousehold[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P10_Line1_Citizen[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P10_Line1_Citizen[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P10_Line2_TotalHouseholdIn[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P10_Line5a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P10_Line5a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].#area[12].Line1_AlienNumber[11]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[11].P14_Line2_NameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P14_Line1_nterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P14_Line1_nterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P14_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P14_Line4_Telephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P14_Line5_Mobile[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P14_NameOfLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P14_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P12_SignatureApplicant[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P15_Line1_PreparerGivenName[0]": {
    "type": "text",
    "source": "attorney.first_name"
  },
  "form1[0].#subform[11].P15_Line1_PreparerFamilyName[0]": {
    "type": "text",
    "source": "attorney.last_name"
  },
  "form1[0].#subform[11].P15_Line2_NameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "firm.firm_name"
  },
  "form1[0].#subform[11].P15_Line6_Email[0]": {
    "type": "text",
    "source": "attorney.email"
  },
  "form1[0].#subform[11].P15_Line4_Telephone[0]": {
    "type": "text",
    "source": "attorney.phone",
    "transform": "digits"
  },
  "form1[0].#subform[11].P15_Line5_Mobile[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P15_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P12_SignatureApplicant[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].#area[13].Line1_AlienNumber[12]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[12].P11_Line5D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line6A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line6B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line6C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line6D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line5C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line5B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line5A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line3A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line3B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line3C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line3D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P2_Line1_FamilyName[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[12].P2_Line1_GivenName[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[12].P2_Line1_MiddleName[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[12].P11_Line4A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line4B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line4C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P11_Line4D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].#area[14].Line1_AlienNumber[13]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[13].Part15ApplicantsSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part15USCISSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part15DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part15USCISName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].ApplicantsSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part15DateofSignature[1]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'n-400';
