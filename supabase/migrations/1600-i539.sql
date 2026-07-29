-- Migration 1600-i539: I-539 field map + template registration
--
-- USCIS Form I-539, Application to Extend/Change Nonimmigrant Status. Filed by a nonimmigrant to extend their stay or change to a different nonimmigrant status. Part 1 is applicant biographic/contact/entry data; Parts 2-4 are the application type, processing information, and eligibility questions; Part 5 signature.
--
-- Source:  uscis-forms/i-539.pdf
-- Edition: 08/28/24 (printed lower-left; title "Application to Extend/Change Nonimmigrant Status")
-- SHA-256: 1bc54433340995d37eaba60f6975ee501f4e4e635e1ff63eee8ad3f9ae1bd81f
--
-- 152 fields: 22 data-mapped, 130 deliberately blank.
-- Field inventory: normalized/i-539.fields.json
-- Field semantics: normalized/i-539.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 1 A-number, USCIS online account, legal name, U.S. mailing
--    address (item 4 — the always-required primary address), DOB, country of
--    citizenship (8), country of birth (7), SSN (10), date of last arrival (11)
--    and I-94 number; Part 5 applicant phone/mobile/email; Part 8 pre-populated
--    name + A-number.
--  * Left blank on purpose:
--    - Current physical address (item 6) + "mailing same as physical?" (item 5)
--      — client record holds one address, mapped to mailing; attorney fills item 6
--      only if the physical address differs. Mailing may be a safe address.
--    - Current nonimmigrant status (item 12, dropdown) + its expiration —
--      client_immigration.immigration_status is free text and may not match the
--      dropdown's option values; a wrong status selection is high-risk.
--    - Passport / travel-document number, issuance, expiry — no data column.
--    - Unit type (Apt/Ste/Flr) checkboxes + number — no structured unit field.
--    - Part 2 application type (extend/change/reinstate, dates, school, SEVIS),
--      Part 3 processing info, Part 4 passport-abroad + all "have you EVER"
--      questions — application intent / eligibility / narrative (hard rule).
--    - Attorney/G-28 fields at the top — handled by a separate atty-fields
--      migration, per the established pattern; left blank here.
--    - All signatures & signature dates, interpreter, preparer — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-539', 'Form I-539 -- Application to Extend/Change Nonimmigrant Status')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-539.pdf',
    field_count  = 152,
    edition_date = '08/28/24',
    field_map    = '{
  "form1[0].#subform[0].Pt1Line2_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].Pt1Line2_USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].CheckBox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1Line1a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].P1_Line1b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].P1_Line1c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].Part2_Item11_InCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Item11_StreetName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[0].Part1_Item4_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item4_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item4_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item4_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Item11_City[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].Part2_Item11_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[0].Part2_Item11_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].Part1_Item6_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item6_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item6_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item6_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item6_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item6_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item6_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Item6_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_checkbox5[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_checkbox5[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line8_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].P1_Line7_CountryOfCitizenship[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[1].P1_Line6_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[1].P1_Line9_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[1].SupA_Line1i_DateOfArrival[0]": {
    "type": "text",
    "source": "immigration.last_entry_date",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].SupA_Line1j_ArrivalDeparture[0]": {
    "type": "text",
    "source": "immigration.i94_number"
  },
  "form1[0].#subform[1].SupA_Line1k_Passport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].SupA_Line1l_TravelDoc[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].SupA_Line1m_CountryOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].SupA_Line1n_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line15a_NewStatus[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].SupA_Line1p_DateExpires[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Checkbox12c[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox4[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox4[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line5b_TotalNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line2b_EffectiveDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].SupA_Line1k_Passport[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].SupA_Line1k_Passport[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line2a_NewStatus[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox2a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox2a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line1a_DateExtended[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line5_ReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line4_NameofPetitioner[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox1[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line5_DateFiled[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox4[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox4[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1b_ExpirationDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1a_CountryOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1a_CountryOfIssuance[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_checkbox3_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_checkbox3_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_checkbox5_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_checkbox5_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_checkbox4_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_checkbox4_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line4_NameofPetitioner[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox10_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox10_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox9_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox9_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox8_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox8_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox7_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox7_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox11_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox11_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox14_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox14_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox12_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox12_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox13_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox13_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox19_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox19_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox20_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox20_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox15_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox15_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox16_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox16_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox17_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox17_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox18_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox18_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox6_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox6_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line3_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].P5_Line4_MobilePhoneNumber[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].P5_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[4].P6_Line7_SignatureApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line7_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line1_PreparerFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line1_PreparerGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line2_PreparerNameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line4_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line4_DaytimePhoneNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line6_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line7_SignatureApplicant[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line7_DateofSignature[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line1a_PreparerFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line1b_PreparerGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line2_BusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line6_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line4_PreparerDaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line5_FaxPhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line8a_SignatureofPreparer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line8b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4_A_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4_B_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4_C_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4_D_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5_A_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5_B_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5_C_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5_D_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P1Line1a_FamilyName[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[6].P1_Line1b_GivenName[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[6].P1_Line1c_MiddleName[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[6].P8_Line2_ANumber[0].Pt1Line2_AlienNumber[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[6].P8_Line3_A_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3_B_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3_C_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line6_A_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line6_B_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line6_C_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line6_D_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3_D_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-539';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-539', 7, '08/28/24')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
