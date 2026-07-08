-- Migration 1514: G-28 field map
--
-- Hand-authored against the real AcroForm field names captured in
-- normalized/g-28.fields.json (101 fields: 76 text, 23 checkbox, 2 dropdown).
--
-- Mapping notes:
--   - Part 1/2 (subform[0]) = attorney/firm info -> firm.* + attorney.* sources.
--   - Part 3 (subform[1])   = client info -> client.* + immigration.* sources.
--   - Part 4/5 (subform[2]) = signatures/dates -> ALWAYS blank. Signatures and
--     dates of signature must never be auto-filled.
--   - "Checkbox1dAm"/"Checkbox1dAmNot" (disciplinary status attestation) ->
--     ALWAYS blank. This is a legal attestation the attorney must affirmatively
--     check themselves, never auto-filled regardless of available data.
--   - Part 9 (subform[3]) = additional-info continuation page -> mostly blank
--     (free-form, case-specific), except the repeated client-name header
--     fields, which mirror Part 3's name fields.
--   - "Line1a_USCIS" (Part 3 item 1: filing before USCIS/ICE/CBP) -> always
--     literal true. Every form in this DACA package is filed with USCIS, never
--     ICE or CBP, so this one is safe as a package-wide default.
--   - The 4 PDF417BarCode fields are Adobe LiveCycle's auto-generated 2D
--     barcodes (computed by XFA scripting, which normalize-form-template.js
--     strips) -- there's no value we can compute for them, so they're left
--     out of the map entirely (unmapped, not "blank").
--   - Entity/organization fields (Pt3Line7a/7b), ICE/CBP sections, and law-
--     student fields are inapplicable to individual DACA clients / attorney
--     reps and are left blank.

