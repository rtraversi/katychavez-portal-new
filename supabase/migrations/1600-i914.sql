-- Migration 1600-i914: I-914 field map + template registration
--
-- USCIS Form I-914, Application for T Nonimmigrant Status (for victims of a severe form of human trafficking). Part 2 is the victim's general biographic information; Part 3 covers the trafficking claim and law-enforcement cooperation; Parts 4-5 family members; Part 6 signature. Sensitive form — includes deliberate SAFE address / SAFE phone fields that are never auto-filled.
--
-- Source:  uscis-forms/i-914.pdf
-- Edition: 01/20/25 (printed lower-left; title "Application for T Nonimmigrant Status")
-- SHA-256: 7255f04ff3c99649d59c679b7fd4808dfc9c7164a666e00a0bcc27c172bb7226
--
-- 322 fields: 16 data-mapped, 306 deliberately blank.
-- Field inventory: normalized/i-914.fields.json
-- Field semantics: normalized/i-914.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 2 legal name, physical address, A-number, USCIS online
--    account, SSN, DOB, country of citizenship, place of last entry (17), I-94
--    number; Part 6 applicant daytime phone + email.
--  * Left blank on purpose:
--    - SAFE mailing address (item 4) and SAFE daytime telephone (Part 6 item 4)
--      — these are DELIBERATE alternates a trafficking victim provides for their
--      safety; auto-filling the client's home data there would defeat the point.
--    - City/town of birth (11) — client.place_of_birth is a combined string.
--    - Other names used (2).
--    - Law-enforcement agency (Part 3 item 5) — third-party.
--    - The entire trafficking claim, victimization narrative, LEA cooperation,
--      and Parts 4-5 family members — the substance of the case (hard rule).
--    - Interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-914', 'Form I-914 -- Application for T Nonimmigrant Status')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-914.pdf',
    field_count  = 322,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].CheckBox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].CheckBox1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].EACNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].Part2_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].Part2_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].CheckBox2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].OtherNameMiddle1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].OtherNameFirst1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].OtherNameLastName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].OtherNameMiddle2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].OtherNameFirst2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].OtherNameLastName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[0].P1_Line6_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6__AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6_CityTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].P1_Line6_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].P1_Line6_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[0].P1_Line8_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line8_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].TextField1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Male[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Female[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Married[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Divorced[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Widowed[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Single[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part2_Line5_AlienRegistrationNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[1].P3_Line7_USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[1].P3_Line5_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[1].P1_Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].P3_Line8_CityOrTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line9_ProvinceOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line10_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line11_CountryOfCitizenshipOrNationality[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[1].P3_Line12c_PassportorTravDoc[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line11_CountryOfCitizenshipOrNationality[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line12d_DatePassportIssued[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line12d_DatePExp[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line11_CountryOfCitizenshipOrNationality[2]": {
    "type": "text",
    "source": "immigration.port_of_entry"
  },
  "form1[0].#subform[1].P3_Line17_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line18d_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line12b_ArrivalDeparture[0]": {
    "type": "text",
    "source": "immigration.i94_number"
  },
  "form1[0].#subform[1].P3_Line12g_CurrentNon[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Q1_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Q1_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Q2_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Q2_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Q2b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Q2b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q4_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q4_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q5_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q5_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q6_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q6_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q7_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q7_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q8_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q8_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_CaseNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line5_Circumstances[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].DateofEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].PlaceofEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Status[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].ddState[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].Q9_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q9_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q10_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q10_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q11_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q11_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q3_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Q3_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1c_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1c_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1d_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1d_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1e_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1e_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1f_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1f_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1g_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1g_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1h_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1h_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1i_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq1i_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Table6[0].Row1[0].Whywereyouarrestedciteddetainedorcharged[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Table6[0].Row1[0].Dateofarrestcitationdetentioncharge[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Table6[0].Row1[0].Wherewereyouarrestedciteddetainedorcharged[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Table6[0].Row1[0].Outcomeordisposition[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Table6[0].Row2[0].Whywereyouarrestedciteddetainedorcharged[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Table6[0].Row2[0].Dateofarrestcitationdetentioncharge[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Table6[0].Row2[0].Wherewereyouarrestedciteddetainedorcharged[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Table6[0].Row2[0].Outcomeordisposition[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq3a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq3a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq3b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq3b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq3c_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq3c_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq3d_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Dq3d_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4c_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4c_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4d_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4d_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4e_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq4e_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b3_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b3_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b1_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b1_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b2_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b2_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b4_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b4_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b5_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b5_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b6_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq5b6_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq6a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq6a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq6b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq6b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq6c_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq6c_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq7_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq7_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq8_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Dq8_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq9a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq9b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq9b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq9a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq9c_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10c_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10d_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10e_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10f_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11c_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11d_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11e_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11e_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11d_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11c_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq11a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10f_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10e_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10d_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10c_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq10a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq9c_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq12a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq12b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq12b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq12a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq13_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq14_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq15_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq16_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq17_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq17_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq16_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq15_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq14_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq13_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq18_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq18_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq20_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq21_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq21_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq20_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq22_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Dq22_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Dq23a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Dq23b_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Dq23c_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Dq23c_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Dq23b_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Dq23a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].CountryofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].CountryofBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].CountryofBirth[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P1_Line8_State[1]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].CountryofBirth[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].DateofBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].CountryofBirth[4]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].FamilyName[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].GivenName[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].MiddleName[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].CountryofBirth[5]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P1_Line8_State[2]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].DateofBirth[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].CountryofBirth[6]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].CountryofBirth1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].CountryofBirth2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt12Line1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt12Line1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt12Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt12Line2_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt12Line2_RepresentativeName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].FamilyName[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].GivenName[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].MiddleName[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].CountryofBirth[7]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P1_Line8_State[3]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[10].DateofBirth[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].CountryofBirth[8]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt12Line7_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[10].Pt12Line6_MobileNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt12Line5_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[10].CountryofBirth3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt12Line8_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt12Line8_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt13Line2_InterpreterBusinessorOrg[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt13Line1_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt13Line1_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt12Line5_InterpreterMobileTelephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt12Line4_InterpreterDaytimeTelephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt12_NameofLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt12Line6_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt12Line6_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt12Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line2_BusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line1_PreparerGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line1_PreparerFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt13Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt13ine5_PreparerFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt13Line4_DaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt13Line6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt13Line7_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt13Line7_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt13Line7b_extends[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt13Line7b_extends[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt13Line8_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt12Line8_Signature[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt14Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Part2_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Part2_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Part2_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line2b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line2a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line2c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line2d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Part2_Line5_AlienRegistrationNumber[1]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-914';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-914', 12, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
