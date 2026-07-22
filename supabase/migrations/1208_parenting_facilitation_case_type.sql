-- Migration 1208: add parenting_facilitation case type
-- Anita does PF work as a court-appointed neutral; needs its own case type.
-- No client portal access is issued for these matters.

ALTER TYPE public.case_type ADD VALUE IF NOT EXISTS 'parenting_facilitation';
