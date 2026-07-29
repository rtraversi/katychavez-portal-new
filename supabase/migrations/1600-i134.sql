-- Migration 1600-i134: I-134 field map + template registration
--
-- USCIS Form I-134, Declaration of Financial Support. Part 2 is the individual agreeing to financially support the beneficiary (the sponsor); Part 3 is the beneficiary; Parts 4-6 are the sponsor's financial information and signature. Follows the I-864 convention: sponsor -> petitioner.*, beneficiary -> client.*.
--
-- Source:  uscis-forms/i-134.pdf
-- Edition: 01/20/25 (printed lower-left; title "Declaration of Financial Support")
-- SHA-256: e887f9dbb4660ff9eec47d740c00358e45fcfb9c04a9776d8d95cda2e7a5e0d8
--
-- 240 fields: 13 data-mapped, 227 deliberately blank.
-- Field inventory: normalized/i-134.fields.json
-- Field semantics: normalized/i-134.tooltips.tsv
--
-- Mapping decisions:
--  * Convention (matches I-864): the sponsor (Part 2) is the primary opposing
--    party (petitioner.*); the beneficiary (Part 3) is the matter client
--    (client.*). If petitioner.* is unpopulated (e.g. parole/visitor context
--    with no immigration petitioner), the sponsor fields simply stay blank.
--  * Autofilled Part 2 (sponsor): name, mailing address, DOB, A-number.
--  * Autofilled Part 3 (beneficiary/client): name, DOB, A-number.
--  * Left blank on purpose:
--    - Place of birth (combined string), physical address, other names.
--    - Part 2 Financial Information (income, assets, dependents table) and the
--      entire support declaration — the substance (hard rule).
--    - Interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-134', 'Form I-134 -- Declaration of Financial Support')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-134.pdf',
    field_count  = 240,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].Pt3Line17[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt3Line17[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_MiddleName[0]": {
    "type": "text",
    "source": "petitioner.middle_name"
  },
  "form1[0].#subform[0].Pt1Line1_GivenName[0]": {
    "type": "text",
    "source": "petitioner.first_name"
  },
  "form1[0].#subform[0].Pt1Line1_FamilyName[0]": {
    "type": "text",
    "source": "petitioner.last_name"
  },
  "form1[0].#subform[0].P1_Line3_MiddleName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_GivenName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_FamilyName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_MiddleName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_GivenName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3_FamilyName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Item11_InCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Item11_StreetName[0]": {
    "type": "text",
    "source": "petitioner.address_line1"
  },
  "form1[0].#subform[0].Part2_Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Line3_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Item11_City[0]": {
    "type": "text",
    "source": "petitioner.city"
  },
  "form1[0].#subform[0].Part2_Item11_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Item11_ZipCode[0]": {
    "type": "text",
    "source": "petitioner.zip"
  },
  "form1[0].#subform[0].Part2_Item11_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Item11_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part2_Item11_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2_Line4_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2_Line4_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Item11_InCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Item11_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Line5_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Line5_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Line5_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Line5_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Item11_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Item11_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Item11_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Item11_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Item11_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].sfPhysicalAddress[0].Part2_Item11_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].#area[0].P2_Line8_DateOfBirth[0]": {
    "type": "text",
    "source": "petitioner.dob",
    "transform": "date_slash"
  },
  "form1[0].PG2[0].Part2_Item6_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].Part2_Item6_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].Part2_Item6_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].Pt1Line5_AlienNumber[0]": {
    "type": "text",
    "source": "petitioner.a_number",
    "transform": "a_number"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line10_ImmigrationStatus[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].P3_Line10_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].Pt1Line10_OnlineAccountNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].P2_Line11_Beneficiary[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].StatusEmployment_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].EmploymentType[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].NameOfEmployer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].StatusEmployment_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].SelfEmploymentType[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].PG2[0].StatusEmployment_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].StatusEmployment_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].StatusEmployment_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].PG2[0].OtherEmployment[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row1_FullName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row1_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row1_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].P2_Line15_Row1_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row1_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row2_FullName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row2_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].P2_Line15_Row2_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row2_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row3_FullName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row3_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row3_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].P2_Line15_Row3_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row3_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row4_FullName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row4_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row4_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].P2_Line15_Row4_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row4_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row5_FullName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row5_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row5_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].P2_Line15_Row5_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row5_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row6_FullName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row6_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row6_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].P2_Line15_Row6_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row6_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row7_FullName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row7_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row7_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].P2_Line15_Row7_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row7_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row8_FullName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row8_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row8_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].P2_Line15_Row8_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row8_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row9_FullName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row9_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row9_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].P2_Line15_Row9_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].#subform[0].Pt2_Line15_Row9_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line116_Annual[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line1Cell1_TypeofAssetDropDownList[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line1Cell1_Amount[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line2Cell2_TypeofAssetDropDownList[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line2Cell2_Amount[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line3Cell3_TypeofAssetDropDownList[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line3Cell3_Amount[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line4Cell4_TypeofAssetDropDownList[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line4Cell4_Amount[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line5Cell5_TypeofAssetDropDownList[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line5Cell5_Amount[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line6Cell6_TypeofAssetDropDownList[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line6Cell6_Amount[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].Pt3Line9Cell9_Total[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].P3_Line14[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P3[0].P3_Line13[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].Pt3Line1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].P8[0].Pt3Line1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].P8[0].P1_Line3_MiddleName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].P1_Line3_GivenName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].P1_Line3_FamilyName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].P1_Line3_MiddleName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].P1_Line3_GivenName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].P1_Line3_FamilyName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].#area[0].P2_Line8_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].P8[0].Pt3_Line4_Sex_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P8[0].Pt3_Line4_Sex_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P8[0].Pt3Line5_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].P8[0].P2_Line8_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].Part2_Item6_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].Part2_Item6_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].Part2_Item6_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].Pt4Line1b_language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P8[0].Pt2_Line18_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P8[0].Pt2_Line18_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P8[0].Pt3Line1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].P4[0].Pt3_Line8_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line8_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line8_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line8_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line8_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line8_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line8_MaritalStatus[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line8_MaritalStatusOther[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].P2_Line10_InCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].Pt2_Line10_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].Pt2Line10_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].Pt2Line10_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].P2_Line10_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].P2_Line10_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].P2_Line10_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].P2_Line10_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].P2_Line10_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].Pt2Line10_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].Pt2Line10_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].sfPhysicalAddress[0].Pt2Line10_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line12_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Pt2Line12_Date[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line12_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Pt2Line12_NoDate[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line10_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Pt3_Line10_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Part2_Item11_InCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Part2_Item11_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Part3_Item9_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Part3_Item9_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Part3_Item9_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P4[0].Part3_Item9_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Part2_Item11_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Part2_Item11_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].P4[0].Part2_Item11_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Part2_Item11_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Part2_Item11_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P4[0].Part2_Item11_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].P8_Line6_Sign[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].P8_Line6_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part4_Line4_SafePhoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part4_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part4_Line3_DaytimePhoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Pt4Line1b_language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Pt4Line1a_Checkboxa[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Pt4Line1b_Checkboxb[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P5[0].Pt4Line2_RepresentativeName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P5[0].Part4_Line2_ReqServCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P9[0].Part4_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P9[0].Part4_Line4_SafePhoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P9[0].Part4_Line3_DaytimePhoneNumber3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P9[0].Part4_Line2_ReqServCheckbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P9[0].Pt5_Line2_RepresentativeName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P9[0].Pt5_Line1_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P9[0].Pt5_Line1b_language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P9[0].Pt5_Line1_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].P10[0].Pt6Line1_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].Pt6Line1_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].Pt6Line2_BusinessOrOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].P3_Line4_DaytimeTelePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].P3_Line5_MobileTelePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].P3_Line6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].P4_Line6_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].P12_SignatureApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].P13_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].P8_Line6_Sign[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P10[0].P8_Line6_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P11[0].Pt7Line8_SignatureofPreparer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P11[0].Pt7Line8_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P11[0].P4_Line1_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P11[0].P4_Line1_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P11[0].P4_Line2_NameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P11[0].Pt7Line4_DaytimeTelephoneNum[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P11[0].Pt7Line3_MobileTelephoneNum[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P11[0].Pt7Line6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Line3_ANumber[0].Pt1Line5_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt1Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt1Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt1Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line4a_PageNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line4b_PartNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line4c_ItemNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line4a_PageNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line4b_PartNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line4c_ItemNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line3d_AdditionalInfo[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line3d_AdditionalInfo[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].P13[0].Pt9Line3d_AdditionalInfo[3]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-134';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-134', 10, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
