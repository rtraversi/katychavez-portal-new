-- Migration 1600-i914supa: I-914SUPA field map + template registration
--
-- USCIS Form I-914 Supplement A, filed by a T-1 principal (trafficking victim) to apply for a qualifying immediate family member. Part 2 is the principal's information; the remaining parts describe the family member. Edition tracked to the parent I-914 (no standalone page).
--
-- Source:  uscis-forms/i-914supa.pdf
-- Edition: 01/20/25 (printed lower-left; title "Application for Immediate Family Member of T-1 Recipient")
-- SHA-256: 8bef9027af9cf762b2cd2a178b4531bfbf814fb059c41ecfae4a60237aa5e0fd
--
-- 331 fields: 9 data-mapped, 322 deliberately blank.
-- Field inventory: normalized/i-914supa.fields.json
-- Field semantics: normalized/i-914supa.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 2 PRINCIPAL (the matter client) legal name, DOB, A-number;
--    Part 8 pre-populated principal name + A-number.
--  * Left blank on purpose:
--    - ALL family-member fields — generated once, cannot know which member; the
--      principal's data does not belong there. Attorney enters (as with I-539A).
--    - Relationship, family member's biographic/entry data, and eligibility.
--    - Attorney/G-28, interpreter, preparer, all signatures — hard rule.
--  * Edition is the parent I-914's (01/20/25); supplement has no standalone page.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-914supa', 'Form I-914SUPA -- Application for Immediate Family Member of T-1 Recipient')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-914supa.pdf',
    field_count  = 331,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].pAFamilyMember[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].pAFamilyMember[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].pAFamilyMember[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].pAFamilyMember[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].pBFamilyMember[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].pBFamilyMember[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].pBFamilyMember[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].pBFamilyMember[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P2Line4_I914Status[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P2Line4_I914Status[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P2Line4_I914Status[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P2Line1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].P2Line1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].P2Line1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].P2Line3_ANum[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].P2Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[0].MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CheckBox2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].TextField1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Line2_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Line2_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line2_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].InCareOf[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line3_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P1Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4Line4_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4Line4_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4Line4_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4Line4_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4Line4_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt4Line4_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4Line4_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P4Line4_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line8_Sex[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line8_Sex[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line7_SSN[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line6_USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].ANum[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line9_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line9_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line9_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line9_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line1_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Line1_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line1_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Line16_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line9_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Button1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line20B_DateofLastEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line11_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line11_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line11_CityTown[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line11_StateProvince[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line11_Country[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part2Line13_PassportorTravDoc[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part2Line12_CountryOfCitizenship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line16_ExpDate[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line15_IssuedDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line_CountryOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line20_CurrentNon[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].Q1_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Q1_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Line20A_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line20A_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].Line20C_ArrivalDeparture[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line21A_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line21A_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line21A_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Line21B_CityorTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_21c_State_or_ForeignCountry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line11_StateProvince[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line10D_MaririageEnded[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line10D_MaririageEnded[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line10D_MaririageEnded[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P4_Line10D_MaririageEnded[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line21D_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line22B_DateofLastEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line22A_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line22A_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Line22_CurrentNon[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Line22_IssuedDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24B_checkboxB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24C_checkboxC[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24D_checkboxD[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24E_checkboxE[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24A_checkboxA[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24_IssuedDateA[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24_IssuedDateB[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24_IssuedDateC[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24_IssuedDateD[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt4Line24_IssuedDateE[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Q23_yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Q23_no[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Q25[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Q25[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1bYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1bYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1cYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1cYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1dYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1dYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1eYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1eYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1fYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1fYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1gYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1gYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1hYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1hYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1iYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine1iYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row1[0].pEWhyCharged1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row1[0].pEArrestDate1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row1[0].pEWhereCharged1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row1[0].pEOutcome1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[0].pEWhyCharged2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[0].pEArrestDate2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[0].pEWhereCharged2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[0].pEOutcome2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[1].pEWhyCharged3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[1].pEArrestDate3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[1].pEWhereCharged3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[1].pEOutcome3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[2].pEWhyCharged4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[2].pEArrestDate4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[2].pEWhereCharged4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[2].pEOutcome4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[3].pEWhyCharged5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[3].pEArrestDate5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[3].pEWhereCharged5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Table6[0].Row2[3].pEOutcome5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine2aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine2aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine2bYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine2bYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine2cYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine2cYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine2dYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].pELine2dYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3bYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3bYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3cYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3cYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3dYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3dYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3eYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine3eYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b3YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b3YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b1YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b1YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b2YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b2YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b4YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b4YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b6YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b6YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b5YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine4b5YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine5aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine5aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine5bYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine5bYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine5cYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine5cYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine6YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine6YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine7YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].pELine7YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine8aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine8aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine8bYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine8bYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine8cYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine8cYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9bYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9bYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9cYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9cYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9dYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9dYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9eYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9eYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9fYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine9fYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10bYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10bYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10cYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10cYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10eYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10eYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10dYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine10dYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine11aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine11aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine11bYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine11bYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine12YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine12YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine13YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine13YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine14YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine14YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine15YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine15YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine16YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].pELine16YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine17YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine17YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine19YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine19YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine20YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine20YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine21YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine21YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine22aYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine22aYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine22bYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine22bYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine22cYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pELine22cYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pFLine1Interpreter[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pFLine1Interpreter[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pFLine1Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].pFLine2Preparer[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].pFLine2PreparerName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].pFLine5Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].pFLine4MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].pFLine3DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].pFLine6SignatureDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].pFLine6Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].pFDerivateSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].pFDerivateSigDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].pFLine4MobilePhone[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].pFLine3DayPhone[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].pGLine1FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].pGLine1GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].pGLine2OrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine5MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine4DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGNameofLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine7SignatureDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine7Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3AptSteFlr[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3AptSteFlr[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3AptSteFlr[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine3Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pGLine6Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pHLine1GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pHLine2BusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].pHLine1FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine5MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine4DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine6Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine3Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine7PrepStatement[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine7PrepStatement[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine7Extend[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine7Extend[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine8PrepSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].pHLine8PrepSignatureDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P3Line1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[12].P3Line1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[12].P3Line1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[12].P8_Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line5_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].ANum[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  }
}'::jsonb
WHERE form_key = 'i-914supa';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-914SUPA', 12, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();

UPDATE public.form_editions SET source_url = 'https://www.uscis.gov/i-914'
  WHERE form_number = 'I-914SUPA' AND source_url IS NULL;
