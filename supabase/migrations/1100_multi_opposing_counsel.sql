-- Migration 1100: Multi-opposing-counsel support + DWOP key date type
-- Adds a proper one-to-many opposing_counsels table linked to matters.
-- Keeps legacy single-OC columns on opposing_parties for backward compat (left null going forward).
-- Adds DWOP (Dismissal for Want of Prosecution) as a key_date_type enum value.
-- Apply AFTER migrations 001–1050.

-- ── 1. Add DWOP to key_date_type enum ────────────────────────────────────────

ALTER TYPE public.key_date_type ADD VALUE IF NOT EXISTS 'dwop';

COMMENT ON TYPE public.key_date_type IS
  'Key date types for matters. dwop = Dismissal for Want of Prosecution (Texas).';

-- ── 2. Create opposing_counsels table ────────────────────────────────────────
--
-- Linked to matters (not opposing_parties) because:
--   a) A matter can have OC even when opposing_party record is sparse.
--   b) Collaborative matters have neutral professionals (MHP, FP) who are not
--      strictly "opposing" but are counsel/professional contacts on the matter.

CREATE TABLE IF NOT EXISTS public.opposing_counsels (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id      uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  attorney_name  text        NOT NULL,
  firm           text,
  phone          text,
  email          text,
  address_line1  text,
  address_city   text,
  address_state  text,
  address_zip    text,

  -- Role distinguishes true OC from collaborative neutrals (MHP, FP, GAL, etc.)
  role           text        NOT NULL DEFAULT 'Opposing Counsel',

  sort_order     integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_opposing_counsels_matter ON public.opposing_counsels (matter_id);

CREATE TRIGGER opposing_counsels_updated_at
  BEFORE UPDATE ON public.opposing_counsels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.opposing_counsels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opp_counsel_read"  ON public.opposing_counsels
  FOR SELECT USING (public.can_read('core'));

CREATE POLICY "opp_counsel_write" ON public.opposing_counsels
  FOR ALL USING (public.can_write('core'));
