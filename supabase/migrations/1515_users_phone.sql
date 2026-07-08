-- Migration 1515: users.phone
--
-- Ported from wilsonlakesavage's 1204_users_bar_phone.sql — that migration
-- added both phone and bar_number, but this repo already has bar_number via
-- its own 1512_users_bar_number.sql. Only phone was actually missing.
-- Lets attorney signature blocks on form templates auto-populate a phone
-- number without manual entry.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
