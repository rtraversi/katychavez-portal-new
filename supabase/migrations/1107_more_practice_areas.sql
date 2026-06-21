-- Migration 1107: Add Personal Injury and Criminal practice areas

INSERT INTO public.practice_areas (key, name, description, sort_order) VALUES
  ('personal_injury', 'Personal Injury', 'Auto accidents, slip & fall, medical malpractice, wrongful death, and related tort matters', 30),
  ('criminal',        'Criminal',        'DWI/DUI, drug offenses, assault, theft, domestic violence, expunctions, and related criminal defense matters', 40)
ON CONFLICT (key) DO NOTHING;

-- ── Seed: Personal Injury ────────────────────────────────────────────────────

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('auto_accident',        'Auto Accident',              10),
  ('truck_accident',       'Truck Accident',             20),
  ('motorcycle_accident',  'Motorcycle Accident',        30),
  ('slip_and_fall',        'Slip & Fall',                40),
  ('premises_liability',   'Premises Liability',         50),
  ('medical_malpractice',  'Medical Malpractice',        60),
  ('product_liability',    'Product Liability',          70),
  ('wrongful_death',       'Wrongful Death',             80),
  ('workplace_injury',     'Workplace Injury',           90),
  ('dog_bite',             'Dog Bite / Animal Attack',  100),
  ('other',                'Other',                     999)
) AS ct(key, name, sort_order)
WHERE pa.key = 'personal_injury'
ON CONFLICT (practice_area_id, key) DO NOTHING;

-- ── Seed: Criminal ───────────────────────────────────────────────────────────

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('dwi_dui',              'DWI / DUI',                  10),
  ('drug_offense',         'Drug Offense',               20),
  ('assault_battery',      'Assault / Battery',          30),
  ('domestic_violence',    'Domestic Violence',          40),
  ('theft_robbery',        'Theft / Robbery',            50),
  ('sexual_assault',       'Sexual Assault',             60),
  ('murder_homicide',      'Murder / Homicide',          70),
  ('white_collar',         'White Collar Crime',         80),
  ('juvenile',             'Juvenile',                   90),
  ('probation_violation',  'Probation Violation',       100),
  ('expunction',           'Expunction / Non-Disclosure',110),
  ('other',                'Other',                     999)
) AS ct(key, name, sort_order)
WHERE pa.key = 'criminal'
ON CONFLICT (practice_area_id, key) DO NOTHING;

-- ── Extension table: Personal Injury ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_personal_injury (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  incident_date        date,
  incident_location    text,
  incident_description text,
  at_fault_party       text,
  insurance_carrier    text,
  claim_number         text,
  policy_limits        numeric(12,2),
  treating_physician   text,
  medical_provider     text,
  sol_date             date,
  demand_amount        numeric(12,2),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_personal_injury ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_personal_injury_select" ON public.client_personal_injury
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "client_personal_injury_insert" ON public.client_personal_injury
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "client_personal_injury_update" ON public.client_personal_injury
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "client_personal_injury_delete" ON public.client_personal_injury
  FOR DELETE TO authenticated USING (true);

-- ── Extension table: Criminal ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.client_criminal (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id         uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  arrest_date       date,
  offense_date      date,
  cause_number      text,
  charges           text,
  arresting_agency  text,
  bond_amount       numeric(12,2),
  bond_type         text,  -- personal_recognizance | cash | surety | no_bond
  prosecutor        text,
  next_hearing_type text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_criminal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_criminal_select" ON public.client_criminal
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "client_criminal_insert" ON public.client_criminal
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "client_criminal_update" ON public.client_criminal
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "client_criminal_delete" ON public.client_criminal
  FOR DELETE TO authenticated USING (true);
