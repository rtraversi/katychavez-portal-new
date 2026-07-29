-- Migration 1625: backfill form_templates.edition_date from form_editions
--
-- Every form loaded before this migration left form_templates.edition_date NULL:
-- the 1600-* field-map migrations recorded the edition only in a header comment,
-- and five of sixteen didn't record it at all. The column is the documented
-- fallback for the expected-edition lookup in proof-scan.js and
-- smart-intake-analyze.js, so it was a fallback that could never fire.
--
-- It has not caused a visible failure yet only because form_editions (seeded in
-- 1300_proof_scan.sql) happens to cover all twelve loaded forms. The next form
-- added without a form_editions row would have had no expected edition from
-- either source, and editionOk() returns null in that case — so every scanned
-- page would report "edition date could not be verified" rather than failing.
--
-- form_editions.form_number is the uppercased form key ('I-765WS' <- 'i-765ws').
-- Going forward prep-form.js scaffolds both writes and validate-field-map.js
-- fails the run if they are missing or disagree, so this backfill is one-time.

UPDATE public.form_templates t
SET edition_date = e.edition_date
FROM public.form_editions e
WHERE upper(t.form_key) = e.form_number
  AND t.edition_date IS DISTINCT FROM e.edition_date;

-- Any active template still without an expected edition after the backfill has
-- no form_editions row either, and its edition can never be verified. Surface
-- it as a notice rather than failing the migration — the fix is to add the
-- form_editions row, which needs the printed PDF in hand.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(form_key, ', ' ORDER BY form_key)
    INTO missing
    FROM public.form_templates
   WHERE active AND edition_date IS NULL;

  IF missing IS NOT NULL THEN
    RAISE NOTICE 'form_templates with no known edition (add a form_editions row): %', missing;
  END IF;
END $$;
