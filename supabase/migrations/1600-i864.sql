-- Migration 1600-i864: I-864 field map + template registration
--
-- Affidavit of Support Under Section 213A of the INA. A legally enforceable
-- contract in which a SPONSOR (the petitioning relative, a joint sponsor, a 5%
-- business owner, or a substitute sponsor) accepts financial responsibility for
-- an intending immigrant, demonstrating the immigrant is not likely to become a
-- public charge. Required for most family-based and some employment-based
-- adjustment-of-status and consular-processing filings.
--
-- Source:  uscis-forms/i-864.pdf
-- Edition: 10/17/24 (printed lower-left; OMB expires 10/31/2027)
-- SHA-256: f231f39684ba4dd348aad920a65f29ef5707270f39d6f8328ab43e366348f5f5
--
-- 207 field(s): 41 CheckBox, 163 TextField, 3 Dropdown.
-- Field inventory: normalized/i-864.fields.json
-- Field semantics: normalized/i-864.tooltips.tsv
--
-- ⚠ PARTY ROLES ARE INVERTED RELATIVE TO EVERY OTHER FORM IN THE LIBRARY.
-- On the I-864 the SPONSOR fills out the form and the immigrant is the subject:
--
--   Part 2  "Information About You, the Sponsor"      -> petitioner.*
--   Part 3  "Information About the Principal Immigrant" -> client.*
--
-- This is the reverse of I-751/N-400/I-821D, where Part 1/Part 2 is the client.
-- Per migration 1602, on immigration matters the client IS the beneficiary and
-- opposing_parties is the petitioner/sponsor. Carrying another form's pattern
-- across would put the sponsor's SSN in the immigrant's boxes and pass every
-- automated check we have -- the validator cannot see this class of error.
--
-- ⚠ THIS MAP DOES NOT USE joint_sponsor.* -- AND STRUCTURALLY CANNOT.
-- The expectation going in was that the I-864 would be the form that finally
-- exercises the joint_sponsor.* resolver shipped in migration 1604. It does
-- not. The I-864 has no joint-sponsor data block: a joint sponsor files their
-- OWN complete I-864, in which THEY are the person described in Part 2. The
-- only joint-sponsor references on the whole form are the Part 1 basis
-- checkboxes 1.d/1.e ("I am the only joint sponsor" / "first or second of two
-- joint sponsors"), which are eligibility selections and blank here.
--
-- So which party Part 2 draws from is a per-generated-document question, not a
-- static field-map one, and a field map has no way to express it. Mapping
-- Part 2 to joint_sponsor.* would be wrong for the ordinary petitioner-sponsor
-- case, which is the common one.
--
-- CONSEQUENCE FOR VERIFICATION: joint_sponsor.* remains UNEXERCISED by any
-- field map in the library. Generating an I-864 will not test that resolver --
-- it will not fire at all. Section 8 of USCIS-FORM-PREP-PROCESS.md says to
-- verify I-864 first on the theory that it covers joint_sponsor.*; that
-- premise does not hold, and a clean I-864 must NOT be read as evidence that
-- the 1604 plumbing works. Supporting a joint sponsor end to end needs a way
-- to choose the sponsoring party at generate time (e.g. a per-document party
-- selector, or a second template keyed to joint_sponsor.*). Rob's call --
-- escalated, not worked around.
--
-- Field NAMES on this form do not match their own parts -- Part 2's fields are
-- named P4_*, Part 3's are named P2_*, and P4_Line7_CityofBirth is actually
-- "Country of Birth" (confirmed against the printed form, page 2). Every source
-- below was derived from normalized/i-864.tooltips.tsv, never from a name.
--
-- ⚠ FIRM CONVENTION (applies to every form from here on, not just this one):
-- this office capitalizes COUNTRIES and LAST NAMES in full -- "UNITED STATES",
-- "VILLALOBOS". Two halves, and only one of them is satisfied below:
--   - Literals are written uppercase directly. Done here.
--   - Data-driven values CANNOT be uppercased. There is no uppercase transform
--     in applyTransform (functions/api/_form-fill.js); the only toUpperCase
--     there is inside state_abbrev, for 2-letter codes. Per
--     USCIS-FORM-PREP-PROCESS.md section 6 one was NOT added here. Every
--     last_name and country field below is therefore mapped normally and will
--     fill in whatever case the database holds.
--   ESCALATED, CROSS-CUTTING, HIGH PRIORITY: this affects every last-name and
--   country box across all six of Katy's forms (I-751, I-864, I-130, I-130A,
--   I-485, N-400), not just this map. One transform on Rob's side fixes the
--   whole library; six field maps otherwise ship non-conforming. Affected here:
--   petitioner.last_name (Part 2 item 1, Part 11), client.last_name (Part 3
--   item 1), attorney.last_name (Part 10 item 1), and
--   immigration.country_of_citizenship (Part 3 item 3).
--
-- Notable decisions:
--   - Attorney header <- attorney.bar_number + attorney.uscis_account_number;
--     G-28 attached checkbox = literal:true (1600-i821d precedent).
--   - Part 1 (basis for filing: petitioner / 5% owner / only joint sponsor /
--     first-or-second of two / substitute sponsor): entirely blank. This is an
--     eligibility-basis selection and drives which later parts apply -- the
--     attorney's call, same treatment as N-400 Part 1. The 1.b/1.c/1.f
--     relationship free-text boxes stay blank with it: they are only valid
--     under a basis we are not selecting, so filling them from
--     petitioner.relationship_to_client would assert a basis we did not choose.
--   - Part 2 item 2 (mailing address, required) <- petitioner.address_line1/2 +
--     city/state/zip; country = literal:UNITED STATES (1600-n400 precedent,
--     uppercased per the firm convention above; safe here because a sponsor
--     must be U.S.-domiciled -- see item 5).
--     Unit trio order tooltip-verified per block: item 2 and item 4 are both
--     [0]=Apt [1]=Ste [2]=Flr -- NOT the order used on G-28 or I-821D.
--   - Part 2 item 4 (physical address, "if different from above") stays blank,
--     and item 3 ("is mailing the same as physical?" Yes/No) is NOT mapped
--     here. Item 3 is a firm-workflow answer, not case data: it belongs in
--     Settings -> template defaults (firm_overrides) as a standing "Yes", which
--     is what makes a blank item 4 correct rather than incomplete -- USCIS only
--     wants item 4 filled when item 3 is No. Firm practice is that mailing and
--     physical are almost always the same. RECOMMEND adding that default.
--   - opposing_parties.mailing_address_line1/city/state/zip were considered for
--     item 2 and rejected: those columns are display-only leftovers from
--     migration 004 with NO input anywhere in the portal (pages/clients/detail
--     detail.js:810/885 read them, nothing writes them). They are unmappable in
--     practice, not merely unmapped -- worth cleaning up or wiring separately.
--     They also have no address_line2 equivalent, so the Apt/Ste/Flr trio could
--     not be driven from them even if they were populated.
--   - Part 2 item 5 (Country of Domicile) = literal:UNITED STATES. NOTE THE
--     REASONING, and do not "correct" this to match the I-751 Part 4 country
--     box, which is deliberately blank: the two are not the same case. The
--     I-864 legally REQUIRES the sponsor to be domiciled in the United States
--     (INA 213A) -- it is a condition of sponsorship, not an assumption we are
--     making about where someone happens to live. That is what makes the
--     literal safe here and unsafe there. Flagged for Rob's eye.
--   - Part 2 item 12 (active-duty military, Yes/No) blank: no data column, and
--     a "No" is never auto-checked.
--   - Part 3 (principal immigrant) <- client.* + immigration.*. Its fields are
--     NAMED P2_* -- see the naming warning above. Unit trio tooltip-verified
--     [0]=Apt [1]=Ste [2]=Flr. Daytime phone <- client.phone (1600-n400
--     precedent).
--   - Part 3 item 2 mailing-address Country is left BLANK, deliberately
--     diverging from Part 2, which uses a literal. The I-864 serves consular
--     processing as well as adjustment of status, and on a consular case the
--     principal immigrant is by definition still abroad -- the Province and
--     Postal Code boxes in this same block exist for exactly that. Nothing
--     requires the immigrant to be in the U.S., so nothing makes a literal
--     safe. Province/Postal Code blank for the same reason.
--   - Part 5 (household size): only item 2 "Yourself" is filled, as
--     literal:1 -- USCIS itself dictates that value ("The number one is
--     entered in this space for you"). Items 1 and 3-8, including the item 8
--     total, stay blank: they are counts with no data columns, and household
--     size is the denominator of the poverty-guideline test that decides
--     whether the sponsor qualifies. Not a field to guess at.
--   - Part 6 item 2 employer <- petitioner.employer; item 7 current individual
--     annual income <- petitioner.gross_annual_income. FLAGGED for field-by-
--     field check: that column is self-reported at intake and may be stale or
--     may differ from the adjusted-gross-income figure on the tax returns
--     filed as evidence. The employment-status checkboxes (employed / self-
--     employed / retired / unemployed) stay blank -- deriving them would need
--     a "column is non-empty" transform, which does not exist, and a checkbox
--     source that is not literally Yes/true silently resolves to unchecked.
--     P6_Line1a_NameofEmployer is named misleadingly: its tooltip says "enter
--     what you are employed as" (occupation) -- blank, no occupation column.
--     Items 8-11 (household members combining income), item 12 total, items
--     15-17 (tax-return history and years) all blank: no columns, and the
--     totals are computed from fields the attorney fills.
--   - Part 7 (assets used to supplement income) entirely blank: no asset
--     columns exist, and this Part is only completed when income falls below
--     the guidelines -- an attorney determination.
--   - Part 8: sponsor contact only (daytime phone / mobile / email). The
--     contract, interpreter and preparer statements, certification, signature
--     and signature date stay blank. Item 2's preparer-name box <-
--     attorney.full_name (factual), while the attestation checkbox above it
--     stays blank.
--   - Part 9 (interpreter) entirely blank, per the N-400 precedent.
--   - Part 10 (preparer) <- attorney.last_name/first_name/phone/email +
--     firm.firm_name/firm.fax. Signature and date blank.
--   - Part 11 items 1-2 are pre-filled-from-page-1 boxes (read-only flag
--     cleared at normalize time), so they are the SPONSOR's name and A-number,
--     NOT the immigrant's -- another place the role inversion bites. The
--     page/part/item-number and additional-information boxes stay blank.
--
-- ⚠ PART 4 IS ENTIRELY BLANK -- KNOWN PLATFORM LIMITATION, NOT AN OVERSIGHT.
-- Part 4 lists the family members being sponsored alongside the principal
-- immigrant (four rows: name, relationship to principal immigrant, DOB,
-- A-number, USCIS account number). The only available source is
-- immigration.family.<n>.<col>, which is POSITIONAL ONLY -- there is no way to
-- filter by relationship. A spouse sitting at index 0 would land in the first
-- sponsored-family slot invisibly, and a missing member at that index resolves
-- to blank rather than erroring, so a wrong index and an empty field look
-- identical on the generated PDF. On this form the consequence is financial:
-- everyone listed in Part 4 counts toward the household size that the income
-- test is measured against.
-- This is the same blocker that stopped I-751 Part 5 and the N-400 children
-- section -- the third form to hit it. It needs a relationship-aware source
-- (e.g. immigration.spouse.<col> / immigration.child.<n>.<col>) in
-- functions/api/_form-fill.js, which is Rob's call per section 6. NOT worked
-- around here. Part 4 items 1-3 (which set of family members is being
-- sponsored, and whether the principal immigrant is included) are blank
-- regardless -- those are filing-strategy selections.
--
-- Escalated -- blank pending Rob, all on the sponsor (Part 2):
--   - item 7 Country of Birth: no opposing_parties.country_of_birth column.
--     (place_of_birth exists but is unconstrained free text and no field map
--     has ever used it for a country box.) Candidate future column.
--   - item 9 Immigration Status (U.S. citizen / U.S. national / LPR): the data
--     exists as petitioner.immigration_status ("US Citizen" / "Lawful Permanent
--     Resident" / "Other", per migration 1602), but checking one of three
--     boxes needs a string-equality transform and none exists. Candidate
--     transform, e.g. equals:<value>. High value -- this is on every I-864.
--   - item 11 USCIS Online Account Number: no opposing_parties.uscis_account_
--     number column (only client_immigration and users have one).
--   - no uppercase transform for last names / countries -- see the firm
--     convention block above. Cross-cutting across six forms.
--   - Part 4: no relationship-aware family-member source -- see above.
--
-- Part 8 sponsor phones: item 3 (DAYTIME) and item 4 (MOBILE) BOTH <-
-- petitioner.cell_phone, matching what I-751 does for the sponsor's daytime
-- box. opposing_parties has home_phone, work_phone and cell_phone but NO
-- generic "phone" column, unlike clients, so there is no exact counterpart to
-- the client.phone that 1600-n400 uses for the same box. home_phone was
-- considered and rejected: it is empty for most people now, which would leave
-- the daytime box -- the number USCIS actually calls -- blank on most filings,
-- and it would put a different number than I-751 does for the same person in
-- the same packet. Consequence, same as I-751 documents: when a cell is the
-- only number on file, items 3 and 4 carry the SAME value. Flagged for Rob's
-- field-by-field check.
--
-- 207 map entries (48 data-mapped, 4 literal, 155 deliberately blank);
-- XFA barcode fields stamped+removed at normalize time. Field inventory:
-- normalized/i-864.fields.json. Requires the a_number/digits/state_abbrev/
-- date_slash/unit_number/unit_is_* transforms already shipped in
-- functions/api/_form-fill.js -- no new transform is required to apply this
-- map as written.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-864', 'Form I-864 -- Affidavit of Support Under Section 213A of the INA')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key      = 'form-templates/i-864.pdf',
    field_count = 207,
    field_map   = '{
  "form1[0].#subform[0].G28-CheckBox1[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "attorney.bar_number"
  },
  "form1[0].#subform[0].USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "attorney.uscis_account_number"
  },
  "form1[0].#subform[0].P1_Line1a-f_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1a-f_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1b_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1a-f_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1c_InterestIn[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1c_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1a-f_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1a-f_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1e1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1e1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1a-f_CB[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].P1_Line1f_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].P4_Line1a_FamilyName[0]": {
    "type": "text",
    "source": "petitioner.last_name"
  },
  "form1[0].#subform[0].P4_Line1b_GivenName[0]": {
    "type": "text",
    "source": "petitioner.first_name"
  },
  "form1[0].#subform[0].P4_Line1c_MiddleName[0]": {
    "type": "text",
    "source": "petitioner.middle_name"
  },
  "form1[0].#subform[1].P4_Line2a_InCareOf[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line2b_StreetNumberName[0]": {
    "type": "text",
    "source": "petitioner.address_line1"
  },
  "form1[0].#subform[1].P4_Line2c_Unit[0]": {
    "type": "checkbox",
    "source": "petitioner.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[1].P4_Line2c_Unit[1]": {
    "type": "checkbox",
    "source": "petitioner.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[1].P4_Line2c_Unit[2]": {
    "type": "checkbox",
    "source": "petitioner.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[1].P4_Line2d_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "petitioner.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[1].P4_Line2e_CityOrTown[0]": {
    "type": "text",
    "source": "petitioner.city"
  },
  "form1[0].#subform[1].P4_Line2f_State[0]": {
    "type": "dropdown",
    "source": "petitioner.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[1].P4_Line2g_ZipCode[0]": {
    "type": "text",
    "source": "petitioner.zip"
  },
  "form1[0].#subform[1].P4_Line2h_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line2i_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line2j_Country[0]": {
    "type": "text",
    "source": "literal:UNITED STATES"
  },
  "form1[0].#subform[1].P1_Line3_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P1_Line3_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4c_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4d_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4e_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4f_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4h_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4g_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line4i_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line5_CountryOfDomicile[0]": {
    "type": "text",
    "source": "literal:UNITED STATES"
  },
  "form1[0].#subform[1].P4_Line6_DateOfBirth[0]": {
    "type": "text",
    "source": "petitioner.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].P4_Line7_CityofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line10_SocialSecurityNumber[0]": {
    "type": "text",
    "source": "petitioner.ssn_full",
    "transform": "digits"
  },
  "form1[0].#subform[1].P4_Line11a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line11b_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line11c_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].#area[1].P4_Line12_AlienNumber[0]": {
    "type": "text",
    "source": "petitioner.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[1].P4_Line13_AcctIdentifier[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line14_Checkboxes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].P4_Line14_Checkboxes[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line1a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[2].P2_Line1b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[2].P2_Line1c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[2].P2_Line2_InCareOf[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line2_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[2].P2_Line2_Unit[0]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[2].P2_Line2_Unit[1]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[2].P2_Line2_Unit[2]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[2].P2_Line2_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "client.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[2].P2_Line2_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[2].P2_Line2_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[2].P2_Line2_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[2].P2_Line2_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line2_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line2_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line3_CountryCitizenship[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[2].P2_Line4_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[2].#area[2].P2_Line5_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[2].Pt2_Line6_USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[2].P2_Line7_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[2].P3_Line1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line2_SponsoringFamily[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line2_SponsoringFamily[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line3a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line3b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line3c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line4_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P2_Line5_AlienNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P3_Line7_AcctIdentifier[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line8a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line8b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line8c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line9_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line10_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line11_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line12_AcctIdentifier[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line13a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line13b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line13c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line14_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line15_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P2_Line5_AlienNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line17_AcctIdentifier[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line18a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line18b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line18c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line19_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line20_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line21_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].P3_Line22_AcctIdentifier[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P3_Line28_TotalNumberofImmigrants[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line2_Yourself[0]": {
    "type": "text",
    "source": "literal:1"
  },
  "form1[0].#subform[4].P5_Line3_Married[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line4_DependentChildren[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line5_OtherDependents[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line6_Sponsors[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P5_Line7_SameResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Override[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line1_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line1a_NameofEmployer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line1a1_NameofEmployer[0]": {
    "type": "text",
    "source": "petitioner.employer"
  },
  "form1[0].#subform[4].P6_Line1a2_NameofEmployer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line4_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line4a_SelfEmployedAs[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line5_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line5a_DateRetired[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line6_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line6a_DateofUnemployment[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].P6_Line2_TotalIncome[0]": {
    "type": "text",
    "source": "petitioner.gross_annual_income"
  },
  "form1[0].#subform[5].P6_Line3_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line4_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line5_CurrentIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line6_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line7_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line8_CurrentIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line9_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line10_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line11_CurrentIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line12_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line13_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line14_CurrentIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line15_TotalHouseholdIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line16_CompletedForm[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line17_NotNeedComplete[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line17_Name[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line18a_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].P6_Line18a_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P6_Line19a_TaxYear[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P6_Line19a_TotalIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P6_Line19b_TaxYear[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P6_Line19b_TotalIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P6_Line19c_TaxYear[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P6_Line19c_TotalIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P6_Line17_IWasNotReq[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].P7_Line1_BalanceofAccounts[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P7_Line2_RealEstate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P7_Line3_StocksBonds[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P7_Line4_Total[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].P7_Line5_TotalAssetsHouseholdMembers[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P7_Line6_BalanceofAccounts[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P7_Line7_RealEstate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P7_Line8_StocksBonds[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P7_Line9_Total[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].P7_Line10_TotalValueAssets[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line1_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6_Line1_Checkbox[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P8_Line1b_language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P8_Line2_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P8_Line2_Attorney[0]": {
    "type": "text",
    "source": "attorney.full_name"
  },
  "form1[0].#subform[9].P8_Line3_DaytimeTelephoneNumber[0]": {
    "type": "text",
    "source": "petitioner.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[9].P8_Line4_MobileTelephoneNumber[0]": {
    "type": "text",
    "source": "petitioner.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[9].P7Line7_EmailAddress[0]": {
    "type": "text",
    "source": "petitioner.email"
  },
  "form1[0].#subform[9].P8_Line9a_ApplicantSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P7Line9b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P9_Line1a_InterpretersFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P9_Line1b_InterpretersGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P8Line2_InterpretersBusinessName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P9_Line4_InterpretersDaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P9_Line4_InterpretersDaytimePhoneNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P9_Line5_InterpretersEmailAddress[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P9_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P9_Line6a_InterpretersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P9_Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P10_Line1a_PreparersFamilyName[0]": {
    "type": "text",
    "source": "attorney.last_name"
  },
  "form1[0].#subform[10].P10_Line1b_PreparersGivenName[0]": {
    "type": "text",
    "source": "attorney.first_name"
  },
  "form1[0].#subform[10].P10_Line2_PreparersBusinessName[0]": {
    "type": "text",
    "source": "firm.firm_name"
  },
  "form1[0].#subform[10].P10_Line4_PreparersDaytimePhoneNumber[0]": {
    "type": "text",
    "source": "attorney.phone",
    "transform": "digits"
  },
  "form1[0].#subform[10].P10_Line5_PreparersFaxNumber[0]": {
    "type": "text",
    "source": "firm.fax"
  },
  "form1[0].#subform[10].P10_Line6_PreparersEmailAddress[0]": {
    "type": "text",
    "source": "attorney.email"
  },
  "form1[0].#subform[10].P10_Line8a_PreparersSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].P10_Line8b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P4_Line1a_FamilyName[1]": {
    "type": "text",
    "source": "petitioner.last_name"
  },
  "form1[0].#subform[11].P4_Line1b_GivenName[1]": {
    "type": "text",
    "source": "petitioner.first_name"
  },
  "form1[0].#subform[11].P4_Line1c_MiddleName[1]": {
    "type": "text",
    "source": "petitioner.middle_name"
  },
  "form1[0].#subform[11].Global_ANumber[0].P4_Line12_AlienNumber[1]": {
    "type": "text",
    "source": "petitioner.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[11].P11_Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].P11_Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-864';
