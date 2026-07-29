-- Migration 1600-i485: I-485 field map + template registration
--
-- Application to Register Permanent Residence or Adjust Status. The core
-- application by which someone already in the United States becomes a lawful
-- permanent resident (a "green card holder") without leaving the country,
-- filed either alongside or after an approved underlying petition such as an
-- I-130. Adjustment of status is the single largest case type in the queue.
--
-- Source:  uscis-forms/i-485.pdf
-- Edition: 01/20/25 (printed lower-left)
-- SHA-256: 7c8e1c5242d680b2bc0bfa7d8026e0c3fc8e32bbe52c55648fb5078703122423
--
-- 736 field(s): 310 TextField, 416 CheckBox, 10 Dropdown.
-- Field inventory: normalized/i-485.fields.json
-- Field semantics: normalized/i-485.tooltips.tsv
--
-- Party roles are STRAIGHTFORWARD here and must not be confused with the
-- I-864's: on the I-485 the APPLICANT is the client. Part 1 -> client.* /
-- immigration.*; Part 12 (preparer) -> attorney.* + firm.*. Do not carry the
-- I-864's petitioner/client inversion across -- that form is the exception.
--
-- ⚠ FIELD NAMES ARE UNRELIABLE ON THIS FORM. Prefixes mix P<n> and Pt<n>
-- styles for the same part (Pt1Line12_Date and P1Line12_I94 are both Part 1
-- item 12), and at least one field is named for the wrong part outright:
-- Pt2Line11_CB[0]'s tooltip reads "Part 1. Application Type or Filing
-- Category" while its siblings [1]-[3] read "Part 2" for identical content --
-- a USCIS tooltip typo on top of a misleading name. It is a filing-category
-- box and blank either way, so nothing turns on it here, but it is a concrete
-- example of why every source below was derived from
-- normalized/i-485.tooltips.tsv and never from a field name.
--
-- ⚠ UNIT CHECKBOX ORDER DIFFERS BETWEEN ADDRESS BLOCKS OF THE SAME ITEM.
-- Part 1 item 18 has four address blocks and they are NOT consistent:
--   Pt1Line18US_Unit        (Current U.S. Physical) [0]=Ste [1]=Flr [2]=Apt
--   Pt1Line18_CurrentUnit   (Current Mailing)       [0]=Apt [1]=Ste [2]=Flr
--   Pt1Line18_PriorAddress_Unit (Prior)             [0]=Apt [1]=Ste [2]=Flr
--   Pt1Line18_RecentUnit    (Most Recent Outside US)[0]=Apt [1]=Ste [2]=Flr
-- Only the first is mapped; all four were verified individually anyway.
--
-- FIRM CONVENTION: countries and last names are capitalized in full
-- ("UNITED STATES", "VILLALOBOS"). Literals below are written uppercase.
-- Data-driven values still CANNOT be -- there is no uppercase transform in
-- applyTransform (functions/api/_form-fill.js) and one was not added here per
-- USCIS-FORM-PREP-PROCESS.md section 6. Already escalated on the I-864 PR as a
-- cross-cutting item affecting every last-name and country box across all six
-- of Katy's forms; when that transform ships, one jsonb-merge migration
-- (1600-g28-atty-fields.sql style) applies it library-wide. Affected here:
-- client.last_name (Part 1 item 1), immigration.country_of_birth (item 7),
-- immigration.country_of_citizenship (item 8), attorney.last_name (Part 12).
--
-- Notable decisions -- Part 1:
--   - Attorney header <- attorney.bar_number + attorney.uscis_account_number;
--     G-28 checkbox = literal:true (1600-i821d precedent). Volag Number blank:
--     that is a voluntary-agency identifier, not a law firm's.
--   - The 24 page-header A-Number boxes (one per sheet, AlienNumber[0]-[23];
--     [1]-[23] are pre-populated read-only fields whose read-only flag is
--     cleared at normalize time) <- immigration.a_number. Same treatment as
--     N-400's 14 header boxes.
--   - item 2 "Other Names You Have Used Since Birth" blank: clients has only
--     former_maiden_name, a single free-text column that cannot be split into
--     the family/given/middle boxes the form wants. N-400 precedent.
--   - item 4 A-Number <- immigration.a_number; the "Do you have an A-Number?"
--     Yes/No pair stays blank, as does item 5 (other A-Numbers ever used).
--   - item 6 Sex blank -- no unambiguous data column (hard rule).
--   - item 7 City/Town of Birth <- client.place_of_birth. Country of Birth <-
--     immigration.country_of_birth is exact. See the free-text note below.
--   - item 10: only Place and Date of Last Arrival are mapped. City or Town <-
--     immigration.port_of_entry -- the State dropdown beside it is left blank
--     rather than guessed at, since there is no city/state split. Date of Last
--     Arrival <- immigration.last_entry_date. Passport number, passport
--     expiration, issuing country, visa number and visa issue date all blank:
--     no columns exist for any of them.
--   - item 11 (admitted / paroled / entered without inspection / other, plus
--     the class-of-admission text boxes) blank. How the applicant last entered
--     is legally decisive for adjustment eligibility -- attorney judgment.
--   - item 12: I-94 number <- immigration.i94_number and expiration of
--     authorized stay <- immigration.i94_expiry. The two I-94 NAME boxes stay
--     blank: item 12 asks for the details as they appear on that specific
--     document, and a transposed or truncated name on an I-94 is exactly the
--     discrepancy the question exists to surface. "Immigration Status on Form
--     I-94" also blank -- that is the status at arrival, which is not what
--     immigration.immigration_status holds.
--   - item 14 current immigration status <- immigration.immigration_status.
--     FLAGGED: the question is conditional ("if it has changed since your last
--     arrival"), so on a case where status never changed this fills a box the
--     form would leave empty. Item 15 (expiration of CURRENT status) is left
--     blank rather than reusing i94_expiry, which is the I-94's expiry and
--     only coincides while the original admission still governs.
--   - items 13, 16, 17 (first physical presence; alien-crewman visa; arrival
--     as a seaman/crewman) blank -- a "No" is never auto-checked.
--   - item 18 Current U.S. Physical Address <- client.address_line1/2 +
--     city/state/zip. In Care Of blank. See the unit-order warning above.
--   - item 18 Current Mailing Address (Safe or Alternate) blank: clients has
--     no mailing-address columns, and a safe/alternate address is a deliberate
--     DV-confidentiality choice, not a default. N-400 precedent.
--   - item 18 Prior Address and Most Recent Address Outside the United States
--     (both with residence date ranges) blank: no address-history columns
--     exist. Same gap N-400 hit for its 5-year residence history.
--   - item 19: SSN <- client.ssn_full. Whether SSA ever issued a card, whether
--     the applicant wants one issued, and the SSA disclosure-consent pair all
--     stay blank -- N-400 precedent for the same SSA consent block.
--
-- ⚠ FREE-TEXT COLUMNS FEEDING CITY-ONLY BOXES -- a data-entry convention
-- question for the firm, NOT a mapping defect. Three single free-text columns
-- feed boxes that USCIS scopes to a city only:
--   client.place_of_birth      -> Part 1 item 7  "City or Town of Birth"
--   immigration.port_of_entry  -> Part 1 item 10 "City or Town" of last arrival
--   matter.place_of_marriage   -> Part 6 item 9  "City or Town" of marriage
-- If intake types "Guadalajara, Jalisco", "Laredo, TX" or "Harris County,
-- Texas", the extra text lands in the city box. Visible in the editor and
-- trivially editable -- not dangerous, and no column is being misused. In each
-- case the neighbouring State/Country box is left BLANK rather than guessed at,
-- so nothing is asserted that the data does not actually say. Worth settling as
-- an intake convention (city only, with country/state captured separately)
-- rather than papering over in the field maps.
--
-- Notable decisions -- Parts 2-7:
--   - Part 2 (Application Type or Filing Category) entirely blank. Which
--     immigrant category someone adjusts under -- family-based preference tier,
--     employment-based, asylee/refugee, VAWA, T/U victim, Cuban Adjustment,
--     registry, diversity visa -- is THE central legal determination on this
--     form and drives everything downstream. Attorney judgment, always. The
--     245(i) and CSPA questions (items 4-5) and the derivative-applicant block
--     (principal applicant's name/DOB/A-Number) go blank with it: the latter
--     describes a DIFFERENT person than our client and has no column.
--   - Part 3 (request for exemption from the I-864 Affidavit of Support) blank
--     -- six mutually exclusive eligibility assertions, all attorney judgment.
--   - Part 4 items 1-6 (prior immigrant-visa application at a consulate, prior
--     adjustment application, previously rescinded LPR status) blank: no
--     columns, and each is an immigration-history admission where a wrong
--     "No" is worse than an empty box.
--   - Part 4 item 7 employment: the current/most-recent employer NAME box <-
--     client.employer, plus employer address <- client.employer_address_line1 /
--     employer_city / employer_state / employer_zip. N-400 precedent.
--     ⚠ The three item-7 name boxes are NOT three employer rows, despite all
--     three being named Pt4Line7_EmployerName. Tooltips and widget geometry
--     agree: [0] (x=60) is "Employer or School (current or most recent)",
--     [2] (x=324) is "Name of Employer, Company, or School", and [1] (full
--     width below) is "Your Occupation". Only [2] is mapped. [1] is blank --
--     no occupation column exists, the same gap the I-864 hit at its Part 6.
--     [0] is blank because what USCIS wants in it is genuinely unclear.
--     The employer-address unit trio and its number box are blank: clients has
--     employer_address_line1 but no employer_address_line2, so there is no
--     unit to derive Apt/Ste/Flr from. Employment dates blank
--     (client.length_of_employment is a duration string, not a date range);
--     the employer-address Country box is blank rather than a literal, since
--     item 7 covers ALL employment for five years and may be foreign.
--   - Part 4 item 8 (most recent employer or school OUTSIDE the U.S.) entirely
--     blank: it is explicitly scoped to employment not already listed, and no
--     prior/foreign-employer columns exist.
--   - Part 5 (Your Parents: both parents' legal name, name at birth, DOB,
--     country of birth) entirely blank -- see the family-member limitation
--     below. Note Pt5Line5_CityTownOfBirth / Pt5Line10_CityTownOfBirth are
--     named "CityTown" but their tooltips say "Enter Country of Birth"; blank
--     either way, but do not map them from the name.
--   - Part 6 (Marital History): only the two matter-level facts are mapped --
--     item 9 Date of Marriage to Current Spouse <- matter.date_of_marriage and
--     its City or Town <- matter.place_of_marriage. Everything identifying the
--     SPOUSE is blank (see below). Item 1 current marital status is blank: no
--     marital_status column, and marital status is a hard-rule blank. Item 3
--     (number of times married), item 10 (is your spouse also adjusting), and
--     the entire prior-marriage block (items 11-18, including how the marriage
--     ended) are blank -- no columns, and each is a factual admission.
--   - Part 7 (Your Children): total number of living children and both child
--     rows entirely blank -- see below.
--
-- ⚠ FAMILY-MEMBER LIMITATION -- FOURTH FORM TO HIT IT. Parts 5, 6 and 7 all
-- describe specific RELATIVES: Parent 1 and Parent 2, the current spouse, prior
-- spouses, and two children. The only source available is
-- immigration.family.<n>.<col>, which is POSITIONAL ONLY -- there is no way to
-- ask for "the spouse" or "the mother". A parent sitting at index 0 would land
-- in the Parent 1 boxes only by luck, a child at index 1 would silently become
-- the second child, and a missing member at an index resolves to blank rather
-- than erroring, so a wrong index and an empty field look identical on the
-- generated PDF. Left blank rather than worked around.
--   Previously blocked: I-751 Part 5, N-400's children section, I-864 Part 4.
--   The I-485 adds a NEW variant of the same gap: for a marriage-based case the
--   current spouse usually IS petitioner.* (party_role='primary'), but the
--   petitioner may equally be a parent, sibling or employer, and
--   petitioner.relationship_to_client cannot be tested -- there is no
--   equality/conditional transform. So even a relationship-aware family source
--   would not cover Part 6 on its own; a source needs to be conditional on the
--   petitioner's relationship too. Both belong to _form-fill.js -- Rob's call
--   per USCIS-FORM-PREP-PROCESS.md section 6.
--
-- ⚠ SOME TOOLTIPS ON THIS FORM ARE THEMSELVES WRONG -- not just the names.
-- P6Line8_Unit[0]-[2], P6Line8_Number, P6Line8_State and P6Line8_ZipCode carry
-- tooltips reading "Interpreter's Mailing Address" (Part 11), but widget
-- geometry places them inside the Part 6 CURRENT SPOUSE address block, on the
-- same rows as Part6Line8_StreetName and P6Line8_City, whose tooltips do say
-- Part 6. They are spouse-address fields and are blank as such. Consequence for
-- whoever maps Part 11: do NOT reach for a P6Line8_* field for the interpreter
-- block. Likewise Pt5Line2_YNNA and Pt6Line3_TimesMarried carry "Part 5"
-- labels for marital-history content that belongs to Part 6, and
-- Pt5Line8_DateofBirth[1]/[2]/[3] -- named for a Part 5 parent's DOB -- are in
-- fact the current spouse's DOB, the date of marriage, and the prior spouse's
-- DOB. Where a tooltip and the page disagree, the geometry was checked.
--
-- Notable decisions -- Parts 8-14:
--   - Part 8 (Biographic Information: ethnicity, race, height, weight, eye and
--     hair colour) entirely blank -- hard-rule biometrics, no columns.
--   - Part 9 (General Eligibility and Inadmissibility Grounds) entirely blank:
--     286 fields, the single largest block on the form. Every one is an
--     admission bearing on admissibility -- organization membership, criminal
--     acts, security and terrorism grounds, public charge, removal and unlawful
--     presence, illegal reentry. NO answer is auto-filled, and in particular no
--     "No" is ever auto-checked: a wrong negative here is a false statement on
--     a sworn application. Attorney judgment throughout, without exception.
--     The public-charge household-size and income/asset bands (items 57-60) are
--     blank with the rest -- they are computed for THIS test, not the same as
--     any figure the portal stores. Item 62's eight "List of Certifications"
--     rows (Table1/Row1-8/TextField1-8) carry no usable tooltip at all -- just
--     "TextField1".."TextField8" -- and were identified by widget geometry:
--     they sit between item 61 (y=396) and item 63 (y=139) on the same page.
--     Blank; no certifications column exists.
--   - Part 10 (Applicant's Contact Information, Certification, and Signature)
--     <- client.phone / client.cell_phone / client.email. Its fields are named
--     Pt3_*. Certification and signature/date blank.
--   - Part 11 (Interpreter) entirely blank -- N-400/I-765/I-864 precedent; the
--     firm does not pre-name an interpreter. ⚠ SEE THE TOOLTIP WARNING BELOW:
--     the real interpreter fields are Pt11Line1a/1b, Pt11Line2_OrgName,
--     P3_Line4/5/6, Part11_NameofLanguage, plus P12_SignatureApplicant and
--     P13_DateofSignature (named P12/P13 but belonging to Part 11). They are
--     NOT the P6Line8_* fields whose tooltips claim to be the interpreter's
--     mailing address.
--   - Part 12 (Preparer) <- attorney.last_name / first_name / phone / email +
--     firm.firm_name. Signature and date blank. NOTE: unlike the I-765's
--     Part 5, the I-485's Part 12 has NO preparer-statement checkboxes -- the
--     certification is a single narrative paragraph with nothing selectable, so
--     the "7.b = literal:true" precedent from 1600-i765.sql has no counterpart
--     here and nothing was invented to apply it to. Preparer's Mobile
--     Telephone Number is blank: users has phone and fax but no cell column.
--   - Part 13 (Signature at Interview) entirely blank -- it is completed at the
--     USCIS interview, on the officer's instruction, and includes the officer's
--     own signature and stamp. The printed form says so explicitly.
--   - Part 14 (Additional Information): the three pre-populated name boxes <-
--     client name (the A-Number box is covered by the page-header rule above).
--     The page/part/item-number references and the free-text continuation boxes
--     are blank -- they exist to carry overflow answers the attorney writes.
--
-- ⚠ NAME PREFIXES ARE SYSTEMATICALLY OFF ON THE LATER PARTS. Beyond the
-- individual traps above, whole parts are named for the part before them:
-- Part 8's fields are Pt7Line*, Part 9's are largely Pt8Line*, Part 10's are
-- Pt3Line*, and two Part 11 fields are P12_/P13_. Nothing on this form should
-- be mapped, reviewed, or spot-checked by reading a field name.
--
-- 736 map entries (67 data-mapped, 1 literal, 668 deliberately blank);
-- XFA stripped and barcodes stamped at normalize time. Field inventory:
-- normalized/i-485.fields.json. Requires the a_number/digits/state_abbrev/
-- date_slash/unit_number/unit_is_* transforms already shipped in
-- functions/api/_form-fill.js -- no new transform is required to apply this
-- map as written.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('i-485', 'Form I-485 -- Application to Register Permanent Residence or Adjust Status')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key      = 'form-templates/i-485.pdf',
    field_count = 736,
    field_map   = '{
  "form1[0].#subform[0].AttorneyStateBarNumber[0]": {
    "type": "text",
    "source": "attorney.bar_number"
  },
  "form1[0].#subform[0].CheckBox1[0]": {
    "type": "checkbox",
    "source": "literal:true"
  },
  "form1[0].#subform[0].VolagNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].USCISOnlineAcctNumber[0]": {
    "type": "text",
    "source": "attorney.uscis_account_number"
  },
  "form1[0].#subform[0].AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
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
  "form1[0].#subform[0].Pt1Line2_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2a_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line2a_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line3_DOB[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[0].Pt1Line3_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line3_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line3A_OtherDOB[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Pt1Line3B_OtherDOB[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].AlienNumber[1]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[1].Pt1Line6_CB_Sex[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line6_CB_Sex[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line7_CityTownOfBirth[0]": {
    "type": "text",
    "source": "client.place_of_birth"
  },
  "form1[0].#subform[1].Pt1Line7_CountryOfBirth[0]": {
    "type": "text",
    "source": "immigration.country_of_birth"
  },
  "form1[0].#subform[1].Pt1Line8_CountryofCitizenshipNationality[0]": {
    "type": "text",
    "source": "immigration.country_of_citizenship"
  },
  "form1[0].#subform[1].Pt1Line9_USCISAccountNumber[0]": {
    "type": "text",
    "source": "immigration.uscis_account_number"
  },
  "form1[0].#subform[1].Pt1Line10_PassportNum[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line10_ExpDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line10_Passport[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line10_VisaNum[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line10_CityTown[0]": {
    "type": "text",
    "source": "immigration.port_of_entry"
  },
  "form1[0].#subform[1].Pt1Line10_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line10_DateofArrival[0]": {
    "type": "text",
    "source": "immigration.last_entry_date",
    "transform": "date_slash"
  },
  "form1[0].#subform[1].Pt1Line10_NonImmDate[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line4_AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[1].Pt1Line4_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line4_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line5_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line5_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line5A_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line5B_ANumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line11_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line11_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line11_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line11_Other[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt2Line11_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line11_Admitted[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[1].Pt1Line11_Paroled[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].AlienNumber[2]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[2].P1Line12_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P1Line13_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line12_Date[0]": {
    "type": "text",
    "source": "immigration.i94_expiry",
    "transform": "date_slash"
  },
  "form1[0].#subform[2].Pt1Line12_Status[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].P1Line12_I94[0]": {
    "type": "text",
    "source": "immigration.i94_number"
  },
  "form1[0].#subform[2].Pt1Line13_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line13_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line15_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line16_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line17_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line17_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line16_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18US_Unit[0]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_ste"
  },
  "form1[0].#subform[2].Pt1Line18US_Unit[1]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_flr"
  },
  "form1[0].#subform[2].Pt1Line18US_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "client.address_line2",
    "transform": "unit_number"
  },
  "form1[0].#subform[2].Pt1Line18US_Unit[2]": {
    "type": "checkbox",
    "source": "client.address_line2",
    "transform": "unit_is_apt"
  },
  "form1[0].#subform[2].Pt1Line18_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[2].Pt1Line18_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[2].Pt1Line18_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[2].Pt1Line18_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[2].Part1_Item18_InCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_CurrentUnit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_CurrentUnit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_CurrentUnit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_CurrentAptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_CurrentCityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_CurrentState[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_CurrentZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_CurrentStreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line18_CurrentInCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[2].Pt1Line14_Status[0]": {
    "type": "text",
    "source": "immigration.immigration_status"
  },
  "form1[0].#subform[3].AlienNumber[3]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[3].Pt1Line18_last5yrs_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_last5yrs_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorInCareOfName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorStreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorAddress_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorAddress_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorAddress_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorAddress_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorCity[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorState[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorProvince[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorPostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorCountry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_PriorDateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18PriorDateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentStreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentUnit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentUnit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentUnit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentCity[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentState[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentProvince[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentPostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentCountry[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentDateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line18_RecentDateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line19_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line19_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line19_SSN[0]": {
    "type": "text",
    "source": "client.ssn_full",
    "transform": "digits"
  },
  "form1[0].#subform[3].Pt1Line19_SSA_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line19_SSA_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line19_Consent_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[3].Pt1Line19_Consent_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].AlienNumber[4]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[4].Pt2Line1_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line1_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line2_Receipt[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line2_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line2_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line2_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line2_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt1Line2_DOB[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line2_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line2_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line2_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[10]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[11]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[12]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[13]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[4].Pt2Line3a_CB[14]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].AlienNumber[5]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[5].Pt2Line3b_CB526[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140Assoc[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140Assoc[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3b_CB140Assoc[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Relative_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Relative_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Relative_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Relative_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Relative_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Relative_CB[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Relative_CB[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Relative_CB[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2RelativeType_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2RelativeType_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2RelativeType_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2RelativeType_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[5].Pt2Line3c_CB[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3d_AsyleeRefugeeCB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3d_AsyleeRefugeeCB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3e_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3e_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].AlienNumber[6]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[6].Pt2Line3f_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3f_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3f_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3f_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3f_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3f_CB[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3f_CB[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line1g_OtherEligibility[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3g_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3g_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3g_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3g_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3g_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3d_Asylum[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3d_Refugee[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line1g_DV[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line3f_CB[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line5_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line5_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line4_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[6].Pt2Line4_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].AlienNumber[7]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[7].Pt4Line1_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line1_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line4_Date[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt3Line1_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt3Line1_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt3Line1_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt3Line1_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt3Line1_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line2_CityTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line2_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line5_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line5_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line6_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line7_EmployerName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line7_EmployerName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt4Line7_EmployerName[2]": {
    "type": "text",
    "source": "client.employer"
  },
  "form1[0].#subform[7].Pt4Line3_Decision[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[7].Pt3Line1_CB[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].AlienNumber[8]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[8].Part4Line7_StreetName[0]": {
    "type": "text",
    "source": "client.employer_address_line1"
  },
  "form1[0].#subform[8].P4Line7_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line7_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line7_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line7_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line7_City[0]": {
    "type": "text",
    "source": "client.employer_city"
  },
  "form1[0].#subform[8].P4Line7_State[0]": {
    "type": "dropdown",
    "source": "client.employer_state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[8].P4Line7_ZipCode[0]": {
    "type": "text",
    "source": "client.employer_zip"
  },
  "form1[0].#subform[8].P4Line7_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line7_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line7_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line7_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line7_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Part4Line7_StreetName[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line8_Occupation[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line8_EmployerName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].P4Line8_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line8_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt4Line8_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Part4Line8_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt5Line1_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt5Line1_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt5Line1_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt5Line2_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt5Line3_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt5Line2_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[8].Pt5Line2_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].AlienNumber[9]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[9].Pt5Line5_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line6_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line8_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line7_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line7_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line7_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line10_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line1_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line1_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line1_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line1_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line1_MaritalStatus[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line1_MaritalStatus[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line2_YNNA[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line2_YNNA[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line2_YNNA[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line3_TimesMarried[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line4_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line4_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line4_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line5_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt5Line8_DateofBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Pt6Line7_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].Part6Line8_StreetName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_City[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_PostalCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_Province[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_Number[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[9].P6Line8_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].AlienNumber[10]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[10].Pt6Line10_CityTownOfBirth[0]": {
    "type": "text",
    "source": "matter.place_of_marriage"
  },
  "form1[0].#subform[10].Pt6Line10_State[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line10_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt5Line8_DateofBirth[2]": {
    "type": "text",
    "source": "matter.date_of_marriage",
    "transform": "date_slash"
  },
  "form1[0].#subform[10].Pt6Line11_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line11_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line12_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line12_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line12_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt5Line8_DateofBirth[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line15_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line14_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line16_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line10_CityTownOfBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line10_State[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line10_Country[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line18_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line18_State[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line18_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line16_DateofBirth[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line19_MaritalStatus[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line19_MaritalStatus[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line19_MaritalStatus[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line19_MaritalStatus[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[10].Pt6Line19_HowMarriageEndedOther[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].AlienNumber[11]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[11].Pt6Line1_TotalChildren[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line2_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line2_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line2_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line2_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line2_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line2_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line2_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line2_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line2_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line3_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line3_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line3_MiddleName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line3_AlienNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line3_DateofBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line3_YN[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line3_YN[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[11].Pt7Line3_Relationship[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].AlienNumber[12]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[12].Pt7Line1_Ethnicity[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line1_Ethnicity[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line2_Race[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line2_Race[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line2_Race[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line2_Race[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line2_Race[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line3_HeightFeet[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line3_HeightInches[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line4_Weight1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line4_Weight2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line4_Weight3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line5_Eyecolor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line5_Eyecolor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line5_Eyecolor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line5_Eyecolor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line5_Eyecolor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line5_Eyecolor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line5_Eyecolor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line5_Eyecolor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line5_Eyecolor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line6_Haircolor[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line6_Haircolor[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line6_Haircolor[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line6_Haircolor[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line6_Haircolor[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line6_Haircolor[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line6_Haircolor[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line6_Haircolor[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt7Line6_Haircolor[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt8Line1_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt8Line1_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt9Line2_Organization1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt9Line3_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt9Line3_State[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt9Line3_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt9Line4_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt9Line4_Involvement[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt9Line5_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt9Line5_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[12].Pt9Line6_Organization2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].AlienNumber[13]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[13].Pt9Line7_CityTownOfBirth[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line7_State[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line7_Country[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line8_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line8_Involvement[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line9_DateFrom[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line9_DateTo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line10_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line10_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line11_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line11_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line13_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line13_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line18_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line18_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line19_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line19_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line12_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt9Line12_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line20_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line20_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line17_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line17_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line23_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line23_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line24a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line24a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line24b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line24b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line24c_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line24c_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line22_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[13].Pt8Line22_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].AlienNumber[14]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[14].Pt9Line23_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt9Line23_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt9Line24_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt9Line24_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line25_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line25_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line26_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line26_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line27_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line27_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line28_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line28_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line29_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line29_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line30_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line30_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line31_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line31_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line32_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line32_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line34_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line34_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line33_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line33_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line35a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line35a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line36_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line36_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line37_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line37_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line35b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[14].Pt8Line35b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].AlienNumber[15]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[15].Pt8Line38_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line38_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt9Line39_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt9Line39_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line41_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line41_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line40_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line40_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line42\\.a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line42\\.a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line42\\.b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line42\\.b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line42c_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line42c_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line42d_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line42d_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43c_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43c_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43d_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43d_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43g_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43g_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43h_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43h_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43e_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43e_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43fYesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43fYesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line44_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line44_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43i_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line43i_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line45_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[15].Pt8Line45_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].AlienNumber[16]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[16].Pt8Line46_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line46_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line47_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line47_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line48_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line48_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line49_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line49_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line50_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line50_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line52_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line52_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line51_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line51_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line55_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line55_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line53d_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line53d_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line54_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line54_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line53a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line53a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line53b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line53b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line53c_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[16].Pt8Line53c_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].AlienNumber[17]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[17].Pt9Line56_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[8]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[9]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[10]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[11]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[12]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[13]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[14]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[15]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[16]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[17]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[18]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[19]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[20]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[17].Pt9Line56_CB[21]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].AlienNumber[18]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[18].Pt9Line57_HouseholdSize[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line53_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line53_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line53_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line53_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line53_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line59_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line59_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line59_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line59_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line59_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line60_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line60_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line60_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line60_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line60_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line56_CB[22]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line56_CB[23]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line61_diploma[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line61_CB[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line61_CB[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line61_CB[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line61_CB[3]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line61_CB[4]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line61_CB[5]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line61_CB[6]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line61_CB[7]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line56_CB[24]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line63_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line63_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line64_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Pt9Line64_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[18].Table1[0].Row1[0].TextField1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Table1[0].Row2[0].TextField2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Table1[0].Row3[0].TextField3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Table1[0].Row4[0].TextField4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Table1[0].Row5[0].TextField5[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Table1[0].Row6[0].TextField6[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Table1[0].Row7[0].TextField7[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[18].Table1[0].Row8[0].TextField8[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].AlienNumber[19]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[20].Pt8Line68d_Column1Row1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column1Row2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column1Row3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column1Row4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column4Row1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column4Row2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column4Row3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column4Row4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column2Row1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column2Row2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column2Row3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column2Row4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column3Row1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column3Row2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column3Row3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68d_Column3Row4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column1Row1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column1Row2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column1Row3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column4Row1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column4Row2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column4Row3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column4Row4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column1Row4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column2Row1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column2Row2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column2Row3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column2Row4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column3Row1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column3Row2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column3Row3[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt8Line68c_Column3Row4[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line65_Row1_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line65_Row1_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line65_Row2_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line65_Row2_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line65_Row3_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line65_Row3_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line65_Row4_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line65_Row4_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line66_Row1_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line66_Row1_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line66_Row2_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line66_Row2_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line66_Row3_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line66_Row3_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line66_Row4_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line66_Row4_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line67_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line67_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line68_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line68_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line73_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line73_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line71_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line71_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line72_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line72_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line70_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line70_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line69_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line69_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line74_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line74_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line75_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[20].Pt9Line75_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].AlienNumber[20]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[21].Pt9Line77_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line77_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line78a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line78a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line78b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line78b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line76_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line76_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line79_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line79_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line80_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line80_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line81_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line81_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line82_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line82_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line83_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line83_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line84a_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line84a_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line84b_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line84b_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line84c_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line84c_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line86_Nationality[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line85_YesNo[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[21].Pt9Line85_YesNo[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[22].AlienNumber[21]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[22].Pt3Line3_DaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "client.phone",
    "transform": "digits"
  },
  "form1[0].#subform[22].Pt3Line5_Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[22].Pt3Line4_MobileNumber1[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  },
  "form1[0].#subform[22].Pt3Line7a_Signature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].Pt3Line7b_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].Pt11Line1b_GivenName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].Pt11Line1a_FamilyName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].Pt11Line2_OrgName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].P3_Line4_DaytimeTelePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].P3_Line5_MobileTelePhoneNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].P3_Line6_Email[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].Part11_NameofLanguage[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].P12_SignatureApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[22].P13_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].AlienNumber[22]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[23].Pt12Line2_BusinessName[0]": {
    "type": "text",
    "source": "firm.firm_name"
  },
  "form1[0].#subform[23].Pt12Line1_PreparerFamilyName[0]": {
    "type": "text",
    "source": "attorney.last_name"
  },
  "form1[0].#subform[23].Pt12Line1a_PreparerGivenName[0]": {
    "type": "text",
    "source": "attorney.first_name"
  },
  "form1[0].#subform[23].Pt12Line3_PreparerDaytimePhoneNumber1[0]": {
    "type": "text",
    "source": "attorney.phone",
    "transform": "digits"
  },
  "form1[0].#subform[23].Pt12Line5_PreparerEmail[0]": {
    "type": "text",
    "source": "attorney.email"
  },
  "form1[0].#subform[23].Pt12Line4_PreparerMobileNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].P12Line6_SignaturePreparer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].P12Line6a_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].Pt13_USCISSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].Pt13_USCISOfficer[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].Pt13_ApplicantSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].Pt13_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].Pt13_Corrections1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].Pt13_Corrections2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].Pt13_Pages1[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].Pt13_Pages2[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[23].Pt13_Corrections2[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].AlienNumber[23]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[24].Pt1Line1_FamilyName[1]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[24].Pt1Line1_GivenName[1]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[24].Pt1Line1_MiddleName[1]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[24].Pt9Line3a_PageNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3b_PartNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3c_ItemNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3a_PageNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3b_PartNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3c_ItemNumber[1]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3a_PageNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3b_PartNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3c_ItemNumber[2]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3a_PageNumber[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3b_PartNumber[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].Pt9Line3c_ItemNumber[3]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].P14_Line5_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].P14_Line4_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].P14_Line3_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[24].P14_Line2_AdditionalInfo[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-485';
