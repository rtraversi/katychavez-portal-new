-- Migration 1011: Scheduling — double-booking race guard
-- Two prospects submitting the same slot simultaneously both pass the free/busy
-- re-check (neither calendar event exists yet). This DB-level exclusion constraint
-- makes the second INSERT fail (SQLSTATE 23P01), which the booking API surfaces
-- as 409 "that time was just booked". Cancelled/completed rows don't block —
-- only live bookings ('booked') participate.
--
-- tstzrange default bounds are [) — back-to-back appointments (A.ends_at ==
-- B.starts_at) do NOT conflict; buffers are enforced by the availability engine.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    user_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
  WHERE (status = 'booked');
