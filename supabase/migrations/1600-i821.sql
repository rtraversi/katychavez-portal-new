-- Migration 1600-i821: I-821 field map + template registration
--
-- USCIS Form I-821, Application for Temporary Protected Status (TPS). Filed by nationals of a TPS-designated country. Part 2 is applicant identity/address/entry; Parts 3-7 cover eligibility, criminal history, and the TPS basis; Part 8 signature.
--
-- Source:  uscis-forms/i-821.pdf
-- Edition: 01/20/25 (printed lower-left; title "Application for Temporary Protected Status")
-- SHA-256: d6281d7ee4699228744e2cee80590d222d92a6c9e87eb86d657f0cd683ea91d3
--
-- 465 fields: 18 data-mapped, 447 deliberately blank.
-- Field inventory: normalized/i-821.fields.json
-- Field semantics: normalized/i-821.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 2 legal name, U.S. mailing address, A-number, USCIS online
--    account, SSN, DOB, country of birth; Part 8 daytime/mobile phone + email;
--    Part 11 pre-populated name.
--  * Left blank on purpose:
--    - Physical address (6, if different from mailing), other names (2-3), other
--      dates of birth (11), entry info (place/date of last entry).
--    - TPS country designation, eligibility, and the extensive criminal/security
--      questions — case judgment (hard rule).
--    - Interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-821', 'Form I-821 -- Application for Temporary Protected Status')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-821.pdf',
    field_count  = 465,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].Page01[0].G28CheckBox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page01[0].BarNumber_Txt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page01[0].USCISNumber_Txt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page01[0].Part1_Item1_ApplicationType[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page01[0].Part1_Item1_ApplicationType[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page01[0].Part1_Item2_GrantedTPSU[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page01[0].Part1_Item2_GrantedTPSI[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page01[0].Part1_Item3_EADApp[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page01[0].Part1_Item3_EADApp[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page01[0].Part2_Item1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].Page01[0].Part2_Item1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].Page01[0].Part2_Item1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].Page01[0].Part1_TPScountry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item3_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item3_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item2_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item2_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item2_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item4_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item4_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].Page02[0].Part2_Item4_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item4_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item4_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item4_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item4_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].Page02[0].Part2_Item4_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].Page02[0].Part2_Item4_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].Page02[0].Part2_Item5_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item5_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item6_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item6_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item6_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item6_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item6_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item6_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item6_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item6_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].#area[0].Part2_Item8_AcctIdentifier[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].Page02[0].Part2_Item10_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].Page02[0].Part2_Item11_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item11_DateOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item12_Sex[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item12_Sex[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item13_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item14_CountryofBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].Page02[0].Part2_Item17_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item17_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item17_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item17_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item17_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item17_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item17_MaritalStatus[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item17_MaritalStatusOther[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item7_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].Page02[0].Part2_Item9_SocialSecurityNumber[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].Page02[0].Part2_Item15a[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item15b[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item15c[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item15d[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item16a[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item16b[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item16c[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page02[0].Part2_Item16d[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item10_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].P2_Line7_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item19_ImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item20_PortofEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item20_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item20_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item21_AuthorizedPdofStay[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item22_Passport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item23a_AddlPassport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item23b_AddlPassport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item24_CountryofIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item24_PassportExpiration[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item22_Passport[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item25_ImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item25_ImmigrationProceedings[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item25_ImmigrationProceedings[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item27_ProceedingType[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item27_ProceedingType[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item27_ProceedingType[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item28_LocDOJProceedings[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item29_LocFedCtProceedings[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item31a_ProceedingDateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item31b_ProceedingDateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page03[0].Part3_Item1_Ethnicity[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part3_Item1_Ethnicity[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part3_Item2_RaceW[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part3_Item2_RaceA[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part3_Item2_RaceB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part3_Item2_RaceI[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part3_Item2_RaceH[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item31e_Present[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page03[0].Part2_Item22_I94[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item5_Eyecolor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item5_Eyecolor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item5_Eyecolor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item5_Eyecolor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item5_Eyecolor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item5_Eyecolor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item5_Eyecolor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item5_Eyecolor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item5_Eyecolor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item6_Haircolor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item6_Haircolor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item6_Haircolor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item6_Haircolor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item6_Haircolor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item6_Haircolor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item6_Haircolor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item6_Haircolor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part3_Item6_Haircolor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Pt2Line3_HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Pt2Line3_HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Pt2Line4_HeightInches2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Pt2Line4_HeightInches1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Pt2Line4_HeightInches3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].#area[0].Part4_Item1_USCISNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item3_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item3_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item4_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item5_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item6_DateOfMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item7_PlaceofMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item8_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item8_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item8_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item9_TPSY[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item9_TPSN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item10b_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item10c_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item10d_Present[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item10e_IDK[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0]._YesNoDontKnow[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0]._YesNoDontKnow[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0]._YesNoDontKnow[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item2_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page04[0].Page04[0].Part4_Item8_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item2_FSpouseNationalities[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item4_FSpouseDOB[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item5_FSpouseDOD[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item6_MarriageFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item6_MarriageTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item7_MarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item8_YDI[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item8_YDI[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item8_YDI[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item9a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item9b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item9c_Present[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item9d_IDK[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item10_YNI[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item10_YNI[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item10_YNI[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item11_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item11_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item11_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item12_FSpouseNationalities[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item14_FSpouseDOB[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item15_FSpouseDOD[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item16_MarriageFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item16_MarriageTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item17_MarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item18_YNI[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item18_YNI[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item18_YNI[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item19a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item19b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item19c_Present[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item19d_IDK[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item20_YNI[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item20_YNI[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item20_YNI[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item3_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page05[0].Part5_Item13_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].#area[0].Part6_Item2_USCISNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item4_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item5_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item6_ChildTPSFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item6_ChildTPSTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part5_Item7_ChildAppTPS[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part5_Item7_ChildAppTPS[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item8_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item8_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item8_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].#area[1].Part4_Item1_USCISNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item11_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item13_ChildTPSFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item12_ChildTPSTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item14_ChildAppTPS[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item14_ChildAppTPS[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page06[0].Part7_Item1_CountryResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item3_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page06[0].Part6_Item10_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item1_EnterUS[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item1_Travel[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item1_Travel[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item2_CountriesTraveled[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item2_CountriesTraveledFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item2_CountriesTraveledTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item2_ImmigrationStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item2_ImmigrationOffer[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item2_ImmigrationOffer[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item2_DescribeCountries[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item2_DidNotAccept[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item4a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item4a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item4b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page07[0].Part7_Item4b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item4c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item4c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item5a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item5a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item5b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item5b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item5c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item5c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item7a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item7a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item7b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item7b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item7c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item7c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item8_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item8_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9d_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9d_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9e_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item9e_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item11a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item11a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item11b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item11b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item11c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item11c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item11d_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item11d_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item12a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item12a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item12b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item12b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item12c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item12c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item12d_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item12d_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item13a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item13a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item13b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item13b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item13c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page08[0].Part7_Item13c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item17_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item17_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18d_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18d_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18e_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18e_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item18d_YND[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item19_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item19_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item20_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item20_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item21a_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item21a_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item21b_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item21b_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item21c_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item21c_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item22_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item22_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item23_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item23_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item24_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item24_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item25_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item25_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item26_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item26_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item16c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item16c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item16b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item16b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item27_YND[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item27_YND[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29d_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29d_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29e_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item29e_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item14_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item14_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item15_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item15_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item16a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page09[0].Part7_Item16a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item33_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item33_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item34_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item34_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item35_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item35_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item36_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item36_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item37a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item37a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item37b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item37b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38c_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38c_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38d_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38d_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38e_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item38e_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item39a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item39a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item39b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item39b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item40a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item40a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item41_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item41_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part8_Item1_AppStmt[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part8_Item2_Preparer[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part8_Item2_PrepName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page10[0].Part8_Item1_AppStmt[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part8_Item1_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item31a_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item31a_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item31b_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item31b_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item32_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page10[0].Part7_Item32_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item1_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item2_OrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part8_Item6a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part8_Item6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item4_DaytimePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part9_Item5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part10_Item5_MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page11[0].Part8_Item3_DayPhone[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].Page11[0].Part8_Item4_MobilePhone[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].Page11[0].Part8_Item5_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].Page11[0].Part6_Item12_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part9_Item6_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part9_Item6_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item2_OrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item7_PreparerStmt[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item7_PreparerStmt[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item7b_Extend[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item7b_NotExtend[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item8a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item8b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item4_DaytimePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item5_MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page12[0].Part10_Item6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].Part2_Item1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].Page13[0].Part2_Item1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].Page13[0].Part2_Item1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].Page13[0].AI_3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_7a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_7b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_7c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_7d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].AI_6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page13[0].Part2_Item7_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-821';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-821', 13, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
