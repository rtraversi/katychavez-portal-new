-- Add 'service' (Respondent Served) to key_date_type for pre-trial deadline calculations.
-- The Answer deadline (TRCP 99b) runs from the service date, not the trial date.
ALTER TYPE public.key_date_type ADD VALUE IF NOT EXISTS 'service';
