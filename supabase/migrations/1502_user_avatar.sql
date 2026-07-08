-- 1502_user_avatar.sql — add avatar_url column to users table
-- Stores a base64 data URL for the user's profile photo (resized to 128×128 client-side).

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
