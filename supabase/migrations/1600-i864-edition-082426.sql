-- Migration 1600-i864-edition-082426: I-864 edition bump 10/17/24 -> 08/24/26
--
-- USCIS republished the Affidavit of Support. 1600-i864.sql is already applied
-- (supabase/migrations/applied-dev.txt line 128), and db-migrate tracks
-- migrations by exact filename, so the map correction ships here as an
-- amendment rather than an in-place edit of that file -- the same pattern as
-- 1600-g28-atty-fields.sql.
--
-- Source:  uscis-forms/i-864.pdf
-- Edition: 08/24/26 (printed lower-left; OMB expires 10/31/2027)
-- SHA-256: ddf0b845399ef4ad252468f41820eddf8a726bb982d032bb6fc4a861f2c08130
--
-- Previous edition: 10/17/24, SHA-256
-- f231f39684ba4dd348aad920a65f29ef5707270f39d6f8328ab43e366348f5f5
--
-- ── What actually changed in the form ────────────────────────────────────────
--
-- Almost nothing, and that is the important finding. Re-running prep-form.js
-- against the new PDF gives 207 fields (41 CheckBox, 163 TextField, 3 Dropdown)
-- -- identical counts to 10/17/24. A full comparison of the old map's keys
-- against normalized/i-864.fields.json shows:
--
--   * every field's LEAF NAME is unchanged (no additions, removals, renames)
--   * the field ORDER is byte-for-byte identical
--   * the ONLY delta is the subform index on 8 fields
--
--   subform  10/17/24  08/24/26
--        8         0        8     <- new subform, did not exist before
--        9        10        2
--   (all ten other subforms unchanged: 18/36/31/21/19/18/12/5/17/20)
--
-- USCIS introduced a subform break inside Part 8, splitting the sponsor's
-- interpreter statement and contact information onto their own subform and
-- leaving only the signature pair behind on subform[9]. Page count is still 12
-- and the Part/Item numbering on the printed form is unchanged, so proof-scan's
-- page expectation does not move.
--
-- Because field_map keys are FULL dotted paths, those 8 keys no longer match
-- anything in the new template. The validator caught it as 8 errors + 8
-- warnings. Four of the eight carry real sources, so on the new edition they
-- would have silently stopped filling -- no error, just empty boxes on a filed
-- affidavit:
--
--     P8_Line2_Attorney             attorney.full_name
--     P8_Line3_DaytimeTelephoneNumber  petitioner.cell_phone [digits]
--     P8_Line4_MobileTelephoneNumber   petitioner.cell_phone [digits]
--     P7Line7_EmailAddress          petitioner.email
--
-- The other four were already blank and are re-pointed too, so every field
-- keeps an entry per USCIS-FORM-PREP-PROCESS.md.
--
-- Sources are carried across UNCHANGED. Tooltips for all eight were re-read
-- from the new normalized/i-864.tooltips.tsv and still describe the same Part 8
-- items, so this is purely a key rename.
--
-- ── Separate fix: Part 10 item 4 is NOT a fax box ───────────────────────────
--
-- Found while re-verifying all 52 non-blank entries against the new tooltips.
--
--   form1[0].#subform[10].P10_Line5_PreparersFaxNumber[0]  was  firm.fax
--
-- The field is NAMED fax, but its USCIS tooltip reads "Part 10 ... Preparer's
-- Contact Information. 4. Enter Preparer's Mobile Telephone Number (if any)",
-- and the printed 08/24/26 form confirms it: Part 10 item 4 is "Preparer's
-- Mobile Telephone Number (if any)". There is no fax box anywhere in Part 10.
-- As mapped, the firm's fax number printed into the preparer's mobile phone box
-- on a filed affidavit.
--
-- This is the exact trap USCIS-FORM-PREP-PROCESS.md warns about ("never guess
-- what a field means from its name"), and the rest of the library already got
-- it right: I-130, I-130A, I-765 and I-192 all leave the equivalent field
-- blank, and 1600-i130.sql's header states the reason outright --
-- "Pt8Line5_PreparerFaxNumber is NAMED fax but its tooltip is the preparer's
-- MOBILE number -- blank either way, as users has no cell column."
--
-- Still true: node scripts/fill-sources.js shows no cell/mobile column on
-- users (only phone and fax) or firm_settings. So this goes to blank, matching
-- the majority precedent, rather than to a substitute column.
--
-- NOT FIXED HERE -- ESCALATED: 1600-i751.sql maps its equivalent field
-- (form1[0].#subform[8].P7_Line5_PreparersFaxNumber[0]) to attorney.fax and has
-- the same defect. I-751 is a different form with its own applied migration and
-- is out of scope for an I-864 edition bump; it needs its own amendment.
--
-- ── Not changed ─────────────────────────────────────────────────────────────
--
-- The two ⚠ notes in 1600-i864.sql's header both still hold on this edition and
-- are NOT superseded:
--   * party roles remain inverted (Part 2 sponsor -> petitioner.*,
--     Part 3 immigrant -> client.*)
--   * joint_sponsor.* is still structurally unexercisable by this map; a joint
--     sponsor files their own I-864 as the Part 2 subject. Still Rob's call.
-- The uppercase-transform escalation (COUNTRIES / LAST NAMES) is also unchanged
-- and still outstanding.
--
-- ── Requires a template re-upload ───────────────────────────────────────────
--
-- The R2 object form-templates/i-864.pdf still holds the 10/17/24 template,
-- whose Part 8 fields sit on subform[9]. Applying this migration WITHOUT
-- re-uploading inverts the breakage: the map would then point at subform[8]
-- keys that the old template does not have. Apply the migration and upload the
-- new template together:
--
--     node scripts/normalize-form-template.js i-864 --upload
--
-- Normalized template verified before writing this migration: loads with no
-- password, not encrypted, 12 pages, 207 fields, 0 read-only fields, 0 leftover
-- barcode text fields, 12 PDF417 barcodes stamped as images.

-- ── 1. Re-point the 8 relocated Part 8 fields ───────────────────────────────
-- Drop the stale subform[9] keys, then merge the same entries back at
-- subform[8]. Parenthesised so the deletes complete before the concat.

UPDATE public.form_templates
SET field_map = (
      field_map
        - 'form1[0].#subform[9].P6_Line1_Checkbox[1]'
        - 'form1[0].#subform[9].P6_Line1_Checkbox[2]'
        - 'form1[0].#subform[9].P8_Line1b_language[0]'
        - 'form1[0].#subform[9].P8_Line2_Checkbox[0]'
        - 'form1[0].#subform[9].P8_Line2_Attorney[0]'
        - 'form1[0].#subform[9].P8_Line3_DaytimeTelephoneNumber[0]'
        - 'form1[0].#subform[9].P8_Line4_MobileTelephoneNumber[0]'
        - 'form1[0].#subform[9].P7Line7_EmailAddress[0]'
    ) || '{
  "form1[0].#subform[8].P6_Line1_Checkbox[1]":              { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[8].P6_Line1_Checkbox[2]":              { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[8].P8_Line1b_language[0]":             { "type": "text",     "source": "blank" },
  "form1[0].#subform[8].P8_Line2_Checkbox[0]":              { "type": "checkbox", "source": "blank" },
  "form1[0].#subform[8].P8_Line2_Attorney[0]":              { "type": "text",     "source": "attorney.full_name" },
  "form1[0].#subform[8].P8_Line3_DaytimeTelephoneNumber[0]": { "type": "text",    "source": "petitioner.cell_phone", "transform": "digits" },
  "form1[0].#subform[8].P8_Line4_MobileTelephoneNumber[0]":  { "type": "text",    "source": "petitioner.cell_phone", "transform": "digits" },
  "form1[0].#subform[8].P7Line7_EmailAddress[0]":           { "type": "text",     "source": "petitioner.email" }
}'::jsonb
WHERE form_key = 'i-864';

-- ── 2. Part 10 item 4 is the preparer's MOBILE number, not a fax ────────────

UPDATE public.form_templates
SET field_map = field_map || '{
  "form1[0].#subform[10].P10_Line5_PreparersFaxNumber[0]": { "type": "text", "source": "blank" }
}'::jsonb
WHERE form_key = 'i-864';

-- ── 3. Record the new edition on the template ───────────────────────────────
-- field_count is unchanged at 207; restated so the row is self-consistent if
-- this migration is ever read on its own.

UPDATE public.form_templates
SET edition_date = '08/24/26',
    field_count  = 207
WHERE form_key = 'i-864';

-- ── 4. Move form_editions forward ───────────────────────────────────────────
-- 1300_proof_scan.sql seeded ('I-864', 12, '10/17/24'). Every edition check in
-- the app (proof-scan, Smart Intake) reads this row, so leaving it behind would
-- make the scanner reject affidavits printed on the CURRENT edition.
--
-- Pages stay 12. The 1704 guard columns are set to the verified-today state:
-- the edition above was read off the PDF downloaded from uscis.gov on
-- 2026-09-01, so upstream and ours now agree by construction. verified_by is
-- left NULL -- this was a migration, not a click in the verify UI. The weekly
-- cron re-derives check_status regardless, so this is only a starting point.

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('I-864', 12, '08/24/26')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();

UPDATE public.form_editions
SET upstream_edition  = '08/24/26',
    check_status      = 'current',
    check_error       = NULL,
    last_checked_at   = now(),
    last_verified_at  = now()
WHERE form_number = 'I-864';
