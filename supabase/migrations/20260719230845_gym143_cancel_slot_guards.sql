-- GYM-143 : garde "slot annulé" sur la promotion de liste d'attente (défense en profondeur).
--
-- Constat symétrie (Règle Zéro, section 4) :
--   1. create-booking : l'Edge Function REFUSE déjà un slot status='cancelled'
--      (create-booking/index.ts : "if (slot.status === 'cancelled') → SLOT_CANCELLED").
--      → aucun garde à ajouter.
--   3. send-reminders : get_pending_reminders() ne sélectionne que les bookings
--      status='confirmed' ; cancel_slot_atomic passe tous les bookings du créneau à
--      'cancelled' → ils sortent d'office des rappels. → aucun garde à ajouter.
--   4. update_slot_bookings_count : simple recompte par ligne (RETURN NULL, aucune
--      promotion/notification) → tolère la vague d'UPDATE de l'annulation. → RAS.
--   2. promote_waitlist_atomic : aujourd'hui une promotion sur un slot annulé est déjà
--      impossible EN PRATIQUE (l'annulation passe les waitlisted à 'cancelled', et la RPC
--      refuse un statut <> 'waitlisted'). On ajoute néanmoins un garde EXPLICITE et
--      race-safe (sous le verrou créneau déjà pris) pour blinder tout futur appelant
--      (ex. notify_next_in_waitlist) contre une promotion sur un créneau annulé.
--
-- CREATE OR REPLACE idempotent — NE PAS appliquer manuellement (cockpit staging → GO → prod).

CREATE OR REPLACE FUNCTION public.promote_waitlist_atomic(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slot_id      uuid;
  v_member_id    uuid;
  v_gym_id       uuid;
  v_status       text;
  v_slot_status  text;
  v_capacity     integer;
  v_confirmed    integer;
  v_has_sub      boolean;
  v_credit_id    uuid;
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

  -- 2. Verrou sur LA ligne du créneau (sérialise promotions + réservations + annulation).
  SELECT capacity, status INTO v_capacity, v_slot_status
  FROM time_slots
  WHERE id = v_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'SLOT_NOT_FOUND');
  END IF;

  -- GYM-143 — garde explicite : jamais de promotion sur un créneau annulé.
  IF v_slot_status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'SLOT_CANCELLED');
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
        RETURN jsonb_build_object('status', 'skipped', 'reason', 'NO_CREDIT');
      ELSE
        RAISE;
      END IF;
    END;
  END IF;

  -- 5. Confirmer. NE PAS toucher booked_at (immuable).
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
