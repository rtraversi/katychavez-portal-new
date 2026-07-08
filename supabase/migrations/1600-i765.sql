-- Migration 1600-i765: I-765 field map + template registration
--
-- Application for Employment Authorization, DACA renewal defaults.
-- Sources verified against per-field tooltips (i-765-tooltips.txt). Notable:
--   - Part1_Checkbox[2] = "Renewal of my permission to accept employment"
--     (package-wide literal for a DACA Renewal package).
--   - Line19_Checkbox[1] = item 12 "previously filed I-765? Yes" -- a renewal
--     by definition means a prior filing, safe package-wide literal.
--   - Eligibility category item 27 = (c)(33) for DACA: section_1='c',
--     section_2='33' (parentheses are pre-printed on the form).
--   - The "Pt5Line3_*" address block belongs to the INTERPRETER (Part 4) and
--     "Pt6Line3_*" belongs to the PREPARER (Part 5) -- inverted from their
--     name prefixes; verified via tooltips. Preparer block = attorney/firm.
--   - Unit checkbox index order differs per address block (tooltip-verified):
--     Pt2Line5/Pt2Line7: [0]=Ste [1]=Flr [2]=Apt; Pt6Line3: [0]=Flr [1]=Apt [2]=Ste.
--   - All attestations (Part 3 statement), gender, marital status, physical-
--     address-same question, interpreter fields, signatures and dates of
--     signature stay blank for attorney review.
--
-- 154 map entries (48 data-mapped, 106 deliberately blank);
-- 7 XFA barcode field(s) omitted. Field inventory: normalized/i-765.fields.json.
-- Requires the a_number/unit_*/digits/yes_no_invert transforms shipped in
-- functions/api/_form-fill.js alongside migration 1600-g28.

