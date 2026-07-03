-- GYM-70 : réservation atomique (verrou créneau + débit crédit dans UNE transaction).
-- Corrige la course "2 membres sur la dernière place" (capacité vérifiée puis insérée
-- sans verrou dans create-booking) et rend le débit crédit transactionnel (reliquat GYM-69).
-- Intègre la sélection crédit FIFO correcte (GYM-94 : plus de ligne épuisée masquant une dispo).
--
-- NOTE booked_at : le trigger BEFORE UPDATE `booking_immutable_guard` rend booked_at IMMUABLE.
-- La réactivation d'une ligne annulée NE MET DONC PAS à jour booked_at (contrairement à
-- l'edge function actuelle qui le fait et se ferait rejeter — cf. compte-rendu, à remonter).

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
  -- 1. Verrou sur LA ligne du créneau → sérialise ce créneau uniquement.
  SELECT capacity INTO v_capacity
  FROM time_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND';
  END IF;

  -- 2. Recompte des confirmés SOUS verrou.
  SELECT count(*) INTO v_confirmed
  FROM bookings
  WHERE slot_id = p_slot_id
    AND status = 'confirmed';

  -- 3. Plein → aucune écriture, aucun débit. Le caller gère la waitlist (hors verrou).
  IF v_confirmed >= v_capacity THEN
    RETURN jsonb_build_object('status', 'full');
  END IF;

  -- 4. Insertion (ou réactivation d'une ligne annulée — UNIQUE(slot_id, member_id) impose la réutilisation).
  v_idempotency_key := p_member_id::text || '-' || p_slot_id::text;

  IF p_existing_booking_id IS NOT NULL THEN
    -- Réactivation : on ne touche PAS booked_at (immuable) ni idempotency_key (conservée).
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

  -- 5. Débit crédit FIFO si pas d'abonnement — SOUS verrou de la ligne crédit.
  --    Sélection FIFO (GYM-94) : dispo réelle = (credits_total - credits_used) > 0,
  --    ordonné par expiration puis ancienneté. Aucune ligne dispo → NO_CREDIT annule TOUT
  --    (y compris l'insert/réactivation ci-dessus — c'est le but : atomicité).
  IF NOT p_has_subscription THEN
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
  END IF;

  -- 6. Retour.
  RETURN jsonb_build_object(
    'status', 'confirmed',
    'booking_id', v_booking_id,
    'credit_debited', (NOT p_has_subscription),
    'credit_id', v_credit_id
  );
END;
$$;

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role (edge functions).
REVOKE ALL ON FUNCTION public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid) TO service_role;
