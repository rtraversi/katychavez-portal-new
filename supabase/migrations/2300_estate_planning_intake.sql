-- 2300_estate_planning_intake.sql
-- Estate Planning module: emailed client questionnaire (no login) → answers on the
-- client card → Word documents drafted from the answers.
-- Range 2300-2399 = Estate Planning. See ESTATE-INTAKE-PLAN.md.
--
-- Idempotent and self-contained on purpose: it is cherry-picked from the sandbox
-- template into client repos (KCL first), and must run whether or not the unmerged
-- module/estate-planning branch's 2101 (practice areas) was ever applied there.
-- The practice-area and case-type keys below are the SAME keys 2101 seeds, so the
-- two converge rather than duplicate.

-- ── Module registration (premium) ────────────────────────────────────────────

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default, tier)
VALUES (
  'estate_planning',
  'Estate Planning',
  'Send clients a wills & trusts questionnaire by email, review the answers on the client card, and draft documents from them in Word.',
  'feather',
  'clients',
  1,
  64,
  false,
  'premium'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'estate_planning',
       CASE WHEN name IN ('Owner', 'Staff Admin') THEN 'admin' ELSE 'write' END::public.access_level
FROM public.roles
WHERE name IN ('Owner', 'Attorney', 'Partner Attorney', 'Paralegal', 'Legal Assistant', 'Staff Admin')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Enable for this firm. (Sandbox, and KCL when cherry-picked — both want it.)
INSERT INTO public.enabled_modules (module_key) VALUES ('estate_planning')
ON CONFLICT DO NOTHING;

-- ── Practice area + case types (same keys as 2101) ───────────────────────────

INSERT INTO public.practice_areas (key, name, description, sort_order) VALUES
  ('estate_planning', 'Estate Planning',
   'Wills, trusts, powers of attorney, advance directives, and related planning matters', 50)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('simple_will',             'Simple Will',                         10),
  ('will_testamentary_trust', 'Will with Testamentary Trust',        20),
  ('revocable_living_trust',  'Revocable Living Trust',              30),
  ('financial_poa',           'Financial Power of Attorney',         80),
  ('advance_directive',       'Advance Directive / Health Care POA', 90),
  ('plan_review',             'Estate Plan Review / Amendment',     110),
  ('other',                   'Other',                              999)
) AS ct(key, name, sort_order)
WHERE pa.key = 'estate_planning'
ON CONFLICT (practice_area_id, key) DO NOTHING;

INSERT INTO public.enabled_practice_areas (practice_area_key) VALUES ('estate_planning')
ON CONFLICT DO NOTHING;

-- ── Word templates that fill from the estate questionnaire ───────────────────
-- NULL = the existing case-data merge (drafting-generate.js). 'estate_planning' =
-- the merge context in _ep-merge-context.js. One column rather than a second
-- template table, so uploads, the Word Templates settings page, draft_documents,
-- versions and open-in-Word all keep working unchanged.

ALTER TABLE public.draft_templates
  ADD COLUMN IF NOT EXISTS merge_profile text;

DO $$ BEGIN
  ALTER TABLE public.draft_templates
    ADD CONSTRAINT draft_templates_merge_profile_chk
    CHECK (merge_profile IS NULL OR merge_profile IN ('estate_planning'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Which starter template a row was installed from (e.g. 'nc_hcpoa'), so a
-- reinstall updates rather than duplicates. NULL for firm-uploaded templates.
ALTER TABLE public.draft_templates
  ADD COLUMN IF NOT EXISTS starter_key text;

CREATE UNIQUE INDEX IF NOT EXISTS draft_templates_starter_key_uq
  ON public.draft_templates (starter_key) WHERE starter_key IS NOT NULL;

-- Which side of a couple a draft was made for ('client' | 'spouse').
ALTER TABLE public.draft_documents
  ADD COLUMN IF NOT EXISTS ep_role text;

-- ── Questionnaire requests ───────────────────────────────────────────────────
-- One row per link sent. Resending revokes the open row and carries its draft
-- answers forward, so a client never loses progress to a fresh link — and the
-- history of what was sent when survives.
--
-- The token itself is never stored, only its SHA-256 (hex). The row is the
-- capability; leaking the table must not leak working links.
--
-- answers_submitted is what the client actually sent, frozen at submit.
-- answers is the working copy staff edit before drafting. Drafting reads `answers`.

CREATE TABLE IF NOT EXISTS public.ep_intake_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  questionnaire_key    text NOT NULL,
  questionnaire_version integer NOT NULL,
  token_hash           text NOT NULL UNIQUE,
  language             text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'es')),
  sent_to_email        text,
  sent_by              uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at              timestamptz NOT NULL DEFAULT now(),
  emailed              boolean NOT NULL DEFAULT false,
  expires_at           timestamptz NOT NULL,
  revoked_at           timestamptz,
  opened_at            timestamptz,
  draft_answers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_saved_at       timestamptz,
  submitted_at         timestamptz,
  answers_submitted    jsonb,
  answers              jsonb,
  answers_updated_at   timestamptz,
  answers_updated_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ep_intake_requests_matter_idx
  ON public.ep_intake_requests (matter_id, sent_at DESC);

-- At most one OPEN request per matter (not submitted, not revoked).
CREATE UNIQUE INDEX IF NOT EXISTS ep_intake_requests_one_open_uq
  ON public.ep_intake_requests (matter_id)
  WHERE submitted_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.ep_intake_requests ENABLE ROW LEVEL SECURITY;

-- Staff read through RLS; every write goes through a Worker endpoint with the
-- service role (token checks, validation against the definition, email).
DROP POLICY IF EXISTS ep_intake_requests_read ON public.ep_intake_requests;
CREATE POLICY ep_intake_requests_read ON public.ep_intake_requests
  FOR SELECT TO authenticated USING (public.can_read('estate_planning'));

REVOKE ALL ON public.ep_intake_requests FROM anon, authenticated;
GRANT SELECT ON public.ep_intake_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ep_intake_requests TO service_role;
