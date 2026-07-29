-- Migration 1600-i918supb: I-918SUPB field map + template registration
--
-- USCIS Form I-918 Supplement B, the U Nonimmigrant Status Certification. Part 1 identifies the victim; Parts 2-6 are completed and signed by a certifying law-enforcement official attesting to the qualifying criminal activity and the victim's helpfulness. The firm does not complete the certification itself.
--
-- Source:  uscis-forms/i-918supb.pdf
-- Edition: 01/20/25 (printed lower-left; title "U Nonimmigrant Status Certification")
-- SHA-256: a6e189a543c73013dd57062bcd7bb63c2678453dde985cb9a0b965f8be092460
--
-- 133 fields: 5 data-mapped, 128 deliberately blank.
-- Field inventory: normalized/i-918supb.fields.json
-- Field semantics: normalized/i-918supb.tooltips.tsv
--
-- Mapping decisions:
--  * This form is COMPLETED AND SIGNED BY LAW ENFORCEMENT, not the firm. Only
--    Part 1 Victim Information is pre-filled, so the packet reaches the certifying
--    agency with the correct victim already identified.
--  * Autofilled: Part 1 victim A-number, legal name, DOB.
--  * Left blank on purpose:
--    - Everything else — certifying agency/official, the criminal activity, the
--      victim's helpfulness, investigation/prosecution details, and the official's
--      signature are all the law-enforcement certifier's content (hard rule).
--    - Other names (3).
--  * Edition is the parent I-918's (01/20/25); supplement has no standalone page.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-918supb', 'Form I-918SUPB -- U Nonimmigrant Status Certification')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-918supb.pdf',
    field_count  = 133,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].Part1_5_checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_5_checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P3_Line4c_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P3_Line4c_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P3_Line4c_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line5_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line5_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line5_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line5_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line5_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line6_checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line7_checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line7_checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line7_checkboxes[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line6_checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line6_checkboxes[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line7_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line8_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line8_checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line8_checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line8_checkboxes[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line8_checkboxes[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line9_CaseNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line10_FBIorSIDNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line3_TitleandDivisionOffice[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Line1_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].Pt1Line2a_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].Pt1Line2a_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].Pt1Line2a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].Pt1Line3a_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line3a_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line3a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[0].Pt2Line1_CertifyingAgency[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line2c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line2c_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line2c_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line4a_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line4a_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line4a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line7_Explanation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[10]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[11]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[12]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[13]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[14]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[15]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[16]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[17]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[18]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[19]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[20]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[21]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[22]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[23]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line6_Explanation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line5a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line5a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line3_Citations[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line5b_Explanation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line4b_Explanation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[24]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[25]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[26]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[27]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[28]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[29]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line4a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line4a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_checkboxes[30]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line2a_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line2b_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line2c_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line2d_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line3_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line2_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line2_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line3_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line3_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line1_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line1_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line5_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line1_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line1_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line2_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line2_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line2_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line2_Involvement[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line2_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line3_Involvement[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line3_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line3_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line3_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line4_Involvement[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line4_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line4_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line4_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part5_Line4_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Pt1Line13_ApplicantSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part6_Line3_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].P5_Line4_faxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].pg4[0].Part6_Line2_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Part7_Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Part7_Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Part7_Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Part1_Line1_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line1_CertifyingAgency[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt1Line2a_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt1Line2a_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt1Line2a_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P8_Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P8_Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P8_Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P8_Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P8_Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P8_Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Part7_Line5a_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Part7_Line5a_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Part7_Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-918supb';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-918SUPB', 5, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();

UPDATE public.form_editions SET source_url = 'https://www.uscis.gov/i-918'
  WHERE form_number = 'I-918SUPB' AND source_url IS NULL;
