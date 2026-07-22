-- Migration 1013: private booking offers ("invite to book") + consult-type rename.
--
-- A booking offer is a single-use, expiring capability link a staffer sends to
-- a specific prospect. It lets that prospect book ONE consult of a specific
-- type (typically a staff-offered-only type: free / special-rate) with a
-- specific attorney via /book?offer=<token> — picking their own slot from the
-- attorney's real availability. Public API access to staff-only types is
-- granted ONLY through a live offer token.

CREATE TABLE IF NOT EXISTS public.booking_offers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token               text        NOT NULL UNIQUE
                                  DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  consult_type_id     uuid        NOT NULL REFERENCES public.consult_types(id) ON DELETE CASCADE,
  user_id             uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,  -- the attorney
  label               text,       -- staff-facing note: who this link was sent to
  expires_at          timestamptz NOT NULL DEFAULT now() + interval '30 days',
  used_appointment_id uuid        REFERENCES public.appointments(id) ON DELETE SET NULL,   -- set = consumed
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_booking_offers_open ON public.booking_offers (expires_at)
  WHERE used_appointment_id IS NULL;

ALTER TABLE public.booking_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "booking_offers_select" ON public.booking_offers
  FOR SELECT USING (public.can_read('scheduling'));
CREATE POLICY "booking_offers_write" ON public.booking_offers
  FOR ALL USING (public.can_write('scheduling'));

-- Rename the seeded "Reduced-Rate Consultation" (fresh installs get the new
-- name from the 1010 seed; this catches databases seeded before the rename).
UPDATE public.consult_types
  SET name        = 'Special-Rate Consultation',
      description = 'A consultation at a special rate offered by the attorney.'
  WHERE name = 'Reduced-Rate Consultation';
