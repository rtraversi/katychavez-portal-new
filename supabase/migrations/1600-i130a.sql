-- Migration 1600-i130a: I-130A field map + template registration
--
-- Supplemental Information for Spouse Beneficiary. The companion to the I-130,
-- collecting the spouse beneficiary's own address history, employment history
-- and parents. It is filed BY the beneficiary alongside the petitioner's I-130
-- and adds no new petition -- it supplements one.
--
-- Source:  uscis-forms/i-130a.pdf
-- Edition: 04/01/24 (printed lower-left; OMB expires 02/28/2027)
-- SHA-256: 1d2b2ca97b28abcd2c7e0d336396218b50d582c66450baddfbfda4ee7e779d18
--
-- 188 field(s): 145 TextField, 36 CheckBox, 7 Dropdown.
-- Field inventory: normalized/i-130a.fields.json
-- Field semantics: normalized/i-130a.tooltips.tsv
--
-- ⚠ PARTY ROLES -- A THIRD PATTERN. Do not carry either predecessor across.
-- This entire form is about the BENEFICIARY. Katy: "I-130A = Beneficiary.
-- Information is for the immigrant." So every applicant section maps to
-- client.* / immigration.*.
--   I-485  applicant = client              (client throughout)
--   I-864  sponsor = petitioner, immigrant = client   (INVERTED)
--   I-130  Part 2 = petitioner, Part 4 = client       (INVERTED)
--   I-130A entirely the beneficiary                   (THIS FORM)
-- petitioner.* IS USED ZERO TIMES BELOW, and that is correct, not an omission:
-- every one of the 188 tooltips was searched and NOT ONE field on this form
-- asks about the petitioner. A reviewer expecting the I-130's inversion here,
-- on its own companion form, would introduce exactly the error the inversion
-- is meant to guard against.
--
-- ⚠ WHEN THIS FORM IS USED (Katy). The I-130A is required only on SPOUSAL
-- petitions. It is not needed where the petitioner is the child of the
-- immigrant. That governs whether the form is INCLUDED in a package, not how
-- any field maps, so it does not change this map -- recorded here so nobody
-- infers a filing rule from the field map's silence.
--
-- KATY'S RULES APPLIED:
--   - The beneficiary need not sign if they are not in the country. All
--     signatures and signature dates are blank regardless -- a wet signature
--     is required either way.
--   - In Care Of (℅) is never mapped. (This form has no ℅ box at all.)
--   - Foreign addresses get NO state and NO province.
--   - Employment addresses are the PHYSICAL WORKSITE, never the payroll
--     address. That is a data-entry convention for whatever populates
--     clients.employer_address_line1 / employer_city / employer_state /
--     employer_zip, not something the field map can enforce -- flagged in the
--     PR so the convention is agreed rather than assumed.
--   - Countries and last names are ALL CAPS. The one literal below is written
--     in caps; data-driven values still need the uppercase transform escalated
--     on the I-864 PR.
--
-- ⚠ MAX'S DECISION (2026-07-22), MIRRORING 1600-i130.sql, EXPLICITLY
-- REVERSIBLE ("if wrong we can change later"):
--   CheckBox1[0]            G-28 is attached                    -> literal:true
--   Pt6Line7_Checkbox[1]    7.B "I am an attorney or accredited
--                               representative"                 -> literal:true
--   Pt6Line7b_Checkbox[0]   "my representation EXTENDS beyond
--                            the preparation of this form"      -> literal:true
--   Pt6Line7_Checkbox[0]    7.A "I am NOT an attorney"          -> blank
--   Pt6Line7b_Checkbox[1]   "does NOT extend"                   -> blank
-- The indices were re-verified against THIS form's full tooltips rather than
-- assumed from the I-130: [0] is "extends", [1] is "does not extend". They
-- happen to match, but they were checked.
-- Reasoning, so a reviewer can evaluate rather than inherit it: 7.B states who
-- prepared the form, which the system knows with certainty -- the preparer
-- block below is already filled from attorney.* and firm.*, and leaving 7.B
-- blank while printing the attorney's own name, firm and contact details
-- underneath is self-contradictory on the printed page. "Extends" is the
-- firm's standing posture. The three answers are mutually consistent: the
-- "extends" tooltip itself notes that such an attorney "may be obliged to
-- submit a completed Form G-28", and this map ticks the G-28 box. This is a
-- carve-out from Max's blank-by-default rule, which targets Katy's case-OUTCOME
-- defaults rather than facts about the firm's own role. Consistent with
-- 1600-i130.sql, 1600-i751.sql and 1600-i765.sql. To reverse: set both to
-- "blank" -- a two-value edit, not a remap.
--
-- Notable decisions:
--   - Attorney header <- attorney.bar_number + attorney.uscis_account_number.
--     Volag Number blank (voluntary-agency identifier, not a law firm's).
--   - Part 1 items 1-3 <- beneficiary A-Number, USCIS online account number and
--     legal name. NOTE item 2's field is named Pt2Line3_USCISELISActNumber --
--     a Part 2 name on a Part 1 field; tooltip-verified.
--   - Part 1 item 4 "Physical Address 1" IS mapped <- client.address_line1/2 +
--     city/state/zip, because its own tooltip says "provide your current
--     address first" and this form has NO mailing-address block anywhere. That
--     is the distinction from 1600-i130.sql, where the equivalent history rows
--     were left blank precisely because a mailing block above them already
--     carried the current address and filling both would have asserted the two
--     are the same. Max's rule -- physical address stays blank where it would
--     only repeat the mailing address -- does not bite here, as there is
--     nothing to repeat.
--     Province, Postal Code and Country are blank: a spouse beneficiary may
--     well be abroad, so no country literal is safe, and per Katy a foreign
--     address gets no state and no province.
--   - Part 1 item 5 dates blank (5.B is pre-printed "PRESENT"; 5.A has no
--     column). Items 6-7 "Physical Address 2" and items 8-9 "Last Physical
--     Address Outside the United States" blank -- five years of history with no
--     address-history columns, the gap N-400, I-485 and I-130 all hit.
--   - Part 1 items 10-23, both of the beneficiary's PARENTS (name, date of
--     birth, sex, city and country of birth, city and country of residence),
--     entirely blank: immigration.family.<n>.* is positional with no
--     relationship filter, the escalation already open and now hit by a fifth
--     form. Note Pt1Line14_CountryofBirth is NAMED country-of-birth but its
--     tooltip is item 15, "City / Town / Village of Residence" -- blank either
--     way, but it is not what its name says.
--   - Part 2 Employer 1 <- client.employer + employer_address_line1 /
--     employer_city / employer_state / employer_zip. The employer unit trio and
--     its number box are blank (clients has employer_address_line1 but no
--     employer_address_line2). Occupation (item 3) blank -- no occupation
--     column, the same gap the I-864, I-485 and I-130 hit. Employment dates
--     blank (4.B is pre-printed "PRESENT"). Employer 2 (items 5-8) blank.
--   - Part 3 "Information About Your Employment Outside the United States"
--     entirely blank: explicitly scoped to work not already listed above, and
--     no prior/foreign-employer columns exist.
--   - Part 4 contact <- client.phone / cell_phone / email. Item 2's "Name of
--     Preparer" box <- attorney.full_name (factual), while the beneficiary's
--     statement checkboxes (1.A/1.B read-English vs interpreter, and the
--     preparer-used box) stay blank as attestations, with the signature and its
--     date.
--   - Part 5 (Interpreter) entirely blank. Note Pt5Line4_Interpreter
--     DaytimeTelephone[1] is in fact the interpreter's MOBILE number (item 5).
--   - Part 6 (Preparer) <- attorney.last_name / first_name / phone / email +
--     firm.firm_name and the full firm mailing address, Country =
--     literal:UNITED STATES -- the only country literal on this form, safe
--     because the firm IS U.S.-based (1600-i751.sql item 3.h precedent).
--     Pt6Line5_PreparerFaxNumber is NAMED fax but its tooltip is the
--     preparer's MOBILE number -- blank either way, users has no cell column.
--   - Part 7 (Additional Information): the prepopulated name and A-Number boxes
--     are the BENEFICIARY's (tooltips say "Prepopulated from Part 1")
--     <- client.* / immigration.a_number. On the I-130 the equivalent boxes are
--     the PETITIONER's -- the two companion forms prepopulate from different
--     people, which is exactly the trap this form sets. Page/part/item-number
--     references and the free-text continuation boxes are blank.
--
-- ⚠ PER-CASE-CONTEXT CATEGORY -- this form contributes a NEW LAYER, not a
-- fourth field-level instance. The category raised on the I-130 PR is values
-- whose correctness depends on a per-case fact the static map cannot see:
--   1. I-864 -- which PARTY Part 2 describes (petitioner-sponsor vs joint
--      sponsor).
--   2. I-130 page 8 -- items 61 vs 62, adjustment of status vs consular.
--   3. I-130 Part 2 items 18-19 -- whose marriage the item asks about.
-- Nothing inside THIS form's 188 fields turns on such a fact, and none was
-- manufactured to fit the pattern. But the same missing context decides
-- whether the I-130A is filed at all: it is required on spousal petitions and
-- not where the petitioner is the immigrant's child (Katy, above). So the gap
-- is not only about field VALUES -- it also reaches form INCLUSION, one layer
-- up, in the package model. Worth Rob knowing before the package redesign
-- lands: a case-type / relationship signal is needed in both places, and
-- solving it once could serve both.
--
-- Firm-defaults candidates noticed and shipped BLANK, per Max's standing rule
-- (he would rather tick empty boxes than hunt down wrongly pre-filled ones):
--   - none newly identified on this form beyond the preparer carve-out above;
--     the I-130's Part 2 item 11 (mailing = physical) has no counterpart here,
--     as this form has no mailing-address block.
--
-- 188 map entries (41 data-mapped, 4 literal, 143 deliberately blank);
-- XFA stripped and barcodes stamped at normalize time. Field inventory:
-- normalized/i-130a.fields.json. All 188 declared types were cross-checked
-- against the inventory, including all 7 dropdowns. Requires the
-- a_number/digits/state_abbrev/unit_number/unit_is_* transforms already shipped
-- in functions/api/_form-fill.js -- no new transform is required to apply this
-- map as written.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-130a', 'Form I-130A -- Supplemental Information for Spouse Beneficiary')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key      = 'form-templates/i-130a.pdf',
    field_count = 188,
    field_map   = '{
  "form1[0].#subform[0].Pt1Line1_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].Pt1Line4a_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[0].Pt1Line4b_Unit[0]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[0].Pt1Line4b_Unit[1]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[0].Pt1Line4b_Unit[2]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[0].Pt1Line4b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "client.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[0].Pt1Line4c_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].Pt1Line4d_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[0].Pt1Line4e_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].Pt1Line4f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line4h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line4g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line6g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].CheckBox1[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "attorney.bar_number"
  },
  "form1[0].#subform[0].#area[0].USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "attorney.uscis_account_number"
  },
  "form1[0].#subform[0].Pt1Line7a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line7b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line3a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].Pt1Line3b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].Pt1Line3c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].#area[1].Pt2Line3_USCISELISActNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].Pt1Line5a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line5b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8e_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8f_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8d_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line8a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].VolagNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line9b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line9a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line10_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line10_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line12CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line14_CountryofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line15_CountryofResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line13_CountryofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line11_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line10_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line2a_StreetNumberName[0]": {
    "type": "text",
    "source": "client.employer_address_line1"
  },
  "form1[0].#subform[1].Pt2Line2b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line2b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line2b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line2b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line2c_CityOrTown[0]": {
    "type": "text",
    "source": "client.employer_city"
  },
  "form1[0].#subform[1].Pt2Line2f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line2g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line2e_ZipCode[0]": {
    "type": "text",
    "source": "client.employer_zip"
  },
  "form1[0].#subform[1].Pt2Line2d_State[0]": {
    "type": "dropdown",
    "source": "client.employer_state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[1].Pt2Line2h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line1_EmployerOrCompName[0]": {
    "type": "text",
    "source": "client.employer"
  },
  "form1[0].#subform[1].Pt1Line17_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line19_CountryofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line21_CountryofResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line20_CityTownVillageofRes[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line18_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line16_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line16_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line16_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line3_Occupation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line4a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line4b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line5_EmployerOrCompName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line12_Male[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line12_Female[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line19_Male[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line19_Female[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line7_Occupation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line3_Occupation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line1_EmployerOrCompName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line8a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line8b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line4a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line4b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line1Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line2_RepresentativeName[0]": {
    "type": "text",
    "source": "attorney.full_name"
  },
  "form1[0].#subform[2].Pt4Line3_DaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[2].Pt4Line5_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[2].Pt4Line4_MobileNumber1[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[2].Pt3Line2a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line2h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line1Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line6a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line2_InterpreterBusinessorOrg[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line1b_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line1a_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3h_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5_NameofLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt6Line1b_PreparerGivenName[0]": {
    "type": "text",
    "source": "attorney.first_name"
  },
  "form1[0].#subform[3].Pt6Line2_BusinessName[0]": {
    "type": "text",
    "source": "firm.firm_name"
  },
  "form1[0].#subform[3].Pt6Line1a_PreparerFamilyName[0]": {
    "type": "text",
    "source": "attorney.last_name"
  },
  "form1[0].#subform[3].Pt5Line4_InterpreterDaytimeTelephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line4_InterpreterDaytimeTelephone[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt6Line3c_CityOrTown[0]": {
    "type": "text",
    "source": "firm.city"
  },
  "form1[0].#subform[3].Pt6Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "firm.address_line1"
  },
  "form1[0].#subform[3].Pt6Line3b_Unit[0]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[3].Pt6Line3b_Unit[1]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[3].Pt6Line3b_Unit[2]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[3].Pt6Line3b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "firm.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[3].Pt6Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt6Line3e_ZipCode[0]": {
    "type": "text",
    "source": "firm.zip"
  },
  "form1[0].#subform[3].Pt6Line3d_State[0]": {
    "type": "dropdown",
    "source": "firm.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[3].Pt6Line3h_Country[0]": {
    "type": "text",
    "source": "literal:UNITED STATES"
  },
  "form1[0].#subform[3].Pt6Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line5_PreparerFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line4_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "attorney.phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].Pt6Line6_Email[0]": {
    "type": "text",
    "source": "attorney.email"
  },
  "form1[0].#subform[4].Pt6Line7_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line7_Checkbox[1]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[4].Pt6Line7b_Checkbox[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[4].Pt6Line7b_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line8a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line8b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt1Line3a_FamilyName[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[5].Pt1Line3b_GivenName[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[5].Pt1Line3c_MiddleName[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[5].Pt7Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line7a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line7b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line7c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt7Line7d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt1Line1_AlienNumber[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  }
}'::jsonb
WHERE form_key = 'i-130a';
