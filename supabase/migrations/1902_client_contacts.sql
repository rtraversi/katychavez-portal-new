-- Migration 1902: Client contacts ("Other People")
--
-- Additional people attached to a CLIENT (not a matter) — a guarantor, a parent,
-- or anyone else who might pay on the client's behalf. A retainer or payment
-- request can then be sent to the client OR to one of these people (e.g. a parent
-- paying a child's retainer). Simple contact record: name, phone, email, relationship.
-- Applied: dev ☐  prod ☐

CREATE TABLE IF NOT EXISTS public.client_contacts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  first_name   text        NOT NULL,
  last_name    text,
  phone        text,
  email        text,
  relationship text,
  created_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_client ON public.client_contacts (client_id);

CREATE TRIGGER set_client_contacts_updated_at
  BEFORE UPDATE ON public.client_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_contacts_read"
  ON public.client_contacts FOR SELECT USING (public.can_read('clients'));

CREATE POLICY "client_contacts_write"
  ON public.client_contacts FOR ALL USING (public.can_write('clients'));
