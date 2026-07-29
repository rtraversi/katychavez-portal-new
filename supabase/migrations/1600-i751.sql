-- Migration 1600-i751: I-751 field map + template registration
--
-- Petition to Remove Conditions on Residence (case_type key = 'remove_conditions').
-- Filed by a conditional permanent resident who received a 2-year green card
-- through marriage, to have the conditions removed during the 90 days before
-- that status expires. Normally filed jointly with the U.S. citizen or LPR
-- spouse; may also be filed alone under one of the Part 3 waiver grounds. A
-- child who gained conditional residence through a parent's marriage may be
-- included, or may file separately.
--
-- Source:  uscis-forms/i-751.pdf
-- Edition: 04/01/24
-- SHA-256: 064f773369f0bda068e3a4fbe1a1c6447a8830cfd6777a8d5a81148be5a36510
--
-- 318 field(s): 126 CheckBox, 180 TextField, 12 Dropdown.
-- Field inventory: normalized/i-751.fields.json
-- Field semantics: normalized/i-751.tooltips.tsv
--
-- ── TERMINOLOGY: "Petitioner" means two different things on this form ─────────
--
-- The I-751's own text calls the CONDITIONAL RESIDENT "the Petitioner" (Part 7
-- is headed "Petitioner's Statement"). The database means the sponsoring spouse
-- by that word. Mapped as:
--
--   Parts 1, 7, 11   the conditional resident       -> client.* / immigration.*
--   Parts 4, 8       the U.S. citizen / LPR spouse  -> petitioner.*
--                    (opposing_parties, party_role='primary'; see
--                     1602-petitioner-party.sql. _fill-context.js defaults a
--                     missing party_role to 'primary', so legacy rows resolve.)
--
-- Reversing these puts the spouse's data in the conditional resident's boxes,
-- passes every automated check, and lands on a filed immigration form. Every
-- field below was mapped from its own tooltip, never from its field name.
--
-- NOTE FOR REVIEW: this is the FIRST field map in the library to use
-- petitioner.*, so the resolver has never run on real data for this source.
-- Worth extra attention at the section 8 accuracy gate.
--
-- ── Field-name traps found on this form ──────────────────────────────────────
--
--   - The two Part 1 address blocks differ only by a "Pt1" prefix, and the
--     UNPREFIXED one is the EARLIER item:
--         Line17c_*     -> item 15.c  (Mailing Address)
--         Pt1Line17_*   -> item 17.c  (Physical Address)
--   - Part 1 checkbox names run two behind their item numbers:
--         Line17_Checkbox = item 18   Line18_Checkbox = item 19
--         Line19_Checkbox = item 20   Line20_Checkbox = item 21
--         Line21_Checkbox = item 22   Line22_Checkbox = item 23
--   - Part 10's street field is named Pt9Line3_StreetNumberName but belongs to
--     the Preparer's mailing address (Part 10, item 3.a).
--   - Yes/No index polarity is inconsistent between adjacent pairs:
--     items 16/19/21/22 are [0]=No, [1]=Yes; items 18/20/23 are [0]=Yes, [1]=No.
--   - Item 10 marital-status indices are not in printed order:
--     [0]=Married, [1]=Widowed, [2]=Single, [3]=Divorced.
--   - Part 4 relationship indices are reversed: [0]=1.b (Parent's Spouse),
--     [1]=1.a (Spouse).
--   - The tooltip for Part 4 item 2.b reads "Given Name (Family Name)" — a USCIS
--     tooltip typo. The printed form (page 3) says "Given Name (First Name)".
--   All eight Apt/Ste/Flr trios were confirmed against their own tooltips. On
--   this form all eight are [0]=Apt, [1]=Ste, [2]=Flr — but that is NOT the
--   order 1600-g28.sql uses, so do not carry it forward to another form.
--
-- ── Mapping decisions ────────────────────────────────────────────────────────
--
--   - Header block: G-28 attached <- literal:true (1600-i821d.sql G28_Attached
--     precedent — if the firm generates this through the portal, an attorney is
--     on the matter). Bar number and ELIS number <- attorney.*, matching
--     I-765/I-821D/N-400. Part 1 item 9 is the APPLICANT's USCIS online account
--     number (immigration.uscis_account_number) — a different field from the
--     attorney's ELIS number in the header block.
--   - Part 1: legal name / DOB / country of birth / country of citizenship /
--     A-Number / SSN data-mapped. Items 11-12 (date and place of marriage) <-
--     matter.date_of_marriage / matter.place_of_marriage. These are staff-entry
--     only today: the client-portal intake gates them behind MARRIAGE_CASE_TYPES,
--     which does not include remove_conditions. Rob is adding the marriage
--     fields to the Immigration client card, after which they populate normally.
--   - Part 1 addresses: item 15 (Mailing — always required) <- client address;
--     item 17 (Physical — required only when item 16 = Yes) left blank. We hold
--     one address per client, so the always-required block is the one to fill.
--     Item 16 itself is the attorney's call; asserting "No" is a claim the data
--     does not support (1600-n400.sql made the same call for its mailing block).
--   - Part 2 biographic (ethnicity/race/height/weight/eye/hair): blank, per the
--     biometrics rule and the 1600-n400.sql Part 4 precedent.
-- FIRM CONVENTION: countries and last names are capitalized in full
-- ("UNITED STATES", "VILLALOBOS") — confirmed with Katy. Literals in this map
-- are written uppercase, matching 1600-i864.sql and 1600-i485.sql. The
-- data-driven half CANNOT be satisfied yet: there is no uppercase transform in
-- applyTransform (functions/api/_form-fill.js) — the only toUpperCase there is
-- inside state_abbrev, for 2-letter codes — and one was NOT added here, per
-- USCIS-FORM-PREP-PROCESS.md section 6. Escalated on the I-864 PR as a
-- cross-cutting item affecting every last-name and country box across all six
-- of Katy's forms; one jsonb-merge migration (1600-g28-atty-fields.sql style)
-- applies it library-wide once the transform ships, so no rework is needed
-- here. Affected in this map: client.last_name, petitioner.last_name,
-- attorney.last_name, immigration.country_of_birth and
-- immigration.country_of_citizenship.
--
--   - Part 3 basis for petition (joint filing vs. each waiver ground): blank.
--     This is the attorney's professional judgment and the central legal
--     decision of the entire form.
--   - Part 4 <- petitioner.*, items 2 through 6.e. Items 6.f-6.h (Province,
--     Postal Code, Country) left blank: unlike an N-400 applicant, the Part 4
--     individual has no U.S.-residence requirement, so literal:UNITED STATES is
--     NOT safe here even though 1600-n400.sql and 1600-i821d.sql use it for the
--     applicant's own address. Item 1 (Spouse vs. Parent's Spouse) is blank — it
--     tracks the Part 3 basis, and petitioner.relationship_to_client is free
--     text that no existing transform can turn into a checkbox.
--   - Part 5 children (5 rows x 20 fields): entirely blank. The only available
--     source is immigration.family.<n>.*, which is positional — a family list
--     holding a spouse or parent at index 0 would put that person in "Child 1",
--     and a missing member blanks silently, so a wrong index is invisible. A
--     relationship-aware source is the same future _form-fill.js enhancement
--     1600-n400.sql called for. No field map in the library uses family.* today.
--   - Part 6 disability accommodations: blank (narrative + disability data).
--   - Part 7 (the conditional resident): contact info <- client.phone /
--     client.cell_phone / client.email. Statement checkboxes, interpreter
--     language, preparer name, ASC acknowledgement name, signature and date all
--     blank.
--   - Part 8 (the Part 4 spouse): contact info <- petitioner.cell_phone +
--     petitioner.email; everything else blank as Part 7. opposing_parties has
--     cell/home/work but no generic "phone" column, and the client-facing intake
--     collects cell and home but not work, so item 3 "Daytime Telephone" <-
--     cell_phone — matching the portal's own cell_phone || home_phone contact
--     display convention, and the number likeliest to be both populated and
--     answered. NOTE: items 3 and 4 therefore both receive the cell number when
--     that is the only one on file. That is what a filer with only a mobile
--     would genuinely write, but it is worth a glance at the accuracy gate.
--   - Part 9 interpreter: entirely blank (1600-n400.sql precedent).
--   - Part 10 preparer <- attorney.* + firm.* (1600-n400.sql Part 12 precedent),
--     including the firm mailing address and literal:UNITED STATES for item 3.h
--     — which IS safe here, because the firm is U.S.-based. Item 7.b ("I am an
--     attorney or accredited representative") <- literal:true, following
--     1600-i765.sql, which maps 7.a blank and 7.b literal:true. I-765 goes
--     further and also pre-fills the extends / does-not-extend sub-choice; that
--     pair is left blank here as the more conservative call, since scope of
--     representation is the attorney's. A firm that always works one way should
--     set it as a firm-level template default (Settings -> template defaults,
--     firm_overrides), which sits over this map at generate time, rather than
--     baking it into the map.
--   - Part 11 continuation page: name + A-Number <- client / immigration. The
--     Page/Part/Item Number and free-text boxes stay blank (narrative).
--   - All signatures and signature dates blank (wet signature required).
--
-- ── Deliberately blank that a reader might expect to be filled ───────────────
--
--   - Item 20 (ever arrested, charged, detained) — immigration.has_criminal_history
--     EXISTS and is deliberately not mapped. A "No" is never auto-checked on the
--     criminal / security battery.
--   - Item 18 (in removal proceedings) — immigration.has_prior_removal_order
--     exists but means a PRIOR REMOVAL ORDER, not currently-in-proceedings.
--     A different question; mapping it would be wrong.
--   - Item 10 marital status — no unambiguous column (matter.separation_status is
--     family-law separation, not USCIS marital status).
--   - Items 2.a-3.c "Other Names Used" — client.former_maiden_name exists but is
--     one free-text column against three split name boxes, and is used by no
--     existing field map. Same call as 1600-n400.sql.
--   - Part 7 / Part 8 ASC acknowledgement name boxes — single full-name fields,
--     and there is no client.full_name virtual column (only attorney, petitioner
--     and joint_sponsor have one in _form-fill.js resolvePath).
--
-- ── Candidate future columns (escalated; Rob confirmed blank for now) ────────
--
--   - Item 14, "Conditional Residence Expires On" — the highest-value missing
--     column on this form: the entire filing window (the 90 days before expiry)
--     depends on it. No column exists; immigration.i94_expiry is the I-94, not
--     the 2-year green card. Candidate:
--     client_immigration.conditional_residence_expires (label being confirmed
--     with Katy).
--   - Item 13, "date the marriage ended (divorce or death)" — no column;
--     matter.separation_date is separation, not divorce or death.
--   Note: immigration.case_data is not a workaround. resolvePath does a flat
--   bucket[rest] lookup, so a dotted subpath resolves to undefined.
--
-- 318 map entries: 59 data-mapped, 3 literal, 256 deliberately blank.
-- Requires the a_number / digits / date_slash / state_abbrev / unit_number /
-- unit_is_apt / unit_is_ste / unit_is_flr transforms shipped in
-- functions/api/_form-fill.js. No package rows are created here — packages are
-- being redesigned (USCIS-FORM-PREP-PROCESS.md section 5).

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-751', 'Form I-751 — Petition to Remove Conditions on Residence')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key      = 'form-templates/i-751.pdf',
    field_count = 318,
    field_map   = '{
  "form1[0].#subform[0].G28[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "attorney.bar_number"
  },
  "form1[0].#subform[0].USCISELISAcctNumber[0]": {
    "type": "text",
    "source": "attorney.uscis_account_number"
  },
  "form1[0].#subform[0].Pt1Line1a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].Pt1Line1b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].Pt1Line1c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].P1_Line2a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line2c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line3c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line4_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[0].P1_Line11_DateOfMarriage[0]": {
    "type": "text",
    "source": "matter.date_of_marriage",
    "transform": "date_slash"
  },
  "form1[0].#subform[0].P1_Line12_PlaceOfMarriage[0]": {
    "type": "text",
    "source": "matter.place_of_marriage"
  },
  "form1[0].#subform[0].P1_Line13_DateMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line14_CRExpiresOn[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line7_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].Part1_Line10_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Line10_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Line10_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Part1_Line10_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line9_AcctIdentifier[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[0].P1_Line6_CountryOfCitizenship[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[0].P1_Line8_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full",
    "transform": "digits"
  },
  "form1[0].#subform[0].P1_Line5_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[1].Line17a_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Line17d_City_Town[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[1].Line17b_Street_Number_Name[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[1].Line17c_Apt_Ste_Flr_Number[0]": {
    "type": "text",
    "source": "client.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[1].Line17c_Unit[0]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[1].Pt1Line15f_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[1].Pt1Line15e_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[1].Line17c_Unit[1]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[1].Line17c_Unit[2]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[1].Line16_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line16_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line17_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line18_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line19_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line19_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line18_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line17_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line17_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line17_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line17_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line17_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line17_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line17_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line17_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line17_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line17_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line20_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line20_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line21_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line21_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line22_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Line22_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line8_HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line8_HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line9_HeightInches1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line9_HeightInches2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_Line9_HeightInches3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox6[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox6[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox7_Hawaiian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox7_Indian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox7_White[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox7_Asian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox7_Black[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox10[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox10[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox10[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox10[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox10[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox10[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox10[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox10[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox10[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox11[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox11[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox11[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox11[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox11[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox11[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox11[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox11[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P3_checkbox11[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line1c[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line1d[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line1e[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line1f[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt3Line1g[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Relationship[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part4_Relationship[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line2b_GivenName2[0]": {
    "type": "text",
    "source": "petitioner.first_name"
  },
  "form1[0].#subform[2].Pt4Line2a_FamilyName2[0]": {
    "type": "text",
    "source": "petitioner.last_name"
  },
  "form1[0].#subform[2].Pt4Line2c_MiddleName2[0]": {
    "type": "text",
    "source": "petitioner.middle_name"
  },
  "form1[0].#subform[2].Line3_DateOfBirth[0]": {
    "type": "text",
    "source": "petitioner.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[2].Line4_SSN[0]": {
    "type": "text",
    "source": "petitioner.ssn_full",
    "transform": "digits"
  },
  "form1[0].#subform[2].Line5_AlienNumber[0]": {
    "type": "text",
    "source": "petitioner.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[2].Pt4Line6_CityOrTown[0]": {
    "type": "text",
    "source": "petitioner.city"
  },
  "form1[0].#subform[2].Pt4Line6_StreetNumberName[0]": {
    "type": "text",
    "source": "petitioner.address_line1"
  },
  "form1[0].#subform[2].Pt4Line6_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "petitioner.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[2].Pt4Line6_ZipCode[0]": {
    "type": "text",
    "source": "petitioner.zip"
  },
  "form1[0].#subform[2].Pt4Line6_State[0]": {
    "type": "dropdown",
    "source": "petitioner.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[2].Pt4Line6_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line6_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt4Line6_Unit[0]": {
    "type": "checkbox",
    "source": "petitioner.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[2].Pt4Line6_Unit[1]": {
    "type": "checkbox",
    "source": "petitioner.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[2].Pt4Line6_Unit[2]": {
    "type": "checkbox",
    "source": "petitioner.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[2].Pt4Line6_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line1b_GivenName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line1a_FamilyName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line1c_MiddleName3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line2_DateOfBirth2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Line3_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Part5Line5[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part5Line6[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part5Line6[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Part5Line5[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line6_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line13b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line13a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line13c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line14_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line15_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line11[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line12[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line12[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line11[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line12_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line13b_GivenName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line13a_FamilyName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line13c_MiddleName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line14_DateOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line15_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line17[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line18[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line18[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line17[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt5Line18_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line13b_GivenName[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line13a_FamilyName[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line13c_MiddleName[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line14_DateOfBirth[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Line15_AlienNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line23[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line24[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line24[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Part5Line23[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line24_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line13b_GivenName[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line13a_FamilyName[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line13c_MiddleName[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line14_DateOfBirth[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Line15_AlienNumber[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5Line29[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5Line30[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5Line30[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part5Line29[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt5Line30_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Part6Line1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part6Line2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part6Line3[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part6Line3[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part6Line2[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Part6Line1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line4_DeafOrHardOfHearing[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line4a_chbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line4b_chbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line4_BlindOrSightImpaired[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line4_AccomodationRequested[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt6Line4c_chbx[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P5_Checkbox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P5_Checkbox1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt5Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P5_Checkbox2[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P5_Line2_NameofRepresentative[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P5_Checkbox2_Who[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P5_Checkbox2_Who[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P5_Line5_EmailAddress[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[5].P5_Line3_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[5].P5_Line4_MobilePhoneNumber[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[5].P7_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P5_Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P5_Line6a_SignatureofPetitioner[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Checkbox1[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P8_Checkbox1[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt7Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P5_Checkbox2[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P7Line2_NameofRepresentative[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P7_Checkbox2_Who[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P7_Checkbox2_Who[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P5_Line5_EmailAddress[1]": {
    "type": "text",
    "source": "petitioner.email"
  },
  "form1[0].#subform[6].P5_Line4_MobilePhoneNumber[1]": {
    "type": "text",
    "source": "petitioner.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[6].P5_Line3_DaytimePhoneNumber[1]": {
    "type": "text",
    "source": "petitioner.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[7].Pt8_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P6_Line1b_InterpretersGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P6_Line1a_InterpretersFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P6_Line2_NameofBusinessor[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P6_Line3a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt9Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].P5_Line6b_DateofSignature[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P5_Line6a_SignatureofSpouse[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P6_Line5_InterpretersEmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P6_Line4_InterpretersDaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Line6a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P6_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P7_Line1a_FamilyName[0]": {
    "type": "text",
    "source": "attorney.last_name"
  },
  "form1[0].#subform[8].P7_Line1b_PreparersGivenName[0]": {
    "type": "text",
    "source": "attorney.first_name"
  },
  "form1[0].#subform[8].P7_Line2_NameofBusinessor[0]": {
    "type": "text",
    "source": "firm.firm_name"
  },
  "form1[0].#subform[8].P7_Line6_PreparersEmailAddress[0]": {
    "type": "text",
    "source": "attorney.email"
  },
  "form1[0].#subform[8].P7_Line4_PreparersDaytimePhoneNumber[0]": {
    "type": "text",
    "source": "attorney.phone",
    "transform": "digits"
  },
  "form1[0].#subform[8].P7_Line5_PreparersFaxNumber[0]": {
    "type": "text",
    "source": "attorney.fax",
    "transform": "digits"
  },
  "form1[0].#subform[8].P7_Line3c_CityTown[0]": {
    "type": "text",
    "source": "firm.city"
  },
  "form1[0].#subform[8].Pt9Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "firm.address_line1"
  },
  "form1[0].#subform[8].Pt10Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "firm.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[8].P7_Line3f_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P7_Line3e_ZipCode[0]": {
    "type": "text",
    "source": "firm.zip"
  },
  "form1[0].#subform[8].P7_Line3d_State[0]": {
    "type": "dropdown",
    "source": "firm.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[8].P7_Line3h_Country[0]": {
    "type": "text",
    "source": "literal:UNITED STATES"
  },
  "form1[0].#subform[8].P7_Line3g_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt10Line3_Unit[0]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[8].Pt10Line3_Unit[1]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[8].Pt10Line3_Unit[2]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[8].P7_checkbox7[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P7_checkbox7[1]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[8].Pt10Item7b_Extends[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt10Item7b_NotExtend[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line8a_SignatureofPreparer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7_Line8b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt1Line1a_FamilyName[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[10].Pt1Line1b_GivenName[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[10].Pt1Line1c_MiddleName[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[10].P8_Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line7a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line7b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line7c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line7d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8_Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P1_Line7_AlienNumber[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  }
}'::jsonb
WHERE form_key = 'i-751';
