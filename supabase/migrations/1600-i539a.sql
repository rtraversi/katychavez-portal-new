-- Migration 1600-i539a: I-539A field map + template registration
--
-- USCIS Form I-539A, the supplement filed with Form I-539 for EACH co-applicant (a family member included on the principal's I-539). Part 1 identifies the principal filer; Part 2 onward is the co-applicant's own biographic, entry, eligibility, contact, and signature information.
--
-- Source:  uscis-forms/i-539a.pdf
-- Edition: 08/28/24 (printed lower-left; title "Supplemental Information for Application to Extend/Change Nonimmigrant Status")
-- SHA-256: b9e6ebd14072338b642bf5dba080f3532ec2671b7887f3694f417685b5cca885
--
-- 104 fields: 3 data-mapped, 101 deliberately blank.
-- Field inventory: normalized/i-539a.fields.json
-- Field semantics: normalized/i-539a.tooltips.tsv
--
-- Mapping decisions:
--  * This is a PER-CO-APPLICANT supplement: one I-539A per family member on the
--    I-539. Part 1 = the principal filer (our client); Part 2 = the co-applicant.
--  * Autofilled: Part 1 principal filer's legal name only — the one thing we know
--    unambiguously at generation time (it is always the matter's client).
--  * Left blank on purpose:
--    - ALL of Part 2 (co-applicant name, DOB, birth country, citizenship, SSN,
--      A-number, entry, passport, status) and the Part 7 pre-populated repeats.
--      The co-applicant is a specific family member, but the form generates once
--      and cannot know WHICH co-applicant; filling the principal's data here
--      would be wrong. Attorney enters per co-applicant. (A future enhancement
--      could parameterize immigration.family.<n> once generation is per-member.)
--    - Part 3 eligibility "have you EVER" questions — judgment (hard rule).
--    - Attorney/G-28 fields — separate atty-fields migration.
--    - All signatures & dates, interpreter, preparer — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-539a', 'Form I-539A -- Supplemental Information for Application to Extend/Change Nonimmigrant Status')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/i-539a.pdf',
    field_count  = 104,
    edition_date = '08/28/24',
    field_map    = '{
  "form1[0].#subform[0].CheckBox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_Line1a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_Line1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P2_Line1c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line2_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line3_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line1f_CountryOfCitz[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line1g_SSN[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].#area[0].Pt1Line6_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line1i_DateOfArrival[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line1j_ArrivalDeparture[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line1k_Passport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line1l_TravelDoc[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line1m_CountryOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1Line1a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].P1_Line1b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].P1_Line1c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].SupA_Line1n_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line15a_NewStatus[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].SupA_Line1p_DateExpires[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line13_Passport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line13b_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line10_USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line13b_CountryOfCitizenship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line1_ImmVisa[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line1_ImmVisa[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line2_PetFiled[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line2_PetFiled[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line3_I485Filed[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line3_I485Filed[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line4_CrimOffense[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line4_CrimOffense[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line5_TorGeno[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line5_TorGeno[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line6_Killing[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line6_Killing[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line7_IntSevInjury[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line7_IntSevInjury[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line8_SexContRel[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line8_SexContRel[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line10_MilUnit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line10_MilUnit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line11_WorkPrison[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line11_WorkPrison[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line12_MemOfGroup[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line12_MemOfGroup[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line12_SoldProvWeap[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line12_SoldProvWeap[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line9_LimDenRelBel[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line9_LimDenRelBel[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line14_WeapParamilTrg[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line14_WeapParamilTrg[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line15_NonImmViolSt[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line15_NonImmViolSt[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line17_AdmitGrantExt[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line17_AdmitGrantExt[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line18_J1J2Visitor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line18_J1J2Visitor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line16_RemProceed[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line16_RemProceed[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P12_Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P12_Line3_Telephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P12_Line3_Mobile[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P12_SignatureApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P13_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P14_Line2_NameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P14_Line1_nterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P14_Line1_nterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P14_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P14_Line4_Telephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P14_Line5_Mobile[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P14_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P12_SignatureApplicant[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P7_Line6_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P15_Line1_PreparerGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P15_Line1_PreparerFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P15_Line2_NameofBusinessorOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P15_Line6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P15_Line4_Telephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P15_Line5_Mobile[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P15_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P12_SignatureApplicant[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line5D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line6A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line6B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line6C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line6D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line5C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line5B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line5A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Global_ANumber[0].Pt1Line6_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line3A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line3B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line3C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P2_Line1a_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P2_Line1b_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P2_Line1c_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line4A[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line4B[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P11_Line4C[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line3D[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P7_Line4D[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-539a';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-539A', 5, '08/28/24')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();

UPDATE public.form_editions SET source_url = 'https://www.uscis.gov/i-539'
  WHERE form_number = 'I-539A' AND source_url IS NULL;
