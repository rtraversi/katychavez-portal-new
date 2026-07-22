-- Migration 1518: Per-attorney draft template differentiation
--
-- Ported from wilsonlakesavage's 1105_draft_template_attorney.sql.
-- Allows templates to be scoped to a specific attorney via initials.
-- NULL = universal (shown regardless of who is assigned to the matter).

ALTER TABLE public.draft_templates
  ADD COLUMN IF NOT EXISTS assigned_attorney_initials VARCHAR(5) DEFAULT NULL;
