-- Migration 1600-i918supa: I-918SUPA field map + template registration
--
-- USCIS Form I-918 Supplement A, filed by a U-1 principal to petition for a qualifying derivative family member (spouse, child, parent, or sibling). Part 2 is the principal's information; the remaining parts describe the derivative family member. Edition tracked to the parent I-918 (no standalone page).
--
-- Source:  uscis-forms/i-918supa.pdf
-- Edition: 01/20/25 (printed lower-left; title "Petition for Qualifying Family Member of U-1 Recipient")
-- SHA-256: d6a7bfb53958be03f5fa41c2524d7749cc5c89eade1f2dd36717c478c246d7b7
--
-- 356 fields: 10 data-mapped, 346 deliberately blank.
-- Field inventory: normalized/i-918supa.fields.json
-- Field semantics: normalized/i-918supa.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 2 PRINCIPAL (the matter client) legal name, DOB, A-number,
--    USCIS online account; Part 11 pre-populated principal name + A-number.
--  * Left blank on purpose:
--    - ALL derivative family-member fields (name, DOB, relationship, address,
--      entry, eligibility) — the form generates once and cannot know which family
--      member; the principal's data does not belong there. Attorney enters per
--      derivative. Same rationale as I-539A.
--    - Part 6 the family member's own spouse/children.
--    - Attorney/G-28, interpreter, preparer, all signatures — hard rule.
--  * Edition is the parent I-918's (01/20/25); supplement has no standalone page.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-918supa', 'Form I-918SUPA -- Petition for Qualifying Family Member of U-1 Recipient')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-918supa.pdf',
    field_count  = 356,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].G28_CheckBox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Line1_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Line1_checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Line1_checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Line1_checkbox[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line5_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line5_checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line3b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].Pt1Line1b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].Pt1Line1a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].Part2_Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[0].Part2_Line3_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].P2_Line4_USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].Pt3Line1c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line1a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line3c_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line3e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line15_TravelDoc[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line14_PassportNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1d_CurrentImmigration[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line2b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line2e_StatusOfEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line11_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line11_checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line11_checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line11_checkbox[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line12_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line12_checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1a_DateOfLastEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line2a_DateOfLastEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line4c_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4b_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4d_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line4c_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line4c_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line4c_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4f_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4a_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4i_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4g_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4h_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line5_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line6_SSN[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line7_USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line8_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line3h_CountryofCiti[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line13_PrincipalAlienI-94[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line16_CountryOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line17_DateofIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_LinePart3_Line18_ExpDateforPassport10_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line2d_DateOfAuthStay[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4e_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt4Line1c_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt4Line2c_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].UsenamePart4_Line9_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].UsenamePart4_Line9_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line3a_Checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line3a_Checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line3a_Checkboxes[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line3b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line7f_HowMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line7e_WhereMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line4e_WhereMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line4f_HowMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line3d_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P1_Line4c_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P1_Line4b_StreetNumberName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P1_Line4c_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P1_Line4c_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P1_Line4c_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P1_Line4i_Country[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P1_Line4g_Province[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P1_Line4h_PostalCode[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line5c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line1a_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line1a_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line1a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line6d_DateMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line6a_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line6a_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line6a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Line7d_DateMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7c_ExclusionCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7b_RemovalCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7e_RescissionCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7f_JudicialProceedingsCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7d_DeportationCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7b_DateOfRemoval[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7c_DateOfExclusion[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7d_DateOfDeportation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7e_DateOfRecission[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7f_DateOfProceedings[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line3c_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1e_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1e_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1f_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1f_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1i_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1i_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1g_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1g_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1h_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line1h_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line2f_Outcome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line2e_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line2c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_3f_Outcome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line3a_WhyArrested[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line3e_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line3c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line2a_WhyArrested[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line2b_DateOfArrest[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5_Line3b_DateOfArrest[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line2d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6e_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6e_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line6b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line5d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line5d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line5c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line5c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line5b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line5b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line5a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line5a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line8c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line8c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line9_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line9_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line8b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line8b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line8a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line8a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7g_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7g_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7f_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7f_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7e_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7e_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5_Line7d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line10_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line10_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line13a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line13a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line13b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line13b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line13c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line13c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line12_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line12_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11e_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11e_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11f_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11f_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11g_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11g_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line11b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line14a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line14a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line14b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line14b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line14c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line14c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line18_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line18_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line17_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line17_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line16b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line16b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line16a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line16a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line15c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line15c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line15b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line15b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line15a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Part5_Line15a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line23_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line23_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line22_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line22_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line30a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line30a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line30b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line30b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line30c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line30c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line27_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line27_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line28_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line28_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line29_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line29_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line24_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line24_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line20_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line20_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line21_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line21_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line19_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line19_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line11_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line12_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line8_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line7_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line4_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line26_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line26_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line25_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part5_Line25_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line1c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line1a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line3_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line5c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line5b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line5a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line9c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line9b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line9a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line10_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Part6_Line6_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Line1_ReadCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Line1_ReadCheckbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Line2_Attorney[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Line2_ReqServCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Line6_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Lnine7a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part8_Line1_ReadCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Part8_Line1_ReadCheckbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Part8_Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part8_Line2_Attorney[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part8_Line2_ReqServCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Line3_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Line5_MobilePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part7_Lnine7b_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Part8_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Part8_Line6a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Part8_Line3_DaytimePhoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Part8_Line4_MobilePhoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Part8_Line6b_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt1LinPart9_Line1b_InterpretersGivenNamee1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Part9_Line1a_InterpretersFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Part9_Line2_IntrpretersBusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line4_InterpretersDaytimeTelephoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line4_InterpretersDaytimeTelephoneNumber3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].Part9_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Part10_Line7_Attorney[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Part10_Line7_Attorney[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Part10_Line7b_Extend[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Part10_Line7b_Extend[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line6a_InterpretersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line6b_DateOfSig[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line1a_PreparersFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line2_PreparersBusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line1b_PreparersGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].#area[0].P7_Line4_PreparersDaytimeTelephoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line6_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].#area[1].P7_Line5_PreparersFaxNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt10Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[10].#subform[11].P7_Line8a_InterpretersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].#subform[11].P7_Line8b_DateOfSig[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt1Line1c_MiddleName[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[12].Pt1Line1a_FamilyName[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[12].Pt1Line1b_GivenName[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[12].Part2_Line3_AlienNumber[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[12].P8_Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line6d_AdditionalInfo[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line7c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line7b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line7a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-918supa';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-918SUPA', 12, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();

UPDATE public.form_editions SET source_url = 'https://www.uscis.gov/i-918'
  WHERE form_number = 'I-918SUPA' AND source_url IS NULL;
