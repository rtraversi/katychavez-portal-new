-- Migration 1600-i821d: I-821D field map + template registration
--
-- Consideration of Deferred Action for Childhood Arrivals, RENEWAL defaults.
-- Sources verified against per-field tooltips (i-821d-tooltips.txt). Notable:
--   - P1_Line2_Checkbox[0] = "Renewal Request" (package-wide literal);
--     P1_Line1_Checkbox[0] (Initial Request) stays blank.
--   - P1_Line2_Date ("current DACA expires on") has no data column yet --
--     blank; candidate future client_immigration column.
--   - Part1_CB detention pair maps from immigration.is_detained: [0] "I am in
--     immigration detention" via yes_no, [1] "I am not..." via yes_no_invert.
--   - P1_Line5_Checkbox[0] (removal proceedings YES) fills only when
--     immigration.has_prior_removal_order is true; the "No" box [1] is NEVER
--     auto-checked -- the form question is broader than our column, so a "No"
--     is the attorney's call.
--   - P1_Line12 Current Country of Residence = literal United States (a DACA
--     requestor must be in the US to file).
--   - Part 3 is "For Initial Requests Only" -> entirely blank for renewals.
--   - Part 4 criminal/national-security questions, continuous-residence and
--     advance-parole attestations, biometrics (height/weight/eye/hair, race,
--     ethnicity), gender, marital status, address/travel history, signatures:
--     all deliberately blank for attorney review.
--   - Unit checkbox order (tooltip-verified): P1_Line4c/P2_Line2c: [0]=Flr
--     [1]=Ste [2]=Apt; P7_Line3b: [0]=Ste [1]=Flr [2]=Apt.
--
-- 227 map entries (51 data-mapped, 176 deliberately blank);
-- 7 XFA barcode field(s) omitted. Field inventory: normalized/i-821d.fields.json.
-- Requires the a_number/unit_*/digits/yes_no_invert transforms shipped in
-- functions/api/_form-fill.js alongside migration 1600-g28.

