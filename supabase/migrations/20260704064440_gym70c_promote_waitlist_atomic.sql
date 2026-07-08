-- GYM-70c : promotion waitlist ATOMIQUE et sous verrou créneau.
-- Capacité (recount sous FOR UPDATE, même verrou que create_booking_atomic) + débit crédit FIFO
-- + confirmation dans UNE seule transaction. NO_CREDIT → rollback total, le booking reste 'waitlisted'.
-- Positions waitlist : la promotion ne recalculait PAS les positions des suivants aujourd'hui
-- (reorder_waitlist n'est appelé que sur l'annulation d'un waitlisted) → comportement PRÉSERVÉ (pas de reorder ici).
-- booked_at : jamais touché (trigger booking_immutable_guard).

CREATE OR REPLACE FUNCTION public.promote_waitlist_atomic(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slot_id    uuid;
  v_member_id  uuid;
  v_gym_id     uuid;
  v_status     text;
  v_capacity   integer;
  v_confirmed  integer;
  v_has_sub    boolean;
  v_credit_id  uuid;
BEGIN
  -- 1. Charger le booking + idempotence.
  SELECT slot_id, member_id, gym_id, status
    INTO v_slot_id, v_member_id, v_gym_id, v_status
  FROM bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'BOOKING_NOT_FOUND');
  END IF;
  IF v_status <> 'waitlisted' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'NOT_WAITLISTED');
  END IF;

  -- 2. Verrou sur LA ligne du créneau (sérialise promotions + réservations du même créneau).
  SELECT capacity INTO v_capacity
  FROM time_slots
  WHERE id = v_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'SLOT_NOT_FOUND');
  END IF;

  -- 3. Recount confirmés SOUS verrou : le siège a pu être pris entre-temps.
  SELECT count(*) INTO v_confirmed
  FROM bookings
  WHERE slot_id = v_slot_id
    AND status = 'confirmed';

  IF v_confirmed >= v_capacity THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'FULL');
  END IF;

  -- 4. Abonnement actif → confirme sans débit. Sinon débit FIFO ; NO_CREDIT → skipped (rollback).
  SELECT EXISTS (
    SELECT 1 FROM member_subscriptions
    WHERE member_id = v_member_id AND gym_id = v_gym_id AND status = 'active'
  ) INTO v_has_sub;

  IF NOT v_has_sub THEN
    BEGIN
      v_credit_id := public.debit_credit_fifo(v_member_id, v_gym_id, p_booking_id);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'NO_CREDIT' THEN
        -- La sous-transaction est annulée ; le booking reste 'waitlisted', aucune écriture ne subsiste.
        RETURN jsonb_build_object('status', 'skipped', 'reason', 'NO_CREDIT');
      ELSE
        RAISE;
      END IF;
    END;
  END IF;

  -- 5. Confirmer. NE PAS toucher booked_at (immuable). Mêmes champs qu'avant la refonte.
  UPDATE bookings
  SET status = 'confirmed',
      waitlist_position = NULL,
      waitlist_notified_at = NULL,
      waitlist_confirmation_deadline = NULL,
      promoted_from_waitlist_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'status', 'promoted',
    'booking_id', p_booking_id,
    'credit_debited', (NOT v_has_sub),
    'credit_id', v_credit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.promote_waitlist_atomic(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_waitlist_atomic(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.promote_waitlist_atomic(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.promote_waitlist_atomic(uuid) TO service_role;
