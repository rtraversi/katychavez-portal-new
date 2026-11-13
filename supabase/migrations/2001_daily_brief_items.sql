-- Migration 2001: Bea-Bot — the running priority list
--
-- Slice 1 of BEA-BOT-PLAN.md. This is the list Katy works from; the daily brief
-- is a view onto its top few rows, not a separate thing.
--
-- Apply AFTER 2000_bea_bot_tg_messages.sql.
--
-- NOTE ON priority_items VS tasks: the plan recommended extending public.tasks
-- rather than running a second task system, and that is still the better shape
-- in production. It is deliberately NOT done here, because the brief has to be
-- built and tuned against a database that does not carry the portal's schema.
-- When this reaches the real portal, add a nullable task_id FK and decide then
-- whether the two merge. Until that happens the risk the plan named is real:
-- Katy closing something in Tasks while Bea keeps asking about it.

-- The portal defines this in 001_core_tables.sql. Re-creating it is a no-op
-- there and the only way this migration stands up on its own elsewhere.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ BEGIN
  CREATE TYPE public.brief_item_status AS ENUM
    ('open', 'partial', 'done', 'dropped', 'delegated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.priority_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  title      text NOT NULL,

  -- Client or case identifier as it appears in monday.com. Nullable because a
  -- business item ("billing is broken") belongs on the list with no case.
  case_ref   text,

  -- Section 2 of the spec: every item carries one line on why it needs *Katy*.
  -- NOT NULL on purpose -- the prompt is asked for this, and a prompt is a
  -- request. A column constraint is the part that cannot be talked out of it.
  why_katy   text NOT NULL,

  deadline   date,

  -- The section 3 rubric, 1 (hard deadline, severe consequence) to 5
  -- (everything else -- on the list, never in the brief).
  priority   smallint NOT NULL CHECK (priority BETWEEN 1 AND 5),

  status     public.brief_item_status NOT NULL DEFAULT 'open',
  delegated_to text,
  notes      text,

  -- Where this came from, so Katy can check it: Telegram message ids and
  -- monday item ids. jsonb rather than text[] because the two need telling
  -- apart, e.g. [{"type":"tg","id":1479},{"type":"monday","id":"123"}].
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,

  last_mentioned_in_brief date,

  -- BEYOND THE SPEC, and the reason is in the spec's own history: Katy dropped
  -- monday.com's AI agents for making noise. "Ask about items still open from
  -- yesterday" has no stopping condition, so after a few weeks of partial
  -- answers the trailing section becomes exactly that noise again. This counts
  -- how many briefs have chased an item so a rule can be written against it
  -- (escalate once, then drop it to the list). No policy uses it yet -- the
  -- column just has to exist before the policy can be tried.
  times_asked integer NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- "Open items, most urgent first" is the only query the brief and the portal
-- page both run.
CREATE INDEX IF NOT EXISTS idx_priority_items_open
  ON public.priority_items (priority, deadline NULLS LAST)
  WHERE status IN ('open', 'partial');
CREATE INDEX IF NOT EXISTS idx_priority_items_deadline
  ON public.priority_items (deadline) WHERE deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_priority_items_case_ref
  ON public.priority_items (case_ref) WHERE case_ref IS NOT NULL;

DROP TRIGGER IF EXISTS trg_priority_items_updated_at ON public.priority_items;
CREATE TRIGGER trg_priority_items_updated_at
  BEFORE UPDATE ON public.priority_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS on, no policy -- same reasoning as 2000. These rows name clients and
-- describe what is wrong with their cases. The Worker uses the service role.
-- Slice 3 adds a read policy gated on public.can_read('daily_brief').
ALTER TABLE public.priority_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.priority_items IS
  'Bea-Bot: the running priority list. Contains client data. Service-role only '
  'until Slice 3 adds a read policy.';
