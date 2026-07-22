-- 1901_folder_templates.sql
-- File Manager: firm-level folder defaults (Anita feedback 2026-07-08).
--   default_matter_folders — custom folder paths seeded into matter_folders
--     on every new matter (e.g. ["Collaborative Documents", "Drafts"]).
--   hidden_builtin_folders — built-in Files-tab folder keys the firm doesn't
--     use (e.g. ["trial_docs", "other"]); the UI hides them while empty.
-- Both live on the firm_settings singleton (authenticated read, Owner write).

ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS default_matter_folders jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS hidden_builtin_folders jsonb NOT NULL DEFAULT '[]'::jsonb;
