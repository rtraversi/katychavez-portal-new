-- Migration 902: Document template multi-case-type support
-- Adds case_types text[] to document_checklists.
-- NULL = universal (all case types). Array = applies to listed types only.
-- Backfills existing rows from the single case_type column.
-- The old case_type column is left in place for safety but is no longer written by the app.

ALTER TABLE public.document_checklists
  ADD COLUMN IF NOT EXISTS case_types text[];

-- Backfill: specific-type rows get a single-element array
UPDATE public.document_checklists
  SET case_types = ARRAY[case_type::text]
  WHERE case_type IS NOT NULL;

-- Universal rows (case_type IS NULL) remain with case_types = NULL → still universal.