UPDATE public.form_templates
SET field_map = '{
  "form1[0].#subform[0].Line4_DaytimeTelephoneNumber[0]": { "type": "text", "source": "attorney.phone" },
  "form1[0].#subform[0].Pt1Line2c_MiddleName[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Pt1Line2b_GivenName[0]": { "type": "text", "source": "attorney.first_name" },
  "form1[0].#subform[0].Pt1Line2a_FamilyName[0]": { "type": "text", "source": "attorney.last_name" },
  "form1[0].#subform[0].#area[0].Pt1Line1_USCISOnlineAcctNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Line3a_StreetNumber[0]": { "type": "text", "source": "firm.address_line1" },
  "form1[0].#subform[0].Line3b_Unit[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[0].Line3b_Unit[1]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[0].Line3b_AptSteFlrNumber[0]": { "type": "text", "source": "firm.address_line2" },
  "form1[0].#subform[0].Line3b_Unit[2]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[0].Line3c_CityOrTown[0]": { "type": "text", "source": "firm.city" },
  "form1[0].#subform[0].Line3d_State[0]": { "type": "dropdown", "source": "firm.state", "transform": "state_abbrev" },
  "form1[0].#subform[0].Line3e_ZipCode[0]": { "type": "text", "source": "firm.zip" },
  "form1[0].#subform[0].Line3f_Province[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Line3h_Country[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Line3g_PostalCode[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Pt1ItemNumber7_FaxNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Line6_EMail[0]": { "type": "text", "source": "attorney.email" },
  "form1[0].#subform[0].Line7_MobileTelephoneNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Line2b_NameofOrganization[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Line2c_DateExpires[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].CheckBox2[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[0].Checkbox1dAmNot[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[0].Checkbox1dAm[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[0].Pt2Line1b_BarNumber[0]": { "type": "text", "source": "attorney.bar_number" },
  "form1[0].#subform[0].CheckBox1[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[0].Line3_NameofAttorneyOrRep[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].CheckBox3[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[0].CheckBox4[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[0].Line4b_LawStudent[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Pt2Line1a_LicensingAuthority[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[0].Pt2Line1d_NameofFirmOrOrganization[0]": { "type": "text", "source": "firm.firm_name" },

  "form1[0].#subform[1].Line4_Checkbox[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Line4_Checkbox[1]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Line4_Checkbox[2]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Line4_Checkbox[3]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Line2a_ICE[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Line2b_ListMatter[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[1].Line3a_CBP[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Line3b_ListSpecificMatter[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[1].Line1a_USCIS[0]": { "type": "checkbox", "source": "literal:true" },
  "form1[0].#subform[1].Line1b_ListFormNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[1].Line4_Checkbox[4]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Pt3Line5c_MiddleName[0]": { "type": "text", "source": "client.middle_name" },
  "form1[0].#subform[1].Pt3Line5b_GivenName[0]": { "type": "text", "source": "client.first_name" },
  "form1[0].#subform[1].Pt3Line5a_FamilyName[0]": { "type": "text", "source": "client.last_name" },
  "form1[0].#subform[1].Pt3Line7a_NameOfEntity[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[1].Line10_MobileTelephoneNumber[0]": { "type": "text", "source": "client.cell_phone" },
  "form1[0].#subform[1].#area[1].Pt3Line8_USCISOnlineAcctNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[1].Line12g_PostalCode[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[1].Line12f_Province[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[1].Line12h_Country[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[1].Line12a_StreetNumberName[0]": { "type": "text", "source": "client.address_line1" },
  "form1[0].#subform[1].Line12c_CityOrTown[0]": { "type": "text", "source": "client.city" },
  "form1[0].#subform[1].Line12e_ZipCode[0]": { "type": "text", "source": "client.zip" },
  "form1[0].#subform[1].Line12b_Unit[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Line12b_Unit[1]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Line12b_AptSteFlrNumber[0]": { "type": "text", "source": "client.address_line2" },
  "form1[0].#subform[1].Line12b_Unit[2]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[1].Line12d_State[0]": { "type": "dropdown", "source": "client.state", "transform": "state_abbrev" },
  "form1[0].#subform[1].Line11_EMail[0]": { "type": "text", "source": "client.email" },
  "form1[0].#subform[1].Pt3Line9_ANumber[0]": { "type": "text", "source": "immigration.a_number" },
  "form1[0].#subform[1].Line9_DaytimeTelephoneNumber[0]": { "type": "text", "source": "client.cell_phone" },
  "form1[0].#subform[1].Pt3Line7b_TitleofEntity[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[1].Pt3Line4_ReceiptNumber[0]": { "type": "text", "source": "blank" },

  "form1[0].#subform[2].Line1_Signature[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[2].Line2_SignatureStudent[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[2].Pt5Line2b_DateofSignature[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[2].Pt4Line2a_CheckBox2a[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[2].Line3_Date[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[2].Pt4Line2b_CheckBox2b[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[2].Pt4Line2c_CheckBox2c[0]": { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[2].Pt4Line2b_DateofSignature[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[2].P5_Line6a_SignatureofApplicant[0]": { "type": "text", "source": "blank" },

  "form1[0].#subform[3].Pt9Line3d_AdditionalInfo[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt3Line5a_FamilyName[1]": { "type": "text", "source": "client.last_name" },
  "form1[0].#subform[3].Pt3Line5b_GivenName[1]": { "type": "text", "source": "client.first_name" },
  "form1[0].#subform[3].Pt3Line5c_MiddleName[1]": { "type": "text", "source": "client.middle_name" },
  "form1[0].#subform[3].Pt9Line3a_PageNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line3b_PartNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line3c_ItemNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line4d_AdditionalInfo[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line4a_PageNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line4b_PartNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line4c_ItemNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line5d_AdditionalInfo[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line5a_PageNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line5b_PartNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line5c_ItemNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line6d_AdditionalInfo[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line6c_ItemNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line6b_PartNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line6a_PageNumber[0]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line6d_AdditionalInfo[1]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line6a_PageNumber[1]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line6b_PartNumber[1]": { "type": "text", "source": "blank" },
  "form1[0].#subform[3].Pt9Line6c_ItemNumber[1]": { "type": "text", "source": "blank" }
}'::jsonb
WHERE form_key = 'g-28';
