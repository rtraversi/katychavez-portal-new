-- Migration 1010: Scheduling module — native consult booking (premium)
-- Public booking page (attorney-first flow) + staff-managed consult types, hours, appointments.
-- Range 1010–1049 reserved for scheduling. Apply AFTER 1002 (calendar provider fix).
--
-- Identity note: booking tables reference public.users (portal identity). Calendar tokens in
-- oauth_tokens are keyed by auth.users(id) — translate via users.auth_id when reading free/busy.

-- ============================================================================
-- 1. CONSULT TYPES — the service catalog (settings-first: all staff-editable)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.consult_types (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  description       text,
  duration_min      int         NOT NULL DEFAULT 30 CHECK (duration_min > 0),
  fee_type          text        NOT NULL DEFAULT 'free' CHECK (fee_type IN ('free', 'paid', 'reduced')),
  price_cents       int         NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  buffer_before_min int         NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
  buffer_after_min  int         NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
  is_active         boolean     NOT NULL DEFAULT true,
  sort_order        int         NOT NULL DEFAULT 100,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Which attorneys offer which consult type (attorney-first flow: the public page
-- shows only the picked attorney's types — e.g. estate law only on one attorney's menu).
CREATE TABLE IF NOT EXISTS public.consult_type_providers (
  consult_type_id uuid NOT NULL REFERENCES public.consult_types(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  PRIMARY KEY (consult_type_id, user_id)
);

-- ============================================================================
-- 2. BOOKABLE ATTORNEYS — public-facing profile for the "Book with X" buttons
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_provider_profiles (
  user_id     uuid        PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  slug        text        NOT NULL UNIQUE,  -- opaque public identifier (never expose user ids)
  display_name text       NOT NULL,
  photo_url   text,
  blurb       text,
  is_bookable boolean     NOT NULL DEFAULT true,
  sort_order  int         NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. BOOKING SETTINGS — firm-level, single row (id is always 1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.booking_settings (
  id                    int         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timezone              text        NOT NULL DEFAULT 'America/Chicago',
  min_lead_hours        int         NOT NULL DEFAULT 24 CHECK (min_lead_hours >= 0),
  max_days_out          int         NOT NULL DEFAULT 30 CHECK (max_days_out > 0),
  slot_granularity_min  int         NOT NULL DEFAULT 30 CHECK (slot_granularity_min > 0),
  -- Default working hours, keyed by day-of-week 0–6 (0 = Sunday, JS Date.getDay()
  -- convention). Each day maps to an array of [start, end] local-time windows.
  -- e.g. {"1": [["09:00","17:00"]], "2": [["09:00","17:00"]], ...}
  default_hours         jsonb       NOT NULL DEFAULT
    '{"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],"4":[["09:00","17:00"]],"5":[["09:00","17:00"]]}',
  reminders_enabled     boolean     NOT NULL DEFAULT true,
  reminder_hours_before int         NOT NULL DEFAULT 24 CHECK (reminder_hours_before > 0),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.booking_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Per-attorney working windows. Rows for a user OVERRIDE default_hours entirely for
-- that user; no rows = firm default applies. Multiple windows per day allowed.
CREATE TABLE IF NOT EXISTS public.availability_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  day_of_week int  NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (start_time < end_time)
);

CREATE INDEX idx_availability_rules_user ON public.availability_rules (user_id, day_of_week);

-- ============================================================================
-- 4. APPOINTMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.appointments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  consult_type_id   uuid        NOT NULL REFERENCES public.consult_types(id),
  user_id           uuid        NOT NULL REFERENCES public.users(id),  -- the attorney
  prospect_name     text        NOT NULL,
  prospect_email    text        NOT NULL,
  prospect_phone    text,
  case_type_id      uuid        REFERENCES public.case_types(id),  -- "what's this regarding"
  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,
  status            text        NOT NULL DEFAULT 'booked'
                                CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
  calendar_event_id text,       -- event created on the attorney's connected calendar
  calendar_provider text        CHECK (calendar_provider IN ('google', 'outlook')),
  matter_id         uuid        REFERENCES public.matters(id) ON DELETE SET NULL,  -- set if converted
  payment_status    text        NOT NULL DEFAULT 'none'
                                CHECK (payment_status IN ('none', 'link_sent', 'paid')),
  payment_link      text,
  manage_token      text        NOT NULL UNIQUE
                                DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  reminder_sent_at  timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at)
);

CREATE INDEX idx_appointments_attorney_time ON public.appointments (user_id, starts_at);
CREATE INDEX idx_appointments_status        ON public.appointments (status, starts_at);

-- ============================================================================
-- 4b. updated_at triggers (house convention, set_updated_at from 001)
-- ============================================================================

CREATE TRIGGER consult_types_updated_at
  BEFORE UPDATE ON public.consult_types
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER booking_provider_profiles_updated_at
  BEFORE UPDATE ON public.booking_provider_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER booking_settings_updated_at
  BEFORE UPDATE ON public.booking_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 5. RLS — staff via module access; the public booking flow NEVER touches these
--    tables directly (service-role API only, keyed by opaque slug/manage_token).
-- ============================================================================

ALTER TABLE public.consult_types             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consult_type_providers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_provider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_settings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments              ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consult_types_select" ON public.consult_types
  FOR SELECT USING (public.can_read('scheduling'));
CREATE POLICY "consult_types_write" ON public.consult_types
  FOR ALL USING (public.can_write('scheduling'));

CREATE POLICY "consult_type_providers_select" ON public.consult_type_providers
  FOR SELECT USING (public.can_read('scheduling'));
CREATE POLICY "consult_type_providers_write" ON public.consult_type_providers
  FOR ALL USING (public.can_write('scheduling'));

CREATE POLICY "booking_provider_profiles_select" ON public.booking_provider_profiles
  FOR SELECT USING (public.can_read('scheduling'));
CREATE POLICY "booking_provider_profiles_write" ON public.booking_provider_profiles
  FOR ALL USING (public.can_write('scheduling'));

CREATE POLICY "booking_settings_select" ON public.booking_settings
  FOR SELECT USING (public.can_read('scheduling'));
CREATE POLICY "booking_settings_write" ON public.booking_settings
  FOR ALL USING (public.can_write('scheduling'));

CREATE POLICY "availability_rules_select" ON public.availability_rules
  FOR SELECT USING (public.can_read('scheduling'));
CREATE POLICY "availability_rules_write" ON public.availability_rules
  FOR ALL USING (public.can_write('scheduling'));

CREATE POLICY "appointments_select" ON public.appointments
  FOR SELECT USING (public.can_read('scheduling'));
CREATE POLICY "appointments_write" ON public.appointments
  FOR ALL USING (public.can_write('scheduling'));

-- ============================================================================
-- 6. MODULE REGISTRATION — premium, disabled by default (enabled per firm
--    via enabled_modules, same as Calendar)
-- ============================================================================

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'scheduling',
  'Scheduling',
  'Online consult booking — prospects see real attorney availability and book from the public site.',
  'calendar-check',
  'scheduling',
  1,
  36,
  false
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'scheduling', 'write'
FROM public.roles
WHERE name != 'Client'
ON CONFLICT (role_id, module_key) DO NOTHING;

-- ============================================================================
-- 7. SEED — the three standard consult types (staff edit names/prices/durations
--    in Settings → Scheduling; attorneys are attached there too)
-- ============================================================================

INSERT INTO public.consult_types (name, description, duration_min, fee_type, price_cents, sort_order)
SELECT * FROM (VALUES
  ('Free Consultation',         'A brief introductory call to see how we can help.',        15, 'free',    0, 10),
  ('Initial Consultation',      'A full consultation to review your situation in detail.',  60, 'paid',    0, 20),
  ('Special-Rate Consultation',  'A consultation at a special rate offered by the attorney.', 30, 'reduced', 0, 30)
) AS seed(name, description, duration_min, fee_type, price_cents, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.consult_types);