UPDATE public.form_templates
SET r2_key      = 'form-templates/i-765.pdf',
    field_count = 161,
    field_map   = '{
  "form1[0].Page1[0].Line1a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].Page1[0].Line1b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].Page1[0].Line1c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].Page1[0].Part1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page1[0].Part1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page1[0].Part1_Checkbox[2]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].Page1[0].Line2a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page1[0].Line2b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page1[0].Line2c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page1[0].Line3c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page1[0].Line3b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page1[0].Line3a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page1[0].Line3a_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page1[0].Line3b_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page1[0].Line3c_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page1[0].Attorney-Rep[0].CheckBox1[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].Page1[0].Attorney-Rep[0].attorneyBarNumber[0]": {
    "type": "text",
    "source": "attorney.bar_number"
  },
  "form1[0].Page1[0].Attorney-Rep[0].USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page2[0].Part2Line5_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Part2Line5_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Pt2Line7_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Pt2Line7_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Pt2Line7_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page2[0].Pt2Line7_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Pt2Line7_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page2[0].Pt2Line7_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page2[0].Pt2Line7_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page2[0].Pt2Line7_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page2[0].Line17b_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page2[0].Line17a_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].Page2[0].Line12b_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full",
    "transform": "digits"
  },
  "form1[0].Page2[0].Pt2Line5_Unit[0]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].Page2[0].Pt2Line5_Unit[1]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].Page2[0].Pt2Line5_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "client.address_line2",
    "transform": "unit_number"
  },
  "form1[0].Page2[0].Pt2Line5_Unit[2]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].Page2[0].Pt2Line5_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].Page2[0].Pt2Line5_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].Page2[0].Pt2Line5_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].Page2[0].Line4b_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].Page2[0].Line4a_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page2[0].Line7_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].Page2[0].Line8_ElisAccountNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page2[0].Line9_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Line9_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Line10_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Line10_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Line10_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Line10_Checkbox[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Line19_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page2[0].Line19_Checkbox[1]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].Page3[0].Line20c_TravelDoc[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line21_DateOfLastEntry[0]": {
    "type": "text",
    "source": "immigration.last_entry_date",
    "transform": "date_slash"
  },
  "form1[0].Page3[0].Line20e_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line20d_CountryOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line20b_Passport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line23_StatusLastEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line24_CurrentStatus[0]": {
    "type": "text",
    "source": "immigration.immigration_status"
  },
  "form1[0].Page3[0].Line26_SEVISnumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line27b_Everify[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line27c_EverifyIDNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].PtLine29_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page3[0].PtLine29_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page3[0].Line18a_Receipt[0].Line30a_ReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line28_ReceiptNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line27a_Degree[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line20a_I94Number[0]": {
    "type": "text",
    "source": "immigration.i94_number"
  },
  "form1[0].Page3[0].Line19_DOB[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].Page3[0].Line18c_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].Page3[0].Line18a_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].Line18b_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].#area[1].section_1[0]": {
    "type": "text",
    "source": "literal:c"
  },
  "form1[0].Page3[0].#area[1].section_2[0]": {
    "type": "text",
    "source": "literal:33"
  },
  "form1[0].Page3[0].#area[1].section_3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page3[0].PtLine30b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page3[0].PtLine30b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page3[0].place_entry[0]": {
    "type": "text",
    "source": "immigration.port_of_entry"
  },
  "form1[0].Page4[0].Pt3Line1Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page4[0].Pt3Line1Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page4[0].Pt3Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page4[0].Part3_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page4[0].Pt3Line2_RepresentativeName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page4[0].Pt3Line7b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page4[0].Pt3Line7a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page4[0].Pt3Line3_DaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].Page4[0].Pt3Line4_MobileNumber1[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].Page4[0].Pt3Line5_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].Page4[0].Pt4Line6_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page4[0].Pt4Line2_InterpreterBusinessorOrg[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page4[0].Pt4Line1b_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page4[0].Pt4Line1a_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt4Line4_InterpreterDaytimeTelephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt4Line6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt4Line5_MobileNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Part4_NameofLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line1b_PreparerGivenName[0]": {
    "type": "text",
    "source": "attorney.first_name"
  },
  "form1[0].Page5[0].Pt5Line2_BusinessName[0]": {
    "type": "text",
    "source": "firm.firm_name"
  },
  "form1[0].Page5[0].Pt5Line1a_PreparerFamilyName[0]": {
    "type": "text",
    "source": "attorney.last_name"
  },
  "form1[0].Page5[0].Pt6Line3c_CityOrTown[0]": {
    "type": "text",
    "source": "firm.city"
  },
  "form1[0].Page5[0].Pt6Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "firm.address_line1"
  },
  "form1[0].Page5[0].Pt6Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].Page5[0].Pt6Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].Page5[0].Pt6Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "firm.address_line2",
    "transform": "unit_number"
  },
  "form1[0].Page5[0].Pt6Line3b_Unit[2]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].Page5[0].Pt6Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt6Line3e_ZipCode[0]": {
    "type": "text",
    "source": "firm.zip"
  },
  "form1[0].Page5[0].Pt6Line3d_State[0]": {
    "type": "dropdown",
    "source": "firm.state",
    "transform": "state_abbrev"
  },
  "form1[0].Page5[0].Pt6Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt6Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line5_PreparerFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line4_DaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "attorney.phone",
    "transform": "digits"
  },
  "form1[0].Page5[0].Pt5Line6_Email[0]": {
    "type": "text",
    "source": "attorney.email"
  },
  "form1[0].Page5[0].Pt5Line3c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt5Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt4Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page5[0].Pt4Line6a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page6[0].Part5Line7_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page6[0].Part5Line7_Checkbox[1]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].Page6[0].Part5Line7b_Checkbox[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].Page6[0].Part5Line7b_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].Page6[0].Pt5Line8a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page6[0].Pt5Line8b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line7a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line7b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line7c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Pt6Line7d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].Page7[0].Line1a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].Page7[0].Line1b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].Page7[0].Line1c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].Page7[0].Line7_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].Page7[0].Pt6Line4d_AdditionalInfo[1]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-765';
