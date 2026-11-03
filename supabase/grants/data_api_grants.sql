-- Data API grants for a REBUILT schema
-- Run LAST whenever this schema is recreated from migrations: a new Supabase
-- project, a preview branch, or a local `supabase db reset`. Run it after every
-- migration so every table they create is covered.
--
-- Why this exists: from 2026-10-30 Supabase no longer auto-grants Data API
-- access to new tables in public. Most of this project's migrations were written
-- before that and never GRANT anything, so on a rebuilt schema every table would
-- return "permission denied" through supabase-js / PostgREST (service_role too).
-- The live project is unaffected: its existing tables kept the old auto-grants.
--
-- New migrations should still GRANT inline, in the same file as the CREATE TABLE.
-- This file is the safety net for the old ones.
--
-- These grants mirror the old auto-grant. RLS is what actually restricts access,
-- so a table with RLS disabled is fully exposed to anon -- see the check at the end.
--
-- Deliberately NO function grants: the change only affects tables, and any RPC
-- that does REVOKE ALL FROM PUBLIC on purpose would be reopened by a blanket
-- EXECUTE grant.
--
-- Idempotent: safe to re-run.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Sanity check: tables with RLS off. Expect zero rows; anything listed is
-- readable/writable by anyone holding the anon key.
SELECT c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND NOT c.relrowsecurity
ORDER BY 1;
