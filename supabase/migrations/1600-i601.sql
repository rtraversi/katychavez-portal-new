-- Migration 1600-i601: I-601 field map + template registration
--
-- USCIS Form I-601, Application for Waiver of Grounds of Inadmissibility. Part 1 is applicant identity/address; Parts 2-4 cover U.S. entry history and the specific inadmissibility grounds being waived; Parts 5-6 qualifying/other relatives; Part 7 signature. Heavily discretionary — only Part 1 biographic + Part 7 contact autofill.
--
-- Source:  uscis-forms/i-601.pdf
-- Edition: 01/20/25 (printed lower-left; title "Application for Waiver of Grounds of Inadmissibility")
-- SHA-256: cd90303dc9748151ddfce86f44dc3dbce2effa5d293b99d3f974a303e910da86
--
-- 269 fields: 16 data-mapped, 253 deliberately blank.
-- Field inventory: normalized/i-601.fields.json
-- Field semantics: normalized/i-601.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 1 legal name, A-number, USCIS online account, mailing
--    address, DOB, country of birth, country of citizenship, SSN; Part 7
--    applicant daytime/mobile phone + email.
--  * Left blank on purpose:
--    - City/town of birth (11) — client.place_of_birth is a combined string.
--    - Other names used (4), physical address (7, if different from mailing).
--    - Part 2 U.S. entry history, Part 3-4 inadmissibility grounds + the waiver
--      being sought, Part 8-9 statement/discretion — the core legal argument
--      (hard rule: eligibility/narrative/judgment).
--    - Part 5 qualifying relatives and Part 6 other relatives — specific third
--      persons not in our data model; attorney enters.
--    - Part 11 tuberculosis statement — physician-completed.
--    - Additional-info (Part 10) pre-populated repeats — left blank.
--    - Attorney/G-28 fields, interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-601', 'Form I-601 -- Application for Waiver of Grounds of Inadmissibility')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-601.pdf',
    field_count  = 269,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].p1Line4cMiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line4bGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line4aFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line3aFamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].p1Line3bGivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].p1Line3cMiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].p1Line6YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line6YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line5InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line5StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[0].p1Line5Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line5Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line5AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line5Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line5CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].p1Line5Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line5State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[0].p1Line5ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].p1Line5Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line5PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].G28CheckBox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].attyStateBarNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].attyUSCISOnlineNum[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].p1Line2USCISOnlineNum[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].p1Line1ANum[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[1].p1Line16aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line17aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line17aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line16aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line18aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line18aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line18cFilingLocation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line19YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line19YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line18dDateFiled[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line10DateofBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].p1Line9Gender[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line9Gender[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line11CityOrTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line12ProvinceOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line13CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[1].p1Line14CountryOfCitzOrNat[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[1].p1Line15aCaseNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p2Line1aDateEntered[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line7Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line15bCity[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line15bCountry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line1dCityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p2Line1cLocation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p2Line1bImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p2Line2aDateEntered[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line17bReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line18bReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line16bReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].p1Line8SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[2].p2Line2eCityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].p2Line2dLocation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].p4Line1CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p4Line2CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p4Line3CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p4Line4CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line3HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line3HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line4Weight1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line4Weight2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line4Weight3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line1Ethnicity[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line1Ethnicity[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line2Race[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line2Race[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line2Race[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line2Race[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line2Race[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line5EyeColor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line5EyeColor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line5EyeColor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line5EyeColor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line5EyeColor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line5EyeColor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line5EyeColor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line5EyeColor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line5EyeColor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line6HairColor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line6HairColor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line6HairColor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line6HairColor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line6HairColor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line6HairColor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line6HairColor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line6HairColor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p3Line6HairColor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p2Line2cImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].p4Line5CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p4Line6CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p4Line7CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p4Line8CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].p2Line2bDepartureDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line11CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line12CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line16CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line15CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line14CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line13CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line17CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line18CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line18OtherSpecify[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line20CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line21CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line22CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line24CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line23CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line26CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line25CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line27CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line10CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line9CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line19OtherSpecify[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line19CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].p4Line28CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line40Explanation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line33CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line34CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line35CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line36CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line38CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line37CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line39CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line39OtherSpecify[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line30CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line32CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line31CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].p4Line29CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line1aFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line1bGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line1cMiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5VAWACB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line4Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line3DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5AddlRelatives[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line6ImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line8DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line9ApplicantStatement[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p6Line1aFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt6Line1c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line7AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line5Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].p5Line2ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line4Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line5Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line6ImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6OtherRelatives[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line8DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line9ApplicantStatement[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line3DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line2Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p6Line7AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].p7Line1DayPhone[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[6].p7Line3Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[6].p7Line2MobilePhone[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[6].p7Line6DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line6a_SignatureofApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p8Line1bGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p8Line1aFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p8Line2OrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p8Line4MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p8Line5Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p8Line3DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P8Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p8Line7DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p8Line7Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p9Line1aFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p9Line1bGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p9Line2BusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p9Line5Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p9Line3DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p9Line4MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p9Line6aSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].p9Line6bDateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line3dAdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p1Line3aFamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p1Line3bGivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p1Line3cMiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line3aPageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line3bPartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line3cItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line4aPageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line4bPartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line4cItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line4dAdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line5aPageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line5bPartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line5cItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line5dAdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line6dAdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line6aPageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line6bPartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p10Line6cItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].p1Line1ANum[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line1aSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line1bAppDateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line7Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line4Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line4Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line4Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line4AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line4CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line4State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line4ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line5aSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line5bDateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line6DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line8CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line8ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line8StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line8Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line8Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line8AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line8Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line8State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line2Health[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line2Health[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line3NameofHealthDepartment[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line4StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line5cFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].p11Line5dGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line9aSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line9bDateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line10NameofState[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line11CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line11ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line13Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line11StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line11Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line11Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line11AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line11Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line11State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[10].p11Line12DayPhone[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-601';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-601', 11, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
