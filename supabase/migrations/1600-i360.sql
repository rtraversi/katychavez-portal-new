-- Migration 1600-i360: I-360 field map + template registration
--
-- USCIS Form I-360, Petition for Amerasian, Widow(er), or Special Immigrant — covers VAWA self-petitions, Special Immigrant Juvenile (SIJ), widow(er)s of U.S. citizens, and other special-immigrant classifications. Part 1 is the classification; Part 3 is the person the petition is for (the beneficiary / self-petitioner); Part 11 signature.
--
-- Source:  uscis-forms/i-360.pdf
-- Edition: 01/20/25 (printed lower-left; title "Petition for Amerasian, Widow(er), or Special Immigrant")
-- SHA-256: cbe6fa2e031885452459be4870742dc84b6ec337f7c2696c8f2f94e91fbf4f38
--
-- 491 fields: 14 data-mapped, 477 deliberately blank.
-- Field inventory: normalized/i-360.fields.json
-- Field semantics: normalized/i-360.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 3 (person this petition is for = the beneficiary/self-
--    petitioner, i.e. the matter client) legal name, mailing address, DOB,
--    country of birth, SSN, A-number; Part 11 daytime/mobile phone + email.
--  * Assumption: Part 11 petitioner contact is mapped to the client, which is
--    correct for SELF-petitions (VAWA, SIJ) — the common use here. If someone
--    petitions on another's behalf, the attorney adjusts.
--  * Left blank on purpose:
--    - Part 1 classification / petition type — case judgment (hard rule).
--    - Abuser information, SIJ juvenile-court order, widow(er) marriage details,
--      special-immigrant category, and all eligibility narrative — the substance
--      of the petition and third-party data (hard rule).
--    - Safe/alternate mailing address block, interpreter, preparer, signatures.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-360', 'Form I-360 -- Petition for Amerasian, Widow(er), or Special Immigrant')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-360.pdf',
    field_count  = 491,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].Pt1Line2_OnlineAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6_OrganizationName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].#area[1].Pt1Line3_SSN[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].#area[2].Pt1Line4_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CheckBox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line5_IRSTaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[10]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[11]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[12]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[13]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[14]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1[15]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1d1_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1d1_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1p_Describe[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[2].Pt3Line1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[2].Pt3Line1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[2].Pt3Line3_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[2].#area[3].Pt3Line5_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[2].Pt3Line4_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[2].Line3_ANumber[0].Pt3Line6_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[2].Pt3Line7_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line7_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line7_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line7_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line8_DateOfLastArrival[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].#area[5].Pt3Line9_I94[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line10_Passport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line11_TravelDoc[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line15_DateOfExpired[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line13_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line12_CountryOfIssuanceDocument[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line14_CurrentUSCISStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4Line1b_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line1a_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[2].Pt3Line2_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[2].Pt3Line2_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[2].Pt3Line2_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[2].Pt3Line2_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2b_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2b_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2b_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line4b_HowMany[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line4a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line5[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line4a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line3_Sex[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line3_Sex[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line6[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line7[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line5[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line6[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line7[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2a_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2a_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line3_ANumber[1].Pt5Line2_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line2_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line2_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line2_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line2_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line2_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line2_Relationship[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line2b_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line3_ANumber[2].Pt5Line3_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line3_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line3_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line3_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line3_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line3_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line3_ANumber[3].Pt5Line4_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line4_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line4_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line4_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line4_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line4_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line4_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line3_ANumber[4].Pt5Line5_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line5_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line5_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line5_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line5_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line5_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line5_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line3_ANumber[5].Pt5Line6_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line6_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line6_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line6_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line6_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line6_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line6_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line3_ANumber[6].Pt5Line7_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line7_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line7_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line7_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line7_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line7_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line7_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2b_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Line3_ANumber[7].Pt5Line8_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line8_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line8_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line8_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line8_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line8_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line8_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line9_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line9_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line9_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line9_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line9_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line9_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Line3_ANumber[8].Pt5Line10_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line10_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line10_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line10_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line10_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line10_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line10_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line9_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line2a[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line4_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line5_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line3_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line3_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6c_DateofDeath[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6e_WorkTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line6d_DaytimeTelephoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line7b_BranchServiceNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line7a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line7a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line7a[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line7a[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line7a[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line7a[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line4_DateOfDeath[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line3_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line2c_DateofDeath[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6a[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt6Line6b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line5a_USCitizen[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line5b_citizenabroad[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line5d_Other[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line5d_Explain[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line5c_USNaturalized[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Line3_ANumber[9].Pt7Line5c1_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line8b_PlaceOfMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line9b_DateofReMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line8a_DateofMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line9a_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line10[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line10[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line9a_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line7_NumberofSpouseMarriages[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt7Line6_NumberofMarriages[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line1b_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line1b_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line1a_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line1a_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line1a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line2a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line2a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line2b_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line2c[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt8Line2c[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line6a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line6b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line6b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line6a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3a_Specify[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line5[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line4a[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line4a[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line5[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3b_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3A_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3A_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3A_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3A_Checkbox[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line4b_NameOfParent[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line1a_NumberofMembers[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line1b_NumberofEmployees[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line1c_NumberofBeneficiaries[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line1d_NumberofSIRWandNIRW[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line1e_NumberofSIRWPetitions[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt9Line2[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3b_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt8Line3b_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line4_Position[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line4_Summary[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line5_DescribeRelationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6a_Title[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6b_DetailedDescription[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6c_Description[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6d_Description[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_CompanyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6f_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6b[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6b[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line6b[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line3_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line3_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line3_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line3_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt9Line3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line7[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line7[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line7_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line7_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line7_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line7_CheckboxC1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line7_CheckboxC2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line7_CheckboxC3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line7_CheckboxC4[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line8[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line8[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line9[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line9[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line10[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line12[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line13[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line13[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line12[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line11[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line11[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9Line10[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt9_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line16_TitleofSignatory[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line15_EmployerOrOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line17_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line17_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line17_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line17_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line17_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line17_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line17_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_PreparerFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_DaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_ReligiousDenominationName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_DateofSignatureofARRD[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_ARRDSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_RDTitle[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_RDMiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_RDGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_RDFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line15_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line15_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9Line15_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#subform[12].Pt9_PetitioningOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line24_NameofAROWRD[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line25_AROWRDStreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Lne25_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Lne25_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Lne25_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line25_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line25_AROWRDCityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line25_AROWRDState[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line25_AROWRDZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line27_AROWRDPreparerFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line26_AROWRDDaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line28_AROWRDEmail[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line29_AROWRDIRSTaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line4_DateOfDeath[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line3_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Line3_ANumber[10].Pt10Line5d1_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line5e_Explain[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line5_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line5_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line5_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line5_Checkbox[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line5_Checkbox[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line6_NumberofMarriages[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt10Line7_NumberofAbuseMarriages[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Line3_ANumber[11].Pt10Line5c1_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line9_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line9_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line10_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line11_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line11_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line12[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt10Line12[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt11Line1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt11Line1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt11Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt11Line2_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt11Line2_RepresentativeName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt9Line8a_DateOfMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt9Line8b_PlaceOfMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt11Line6_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt11Line6_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt11Line4_MobileNumber1[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[15].Pt11Line5_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[15].Pt11Line3_DaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[15].Pt12Line1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt12Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt12Line1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line8_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line8_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line6_MobileNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line7_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line5_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line2_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line2_RepresentativeName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line3_AuthorizedSignatoryFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line3_AuthorizedSignatoryGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt12Line4_AuthorizedSignatoryTitle[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt12Line5_InterpreterMobileTelephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt12Line4_InterpreterDaytimeTelephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt12_NameofLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt12Line6_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt12Line6_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt12Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line1_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line1_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[17].#subform[18].Pt13Line2_InterpreterBusinessorOrg[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13ine5_PreparerFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line4_DaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt14Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line7_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line7_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line7b_extends[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line7b_extends[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line8_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line1_PreparerGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line2_BusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt13Line1_PreparerFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].Pt12Line8_Signature[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Global_ANumber[0].Pt1Line4_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt14Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt1Line1_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt1Line1_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt1Line1_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-360';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-360', 19, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
