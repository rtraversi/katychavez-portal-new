-- 1522_translation_cert_toggle.sql
-- Translation module: per-translation toggle for the certification block.
-- Stored on the row so History re-downloads honor the original choice.
-- Existing rows default TRUE (all pre-toggle translations were certified).

ALTER TABLE public.translations
  ADD COLUMN IF NOT EXISTS include_certification BOOLEAN NOT NULL DEFAULT TRUE;
