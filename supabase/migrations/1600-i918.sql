-- Migration 1600-i918: I-918 field map + template registration
--
-- USCIS Form I-918, Petition for U Nonimmigrant Status (for victims of qualifying criminal activity who assist law enforcement). Part 1 is the victim's biographic information; Part 2 is entry history; Parts 3-4 the qualifying-crime and eligibility claim; Part 5 signature. Sensitive form with deliberate SAFE address / SAFE phone fields never auto-filled.
--
-- Source:  uscis-forms/i-918.pdf
-- Edition: 01/20/25 (printed lower-left; title "Petition for U Nonimmigrant Status")
-- SHA-256: d2c19f08b18f2c1679252ea6f9674c7ca7889f727b3ad3ad5ed54776df284042
--
-- 362 fields: 17 data-mapped, 345 deliberately blank.
-- Field inventory: normalized/i-918.fields.json
-- Field semantics: normalized/i-918.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 1 legal name, HOME address, A-number, SSN, USCIS online
--    account, DOB, country of birth, country of citizenship, I-94 number, and
--    place of last entry; Part 5 petitioner daytime phone + email.
--  * Note: several state-dropdown TOOLTIPS on this form are copy-paste errors
--    all reading "Safe Mailing 4.E"; field NAMES disambiguate — P1_Line3d_State
--    is the home-address state (mapped), Line4e/19b are safe/entry (blank).
--  * Left blank on purpose:
--    - SAFE mailing address (item 4), SAFE foreign address (Part 2 item 11-12),
--      and the SAFE/mobile phone (Part 5 item 4) — deliberate victim-safety
--      alternates; auto-filling home data there would defeat the purpose.
--    - City/town of birth — client.place_of_birth is a combined string.
--    - Passport (14), other names (2), Part 2 five-year entry history.
--    - The qualifying-crime claim, victim narrative, and LEA certification —
--      the substance of the petition (hard rule).
--    - Interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-918', 'Form I-918 -- Petition for U Nonimmigrant Status')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-918.pdf',
    field_count  = 362,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].Pt1Line1b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].Pt1Line1a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].Pt1Line1c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].P1_Line4c_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4b_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4d_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4c_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4c_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4c_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4f_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4e_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[0].P1_Line3c_CityTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].P1_Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3e_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].P1_Line4a_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2c_OtherMiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2b_OtherGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2a_OtherFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4i_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4g_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4h_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_checkboxes[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_checkboxes[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].G28_CheckBox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line5_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].P1_Line6_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[0].P1_Line7_USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].P1_Line3d_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].page2[0].P2_Line1_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line1_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line2_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line2_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line3_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line3_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line4_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line4_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line5_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line5_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line6_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P2_Line6_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line15_TravelDoc[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line14_PassportNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line16_CountryOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line12_CountryOfCitizenship[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].page2[0].P1_Line11_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].page2[0].P1_Line22_CurrentImmigration[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line19a_PlaceOfLastEntry[0]": {
    "type": "text",
    "source": "immigration.port_of_entry"
  },
  "form1[0].page2[0].Pt2Line7c_ExclusionCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7b_RemovalCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7e_RescissionCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7f_JudicialProceedingsCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7d_DeportationCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line10_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].page2[0].P1_Line9_checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line9_checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line17_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line18_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line20_DateOfLastEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].P1_Line21_DateOfLastEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7b_DateOfRemoval[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7c_DateOfExclusion[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7d_DateOfDeportation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7e_DateOfRecission[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line7f_DateOfProceedings[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].page2[0].Pt2Line14b_ArrivalDeparture[0]": {
    "type": "text",
    "source": "immigration.i94_number"
  },
  "form1[0].page2[0].Pt1Line19b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Pt2Line10d_StatusOfTimeEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line10b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line9b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Pt2Line9d_StatusOfTimeEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line11a_Checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line11a_Checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line11a_Checkboxes[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line8b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line8d_StatusOfTimeEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line12a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line12b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line12c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line12e_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line12d_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line12f_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line14b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line14b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line14b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line11b_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line11d_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1e_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_1e_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line9a_DateOfEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10a_DateOfEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line8a_DateOfEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line8c_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line9c_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line10c_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line11c_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_1f_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_1f_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line2f_Outcome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line2e_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line2c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line2a_WhyArrested[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_1i_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_1i_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_1g_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_1g_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_1h_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_1h_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line3f_Outcome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line3a_WhyArrested[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line3e_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line3c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_4d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_4d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_4c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_4c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_4b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_4b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_4a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_4a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5e_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_5e_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_6a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_6a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_6b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_6b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line2b_DateOfArrest[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line3b_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line2d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6g_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6g_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6f_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6f_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6e_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6e_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_6d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_7c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_7c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_8_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_8_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_7b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_7b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_7a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_7a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10e_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10e_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10f_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10f_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10g_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10g_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10d_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10d_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_12a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_12a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_12b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_12b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_12c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_12c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_11_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_11_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_9_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_9_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_13a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_13a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_10a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_13c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_13c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_14c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_14c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_14b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_14b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_14a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_14a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_22_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_22_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_21_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_21_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_17_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_17_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_16_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_16_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_15b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_15b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_15a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_15a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_24_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_24_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_25_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_25_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_23_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_23_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_29a_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_29a_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_29b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_29b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_29c_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_29c_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_28_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_28_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_26_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_26_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_27_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_27_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_18_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_18_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_19_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_19_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_20_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_20_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_13b_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P3_13b_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line1a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line1c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line3_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line5_CurrentLocation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line4_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line11a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line11c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line11b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line15_CurrentLocation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line13_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line14_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line6b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line6a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line6c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line8_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line9_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line10_CurrentLocation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line11a_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line11c_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line11b_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line15_CurrentLocation[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line13_CountryOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line14_Relationship[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line6b_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line6a_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line6c_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line8_CountryOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line9_Relationship[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line10_CurrentLocation[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_26_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_26_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line7_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line12_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line12_DateOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P4_Line7_DateOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P5_Line2_Attorney[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P5_Line2_ReqServCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P5_Line1_ReadCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P5_Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P5_Line1_ReadCheckbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].#area[0].P5_Line3_DaytimePhoneNumber3[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[7].P5_Line6_EmailAddress[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[7].#area[1].P5_Line5_SafePhoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P5_Line7a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P6_Line1a_InterpretersFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P6_Line2_IntrpretersBusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P6_Line1b_InterpretersGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P5_Line7b_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_Unit[2]": {
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
  "form1[0].#subform[8].Part7_Line6_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line4_InterpretersDaytimeTelephoneNumber3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line6a_InterpretersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P7_Line1a_PreparersFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P7_Line2_PreparersBusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P7_Line1b_PreparersGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].#area[2].P7_Line4_PreparersDaytimeTelephoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P7_Line6_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].#area[3].P7_Line5_PreparersFaxNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line6b_DateOfSig[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt7Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line7_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line7_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line7_Extend[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line7_Extend[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line8a_InterpretersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line8b_DateOfSig[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt1Line1a_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt1Line1b_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt1Line1c_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P1_Line5_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line6d_AdditionalInfo[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line7c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line7b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line7a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-918';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-918', 11, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
