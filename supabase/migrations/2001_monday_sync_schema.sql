-- 2001_monday_sync_schema.sql
-- Schema for the monday.com client sync. Range 2000-2099 = Monday Sync.
--
-- Three pieces:
--
--   clients.monday_item_id  the back-link. Neither side carried one before this, which
--                           is the whole reason a naive first run would have created a
--                           duplicate of every existing client.
--   monday_sync_state       board/group config and the last-run record. One row.
--   monday_sync_items       every board item this module has an opinion about — the
--                           review queue, the ignore list, and the audit trail of what
--                           was imported and when.
--
-- Decision 2026-07-20: a client leaving the board group is FLAGGED, never archived.
-- A departure is usually a monday reorganisation, not a closed case, and archiving on
-- that signal would hide live matters. See the 'departed' status below.

-- ---------------------------------------------------------------------------
-- 1. The back-link
-- ---------------------------------------------------------------------------

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS monday_item_id text;

-- UNIQUE so the same board item can never produce two clients, which is the specific
-- failure this module exists to avoid. Partial, because the overwhelming majority of
-- clients have no monday item and NULLs must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS clients_monday_item_id_key
  ON public.clients (monday_item_id)
  WHERE monday_item_id IS NOT NULL;

COMMENT ON COLUMN public.clients.monday_item_id IS
  'monday.com item id this client was imported from or reconciled to. NULL for clients created in the portal.';

-- ---------------------------------------------------------------------------
-- 2. Sync state — one row
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.monday_sync_state (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Which board and group to read. Only one group on the board is a client list; the
  -- rest of that board is an activity and mailing log, so syncing the board as a whole
  -- would import well over a thousand junk records.
  board_id      text        NOT NULL,
  group_id      text        NOT NULL,

  -- The run recorder upserts on this pair, so it needs to be unique. Also stops a
  -- mis-set env var from quietly accumulating a second state row that nothing reads.
  UNIQUE (board_id, group_id),

  -- Last completed run.
  last_run_at   timestamptz,
  last_run_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  last_run_created  integer NOT NULL DEFAULT 0,
  last_run_skipped  integer NOT NULL DEFAULT 0,
  last_error    text
);

CREATE TRIGGER monday_sync_state_updated_at
  BEFORE UPDATE ON public.monday_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Per-item record — review queue, ignore list and audit trail in one table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.monday_sync_items (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  monday_item_id  text        NOT NULL UNIQUE,
  item_name       text        NOT NULL,

  -- pending   parsed cleanly, waiting to be confirmed in a preview
  -- imported  a client was created (or an existing one linked) — see client_id
  -- review    parsed with something a human has to settle before it can be imported
  -- ignored   not a client at all (working notes, staff, mail threads), or explicitly
  --           dismissed by staff. Kept so it does not resurface on every run.
  -- departed  was in the group, no longer is. Flag only — nothing is archived.
  status          text        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'imported', 'review', 'ignored', 'departed')),

  -- Why this item is in review or was ignored, in words a reviewer can act on.
  reason          text,

  -- What the parser made of the item, and the raw monday columns it came from. Kept so
  -- a reviewer can see the original alongside the interpretation, and so a parser change
  -- can be re-run against what the board actually said.
  parsed          jsonb,
  raw             jsonb,

  client_id       uuid        REFERENCES public.clients(id) ON DELETE SET NULL,
  matter_id       uuid        REFERENCES public.matters(id) ON DELETE SET NULL,

  resolved_by     uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at     timestamptz
);

CREATE TRIGGER monday_sync_items_updated_at
  BEFORE UPDATE ON public.monday_sync_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The two queues staff actually look at.
CREATE INDEX IF NOT EXISTS monday_sync_items_review_idx
  ON public.monday_sync_items (status) WHERE status = 'review';
CREATE INDEX IF NOT EXISTS monday_sync_items_departed_idx
  ON public.monday_sync_items (status) WHERE status = 'departed';

-- ---------------------------------------------------------------------------
-- 4. RLS — staff read directly for the page and the nav badge; every write goes
--    through the Worker with the service role.
-- ---------------------------------------------------------------------------

ALTER TABLE public.monday_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_sync_items ENABLE ROW LEVEL SECURITY;

-- DROP before CREATE keeps this migration re-runnable.
DROP POLICY IF EXISTS "monday_sync_state_staff_read" ON public.monday_sync_state;
CREATE POLICY "monday_sync_state_staff_read"
  ON public.monday_sync_state FOR SELECT
  USING (public.can_read('monday_sync'));

DROP POLICY IF EXISTS "monday_sync_items_staff_read" ON public.monday_sync_items;
CREATE POLICY "monday_sync_items_staff_read"
  ON public.monday_sync_items FOR SELECT
  USING (public.can_read('monday_sync'));
