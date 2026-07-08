-- GYM-70b : symétrie débit/remboursement crédit.
-- 1) Traçage de la ligne crédit débitée sur la réservation (bookings.debited_credit_id).
-- 2) RPC partagé debit_credit_fifo : sélection FIFO unique, écrit debited_credit_id.
-- 3) create_booking_atomic factorise son débit via ce RPC.
-- booked_at reste immuable (trigger inchangé) ; remboursement exact via la ligne tracée.

-- 1) Colonne de traçage. ON DELETE SET NULL : si la ligne crédit disparaît, on ne bloque rien.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS debited_credit_id uuid
  REFERENCES public.member_credits(id) ON DELETE SET NULL;

-- 2) Débit FIFO partagé (create-booking + confirm-waitlist).
--    Sélection FIFO sous verrou, débit +1, traçage sur la réservation. NO_CREDIT annule tout.
CREATE OR REPLACE FUNCTION public.debit_credit_fifo(
  p_member_id uuid,
  p_gym_id uuid,
  p_booking_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_credit_id uuid;
BEGIN
  SELECT id INTO v_credit_id
  FROM member_credits
  WHERE member_id = p_member_id
    AND gym_id = p_gym_id
    AND (credits_total - credits_used) > 0
  ORDER BY expires_at ASC NULLS LAST, created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_credit_id IS NULL THEN
    RAISE EXCEPTION 'NO_CREDIT';
  END IF;

  UPDATE member_credits
  SET credits_used = credits_used + 1,
      updated_at = now()
  WHERE id = v_credit_id;

  UPDATE bookings
  SET debited_credit_id = v_credit_id
  WHERE id = p_booking_id;

  RETURN v_credit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.debit_credit_fifo(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_credit_fifo(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.debit_credit_fifo(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.debit_credit_fifo(uuid, uuid, uuid) TO service_role;

-- 3) create_booking_atomic : le bloc de débit inline devient un appel au RPC partagé
--    (même transaction ; le RAISE 'NO_CREDIT' continue d'annuler l'insert/réactivation).
CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_member_id uuid,
  p_slot_id uuid,
  p_gym_id uuid,
  p_has_subscription boolean,
  p_existing_booking_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_capacity        integer;
  v_confirmed       integer;
  v_booking_id      uuid;
  v_credit_id       uuid;
  v_idempotency_key text;
BEGIN
  SELECT capacity INTO v_capacity
  FROM time_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND';
  END IF;

  SELECT count(*) INTO v_confirmed
  FROM bookings
  WHERE slot_id = p_slot_id
    AND status = 'confirmed';

  IF v_confirmed >= v_capacity THEN
    RETURN jsonb_build_object('status', 'full');
  END IF;

  v_idempotency_key := p_member_id::text || '-' || p_slot_id::text;

  IF p_existing_booking_id IS NOT NULL THEN
    UPDATE bookings
    SET status         = 'confirmed',
        cancelled_at   = NULL,
        cancel_reason  = NULL,
        is_late_cancel = false,
        waitlist_position = NULL
    WHERE id = p_existing_booking_id
    RETURNING id INTO v_booking_id;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;
  ELSE
    INSERT INTO bookings (member_id, slot_id, gym_id, status, idempotency_key)
    VALUES (p_member_id, p_slot_id, p_gym_id, 'confirmed', v_idempotency_key)
    RETURNING id INTO v_booking_id;
  END IF;

  -- Débit FIFO partagé (trace debited_credit_id). NO_CREDIT annule toute la transaction.
  IF NOT p_has_subscription THEN
    v_credit_id := public.debit_credit_fifo(p_member_id, p_gym_id, v_booking_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'confirmed',
    'booking_id', v_booking_id,
    'credit_debited', (NOT p_has_subscription),
    'credit_id', v_credit_id
  );
END;
$$;
