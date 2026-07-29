-- Migration 1600-n600: N-600 field map + template registration
--
-- USCIS Form N-600, Application for Certificate of Citizenship. Filed by (or on behalf of) a person claiming U.S. citizenship acquired or derived through a U.S.-citizen parent. Part 2 is applicant identity/address; Parts 3-7 cover parents' citizenship and the basis of the claim; Part 8 signature.
--
-- Source:  uscis-forms/n-600.pdf
-- Edition: 01/20/25 (printed lower-left; title "Application for Certificate of Citizenship")
-- SHA-256: 5dcca0f07ec1ba88b961f6bd2bd522e7497d6fd081bd477d6350f44dbeb28a07
--
-- 433 fields: 15 data-mapped, 418 deliberately blank.
-- Field inventory: normalized/n-600.fields.json
-- Field semantics: normalized/n-600.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: Part 2 current legal name, A-number, SSN, USCIS online account,
--    DOB, country of birth, current mailing address; Part 8 daytime/mobile phone
--    + email.
--  * Left blank on purpose:
--    - Name on green card (2), other names (3), physical address (12) — only if
--      different; unit type; entry name (15A).
--    - The ENTIRE citizenship claim: admission/immigration status, both parents'
--      names/citizenship/marriage, adoption, military service, and absences —
--      the substance of the case and third-party data (hard rule).
--    - Part 5 legal-guardian block — filled only when a guardian applies.
--    - Interpreter, preparer, all signatures — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('n-600', 'Form N-600 -- Application for Certificate of Citizenship')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/n-600.pdf',
    field_count  = 433,
    edition_date = '01/20/25',
    field_map    = '{
  "form1[0].#subform[0].#area[0].Line1_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].#area[1].G28CheckBox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].#area[1].AttorneyBarNo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].#area[1].AttorneyUSCISAccountNo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_child[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_citzparent[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Eligibility[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1_other_explain[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].Pt1Line1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].Pt1Line1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[1].#area[2].Line1_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line2_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line2_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line2_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line3_FamilyName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line3_GivenName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line3_MiddleName1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line3_FamilyName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line3_GivenName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line3_MiddleName2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line4_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full"
  },
  "form1[0].#subform[1].P1_Line5_USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[1].#area[3].P2_Line8_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].#area[4].P2_Line10_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[1].#area[5].P2_Line8_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#area[6].P2_Line9_Gender[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].#area[6].P2_Line9_Gender[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].Pt2Line11_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].Pt2Line11_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].Pt2Line11_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].P2_Line11_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].P2_Line11_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].P2_Line11_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].P2_Line11_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].P2_Line11_PhysicalStreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].Pt2Line11_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].Pt2Line11_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[2].Pt2Line11_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[3].P2_Line10_InCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[4].P2_Line10_StreetName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[1].#subform[4].P2_Line10_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[4].P2_Line10_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[4].P2_Line10_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[4].P2_Line10_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[4].Pt2_Line10_City[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[1].#subform[4].Pt2Line10_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[1].#subform[4].Pt2Line10_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[1].#subform[4].Pt2Line10_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[4].Pt2Line10_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].#subform[4].Pt2Line10_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line3_HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line3_HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line12_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line12_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line12_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line12_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line12_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line12_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line12_MaritalStatus[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line12_MaritalStatusOther[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line13_ArmedForces[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P2_Line13_ArmedForces[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].#area[7].Line1_AlienNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line14A_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line14A_DateOfEntry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line14A_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line14A_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line14A_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line14B_CountryOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line14B_TravelDocChbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line14B_PassportChbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line14B_PassportNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line14B_TravelDocNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line14B_DateIssued[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line15C_LPR[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line15C_LPR[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line14D_DateLPR[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line14D_Status_GrantedLPR[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line16_LostLPR[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line16_LostLPR[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line16_Explain[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line15_AppliedFor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line15_AppliedFor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line17_Explain[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line15_PrevAppliedFor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line15_PrevAppliedFor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line15_Explain[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line19[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P2_Line19[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].#area[8].Line1_AlienNumber[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line17_Adopted[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line17_Adopted[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line17A_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line17A_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line17A_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line17B_AdoptionDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line17C_LegalCustodyDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line17D_PhysicalCustody[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line21_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line18_ReAdopted[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line21_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line18_ReAdopted[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line18B_Adoption[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line18C_Legal[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line18D_Physical[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line18A_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line18A_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line18A_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line20[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line20[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line23[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line23[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line22[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line22[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line22A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P2_Line22B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].#area[9].Line1_AlienNumber[4]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P2_Line22C_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[7].P2_Line22C_Place[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P2_Line22D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P2_Line22E[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P2_Line22F_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[7].P2_Line22F_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line3_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt3Line3_Mother[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt3Line3_Father[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_city[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_physicalAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line5_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6_CitizenNo2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6_AlienNumber2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6_AlienNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6_fcitizen[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6_fcitizen[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6_fcitizen[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P4_Line6_fcitizen[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6_CitizenNo1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6_Place[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].#area[10].Line1_AlienNumber[5]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line6_AlienNumber2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line6_CertNo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line6_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line6_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line6_DateOfNat[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line7[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line7[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8B_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8B_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8B_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8B_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8B_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8B_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8A_TimesMarried[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8B_MaritalStatus[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line8B_MaritalStatusOther[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9D_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9B_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9C_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9A_iddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9A_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9A_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt3Line9_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt3Line9_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9E_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9F_DateofMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line9G_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9G_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[8].P4_Line9G_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].#area[11].Line1_AlienNumber[6]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P4_Line9H_Immigration[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P4_Line9H_Immigration[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P4_Line9H_ImmigrationOther[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P4_Line9H_Immigration[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt4Line3_Mother[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt4Line3_Father[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line2_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line4_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_PhysicalAddressStreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line5_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt4Line7_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt4Line7_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line6_fcitizen[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line6_fcitizen[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line6_fcitizen[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P5_Line6_fcitizen[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_AlienNumber1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_CitizenNo1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_AlienNumber2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_CitizenNo2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_AlienNumber2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_CertNo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_DateOfNat[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_Place[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].#area[12].Line1_AlienNumber[7]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line7[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line7[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line8A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line8B_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line8B_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line8B_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line8B_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line8B_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line8B_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line8B_MaritalStatusOther[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line8B_MaritalStatus[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9A_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9A_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9A_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9B_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9C_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9D_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P4_Line11[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P4_Line11[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9E_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9H_Immigration[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9H_Immigration[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9H_Immigration[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9H_ImmigrationOther[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P5_Line9F_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt5Line9G_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[10].P2_Line14A_City[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt5Line9G_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].#area[13].Line1_AlienNumber[8]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P6_UScitizen[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].P6_UScitizen[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[4]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[5]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[6]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[7]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[8]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[9]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[10]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[11]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[12]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[13]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[14]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[15]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line9F_DateofBirth[16]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line1_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line1_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line1_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line2_DateOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_PhysicalAddressStreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P5_Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P7_Line1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].P7_Line1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].P7_Line2_IfYesProvide[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Line1_AlienNumber[9]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P7_Line4_Discharge[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].P7_Line4_Discharge[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].P7_Line4_Discharge[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].P5_Line9F_DateofBirth[17]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P5_Line9F_DateofBirth[18]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P5_Line9F_DateofBirth[19]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P5_Line9F_DateofBirth[20]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line1B_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line2_Preparer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].P8_Line5[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[12].P8_Line3[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[12].P8_Line4[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[12].P7_Line4_Discharge[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].P7_Line4_OtherExplain[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Line1_AlienNumber[10]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P8_Line6_Sign[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P8_Line6_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_InterpretersStreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P9_Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P8_Line6_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P8_Line4_Telephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].P8_Line5_Telephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].#area[14].Line1_AlienNumber[11]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P9_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P9_Line7_Sign[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P9_Line7_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line1_PreparerGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line1_PreparerFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line2_NameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_PreparerStreetrName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line4_Telephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[14].P10_Line5_Mobile[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[15].Line1_AlienNumber[12]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt10Line7_chkbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt10Line7_chkbx[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt10Line7b_DoesNotExtend[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt10Line7b_Extend[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].P10_Line8_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[15].P10_Line8_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].#subform[17].#area[15].Line1_AlienNumber[13]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line5D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line6A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line6B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line6C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line6D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line5C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line5B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line5A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Global_ANumber[0].Line1_AlienNumber[14]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line3A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line3B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line3C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line3D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt1Line1_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt1Line1_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt1Line1_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line4A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line4B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line4C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[16].P11_Line4D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].#area[17].Line1_AlienNumber[15]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P12_applicantName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Part15blank1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Part15blank1[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Part15blank1[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Part15blank1[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P12_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P12_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P12_ApplicantsPrintedName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P12_USCISOfficersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P12_USCISTitle[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P12_DateofSignature[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line2_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line3A[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line3B[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line3C[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line3D[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line3E[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line3E_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P13_Line4[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt12_Location[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].P12_Certification_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].#area[18].Line1_AlienNumber[16]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].P13_Approved[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[19].P13_Approved[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[19].P13_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].P13_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].P13_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].P13_OfficersPrintedName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].P13_USCISOfficersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].P13_USCISPrintedName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[19].P13_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'n-600';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('N-600', 16, '01/20/25')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
