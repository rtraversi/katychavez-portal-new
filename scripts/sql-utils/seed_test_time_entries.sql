-- Seed: test time entries for billing UI development
-- Safe to run multiple times (uses DO block, checks for existing seed entries).
-- Picks the first 2 active/intake matters and first 2 attorney-role users it finds.
-- Run in sandbox Supabase SQL editor only — never apply to production.

DO $$
DECLARE
  m1  uuid;  m2  uuid;
  u1  uuid;  u2  uuid;
BEGIN

  -- Grab two matters
  SELECT id INTO m1 FROM public.matters WHERE status IN ('active','intake') ORDER BY created_at LIMIT 1;
  SELECT id INTO m2 FROM public.matters WHERE status IN ('active','intake') ORDER BY created_at OFFSET 1 LIMIT 1;

  -- Fall back to same matter if only one exists
  IF m2 IS NULL THEN m2 := m1; END IF;

  -- Grab two attorney-ish users (Owner or Attorney role)
  SELECT u.id INTO u1
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE r.name IN ('Owner','Attorney','Partner Attorney')
  ORDER BY u.created_at LIMIT 1;

  SELECT u.id INTO u2
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE r.name IN ('Owner','Attorney','Partner Attorney')
  ORDER BY u.created_at OFFSET 1 LIMIT 1;

  IF u2 IS NULL THEN u2 := u1; END IF;

  IF m1 IS NULL OR u1 IS NULL THEN
    RAISE NOTICE 'No matters or attorney users found — skipping seed.';
    RETURN;
  END IF;

  INSERT INTO public.time_entries
    (matter_id, user_id, entry_date, hours, description, rate, status, created_by)
  VALUES
    -- Matter 1 entries
    (m1, u1, CURRENT_DATE - 14, 1.50, 'Initial client consultation and case evaluation',         350.00, 'unbilled', u1),
    (m1, u1, CURRENT_DATE - 12, 0.75, 'Review and analysis of supporting documents',              350.00, 'unbilled', u1),
    (m1, u2, CURRENT_DATE - 11, 2.00, 'Legal research on applicable precedents',                  275.00, 'unbilled', u2),
    (m1, u1, CURRENT_DATE - 9,  1.25, 'Drafting correspondence to opposing counsel',              350.00, 'unbilled', u1),
    (m1, u2, CURRENT_DATE - 7,  0.50, 'Client call — status update and next steps',               275.00, 'unbilled', u2),
    (m1, u1, CURRENT_DATE - 5,  3.00, 'Preparation and review of case filing documents',         350.00, 'unbilled', u1),
    (m1, u2, CURRENT_DATE - 3,  1.00, 'Internal case strategy meeting',                           275.00, 'unbilled', u2),

    -- Matter 2 entries
    (m2, u1, CURRENT_DATE - 13, 2.00, 'Client intake — review of matter background and goals',   350.00, 'unbilled', u1),
    (m2, u2, CURRENT_DATE - 10, 1.50, 'Research applicable statutes and regulatory framework',   275.00, 'unbilled', u2),
    (m2, u1, CURRENT_DATE - 8,  0.75, 'Review and respond to client document requests',          350.00, 'unbilled', u1),
    (m2, u2, CURRENT_DATE - 6,  1.25, 'Prepare memo summarizing legal options',                   275.00, 'unbilled', u2),
    (m2, u1, CURRENT_DATE - 4,  2.50, 'Draft and revise client agreement',                        350.00, 'unbilled', u1),
    (m2, u2, CURRENT_DATE - 2,  0.50, 'Coordinate with client on outstanding items',              275.00, 'unbilled', u2);

  RAISE NOTICE 'Seeded 13 test time entries across 2 matters.';
END;
$$;
