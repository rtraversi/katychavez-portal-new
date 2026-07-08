-- Migration 1301: Add notify_email to proof_scan_config
ALTER TABLE proof_scan_config ADD COLUMN IF NOT EXISTS notify_email text;
