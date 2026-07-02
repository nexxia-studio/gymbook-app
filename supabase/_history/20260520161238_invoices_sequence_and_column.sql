-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260520161238 : invoices_sequence_and_column
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS invoice_number TEXT UNIQUE;

CREATE SEQUENCE IF NOT EXISTS invoice_seq AS BIGINT START WITH 1 INCREMENT BY 1;

-- Helper that allocates and stamps an invoice number on a paid payment row.
-- Format: INV-YYYY-0001 (4-digit padded, year-scoped via the existing global sequence).
CREATE OR REPLACE FUNCTION allocate_invoice_number(p_payment_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing TEXT;
  next_num BIGINT;
  invoice TEXT;
BEGIN
  SELECT invoice_number INTO existing FROM payments WHERE id = p_payment_id;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  next_num := nextval('invoice_seq');
  invoice := 'INV-' || EXTRACT(YEAR FROM now())::TEXT || '-' || LPAD(next_num::TEXT, 4, '0');

  UPDATE payments SET invoice_number = invoice, updated_at = now()
  WHERE id = p_payment_id AND invoice_number IS NULL;

  RETURN invoice;
END;
$$;
