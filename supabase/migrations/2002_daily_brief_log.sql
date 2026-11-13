-- Migration 2002: Bea-Bot — brief audit log
--
-- Slice 1 of BEA-BOT-PLAN.md. Every brief Bea writes is recorded here with
-- Katy's reply and the changes that reply produced.
--
-- Two jobs, and the second one is the point of Slice 1:
--
--   1. Audit. Section 6 of the spec wants this kept, and it fits the firm's AI
--      governance work: for any morning, what was Bea told, what did she say,
--      what changed as a result.
--
--   2. The silent week. sent_at IS NULL means the brief was generated and not
--      delivered. That is the whole mechanism for running Bea for a week without
--      her interrupting anyone: Katy reads a week of these, says which were
--      useful, the rubric gets tuned, and only then does Slice 2 start sending.
--      Without the column there is no way to run the thing harmlessly.
--
-- Apply AFTER 2001_daily_brief_items.sql.

CREATE TABLE IF NOT EXISTS public.brief_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- One brief per day. The job upserts on this, so a re-run replaces rather
  -- than duplicates -- which matters while the prompt is being tuned and the
  -- same morning gets regenerated several times.
  brief_date  date NOT NULL UNIQUE,

  brief_text  text NOT NULL,

  -- NULL while Bea is running silently. Set the moment it is actually
  -- delivered, which does not happen at all until Slice 2.
  sent_at     timestamptz,

  -- Katy's free-text answer, stored verbatim before anything interprets it.
  -- When a reply is misread, this is the only record of what she actually
  -- wrote, and reply parsing is the part most likely to get it wrong.
  katy_reply     text,
  replied_at     timestamptz,

  -- What the reply was taken to mean, applied to priority_items. The pair
  -- (katy_reply, changes_applied) is what makes a misparse debuggable instead
  -- of just wrong.
  changes_applied jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Which model wrote it, and how much it was given. Needed to tell a prompt
  -- change from a model change when quality moves.
  model          text,
  input_summary  jsonb,

  -- Section 4.4: a failed job sends Katy one line and never fails silently.
  -- A row with error_text and no brief_text is how a bad morning is visible
  -- afterwards rather than being an absence of evidence.
  error_text     text,

  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brief_log_date ON public.brief_log (brief_date DESC);

-- Unsent briefs, newest first -- the review queue for the silent week.
CREATE INDEX IF NOT EXISTS idx_brief_log_unsent
  ON public.brief_log (brief_date DESC) WHERE sent_at IS NULL;

ALTER TABLE public.brief_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.brief_log IS
  'Bea-Bot: every brief, Katy''s reply, and the changes it caused. '
  'sent_at IS NULL means generated but not delivered. Service-role only '
  'until Slice 3 adds a read policy.';
