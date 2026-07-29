-- Migration 1600-i601a: I-601A field map + template registration
--
-- USCIS Form I-601A, Application for Provisional Unlawful Presence Waiver. Filed by certain immigrant-visa applicants to request a provisional waiver of unlawful presence before departing for their consular interview. Part 1 is applicant identity/address/entry data; Parts 2-5 cover the visa case and waiver basis; Part 6 signature.
--
-- Source:  uscis-forms/i-601a.pdf
-- Edition: 01/20/25 (printed lower-left; title "Application for Provisional Unlawful Presence Waiver")
-- SHA-256: 2cc69b6d1db40ed59972615171ea505f0579250a5b4d81905c7c13440b5b94e4
--
-- 248 fields: 17 data-mapped, 231 deliberately blank.
-- Field inventory: normalized/i-601a.fields.json
-- Field semantics: normalized/i-601a.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 1 A-number, SSN, USCIS online account, legal name,
--    mailing address, DOB, country of birth, country of citizenship, and place
--    of last entry (18A); Part 6 applicant daytime/mobile phone + email.
--  * Left blank on purpose:
--    - City/town of birth (12) — client.place_of_birth is a combined string.
--    - Physical address (9, if different from mailing), other names (5-6).
--    - Parents' names (15-16) — no data column.
--    - Entry state dropdowns (18B/20/23) and previous entries — entry history
--      beyond the single place value we hold; attorney completes.
--    - Part 2 eligibility statement, Part 3 immigrant-visa case + petitioner
--      (family member OR company), Part 4-5 waiver basis / extreme hardship —
--      the legal argument + third-party data (hard rule).
--    - Attorney/G-28, interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-601a', 'Form I-601A -- Application for Provisional Unlawful Presence Waiver')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-601a.pdf',
    field_count  = 248,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].CheckBox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].#area[0].USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].#area[1].Pt1Line2_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[0].#area[2].Pt1Line1_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].#area[3].Pt1Line3_USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].Pt1Line4a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].Pt1Line4b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].Pt1Line4c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].Pt1Line5a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line5b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line5c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line7a_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line7b_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[0].Pt1Line7c_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line7c_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line7c_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line7c_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line7d_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].Pt1Line7f_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].Pt1Line7e_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[0].Pt1Line9c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line9a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line9e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line9d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line9b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line9b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line9b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line9b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line10_Sex[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line10_Sex[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line11_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].Pt1Line12_CityOrTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line19_ImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line18a_PlaceOfEntry[0]": {
    "type": "text",
    "source": "immigration.port_of_entry"
  },
  "form1[0].#subform[1].Pt1Line17_DateOfEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line18b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line13_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[1].Pt1Line14_CountryOfCitizenship[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[1].Pt1Line16b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line16a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line15a_MotherFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line15b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line21a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line21b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line20a_PlaceOfEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line20b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line22_ImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line24a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line24b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line25_ImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Checkbox25_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Checkbox25_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line23b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line23a_PlaceOfEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Checkbox27[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Checkbox27[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Checkbox28[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox28[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox29a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox29a_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].#area[4].Pt1Line29b_ReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox31_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox31_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox32_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox32_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox33_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox33_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox34_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox35_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox34_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox35_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox30a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox30b_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox30b_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox30a_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox30_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Checkbox30_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox36_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox37_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox36_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox37_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38a_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38b_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38b_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38c_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38e_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38e_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38d_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38d_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox38c_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox39a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox39a_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox39b_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox39b_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox40_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox40_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox44_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox44_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox43_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox43_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox42_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox42_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line3_HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line3_HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line4_HeightInches1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line4_HeightInches2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line4_HeightInches3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox2_5[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox2_4[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox2_1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox2_2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox2_3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox5[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox5[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox5[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox5[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox5[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox5[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox5[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox5[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox5[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox6[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox6[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox6[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox6[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox6[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox6[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox6[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox6[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Checkbox6[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox41_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Checkbox41_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line4_Option1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line4_Option2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line4_Option3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line4_Option4[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line4_Option5[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6a_DV_KCCCaseNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line2a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line2b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line2c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].#area[5].Pt3Line3a_USCISReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line3b_CSC_NVCCaseNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line2a_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line2b_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line2c_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line3_CompanyOrOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line1a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line1c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line2d_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line2c_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line2a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line2b_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line3_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line3_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line4a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line4b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line4c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line5d_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line5c_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line5a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line5b_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line1_ApplicantStatement[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Checkbox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Checkbox1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line1b_NameofLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Checkbox2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line5_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[5].Pt6Line3_DaytimeTelephoneNumber[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[5].Pt6Line4_MobileTelephoneNumber[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[6].Pt7Line1b_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line1a_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line2_NameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line5_MobileTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line6_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line4_DaytimeTelephoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6a_SignatureofApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line6_NameOfLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line6a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line7_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line7_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line8a_SignatureofPreparer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line8b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line2_BusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line1a_PreparerFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line1b_PreparerGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line4_DaytimeTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line5_MobileTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line6_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt1Line4a_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt1Line4b_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt1Line4c_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt1Line1_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line7d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line7a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line7b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line7c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-601a';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-601A', 9, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
