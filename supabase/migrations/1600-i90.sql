-- Migration 1600-i90: I-90 field map + template registration
--
-- USCIS Form I-90, Application to Replace Permanent Resident Card (green card renewal/replacement). Part 1 is applicant identity/address/biographic data; Part 2 is the application reason; Part 3 processing + biometric description; Part 5 signature.
--
-- Source:  uscis-forms/i-90.pdf
-- Edition: 01/20/25 (printed lower-left; title "Application to Replace Permanent Resident Card")
-- SHA-256: fd436062284fd572224509e0e17a795f915734f7e7c0fca8a161d0a9976f83a0
--
-- 188 fields: 19 data-mapped, 169 deliberately blank.
-- Field inventory: normalized/i-90.fields.json
-- Field semantics: normalized/i-90.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 1 current legal name (card is issued in this name),
--    A-number, USCIS online account, mailing address, DOB, country of birth,
--    SSN; Part 5 applicant phone/mobile/email; Part 8 pre-populated name + A#.
--  * Left blank on purpose:
--    - City/town of birth (item 10) — client.place_of_birth is a combined
--      "city, country" string; only country (item 11) is cleanly separable.
--    - Physical address (item 7, only if different from mailing) — one address
--      on file, mapped to mailing; mailing country/province left to attorney.
--    - Previous name on card (item 5) — only if the name legally changed.
--    - Date of admission (15) / class of admission (14) — no LPR-admission
--      column; last_entry_date and immigration_status are different facts.
--    - Sex (8), mother's/father's name (12/13) — no data column (hard rule).
--    - Part 2 status + reason for application — case judgment (hard rule).
--    - Part 3 biometrics (height, weight, eye/hair color, race, ethnicity) and
--      processing questions — biometrics + judgment (hard rule).
--    - Part 4 accommodations, Part 6 interpreter, Part 7 preparer — blank.
--    - All signatures & signature dates — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-90', 'Form I-90 -- Application to Replace Permanent Resident Card')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-90.pdf',
    field_count  = 188,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].P1_Line3a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].P1_Line3b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].P1_Line3c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].P1_checkbox4[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_checkbox4[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_checkbox4[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6a_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6b_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[0].P1_Line6c_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6d_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].P1_Line6h_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line6f_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].P1_Line6e_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[0].P1_Line6i_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line5a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line5b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line5c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2_AcctIdentifier[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].P1_Line6g_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].#area[1].P1_Line1_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].P1_checkbox6c_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_checkbox6c_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_checkbox6c_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line7a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line7c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line7e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line7b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line7h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line7g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line7f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_checkbox7b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_checkbox7b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_checkbox7b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line7d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line9_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].P1_Line10_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line11_CountryofBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[1].P1_Line16_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[1].P1_Line15_DateOfAdmission[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line14_ClassOfAdmission[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line12_MotherGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line13_FatherGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line8_male[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line8_female[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox1[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[10]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_checkbox2[11]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line2h1_CityandState[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line1_LocationAppliedVisa[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line2_LocationIssuedVisa[0]": {
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
  "form1[0].#subform[2].P3_checkbox5[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox5[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line8_HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line8_HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_checkbox3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_checkbox3[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_checkbox3[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_checkbox3[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_checkbox3[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line9_HeightInches1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line9_HeightInches2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line9_HeightInches3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox6[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox6[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox7_Hawaiian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox7_Indian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox7_White[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox7_Asian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox7_Black[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox10[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox10[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox10[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox10[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox10[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox10[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox10[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox10[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox10[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line3a1_CityandState[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line3a_Destination[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox11[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox11[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox11[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox11[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox11[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox11[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox11[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox11[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_checkbox11[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_checkbox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_checkbox1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_checkbox1a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line1a_AccomodationRequested[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox1b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line1b_AccomodationRequested[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_checkbox1c[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line1c_AccomodationRequested[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Checkbox1b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Checkbox1a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Checkbox2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line2_NameofRepresentative[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[3].P5_Line3_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[3].P5_Line4_MobilePhoneNumber[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[3].P5_Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P5_Line6a_SignatureofApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line1b_InterpretersGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line1a_InterpretersFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line2_NameofBusinessor[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3c_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_checkbox3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_checkbox3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_checkbox3b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line5_InterpretersEmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line4_InterpretersDaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line4_InterpretersDaytimePhoneNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line6a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line1a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line1b_PreparersGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line2_NameofBusinessor[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line3c_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line3e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_checkbox3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_checkbox3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_checkbox3b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line6_PreparersEmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line4_PreparersDaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line5_PreparersFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_checkbox7[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_checkbox7[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_checkbox7Extend[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_checkbox7Extend[1]": {
    "type": "checkbox",
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
  "form1[0].#subform[6].P8_Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P1_Line3a_FamilyName[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[6].P1_Line3b_GivenName[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[6].P1_Line3c_MiddleName[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[6].P8_Line5a_PageNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5b_PartNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5c_ItemNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5d_AdditionalInfo[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5a_PageNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5b_PartNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5c_ItemNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5d_AdditionalInfo[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].#area[3].P1_Line1_AlienNumber[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  }
}'::jsonb
WHERE form_key = 'i-90';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-90', 7, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
