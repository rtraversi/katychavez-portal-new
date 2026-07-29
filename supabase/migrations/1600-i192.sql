-- Migration 1600-i192: I-192 field map + template registration
--
-- USCIS Form I-192, Application for Advance Permission to Enter as a Nonimmigrant (waiver of inadmissibility for certain nonimmigrants). Part 1 is the basis for the request; Part 2 is extensive applicant biographic, address, marriage, immigration/criminal, and employment history; Part 3 signature.
--
-- Source:  uscis-forms/i-192.pdf
-- Edition: 01/20/25 (printed lower-left; title "Application for Advance Permission to Enter as a Nonimmigrant")
-- SHA-256: 4a0e88e322862fbed26f6a37f9021e4e518a511796872e534d1b01130e9e90e9
--
-- 194 fields: 14 data-mapped, 180 deliberately blank.
-- Field inventory: normalized/i-192.fields.json
-- Field semantics: normalized/i-192.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 2 legal name, A-number, USCIS online account, DOB,
--    country of citizenship, and current address (item 9); Part 3 applicant
--    daytime/mobile phone + email.
--  * Left blank on purpose:
--    - Place of birth (item 6 is city-only; client.place_of_birth is combined).
--    - Address HISTORY (items 10-11, five years) — mapped only the standalone
--      current address (item 9); history is not in our data model.
--    - Other names (2), marriage/prior-marriage (14-25), immigration/criminal
--      history, employment history (44-45) — no columns / third-party / narrative.
--    - Part 1 basis for the request, and all Part 2 eligibility questions —
--      the legal argument (hard rule).
--    - No SSN field on this form.
--    - Interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-192', 'Form I-192 -- Application for Advance Permission to Enter as a Nonimmigrant')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-192.pdf',
    field_count  = 194,
    edition_date = '01/20/25',
    field_map    = '{
  "FormI-192[0].#subform[0].CheckBox2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[0].VolagNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[0].USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[0].P1_Line1_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[0].P1_Line1_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "FormI-192[0].#subform[1].P2_Line1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "FormI-192[0].#subform[1].P2_Line1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "FormI-192[0].#subform[1].P2_Line2_A_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line2_A_FirstName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line_A_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line2_B_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line2_B_FirstName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line_B_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line3_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "FormI-192[0].#subform[1].P2_Line4_USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "FormI-192[0].#subform[1].P2_Line5_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "FormI-192[0].#subform[1].P2_Line6_CityorTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line6_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line6_CountryOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line7_CountryOfCitizenship[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "FormI-192[0].#subform[1].P2_Line8_Sex[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line8_Sex[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line9_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line9_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "FormI-192[0].#subform[1].P2_Line9_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line9_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line9_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line9_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line9_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "FormI-192[0].#subform[1].P2_Line9_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "FormI-192[0].#subform[1].P2_Line9_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "FormI-192[0].#subform[1].P2_Line9_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line9_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[1].P2_Line9_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line10_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line11_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line12_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line12_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line12_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line12_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line12_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line12_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line12_MaritalStatus[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line12_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line13_TimesMarried[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line14_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line14_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line14_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[2].P2_Line15_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line19_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line19_StateProvince[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line19_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line18_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line18_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line18_StateProvince[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line16_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line17_Marriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line20_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line20_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line20_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line21_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line22_DateOfMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line23_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line23_StateProvince[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line23_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line25_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line25_StateProvince[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line25_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line24_LegalMarriageEndDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[3].P2_Line26_GroundsofInadmissibility[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line29_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line29_StateProvince[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line29_USCISOffPortEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line29_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line28_DateAppFiled[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].ReceiptNumber[0].P2_Line29_ReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line30_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line30_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line31_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line31_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line32_ApplicationorPetitionFiled[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line34_OutcomeApplicationOrPetitionFiled[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line33_LocationAppFiled[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line35_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line35_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line36_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line36_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line27_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[4].P2_Line27_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line42_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line43_Summary[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_EmployerName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line44_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].Occupation[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line37_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line38_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line39_PortOfEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line40_TravelToUS[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[5].P2_Line41_PlanDateEnterUS[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_Occupation[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P3_Line1_DaytimeTelephoneNumber[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "FormI-192[0].#subform[6].P3_Line2_MobileTelephoneNumber[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "FormI-192[0].#subform[6].P3_Line3_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "FormI-192[0].#subform[6].P3_Line4_SignatureofApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P3_Line4_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_EmployerName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "FormI-192[0].#subform[6].P2_Line45_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line6_Iamfluent[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line6_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line6_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P5_Line1_PreparerFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P5_Line1_PreparerGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P5_Line2_BusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P5_Line3_PreparerDaytimeTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line4_PreparerFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P5_Line6_SignatureofPreparer[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P5_Line6_DateOfSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line3_InterpreterDaytimeTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line4_MobileTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line1_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line1_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[7].P4_Line2_BusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P2_Line1_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P2_Line1_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P2_Line1_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].Line3_ANumber[0].P2_Line3_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line3_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line3_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line3_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line3_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line4_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line4_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line4_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line4_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line5_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line5_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line5_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line5_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line6_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line6_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line6_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "FormI-192[0].#subform[8].P6_Line6_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-192';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-192', 9, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
