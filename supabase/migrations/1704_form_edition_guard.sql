-- Migration 1704: form edition staleness guard
--
-- Every edition check in the app (proof-scan, Smart Intake) compares a scanned
-- page's footer against form_editions — but form_editions was seeded ONCE in
-- 1300_proof_scan.sql and nothing updates it. When USCIS republishes a form, our
-- stored edition, our R2 template, and the scan of the old form we mailed all
-- still agree: the system is internally consistent and externally wrong, and
-- nothing flags it. USCIS rejects filings made on a superseded edition.
--
-- This adds two independent staleness signals on form_editions:
--
--   Tier 0 (human)      last_verified_at / verified_by — a person confirmed this
--                       edition against uscis.gov. Drives a "not verified in N
--                       days" nudge. No scraping, no brittleness.
--   Tier 1 (automated)  upstream_edition / last_checked_at / check_status /
--                       check_error — a weekly cron reads the current edition off
--                       uscis.gov and compares. check_status is the derived
--                       verdict the UI and the digest email read.
--
-- source_url lets a form override the derived uscis.gov URL for the rare form
-- whose page path isn't just the lowercased number.

ALTER TABLE public.form_editions
  ADD COLUMN IF NOT EXISTS upstream_edition  text,
  ADD COLUMN IF NOT EXISTS last_checked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS check_status      text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS check_error       text,
  ADD COLUMN IF NOT EXISTS source_url        text,
  ADD COLUMN IF NOT EXISTS last_verified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by       uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Derived verdict of the automated check:
--   unknown  never auto-checked (fresh column, or the form was added since)
--   current  upstream edition parsed and equals our edition_date
--   stale    upstream edition parsed and DIFFERS — action needed
--   error    the page loaded but no edition could be parsed, or the fetch failed
--            — treated as an alert, never as "current", so a broken scraper
--            surfaces instead of silently reporting all-clear
ALTER TABLE public.form_editions
  DROP CONSTRAINT IF EXISTS form_editions_check_status_chk;
ALTER TABLE public.form_editions
  ADD CONSTRAINT form_editions_check_status_chk
  CHECK (check_status IN ('unknown', 'current', 'stale', 'error'));

-- form_editions is firm-global reference data. 1300 enabled RLS with a read-only
-- policy (staff_read_form_editions USING (true)) and NO write policy, so all
-- writes go through the service role — the cron and the verify endpoint both use
-- the admin client, gating on the caller's role in application code. The new
-- columns inherit that, so no policy change is needed here.

COMMENT ON COLUMN public.form_editions.check_status IS
  'Automated edition-check verdict: unknown | current | stale | error. error = could not verify, treat as alert.';
COMMENT ON COLUMN public.form_editions.last_verified_at IS
  'When a human last confirmed this edition against uscis.gov (Tier 0).';

-- Supplement forms have no standalone uscis.gov page (I-130A 404s; I-765WS
-- redirects to a bare PDF). Their edition is published on the PARENT form's page
-- and USCIS versions the supplement in lockstep with its parent, so point the
-- check there. Without this they perpetually read 'error'. Idempotent.
UPDATE public.form_editions SET source_url = 'https://www.uscis.gov/i-130'
  WHERE form_number = 'I-130A' AND source_url IS NULL;
UPDATE public.form_editions SET source_url = 'https://www.uscis.gov/i-765'
  WHERE form_number = 'I-765WS' AND source_url IS NULL;
