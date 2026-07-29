-- Migration 1600-i131: I-131 field map + template registration
--
-- USCIS Form I-131, Application for Travel Document / Advance Parole. Part 1 is the application type (advance parole, re-entry permit, refugee travel document, TPS travel, etc.); Part 2 is applicant identity/address; later parts cover proposed travel and the basis for the document; Part 10 signature.
--
-- Source:  uscis-forms/i-131.pdf
-- Edition: 01/20/25 (printed lower-left; title "Application for Travel Documents, Parole Documents, and Arrival/Departure Records")
-- SHA-256: e177bbae35c3df634e7269f1094c93a11c6edf6849fa5fe66fbe3726498d59b5
--
-- 325 fields: 16 data-mapped, 309 deliberately blank.
-- Field inventory: normalized/i-131.fields.json
-- Field semantics: normalized/i-131.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 2 legal name, mailing address, A-number, country of
--    birth, country of citizenship, DOB, SSN, USCIS online account; Part 10
--    applicant daytime/mobile phone + email.
--  * Left blank on purpose:
--    - Class of admission (12) — immigration_status is current status, a
--      different fact; mapping it would be wrong.
--    - Physical address (4, if different from mailing), other names (2), unit
--      type checkboxes.
--    - Part 1 application/document type and all Parts covering proposed travel,
--      trip purpose, time abroad, and the parole basis — case judgment (hard rule).
--    - Interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-131', 'Form I-131 -- Application for Travel Documents, Parole Documents, and Arrival/Departure Records')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-131.pdf',
    field_count  = 325,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].P1[0].G28_Attached[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P1[0].CB_AppType[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P1[0].CB_AppType[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P1[0].CB_AppType[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P1[0].CB_AppType[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P1[0].CB_AppType[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P1[0].P1_Line4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P1[0].P1_Line5A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[10]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5E[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5F[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5G[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5H[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5I[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[11]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5M[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5J[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5K[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5L[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line6A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P2[0].CB_AppType[12]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P2[0].P1_Line5B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].CB_AppType[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line6D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].CB_AppType[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line6E[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line8A_1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].CB_AppType[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line8A_2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].CB_AppType[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].CB_AppType[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].CB_AppType[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line8C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line8B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].CB_AppType[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line6C2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].CB_AppType[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line6C1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].CB_AppType[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line6B_3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line6B_2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P3[0].P1_Line6B_1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].P1_Line12_DateOfAdmission[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].P1_Line10E_1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].P1_Line10E_3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].P1_Line10E_2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].P1_Line10H_2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].P1_Line10H_1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].P1_Line10I[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].CB_AppType[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Part2_Line1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].P4[0].Part2_Line1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].P4[0].Part2_Line1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].P4[0].P1_Line13_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].P1_Line13_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line3_CityTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].P5[0].Part2_Line3_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].P5[0].Part2_Line3_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].P5[0].Part2_Line3_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].P5[0].Part2_Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line4_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line11_USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].P5[0].#area[0].Part2_Line5_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].P5[0].#area[1].Part2_Line10_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].P5[0].Part2_Line8_Gender[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line8_Gender[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line9_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].P5[0].Part2_Line6_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].P5[0].Part2_Line7_CountryOfCitizenshiporNationality[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].P5[0].Part2_Line12_ClassofAdmission[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line13_I94RecordNo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line2_MiddleName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line2_MiddleName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line2_GivenName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line2_FamilyName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line2_GivenName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line2_FamilyName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line2_MiddleName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line2_GivenName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part2_Line2_FamilyName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line16_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line16_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line16_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line17_FamilyName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line17_GivenName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line17_MiddleName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line17_FamilyName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line17_GivenName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line17_MiddleName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line17_FamilyName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line17_GivenName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line17_MiddleName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line18_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line19_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line20_CountryOfCitizenship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line21_DaytimeTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line22_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].ANumber[0].P2_Line23_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line24_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].P2_Line25_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Par2_Line15_eMedicalParoleeID[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P6[0].Part2_Line14_I94ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P2_Line26_ClassofAdmission[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P2_Line27_I94RecordNo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line2_Race_Black[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line2_Race_Hawaiian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line2_Race_American[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line3_HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line3_HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line4_Pound1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line4_Pound2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line4_Pound3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line5_EyeColor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line5_EyeColor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line5_EyeColor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line5_EyeColor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line5_EyeColor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line5_EyeColor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line5_EyeColor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line5_EyeColor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line6_HairColor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line6_HairColor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line6_HairColor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line6_HairColor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line6_HairColor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line6_HairColor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line6_HairColor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line6_HairColor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line6_HairColor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line2_Race_Asian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line2_Race_White[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line1_Ethnicity[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line1_Ethnicity[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P3_Line5_EyeColor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line2c_Disposition[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line2a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line2a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line2b_DateIssued[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line1_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line1_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line3a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line3a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line3b_DateIssued[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line3c_Disposition[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line4_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P7[0].P4_Line4_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6a_Name[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6a_ANumber[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6a_CountryofBirthCitizenship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6a_Terms[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6a_DOB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6a_Gender[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6a_Validity[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6a_Photo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6a_Explanation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6b_ReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line7a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line7a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line7b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line7b_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P5_Line1_Lessthan6[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P5_Line1_6months[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P5_Line1_1to2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P5_Line1_2to3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P5_Line1_3to4[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P5_Line1_morethan[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9a_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9c_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9b_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line2_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line2_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line1_CountryRefugee[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line3b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line3c_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line3c_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line3b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line3a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line3a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line4a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line4b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line5_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line5_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line4b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line4a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line6a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line6a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line6b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line6c_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line4_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line4_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line5_ExpectedLengthTrip[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line2_Purpose[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line1_DateOfDeparture[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line3_ListCountries[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Line4c_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Line4c_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P9_Line1_EAD[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3a_DateOfIntendedArrival[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3b_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line2_ExpectedLengthTripinUS[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Part10_Line4_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Part10_Line4_ApplicantSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Part10_Line1_DayPhone[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[10].Part10_Line2_MobilePhone[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[10].Part10_Line3_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[10].P8_Line1_Explain[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Part11_Line3_DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Part11_Line4_MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Part11_Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Part11_Line6_InterpreterSig[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Part11_Line6_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Part11_Line1_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Part11_Line1_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Part11_Line2_NameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Part12_Line6_PreparerSig[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Part12_Line6_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Part12_Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Part12_Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Part12_Line2_NameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Part12_Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Part12_Line3_DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Part12_Line4_MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part2_Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part2_Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part2_Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Global_ANumber[0].Part2_Line5_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line3_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line3_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line3_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line3_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line4_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line4_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line4_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line4_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line5_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line5_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line5_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line5_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line6_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line6_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line6_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line6_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line7_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line7_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line7_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Part13_Line7_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-131';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-131', 14, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
