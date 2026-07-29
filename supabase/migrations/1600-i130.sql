-- Migration 1600-i130: I-130 field map + template registration
--
-- Petition for Alien Relative. The petition by which a U.S. citizen or lawful
-- permanent resident establishes a qualifying family relationship with a
-- relative, creating the basis on which that relative may later adjust status
-- (I-485) or consular process. It proves the RELATIONSHIP; it does not itself
-- grant any status.
--
-- Source:  uscis-forms/i-130.pdf
-- Edition: 04/01/24 (printed lower-left; OMB expires 02/28/2027)
-- SHA-256: 7fc733d4639995d6ad4798f1031464d044bd0da4233caa4ada886e79e762a88f
--
-- 438 field(s): 290 TextField, 128 CheckBox, 20 Dropdown.
-- Field inventory: normalized/i-130.fields.json
-- Field semantics: normalized/i-130.tooltips.tsv
--
-- ⚠ PARTY ROLES ARE INVERTED -- same as the I-864, OPPOSITE of the I-485.
--   Part 2 "Information About You (Petitioner)"  -> petitioner.*
--   Part 4 "Information About Beneficiary"       -> client.*
-- The PETITIONER is the U.S. citizen / LPR filing; the BENEFICIARY is the
-- firm's client. Per migration 1602, on immigration matters the client IS the
-- beneficiary and opposing_parties is the petitioner. Getting this backwards
-- would put the beneficiary's SSN and A-Number in the petitioner's boxes and
-- pass every automated check -- the validator cannot see this class of error.
-- Every field below was checked against its own tooltip, not inferred from the
-- I-864 pattern.
--
-- ⚠ KATY'S RULES (the attorney). These override general instinct.
--
-- FATAL -- ALWAYS BLANK:
--   - Part 1 items 1 and 2 (relationship type: spouse / child / stepchild /
--     child born in or out of marriage). Katy: "very important and fatal."
--     More than one answer can look correct, so she asks for clarification on a
--     case-by-case basis. NEVER map these. Items 3 and 4 (sibling-by-adoption,
--     and whether the petitioner gained status through adoption) go blank with
--     them: same relationship determination, and a wrong "No" is an assertion.
--   - Page 8 items 61 AND 62 -- see the dedicated warning further down.
--
-- OTHER KATY RULES APPLIED THROUGHOUT:
--   - The "entry information" section covers ONLY documents actually used to
--     ENTER the United States. If the beneficiary did not enter on their
--     passport, it stays blank. Passport data is never mapped there.
--   - In Care Of (℅) is blank 99% of the time -- never mapped, anywhere.
--   - Foreign addresses get NO state and NO province.
--   - The G-28-attached checkbox is literal:true (1600-i821d / 1600-i751
--     precedent). Katy: "make sure you select that G-28 is included."
--   - Countries and last names are ALL CAPS (UNITED STATES, VILLALOBOS).
--     Literals are written in caps. Data-driven values still cannot be --
--     there is no uppercase transform and one was NOT added here; see the
--     escalation already raised on the I-864 PR.
--   - Address history on this form is FIVE YEARS. No address-history columns
--     exist, so every history row is blank (the same gap N-400 and I-485 hit).
--   - Item 46A: where the beneficiary last entered on advance parole FOR DACA,
--     the status is "DA" (Advance Parole District Authorized). Case-specific --
--     blank.
--
-- ⚠ BLANK BY DEFAULT, EVEN FOR KNOWN FIRM DEFAULTS. Katy's notes contain many
-- "always check X unless I say otherwise" answers. Max's explicit decision:
-- NONE of them are encoded in this field map -- he would rather tick empty
-- boxes himself than hunt down wrongly pre-filled ones. Where one was noticed
-- it is flagged in the PR as a firm_overrides / template-defaults candidate for
-- Rob, and the field ships blank. Noted so far in Part 2: item 11 (is your
-- mailing address the same as your physical address?).
--
-- ⚠ FIELD NAMES ARE UNRELIABLE, INCLUDING WITHIN A SINGLE PREFIX. On this form
-- one name prefix can span two unrelated sections:
--   Pt2Line41_Yes/_No      -> item 41, the LPR "gained status through adoption"
--                             question
--   Pt2Line41_StreetNumberName/_Unit/_City/_State/_Zip/_Province/_PostalCode/
--   _Country               -> item 43, EMPLOYER 1's ADDRESS
--   Pt2Line40a/b/d/e_*     -> item 40, LPR class and place of admission
--   Pt2Line40_EmployerOrCompName -> item 42, EMPLOYER 1's NAME
-- Also Pt2Line11_SSN is item 3 (not item 11), Pt2Line23a/b/c_checkbox are
-- item 37, Pt2Line36_Yes/_No are item 38, and PtLine20a_FamilyName drops the
-- "2" from its prefix entirely. Every source below came from
-- normalized/i-130.tooltips.tsv.
--
-- Notable decisions -- Parts 1-2:
--   - Attorney header <- attorney.bar_number + attorney.uscis_account_number;
--     G-28 checkbox literal:true. Volag Number blank (voluntary-agency
--     identifier, not a law firm's).
--   - Part 1: all 12 fields blank -- see the fatal rule above.
--   - Part 2 items 1/3/4/6/8 <- petitioner A-Number, SSN, legal name, city of
--     birth, date of birth. Unit trio for item 10 tooltip-verified
--     [0]=Apt [1]=Ste [2]=Flr; every trio on this form was checked separately.
--   - item 2 (petitioner's USCIS Online Account Number) blank: there is no
--     opposing_parties.uscis_account_number column -- the same missing column
--     already escalated for the I-864's Part 2 item 11.
--   - item 5 (other names used) blank: opposing_parties has only
--     former_maiden_name, one free-text column that cannot be split into the
--     family/given/middle boxes. N-400 precedent.
--   - item 7 (petitioner's Country of Birth) blank: no
--     opposing_parties.country_of_birth column -- again the gap already
--     escalated on the I-864.
--   - item 9 Sex blank (hard rule, no unambiguous column).
--   - item 10 mailing address <- petitioner.address_line1/2 + city/state/zip.
--     10.A In Care Of blank per Katy. Province, Postal Code and Country are
--     blank: unlike the I-864, nothing requires an I-130 petitioner to live in
--     the United States -- a U.S. citizen may petition from abroad -- so
--     literal:UNITED STATES is NOT safe here. Same reasoning as I-751 Part 4
--     and I-485 Part 3.
--   - item 11 (mailing = physical?) blank -- firm-defaults candidate, see above.
--   - items 12-15 Address History (Physical Address 1 and 2, with date ranges)
--     entirely blank: five years of history, and no address-history columns
--     exist. Item 10 is NOT reused here -- that would assert mailing and
--     physical are the same address, which is exactly what item 11 asks and
--     which we are deliberately not answering.
--   - items 16-23 marital information and all prior spouses blank. Item 17
--     (current marital status) is a hard-rule blank. Items 18-19 (date and
--     place of the PETITIONER's current marriage) are blank even though
--     matter.date_of_marriage and matter.place_of_marriage exist: those record
--     the CLIENT's marriage, and the client is the beneficiary. On a spousal
--     petition the two coincide, but on a parent, child or sibling petition
--     they are different people's marriages -- and Part 1, which would tell us
--     which, is deliberately blank. Filling them could be wrong, so they are
--     not filled.
--   - items 24-35 (both of the PETITIONER's parents: name, DOB, sex, country of
--     birth, city and country of residence) entirely blank. There is no source
--     for them at all: immigration.family.<n>.* describes the CLIENT's
--     relatives, not the petitioner's, and is positional besides.
--   - item 36 (U.S. citizen vs lawful permanent resident) blank. The data
--     exists as petitioner.immigration_status, but selecting one of two boxes
--     needs the equals-style transform already escalated on the I-864 PR.
--   - items 37-38 (how citizenship was acquired; Certificate of Naturalization
--     number, place and date of issuance) and items 40-41 (LPR class of
--     admission, date and place of admission) blank: no columns, and each is a
--     documentary fact transcribed from a specific certificate.
--   - items 42-43 Employer 1 <- petitioner.employer + employer_address_line1 /
--     employer_city / employer_state / employer_zip. The employer unit trio and
--     its number box are blank -- opposing_parties has employer_address_line1
--     but no employer_address_line2, so there is no unit to derive from.
--     Occupation (item 44) blank: no occupation column, the same gap the I-864
--     and I-485 hit. Employment dates blank. Employer 2 (items 46-49)
--     entirely blank.
--
-- ⚠ PAGE 8 ITEMS 61 AND 62 ARE BOTH BLANK -- AND THEIR FIELD NAMES ARE OFF
-- BY ONE. These two items are exactly INVERTED between case types:
--   printed item 61 (a. City or Town, b. State)  "The beneficiary is in the
--     United States and will apply for ADJUSTMENT OF STATUS ... at the USCIS
--     office in:"          -> fields Pt4Line60a_CityOrTown / Pt4Line60b_State
--   printed item 62 (a. City or Town, b. Province, c. Country)  "The
--     beneficiary will NOT apply for adjustment of status ... will apply for an
--     immigrant visa abroad at the U.S. Embassy or U.S. CONSULATE in:"
--                          -> fields Pt4Line61a/61b/61c
-- Consular processing requires 61 blank and 62 filled; adjustment of status
-- requires 61 filled and 62 blank. Katy flags serious delays when this is
-- wrong. Note the naming: anyone reaching for "item 61" by field name lands on
-- Pt4Line61*, which is the CONSULAR block -- the precise opposite of what they
-- intended. Verified against the printed form, page 8.
-- A static field map cannot know which case type applies, so BOTH ARE BLANK.
--
-- ⚠ A CATEGORY, NOT THREE ODDITIES: values whose correctness depends on a
-- per-case fact the static map cannot see. This is now the third instance
-- across the library, and they should be read together rather than as
-- unrelated quirks:
--   1. I-864 -- which PARTY Part 2 describes (petitioner-sponsor vs joint
--      sponsor); a joint sponsor files their own I-864 as the Part 2 subject.
--   2. I-130 page 8 -- items 61 vs 62, consular vs adjustment of status
--      (above).
--   3. I-130 Part 2 items 18-19 -- the PETITIONER's marriage date and place.
--      matter.date_of_marriage / place_of_marriage record the CLIENT's
--      marriage, and the client is the beneficiary here. On a spousal petition
--      the two are the same marriage; on a parent, child or sibling petition
--      they are different people's. Part 1, which would say which, is
--      deliberately blank -- so the map cannot tell. Both blank.
-- In every case the value is knowable at GENERATE time and unknowable at MAP
-- time. A field map keyed only to the template has nowhere to put it. This is
-- the strongest argument yet for per-document context at generate time (a case
-- type / party / filing-route selector feeding the resolver). Rob's call per
-- USCIS-FORM-PREP-PROCESS.md section 6 -- not worked around here.
-- Note the contrast that proves it is not about the data being absent: Part 4
-- items 19-20 ask about the BENEFICIARY's marriage, the client is the
-- beneficiary, and matter.date_of_marriage / place_of_marriage are therefore
-- exactly right -- so those ARE mapped.
--
-- Notable decisions -- Parts 3-9:
--   - Part 3 (biographic information about the PETITIONER: ethnicity, race,
--     height, weight, eye and hair colour) entirely blank -- hard-rule
--     biometrics, no columns.
--   - Part 4 items 1-9 <- beneficiary A-Number, USCIS online account number,
--     SSN, legal name, city of birth, country of birth, date of birth. NOTE
--     the names run one ahead of the printed items here: Pt4Line7_* is item 6,
--     Pt4Line8_* is item 7, Pt4Line9_DateOfBirth is item 8. Item 5 (other
--     names used) and item 9 (Sex) blank; item 10 (has anyone else ever filed
--     for this beneficiary) blank -- a "No" is never auto-checked.
--   - Part 4 has THREE address blocks and only the first is mapped:
--       item 11 Beneficiary's Physical Address <- client.address_line1/2 +
--         city/state/zip. Province, Postal Code and Country blank -- the
--         beneficiary may well be abroad, so no country literal is safe, and
--         per Katy a foreign address gets no state and no province.
--       item 12 "address in the United States where the beneficiary INTENDS to
--         live" blank: no column, and on a consular case it is usually the
--         petitioner's address while on an adjustment case it is the
--         beneficiary's current one -- a per-case fact, see the category above.
--       item 13 "beneficiary's address OUTSIDE the United States" blank: no
--         column.
--   - Part 4 items 14-16 contact <- client.phone / cell_phone / email.
--   - Part 4 items 19-20 <- matter.date_of_marriage / place_of_marriage; see
--     the contrast noted in the category block above. Item 20's State,
--     Province and Country boxes are blank -- place_of_marriage is one
--     free-text column with no city/state split, the same convention question
--     already raised on the I-485 PR. Items 17-18 (number of marriages,
--     current marital status) blank; items 21-24 (all of the beneficiary's
--     spouses) blank.
--   - Part 4 items 25-44 "Information About Beneficiary's Family" (five
--     Person rows: name, relationship, date of birth, country of birth)
--     entirely blank -- immigration.family.<n>.* is positional with no
--     relationship filter, the gap already escalated and now hit by a fourth
--     form. The rows explicitly want the beneficiary's SPOUSE AND CHILDREN,
--     which is exactly what a positional lookup cannot express.
--   - Part 4 ENTRY INFORMATION, per Katy: this section covers only documents
--     actually used to ENTER the United States. Items 47-50 (passport number,
--     travel document number, country of issuance, expiration date) are
--     therefore ALL BLANK -- passport data is never mapped here, because the
--     beneficiary may not have entered on it. Item 45 (was the beneficiary
--     ever in the U.S.) blank. Item 46.A class of admission blank: where the
--     beneficiary last entered on advance parole for DACA the correct value is
--     "DA" (Advance Parole District Authorized), which is case-specific.
--     Items 46.B/C/D ARE mapped -- I-94 number, date of arrival and date
--     authorized stay expires <- immigration.i94_number / last_entry_date /
--     i94_expiry. Those describe the arrival record itself rather than a
--     travel document, and they are the same three columns the I-485 uses for
--     its Part 1 item 12.
--   - Part 4 item 51 employment <- client.employer + employer_address_line1 /
--     employer_city / employer_state / employer_zip. The employer unit trio and
--     number box are blank (clients has employer_address_line1 but no
--     employer_address_line2). Item 52 (date employment began) blank -- no
--     column. Items 53-56 (immigration proceedings, type, place and date)
--     blank: immigration.has_prior_removal_order is narrower than "EVER in
--     proceedings", and a "No" is never auto-checked.
--   - Part 4 items 57-58 (name and address in the beneficiary's native written
--     language) blank -- no columns. Items 59-60 ("if filing for your spouse,
--     the last address at which you physically lived together", with dates)
--     blank -- no column, and conditional on a spousal petition.
--   - Part 5 (prior petitions filed by the petitioner, and other relatives
--     being petitioned for) entirely blank -- no columns, and each is a filing
--     history admission.
--   - Part 6 petitioner contact: items 3 and 4 BOTH <- petitioner.cell_phone,
--     matching what I-751 and I-864 do for the same pair, so the same person
--     gets the same number across the packet. opposing_parties has no generic
--     phone column; when a cell is the only number on file items 3 and 4 carry
--     the same value. Item 5 <- petitioner.email. Item 2's "Name of Preparer"
--     box <- attorney.full_name (factual), while the statement checkboxes above
--     it (1.A/1.B read-English vs interpreter, and 2 preparer-used) stay blank
--     as attestations, along with the signature and its date.
--   - Part 7 (Interpreter) entirely blank. Note Pt4Line53_DaytimePhoneNumber is
--     in fact the INTERPRETER's mobile number (item 5), not a Part 4 field.
--   - Part 8 (Preparer) <- attorney.last_name / first_name / phone / email +
--     firm.firm_name and the full firm mailing address, with Country =
--     literal:UNITED STATES -- safe here, and unlike every other country box on
--     this form, because the firm IS U.S.-based (1600-i751.sql item 3.h
--     precedent). Preparer unit trio tooltip-verified [0]=Apt [1]=Ste [2]=Flr.
--     Pt8Line5_PreparerFaxNumber is NAMED fax but its tooltip is the
--     preparer's MOBILE number -- blank either way, as users has no cell
--     column. Item 7.B and its "extends" sub-choice are literal:true -- see
--     MAX'S DECISION below. 7.A ("I am not an attorney") and "does not extend"
--     stay blank. Signature and date blank.
--   - Part 9 (Additional Information): the pre-populated name and A-Number
--     boxes are the PETITIONER's (they carry Pt2Line* names and pre-populate
--     from page 1) <- petitioner.*. The page/part/item-number references and
--     the free-text continuation boxes are blank.
--
-- ⚠ MAX'S DECISION (2026-07-22) -- PREPARER'S STATEMENT PRE-FILLED, AND
-- EXPLICITLY REVERSIBLE: "if wrong we can change later." Two values:
--   Pt8Line7_Checkbox[1]   item 7.B  "I am an attorney or accredited
--                                     representative"          -> literal:true
--   Pt8Line7b_Checkbox[0]  item 7.B  "my representation EXTENDS beyond the
--                                     preparation of this petition"
--                                                              -> literal:true
--   Pt8Line7_Checkbox[0]   item 7.A  "I am NOT an attorney"     -> blank
--   Pt8Line7b_Checkbox[1]            "does NOT extend"          -> blank
-- Index order was verified against the full tooltips: [0] is "extends" and [1]
-- is "does not extend". Do not reverse them.
--
-- The reasoning, so a reviewer can evaluate it rather than inherit it:
--   - 7.B states WHO PREPARED the form, which the system knows with certainty.
--     The preparer block immediately below is already filled from attorney.*
--     and firm.*; leaving 7.B blank while printing the attorney's own name,
--     firm, address, phone and email underneath is self-contradictory on the
--     printed page.
--   - "Extends" is the firm's standing posture: they represent the client
--     beyond this single filing.
--   - The three answers are mutually consistent. The "extends" option's own
--     tooltip notes that an attorney whose representation extends beyond
--     preparation "may be obliged to submit a completed Form G-28" -- and Katy
--     separately requires the G-28-attached box ticked, which this map does.
--   - This is a deliberate CARVE-OUT from Max's blank-by-default rule. That
--     rule targets Katy's case-OUTCOME defaults (245(i) No, immediate-relative,
--     the SS-card request) -- answers about the case. These two are facts about
--     the FIRM'S OWN ROLE, which is not case-dependent.
--
-- This also makes the library internally consistent: 1600-i751.sql already
-- ships P7_checkbox7[1] as literal:true, and Rob's pre-existing 1600-i765.sql
-- ticks both the 7.B box and its sub-choice. If Rob or Katy disagrees, this is
-- a TWO-VALUE EDIT, not a remap -- set both to "blank" and nothing else moves.
--
-- Firm-defaults candidates noticed and deliberately shipped BLANK
-- (firm_overrides / template-defaults candidates for Rob, per Max's rule --
-- he would rather tick empty boxes himself than hunt down wrongly pre-filled
-- ones):
--   - Part 2 item 11: is your mailing address the same as your physical
--     address? (the I-864 raised the same question at its Part 2 item 3)
--   - Katy's case-outcome defaults generally (245(i) No, immediate-relative
--     category, SS-card request): none are encoded anywhere in this map.
--
-- 438 map entries (73 data-mapped, 4 literal, 361 deliberately blank);
-- XFA stripped and barcodes stamped at normalize time. Field inventory:
-- normalized/i-130.fields.json. All 438 declared types were cross-checked
-- against the inventory, including all 20 dropdowns. Requires the
-- a_number/digits/state_abbrev/date_slash/unit_number/unit_is_* transforms
-- already shipped in functions/api/_form-fill.js -- no new transform is
-- required to apply this map as written.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-130', 'Form I-130 -- Petition for Alien Relative')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key      = 'form-templates/i-130.pdf',
    field_count = 438,
    field_map   = '{
  "form1[0].#subform[0].Pt2Line11_SSN[0]": {
    "type": "text",
    "source": "petitioner.ssn_full",
    "transform": "digits"
  },
  "form1[0].#subform[0].CheckBox1[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[0].VolagNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "attorney.bar_number"
  },
  "form1[0].#subform[0].USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "attorney.uscis_account_number"
  },
  "form1[0].#subform[0].Pt1Line1_Spouse[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_Siblings[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_Parent[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line1_Child[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2_InWedlock[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2_AdoptedChild[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2_Stepchild[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2_OutOfWedlock[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line3_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line4_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line4_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line3_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt2Line4a_FamilyName[0]": {
    "type": "text",
    "source": "petitioner.last_name"
  },
  "form1[0].#subform[0].Pt2Line4b_GivenName[0]": {
    "type": "text",
    "source": "petitioner.first_name"
  },
  "form1[0].#subform[0].Pt2Line4c_MiddleName[0]": {
    "type": "text",
    "source": "petitioner.middle_name"
  },
  "form1[0].#subform[0].#area[4].Pt2Line1_AlienNumber[0]": {
    "type": "text",
    "source": "petitioner.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].#area[5].Pt2Line2_USCISOnlineActNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line8_DateofBirth[0]": {
    "type": "text",
    "source": "petitioner.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].Pt2Line9_Male[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line9_Female[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line7_CountryofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line11_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line11_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line10_StreetNumberName[0]": {
    "type": "text",
    "source": "petitioner.address_line1"
  },
  "form1[0].#subform[1].Pt2Line10_Unit[0]": {
    "type": "checkbox",
    "source": "petitioner.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[1].Pt2Line10_Unit[1]": {
    "type": "checkbox",
    "source": "petitioner.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[1].Pt2Line10_Unit[2]": {
    "type": "checkbox",
    "source": "petitioner.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[1].Pt2Line10_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "petitioner.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[1].Pt2Line10_CityOrTown[0]": {
    "type": "text",
    "source": "petitioner.city"
  },
  "form1[0].#subform[1].Pt2Line10_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line10_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line10_ZipCode[0]": {
    "type": "text",
    "source": "petitioner.zip"
  },
  "form1[0].#subform[1].Pt2Line10_State[0]": {
    "type": "dropdown",
    "source": "petitioner.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[1].Pt2Line10_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line10_InCareofName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line14_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line13a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line15a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line15b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line12_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line6_CityTownOfBirth[0]": {
    "type": "text",
    "source": "petitioner.place_of_birth"
  },
  "form1[0].#subform[1].Pt2Line5a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line5b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line5c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line16_NumberofMarriages[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line17_Widowed[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line17_Annulled[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line17_Separated[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line17_Single[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line17_Married[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line17_Divorced[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line13b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].PtLine20a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line20b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line20c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line23_DateMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line22c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line22b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line22a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line21_DateMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line18_DateOfMarriage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line24_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line24_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line24_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line25_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line28_CityTownOrVillageOfResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line29_CountryOfResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line27_CountryofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line30b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line30c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line30a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line31_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line34_CityTownOrVillageOfResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line35_CountryOfResidence[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line33_CountryofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line36_USCitizen[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line36_LPR[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line23a_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line23b_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line23c_checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line37a_CertificateNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line36_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line36_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line37c_DateOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line37b_PlaceOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line26_Male[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line26_Female[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line32_Male[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line32_Female[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line19a_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line19b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line19c_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt2Line19d_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line40a_ClassOfAdmission[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line40b_DateOfAdmission[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line40d_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line41_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line41_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line41_StreetNumberName[0]": {
    "type": "text",
    "source": "petitioner.employer_address_line1"
  },
  "form1[0].#subform[3].Pt2Line41_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line41_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line41_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line41_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line41_CityOrTown[0]": {
    "type": "text",
    "source": "petitioner.employer_city"
  },
  "form1[0].#subform[3].Pt2Line41_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line41_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line41_ZipCode[0]": {
    "type": "text",
    "source": "petitioner.employer_zip"
  },
  "form1[0].#subform[3].Pt2Line41_State[0]": {
    "type": "dropdown",
    "source": "petitioner.employer_state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[3].Pt2Line41_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line40_EmployerOrCompName[0]": {
    "type": "text",
    "source": "petitioner.employer"
  },
  "form1[0].#subform[3].Pt2Line45_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line45_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line46_Occupation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line47a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line47b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line1_Ethnicity[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line1_Ethnicity[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line2_Race_Black[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line2_Race_AmericanIndianAlaskaNative[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line2_Race_White[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line2_Race_Asian[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line2_Race_NativeHawaiianOtherPacificIslander[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line3_HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line3_HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line4_Pound1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line4_Pound2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line4_Pound3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line44_EmployerOrOrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line42_Occupation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line43a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line43b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line5_EyeColor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line5_EyeColor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line5_EyeColor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line5_EyeColor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line5_EyeColor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line5_EyeColor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line5_EyeColor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line5_EyeColor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt3Line5_EyeColor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt2Line40e_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].#area[6].Pt4Line1_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[4].#area[7].Pt4Line2_USCISOnlineActNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[4].Pt4Line4a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[4].Pt4Line4b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[4].Pt4Line4c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[4].P4Line5a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line5b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line5c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line7_CityTownOfBirth[0]": {
    "type": "text",
    "source": "client.place_of_birth"
  },
  "form1[0].#subform[4].Pt4Line8_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[4].Pt4Line11_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line11_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line11_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line12a_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line12b_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line12b_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line12b_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line12b_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line12c_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line12e_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line12d_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line13_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line13_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line13_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line13_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line13_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line13_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line13_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line13_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line13_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line11_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[4].Pt4Line11_Unit[0]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[4].Pt4Line11_Unit[1]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[4].Pt4Line11_Unit[2]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[4].Pt4Line11_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "client.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[4].Pt4Line11_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[4].Pt4Line11_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[4].Pt4Line11_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[4].Pt4Line9_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[4].Pt4Line9_Male[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line9_Female[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6_HairColor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6_HairColor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6_HairColor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6_HairColor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6_HairColor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6_HairColor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6_HairColor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6_HairColor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt3Line6_HairColor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line10_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line10_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line10_Unknown[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt4Line14_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[4].Pt4Line3_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full",
    "transform": "digits"
  },
  "form1[0].#subform[5].Pt4Line20c_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line17_NumberofMarriages[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line18_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line18_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line18_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line18_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line18_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line18_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line15_MobilePhoneNumber[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[5].Pt4Line16_EmailAddress[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[5].Pt4Line19_DateOfMarriage[0]": {
    "type": "text",
    "source": "matter.date_of_marriage",
    "transform": "date_slash"
  },
  "form1[0].#subform[5].Pt4Line18a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line18b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line18c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line16a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line16b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line16c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line17_DateMarriageEnded[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line17_DateMarriageEnded[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line31_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line30a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line30b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line30c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line32_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line49_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line35_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line36_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line37_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line34a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line34b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line34c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line38b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line38c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line38a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line41_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line40_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line39_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line20a_CityTown[0]": {
    "type": "text",
    "source": "matter.place_of_marriage"
  },
  "form1[0].#subform[5].Pt4Line20b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt4Line20d_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line42c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line42b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line42a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line45_CountryOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line44_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line43_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line46a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line46b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line46c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line47_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line49_CountryOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line48_DateOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line20_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line20_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line21d_DateExpired[0]": {
    "type": "text",
    "source": "immigration.i94_expiry",
    "transform": "date_slash"
  },
  "form1[0].#subform[6].Pt4Line21a_ClassOfAdmission[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line21c_DateOfArrival[0]": {
    "type": "text",
    "source": "immigration.last_entry_date",
    "transform": "date_slash"
  },
  "form1[0].#subform[6].Pt4Line22_PassportNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line23_TravelDocNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line24_CountryOfIssuance[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line25_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line26_NameOfCompany[0]": {
    "type": "text",
    "source": "client.employer"
  },
  "form1[0].#subform[6].Pt4Line26_StreetNumberName[0]": {
    "type": "text",
    "source": "client.employer_address_line1"
  },
  "form1[0].#subform[6].Pt4Line26_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line26_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line26_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line26_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line26_CityOrTown[0]": {
    "type": "text",
    "source": "client.employer_city"
  },
  "form1[0].#subform[6].Pt4Line26_State[0]": {
    "type": "dropdown",
    "source": "client.employer_state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[6].Pt4Line26_ZipCode[0]": {
    "type": "text",
    "source": "client.employer_zip"
  },
  "form1[0].#subform[6].Pt4Line26_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line27_DateEmploymentBegan[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line28_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line28_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line54_Removal[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line54_Exclusion[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line54_Rescission[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line54_JudicialProceedings[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line55a_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line26_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line26_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line55b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt4Line56_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].#area[8].Pt4Line21b_ArrivalDeparture[0]": {
    "type": "text",
    "source": "immigration.i94_number"
  },
  "form1[0].#subform[7].Pt4Line55c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line55a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line55b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line56_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line56_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line56_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line56_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line56_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line56_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line56_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line56_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line56_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line58a_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line58b_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line57_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line61a_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line61b_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line61c_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Part4Line1_Yes[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Part4Line1_No[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt5Line2a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt5Line2b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt5Line2c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt5Line5_Result[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt5Line4_DateFiled[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt5Line3a_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt5Line3b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line60a_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line60b_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line7_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line3_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "petitioner.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[8].Pt6Line5_Email[0]": {
    "type": "text",
    "source": "petitioner.email"
  },
  "form1[0].#subform[8].Pt6Line4_MobileNumber[0]": {
    "type": "text",
    "source": "petitioner.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[8].Pt4Line8c_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line8b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line8a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line9_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line1Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line1Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line1b_Language[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line2_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt6Line2_RepresentativeName[0]": {
    "type": "text",
    "source": "attorney.full_name"
  },
  "form1[0].#subform[8].Pt6Line6b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P5_Line6a_SignatureofApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line1b_InterpreterGivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line1a_InterpreterFamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line2_InterpreterBusinessorOrg[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7_NameofLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line7b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line7a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt8Line1b_PreparerGivenName[0]": {
    "type": "text",
    "source": "attorney.first_name"
  },
  "form1[0].#subform[9].Pt8Line2_BusinessName[0]": {
    "type": "text",
    "source": "firm.firm_name"
  },
  "form1[0].#subform[9].Pt8Line1a_PreparerFamilyName[0]": {
    "type": "text",
    "source": "attorney.last_name"
  },
  "form1[0].#subform[9].Pt7Line4_InterpreterDaytimeTelephone[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt7Line5_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt4Line53_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt8Line3_CityOrTown[0]": {
    "type": "text",
    "source": "firm.city"
  },
  "form1[0].#subform[9].Pt8Line3_StreetNumberName[0]": {
    "type": "text",
    "source": "firm.address_line1"
  },
  "form1[0].#subform[9].Pt8Line3_Unit[0]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[9].Pt8Line3_Unit[1]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[9].Pt8Line3_Unit[2]": {
    "type": "checkbox",
    "source": "firm.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[9].Pt8Line3_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "firm.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[9].Pt8Line3_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt8Line3_ZipCode[0]": {
    "type": "text",
    "source": "firm.zip"
  },
  "form1[0].#subform[9].Pt8Line3_State[0]": {
    "type": "dropdown",
    "source": "firm.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[9].Pt8Line3_Country[0]": {
    "type": "text",
    "source": "literal:UNITED STATES"
  },
  "form1[0].#subform[9].Pt8Line3_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt8Line5_PreparerFaxNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt8Line4_DaytimePhoneNumber[0]": {
    "type": "text",
    "source": "attorney.phone",
    "transform": "digits"
  },
  "form1[0].#subform[10].Pt8Line6_Email[0]": {
    "type": "text",
    "source": "attorney.email"
  },
  "form1[0].#subform[10].Pt8Line7_Checkbox[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt8Line7_Checkbox[1]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[10].Pt8Line7b_Checkbox[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[10].Pt8Line7b_Checkbox[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt8Line8a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt8Line8b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt2Line1_AlienNumber[1]": {
    "type": "text",
    "source": "petitioner.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[11].Pt9Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line3d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line4a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line4b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line4c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line4d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line5a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line5b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line5c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line6a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line6b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line6c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt2Line4a_FamilyName[1]": {
    "type": "text",
    "source": "petitioner.last_name"
  },
  "form1[0].#subform[11].Pt2Line4b_GivenName[1]": {
    "type": "text",
    "source": "petitioner.first_name"
  },
  "form1[0].#subform[11].Pt2Line4c_MiddleName[1]": {
    "type": "text",
    "source": "petitioner.middle_name"
  },
  "form1[0].#subform[11].Pt9Line6d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line5d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line9a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line7b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line7c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt9Line7d_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-130';