UPDATE public.form_templates
SET r2_key      = 'form-templates/i-821d.pdf',
    field_count = 234,
    field_map   = '{
  "form1[0].#subform[0].G28_Attached[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[0].P1_Line3a_Name[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].P1_Line3b_Name[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].P1_Line3c_Name[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].P1_Line2_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_CB[0]": {
    "type": "checkbox",
    "source": "immigration.is_detained",
    "transform": "yes_no"
  },
  "form1[0].#subform[0].P1_Line1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_CB[1]": {
    "type": "checkbox",
    "source": "immigration.is_detained",
    "transform": "yes_no_invert"
  },
  "form1[0].#subform[0].P1_Line2_Checkbox[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[0].P1_Line4c_Number[0]": {
    "type": "text",
    "source": "client.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[0].P1_Line4c_Unit[0]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[0].P1_Line4c_Unit[1]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[0].P1_Line4c_Unit[2]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[0].P1_Line5_Checkbox[0]": {
    "type": "checkbox",
    "source": "immigration.has_prior_removal_order",
    "transform": "yes_no"
  },
  "form1[0].#subform[0].P1_Line5_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4f_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].P1_Line4e_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[0].P1_Line4d_City[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].#area[1].AttyLicenseNum[0]": {
    "type": "text",
    "source": "attorney.bar_number"
  },
  "form1[0].#subform[0].P1_Line4a_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4b_Street[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[1].P1_Line14_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line14_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line14_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line14_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line10_Gender[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line10_Gender[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line11a_CityBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line9_DOB[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].P1_Line11b_CountryBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[1].P1_Line12_CountryRes[0]": {
    "type": "text",
    "source": "literal:United States"
  },
  "form1[0].#subform[1].P1_Line13_CountryCitz[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[1].Line4_ANumber[0].P1_Line7_ANumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[1].P1_Line8_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full",
    "transform": "digits"
  },
  "form1[0].#subform[1].P1_Line21_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_Checkbox[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_Checkbox[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_Checkbox[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_Checkbox[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_Checkbox[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line21_Checkbox[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line18_Height-Ft[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line18_Height-In[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line19_Weight[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line19_Weight[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line19_Weight[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line20_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line20_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line20_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line20_Checkbox[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line20_Checkbox[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line20_Checkbox[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line20_Checkbox[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line20_Checkbox[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line20_Checkbox[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line1_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line1_checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line17_Race_NativeHaw[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line17_Race_AmIndian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line17_Race_White[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line17_Race_Asian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line17_Race_Black[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line16_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line16_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line6_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line6_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line6_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line6_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line6g_Location[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line6f_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line6_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line15a_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line15b_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line15c_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3d_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3b_Street[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3e_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2_Line3f_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3a_Date_From[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3a_Date_To[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3c_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3c_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3c_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3c_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line2d_City[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[2].P2_Line2b_Street[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[2].P2_Line2e_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[2].P2_Line2f_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[2].P2_Line2a_Date_From[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line2c_Number[0]": {
    "type": "text",
    "source": "client.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[2].P2_Line2c_Unit[0]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[2].P2_Line2c_Unit[1]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[2].P2_Line2c_Unit[2]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[2].P2_Line4d_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line4b_Street[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line4e_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line4f_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line4a_Date_From[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line4a_Date_To[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line4c_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line4c_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line4c_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line4c_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line7c_Reason[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line7a_DeptDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line7b_RetDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line8_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line8_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line9a_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line9b_Passport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line9c_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line10_BorderCard[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line6c_Reason[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line6a_DepDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line6b_RetDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5d_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5e_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5f_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5b_Street[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5a_Date_From[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5a_Date_To[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5c_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5c_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5c_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5c_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line5c_I94Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line5a_I94[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line5a_I94[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Line16_I94[0].P3_Line5b_I94Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line6_Education[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line7_School[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line8_GradDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line9b_SvcDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line9c_DischgDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line9_Military[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line9_Military[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line9a_Branch[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line3_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line3_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line4_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line4_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line2_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line2_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line5a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line5a_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line5b_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line5b_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line5c_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line5c_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line5d_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line5d_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line6_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line6_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line7_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P4_Line7_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line4_ImmStatus[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line1_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line1_checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line2_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line3_Place[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line9d_Discharge[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line1a_1b_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line2b_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line2a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line1a_1b_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line3_DayPhone[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].P5_Line5_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[4].P5_Line4_MobilePhone[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].P6_Line2_Organization[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3c_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3a_Street[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3b_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line3b_Unit[2]": {
    "type": "checkbox",
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
  "form1[0].#subform[4].P6_Line1b_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line1a_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6Line6b_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line6a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line6_Email[0]": {
    "type": "text",
    "source": "attorney.email"
  },
  "form1[0].#subform[5].P7_Line4_DayPhone[0]": {
    "type": "text",
    "source": "attorney.phone",
    "transform": "digits"
  },
  "form1[0].#subform[5].P7_Line5_MobilePhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line7a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line7b_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line3c_City[0]": {
    "type": "text",
    "source": "firm.city"
  },
  "form1[0].#subform[5].P7_Line3a_Street[0]": {
    "type": "text",
    "source": "firm.address_line1"
  },
  "form1[0].#subform[5].P7_Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[5].P7_Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[5].P7_Line3b_Number[0]": {
    "type": "text",
    "source": "firm.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[5].P7_Line3b_Unit[2]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[5].P7_Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line3e_ZipCode[0]": {
    "type": "text",
    "source": "firm.zip"
  },
  "form1[0].#subform[5].P7_Line3d_State[0]": {
    "type": "dropdown",
    "source": "firm.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[5].P7_Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P7_Line2_Organization[0]": {
    "type": "text",
    "source": "firm.firm_name"
  },
  "form1[0].#subform[5].P7_Line1a_Name[0]": {
    "type": "text",
    "source": "attorney.last_name"
  },
  "form1[0].#subform[5].P7_Line1b_Name[0]": {
    "type": "text",
    "source": "attorney.first_name"
  },
  "form1[0].#subform[5].P6_Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line4_DayPhone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3a_Page[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3b_Part[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3c_Item[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4a_Page[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4b_Part[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4c_Item[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line4d_Narrative[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P1_Line3a_Name[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[6].P1_Line3b_Name[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[6].P1_Line3c_Name[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[6].Line4_ANumber[1].P1_Line7_ANumber[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[6].P8_Line5a_Page[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5b_Part[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5c_Item[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line5d_Narrative[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Line3d_Narrative[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-821d';
