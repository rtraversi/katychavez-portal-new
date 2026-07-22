-- One-off test fixture (NOT a migration — ad-hoc dev/sandbox seed data only).
-- Creates a test client + matter (case type = daca) + client_immigration row,
-- and backfills firm_settings + an existing attorney's bar_number if missing,
-- so the form-filler generate flow has real data to fill G-28 from.
--
-- Run this once in the sandbox Supabase SQL editor. The final SELECT prints
-- the new matter_id — hand that back for the generate test.

-- ── Firm settings (only fills in if the singleton row is still empty) ───────
UPDATE public.firm_settings
SET firm_name     = COALESCE(firm_name, 'IurisIQ Sandbox Law Firm'),
    address_line1 = COALESCE(address_line1, '123 Main Street'),
    address_line2 = COALESCE(address_line2, 'Suite 400'),
    city          = COALESCE(city, 'Austin'),
    state         = COALESCE(state, 'TX'),
    zip           = COALESCE(zip, '78701'),
    phone         = COALESCE(phone, '5125551234'),
    email         = COALESCE(email, 'info@sandboxfirm.test');

-- ── Attorney bar number (backfill on an existing Owner/Attorney if missing) ──
WITH candidate AS (
  SELECT u.id
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE r.name IN ('Owner', 'Attorney', 'Partner Attorney') AND u.active
  ORDER BY (r.name = 'Attorney') DESC, u.created_at ASC
  LIMIT 1
)
UPDATE public.users
SET bar_number = COALESCE(bar_number, '24012345')
WHERE id IN (SELECT id FROM candidate);

-- ── Test client + matter + immigration record ────────────────────────────────
WITH attorney AS (
  SELECT u.id
  FROM public.users u
  JOIN public.roles r ON r.id = u.role_id
  WHERE r.name IN ('Owner', 'Attorney', 'Partner Attorney') AND u.active
  ORDER BY (r.name = 'Attorney') DESC, u.created_at ASC
  LIMIT 1
),
daca_type AS (
  SELECT id FROM public.case_types WHERE key = 'daca' LIMIT 1
),
new_client AS (
  INSERT INTO public.clients (first_name, last_name, middle_name, dob, email, cell_phone,
    address_line1, address_line2, city, state, zip, active)
  VALUES ('Maria', 'Test-Gonzalez', 'Elena', '2000-05-14', 'maria.test@example.com', '5125559876',
    '456 Oak Avenue', 'Apt 2B', 'Austin', 'TX', '78702', true)
  RETURNING id
),
new_matter AS (
  -- case_type (legacy text column) must be set alongside case_type_id: the
  -- trg_activity_matter_opened trigger builds its activity_log title from
  -- NEW.case_type, not case_type_id, and activity_log.title is NOT NULL.
  INSERT INTO public.matters (client_id, case_type_id, case_type, assigned_attorney_id, status)
  SELECT new_client.id, daca_type.id, 'daca', attorney.id, 'active'
  FROM new_client, daca_type, attorney
  RETURNING id, client_id
)
INSERT INTO public.client_immigration (matter_id, a_number, country_of_birth, country_of_citizenship,
  languages, immigration_status, port_of_entry, last_entry_date)
SELECT new_matter.id, 'A123456789', 'Mexico', 'Mexico', 'Spanish, English', 'DACA Recipient',
  'Laredo, TX', '2010-08-01'
FROM new_matter;

-- ── Print the new matter_id ───────────────────────────────────────────────────
SELECT m.id AS matter_id, c.first_name, c.last_name, ct.key AS case_type
FROM public.matters m
JOIN public.clients c ON c.id = m.client_id
JOIN public.case_types ct ON ct.id = m.case_type_id
WHERE ct.key = 'daca'
ORDER BY m.id DESC
LIMIT 1;
