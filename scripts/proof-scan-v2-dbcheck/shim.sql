-- TEST ONLY. NEVER APPLY TO A REAL DATABASE.
--
-- A minimal stand-in for the parts of Supabase that plain Postgres lacks, so
-- the Proof Scan migration chain can be applied to a throwaway local database
-- by scripts/proof-scan-v2-dbcheck/run.sh. Real Supabase projects already have
-- all of this (and much more); running it there would clash with the real auth
-- schema.
--
-- Only what the applied migrations actually need:
--   roles anon / authenticated / service_role   policies name them (TO authenticated, REVOKE ... FROM anon)
--   auth.users (id, email, raw_user_meta_data)   002 references it and its signup trigger reads email + metadata
--   auth.uid()                                   003 / 005 helpers and policies
--
-- auth.uid() reads request.jwt.claim.sub, the same setting Supabase's own
-- auth.uid() reads. Checks impersonate a user with:
--   SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '<auth id>', true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  -- Supabase's service_role bypasses row level security.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id                  uuid  PRIMARY KEY,
  email               text,
  raw_user_meta_data  jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Supabase grants the API roles usage on these schemas and default privileges on
-- everything created in public. Mirror that, so a missing policy (not a missing
-- grant) is what the checks exercise.
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
