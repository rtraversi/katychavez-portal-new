-- Migration 1226: Retainer Requests (trust-routed client pre-payment)
--
-- Lets staff email a client a Payload payment link that deposits DIRECTLY into the
-- IOLTA trust account (accountType:'trust'), with NO invoice — i.e. a client funding
-- their retainer before any work is billed. On payment, a trust ledger DEPOSIT is
-- posted for the matter for the GROSS amount.
--
-- Fee handling is entirely Payload-side: the Trust processing account receives the
-- full amount; Payload debits its convenience fee from the firm's separate Operating
-- (billing) account. The portal never nets or splits fees — we record the gross.
-- (Confirmed by Payload support, Jul 2026 — dual-account structure.)
--
-- Depends on: 1200_trust_accounting (trust_accounts, trust_ledger_entries), matters, users.
-- Applied: dev ☐  prod ☐

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.retainer_requests (
  id                     uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now(),

  matter_id              uuid          NOT NULL REFERENCES public.matters(id) ON DELETE RESTRICT,
  amount                 numeric(10,2) NOT NULL CHECK (amount > 0),
  description            text          NOT NULL DEFAULT 'Retainer',

  status                 text          NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'paid', 'cancelled', 'expired')),

  -- Payment link (Payload). payment_reference is the Payload payment_link id — the
  -- webhook keys the incoming 'processed' event back to this row on this column.
  payment_link           text,
  payment_reference      text,
  payment_adapter        text,

  -- Snapshot of who the link was sent to (client may change later)
  client_email           text,
  client_name            text,

  requested_by           uuid          NOT NULL REFERENCES public.users(id),

  -- Set when the webhook posts payment
  paid_at                timestamptz,
  transaction_ref        text,
  trust_ledger_entry_id  uuid          REFERENCES public.trust_ledger_entries(id)
);

CREATE INDEX idx_retainer_requests_matter    ON public.retainer_requests (matter_id, created_at DESC);
CREATE INDEX idx_retainer_requests_status    ON public.retainer_requests (status);
CREATE INDEX idx_retainer_requests_reference ON public.retainer_requests (payment_reference)
  WHERE payment_reference IS NOT NULL;

CREATE TRIGGER retainer_requests_updated_at
  BEFORE UPDATE ON public.retainer_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: process_retainer_payment
-- Atomic mirror of process_invoice_payment (1505). Marks the retainer paid AND
-- inserts the trust ledger deposit in one transaction. FOR UPDATE + status guard
-- make it idempotent against duplicate webhook deliveries.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_retainer_payment(
  p_retainer_id     uuid,
  p_transaction_ref text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_matter_id    uuid;
  v_amount       numeric(10,2);
  v_requested_by uuid;
  v_client_name  text;
  v_trust_id     uuid;
  v_entry_id     uuid;
BEGIN
  -- Lock the retainer row; only act if still awaiting payment.
  SELECT matter_id, amount, requested_by, client_name
  INTO   v_matter_id, v_amount, v_requested_by, v_client_name
  FROM   public.retainer_requests
  WHERE  id = p_retainer_id
    AND  status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_processed_or_not_found');
  END IF;

  -- Resolve the active trust account (one firm, one IOLTA account).
  SELECT id INTO v_trust_id
  FROM   public.trust_accounts
  WHERE  is_active = true
  LIMIT  1;

  IF v_trust_id IS NULL THEN
    -- No trust account configured — cannot post a deposit. Leave the retainer
    -- pending and surface the problem so the webhook returns non-2xx and retries.
    RAISE EXCEPTION 'No active trust account configured — cannot post retainer deposit for %', p_retainer_id;
  END IF;

  -- Best-effort payor name for the ledger (fall back to the matter's client).
  IF v_client_name IS NULL THEN
    SELECT c.first_name || ' ' || c.last_name
    INTO   v_client_name
    FROM   public.matters m
    JOIN   public.clients c ON c.id = m.client_id
    WHERE  m.id = v_matter_id;
  END IF;

  -- Post the GROSS deposit to the trust ledger (balance_after set by trigger).
  INSERT INTO public.trust_ledger_entries (
    trust_account_id,
    matter_id,
    entry_type,
    amount,
    description,
    payor_payee,
    created_by
  ) VALUES (
    v_trust_id,
    v_matter_id,
    'deposit',
    v_amount,
    'Retainer payment received via Payload (trust)',
    v_client_name,
    v_requested_by
  )
  RETURNING id INTO v_entry_id;

  -- Mark the retainer paid and link it to the ledger entry.
  UPDATE public.retainer_requests
  SET    status                = 'paid',
         paid_at               = now(),
         transaction_ref       = p_transaction_ref,
         trust_ledger_entry_id = v_entry_id
  WHERE  id = p_retainer_id;

  RETURN jsonb_build_object('ok', true, 'ledger_entry_id', v_entry_id);
END;
$$;

REVOKE ALL ON FUNCTION public.process_retainer_payment(uuid, text) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY  (gated on the trust_accounting module, like the ledger)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.retainer_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "retainer_requests_select"
  ON public.retainer_requests FOR SELECT
  USING (public.can_read('trust_accounting'));

CREATE POLICY "retainer_requests_insert"
  ON public.retainer_requests FOR INSERT
  WITH CHECK (public.can_write('trust_accounting'));

-- Staff may cancel a still-pending request; the webhook (service role) bypasses RLS.
CREATE POLICY "retainer_requests_update"
  ON public.retainer_requests FOR UPDATE
  USING (public.can_write('trust_accounting'));

CREATE POLICY "retainer_requests_no_delete"
  ON public.retainer_requests FOR DELETE
  USING (false);
