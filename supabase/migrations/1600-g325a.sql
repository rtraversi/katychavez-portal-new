-- Migration 1600-g325a: G-325A field map + template registration
--
-- USCIS Form G-325A, Biographic Information (for Deferred Action). Despite the
-- historic "G-325A biographic" name, the current 01/20/25 edition is the
-- biographic form filed WITH a deferred action request: Part 1 collects the
-- requestor's biographic detail (name, address, birth, immigration/entry
-- history, parents, spouse), Part 2 is the deferred action request itself
-- (filing type + supporting statement), Part 3 an optional EAD request, Part 4
-- an optional SSN card request, Parts 5-7 signatures.
--
-- Source:  uscis-forms/g-325a.pdf
-- Edition: 01/20/25 (printed lower-left; title "Biographic Information (for Deferred Action)")
-- SHA-256: d3e6365df1b68fdd07f1151e7a296c70fb1bbdda7d9f5246aeb64cf01b5b4912
--
-- 166 fields: 25 data-mapped, 141 deliberately blank.
-- Field inventory: normalized/g-325a.fields.json
-- Field semantics: normalized/g-325a.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 1 legal name, current PHYSICAL address, DOB, A-number,
--    city/country of birth, country of citizenship (item 10), USCIS online
--    account #, date/location of last entry (13A/13B), I-94 number & expiry
--    (14A/14B); Part 3 current annual income; Part 4 SSN; Part 5 requestor
--    phone/mobile/email; Part 8 name + A-number (pre-populated repeats).
--  * Left blank on purpose:
--    - Mailing/safe address (item 3) — no separate mailing column on client;
--      often intentionally a safe address, so never assume it equals physical.
--    - Other names used, prior 5-year residences, parents, spouse, marriage —
--      no structured data columns; attorney enters.
--    - 13C immigration status AT ENTRY — client_immigration.immigration_status
--      is CURRENT status, a different fact; mapping it would be wrong.
--    - Sex (item 5) — no unambiguous data column (hard rule).
--    - Unit type (Apt/Ste/Flr) checkboxes + number — no structured unit field.
--    - Part 2 deferred-action filing type + supporting statement, Part 3 EAD
--      yes/no + expenses/assets/explanation, Part 4 card yes/no + consent —
--      eligibility/discretion judgment (hard rule).
--    - All signatures & signature dates, interpreter, preparer — hard rule.
--  * Judgment call to verify on review: Part 3 current annual income is mapped
--    from client.gross_annual_income. It is clean data, but it feeds the
--    economic-necessity argument for the EAD — confirm the attorney wants it
--    auto-filled, else set it blank.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('g-325a', 'Form G-325A -- Biographic Information (for Deferred Action)')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/g-325a.pdf',
    field_count  = 166,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#pageSet[0].Page2[0].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#pageSet[0].Page3[0].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#pageSet[0].Page3[1].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#pageSet[0].Page3[2].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#pageSet[0].Page3[3].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#pageSet[0].Page3[4].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].P1_Line1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].P1_Line1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].P1_Line2_CityTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].P1_Line2_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].P1_Line2_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[0].P1_Line2_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[0].P1_Line2_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[0].P1_Line6_Sex[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6_Sex[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line9_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].P1_Line10_MiddleName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line10_FamilyName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line10_GivenName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line10_MiddleName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line10_GivenName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line10_FamilyName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line10_MiddleName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line10_GivenName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line10_FamilyName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_Line6_USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].P1_Line5_CountryOfCitizenship[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[0].P1_Line11_CityCountyOfBirth[0]": {
    "type": "text",
    "source": "client.place_of_birth"
  },
  "form1[0].#subform[0].P1_Line5_CountryOfCitizenship[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row2[0].P1_Line26_StreetandNumber_2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row2[0].P1_Line26_City_1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row2[0].P1_Line26_ProvinceorState_1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row2[0].P1_Line26_ZIPPostalCode_1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row2[0].P1_Line26_Country_1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row2[0].P1_Line26_MonthFrom_1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row2[0].P1_Line26_MonthTo_1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row3[0].P1_Line26_StreetandNumber_2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row3[0].P1_Line26_City_2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row3[0].P1_Line26_ProvinceorState_2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row3[0].P1_Line26_ZIPPostalCode_2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row3[0].P1_Line26_Country_2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row3[0].P1_Line26_MonthFrom_2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row3[0].P1_Line26_MonthTo_2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row4[0].P1_Line26_StreetandNumber_3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row4[0].P1_Line26_City_3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row4[0].P1_Line26_ProvinceorState_3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row4[0].P1_Line26_ZIPPostalCode_3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row4[0].P1_Line26_Country_3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row4[0].P1_Line26_MonthFrom_3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row4[0].P1_Line26_MonthTo_3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row5[0].P1_Line26_StreetandNumber_4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row5[0].P1_Line26_City_4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row5[0].P1_Line26_ProvinceorState_4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row5[0].P1_Line26_ZIPPostalCode_4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row5[0].P1_Line26_Country_4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row5[0].P1_Line26_MonthFrom_4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Table1[0].Row5[0].P1_Line26_MonthTo_4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4_DateOfBirth[1]": {
    "type": "text",
    "source": "immigration.last_entry_date",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].P1_Line4_DateOfBirth[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line5_CountryOfCitizenship[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line5_CountryOfCitizenship[3]": {
    "type": "text",
    "source": "immigration.port_of_entry"
  },
  "form1[0].#subform[1].P1_Line4_DateOfBirth[3]": {
    "type": "text",
    "source": "immigration.i94_expiry",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].P1_Line5_CountryOfCitizenship[4]": {
    "type": "text",
    "source": "immigration.i94_number"
  },
  "form1[0].#subform[1].P1_Line13_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line13_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line14_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line15_CityCountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line16_CityCountryOfResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line16_CityCountryOfResidence[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line13_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line13_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line14_DateOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line16_CityCountryOfResidence[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line15_CityCountryOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line16_CityCountryOfResidence[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line16_CityCountryOfResidence[4]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line16_CityCountryOfResidence[5]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line22_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P1_Line23_CityCountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P1_Line24_DateOfMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P1_Line25_PlaceOfMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P1_Line25_PlaceOfMarriage[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P1_Line25_PlaceOfMarriage[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_2_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_2_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_2_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_2_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_2_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_2_CB[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_2_CB[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Line1a_Purpose[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_2_CB[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P1_Line23_CityCountryOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line2_No1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Line2_Yes1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line2a_AnnualIncome[0]": {
    "type": "text",
    "source": "client.gross_annual_income"
  },
  "form1[0].#subform[4].P3_Line2b_CurrentAnnualExp[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line2c_AssestTotalValue[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line2d_Explanation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P4_CB1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P4_CB1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P4_Line2_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[4].Line2_No1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Line2_Yes1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt12Line6_MobileNumber1[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].Pt12Line7_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[4].Pt12Line5_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].Pt13Line8_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt12Line8_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt13Line1_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt13Line1_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt13Line2_InterpreterBusinessorOrg[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt12Line5_InterpreterMobileTelephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt12Line4_InterpreterDaytimeTelephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt12Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt12_NameofLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt12Line6_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt12Line6_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt13Line1_PreparerGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt13Line2_BusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt13Line1_PreparerFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt13ine5_PreparerFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt13Line4_DaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt13Line6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt12Line6_DateofSignature[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt12Line6_Signature[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line3_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line3_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line3_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Line3_ANumber[0].P1_Line9_AlienNumber[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[6].P1_Line1_GivenName[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[6].P1_Line1_FamilyName[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[6].P1_Line1_MiddleName[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[6].Pt8Line4_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line4_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line4_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line5_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line5_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line5_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line6_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line6_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line6_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line3_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line4_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line5_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt8Line6_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'g-325a';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('G-325A', 6, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
