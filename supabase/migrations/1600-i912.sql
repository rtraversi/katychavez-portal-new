-- Migration 1600-i912: I-912 field map + template registration
--
-- USCIS Form I-912, Request for Fee Waiver. Filed to request a waiver of USCIS filing fees based on means-tested benefits, household income, or financial hardship. Part 2 identifies the requestor; Parts 3-6 establish the fee-waiver basis (benefits, income, hardship); Part 7 signature.
--
-- Source:  uscis-forms/i-912.pdf
-- Edition: 07/22/25 (printed lower-left; title "Request for Fee Waiver")
-- SHA-256: c5c5f61c9954e812133f702a0edfacd5cb7ff597c703017789de87735bf2c276
--
-- 213 fields: 13 data-mapped, 200 deliberately blank.
-- Field inventory: normalized/i-912.fields.json
-- Field semantics: normalized/i-912.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 2 requestor legal name, A-number, USCIS online account,
--    DOB, SSN; Part 7 daytime/mobile phone + email; Part 10 pre-populated name.
--  * Left blank on purpose:
--    - No requestor mailing address on this form (it references the underlying
--      applications), so none is mapped.
--    - Other names used (item 3).
--    - Parts 3-6 fee-waiver basis: means-tested benefits, household size and
--      income, employment, dependents, and financial-hardship narrative — the
--      entire substance of the request and third-party/household data (hard rule).
--    - Interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-912', 'Form I-912 -- Request for Fee Waiver')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-912.pdf',
    field_count  = 213,
    edition_date = '07/22/25',
    field_map    = '{
  "form1[0].#subform[0].P1_Line1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Line7a_Check_box[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Line7a_Check_box[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Line7a_Check_box[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Line7a_Check_box[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Line7a_Check_box[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Line7a_Check_box[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_L2_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].P2_L2_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].P2_L2_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].P2_L3_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_L3_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_L3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_3_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_3_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_Line3_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].P2_Line4_AcctIdentifier[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].P1_ImmStatus[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_7_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_7_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_7_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_7_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_7_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_7_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_Name1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_Name2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_Name3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_Name4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_DateofBirth2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_DateofBirth3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_DateofBirth4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_DateofBirth1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line2b_DateofBirth2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line2c_DateofBirth3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line2d_DateofBirth4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line2a_RelationshipToYou1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line1_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line1_AlienNumber2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line1_AlienNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line1_AlienNumber4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_FormsFiled4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_FormsFiled3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_FormsFiled2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_TotalForms[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part3_Line1_FormsFiled1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_TypeofBene1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_TypeofBene2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_TypeofBene3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_TypeofBene4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_FullName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_FullName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_FullName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_FullName4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Relationship1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Relationship2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Relationship3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Relationship4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Agency1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Agency2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Agency3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Agency4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_ExpDate1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_ExpDate2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_ExpDate3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_ExpDate4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_DateAward1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_DateAward2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_DateAward3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_DateAward4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part2_Line7_OtherText[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_7_MaritalStatus[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_5_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].P2_Line6_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[1].Part4_Line1_TypeofBene1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_TypeofBene2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_TypeofBene3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_TypeofBene4[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_FullName1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_FullName2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_FullName3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_FullName4[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Relationship1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Relationship2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Relationship3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Relationship4[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Agency1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Agency2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Agency3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_Agency4[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_ExpDate1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_ExpDate2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_ExpDate3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_ExpDate4[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_DateAward1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_DateAward2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_DateAward3[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Part4_Line1_DateAward4[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P5_1_EmploymentStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P5_1_EmploymentStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P5_1_EmploymentStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part3_Line3_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P5_1_EmploymentStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].#area[0].Part5_Line2_chbxyesno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].#area[0].Part5_Line2_chbxyesno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P5_2a_DateOfUnemployment[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].MonthlyIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part5_Line3_TotalHouseSize[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part5_Line4_TotalHousehold[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part5_Line5_NameHousehold[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].AvgHousehold[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Total[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].#area[1].Part5_Line9_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].#area[1].Part5_Line9_checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part5_Line9_Explanation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part6_Line1_Situation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Assets1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Assets2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Assets3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].TotalAssets[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part7_Line2a_TypeOfAsset[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part7_Line2b_TypeOfAsset[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part7_Line2c_TypeOfAsset[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Checkbox[10]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P6_Line3_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part6_Line3_Total[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Button1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_L2_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_L2_chbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_L1_chbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_L1B_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_L1_chbx[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_L4_MobileTelePhoneNumber1[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].P7_L3_DaytimeTelePhoneNumber1[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].P7_L5_EmailAddress[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[4].P3_L2a_ApplicantsSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_L6_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L4_DaytimeTelePhoneNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L5_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P10_L6a_InterpretersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L6b_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L3c_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L3e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L3A_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L3B_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_LB_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_LB_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_LB_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L3f_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L3g_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L1A_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L1B_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L2_BusOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P9_L4_DaytimeTelePhoneNumber1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L7_chbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L7_chbx[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L7B_chbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3c_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3f_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L3g_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L6_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L4_DaytimeTelePhoneNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L5_FaxNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L7B_chbx[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L1A_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L2_BusOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P11_L2_InterpretersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P10_L8B_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P2_L2_MiddleName[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[7].P2_L2_GivenName[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[7].P2_L2_FamilyName[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[7].Part12_Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part12_Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part11_Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P2_Line3_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-912';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-912', 8, '07/22/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
