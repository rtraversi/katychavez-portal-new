-- Migration 1012: booking-page visibility flag + branding.
--
-- 1) consult_types.public_bookable — only flagged types appear on the public
--    /book page (or can be booked through the public API). Unflagged types
--    (free / reduced-rate) stay in the catalog as attorney-OFFERED options:
--    the firm decides a prospect gets one, the prospect never self-books it.
-- 2) booking_settings.logo_url + brand_color — self-serve branding for /book,
--    edited in Settings → Scheduling.

ALTER TABLE public.consult_types
  ADD COLUMN IF NOT EXISTS public_bookable boolean NOT NULL DEFAULT true;

-- Seed policy: prospects self-book only the paid Initial Consultation.
-- Safe today: runs before any real firm has customized its catalog.
UPDATE public.consult_types
  SET public_bookable = false
  WHERE fee_type IN ('free', 'reduced');

ALTER TABLE public.booking_settings
  ADD COLUMN IF NOT EXISTS logo_url    text,
  ADD COLUMN IF NOT EXISTS brand_color text;
