-- GYM-143 : annulation d'un cours par le gérant.
-- Un coach est malade → le gérant annule le créneau depuis /planning. Conséquences
-- atomiques : le créneau passe 'cancelled', chaque réservation active est annulée,
-- chaque membre débité en crédit est RECRÉDITÉ EXACTEMENT (la ligne member_credits
-- réellement débitée, tracée par bookings.debited_credit_id — symétrie stricte avec
-- debit_credit_fifo), la liste d'attente est purgée, et la liste des inscrits est
-- renvoyée pour les notifications (push + email) émises par l'Edge Function cancel-slot.
--
-- NE PAS appliquer manuellement : passage par le cockpit (staging → GO → prod).
--
-- Constats schéma (Règle Zéro) :
--   - time_slots possède DÉJÀ status ('scheduled'|'cancelled'|'completed', CHECK) et
--     cancellation_reason → status='cancelled' est le marqueur canonique. On ajoute
--     seulement cancelled_at (horodatage explicite de l'annulation).
--   - Il n'existe PAS de table waitlist_entries : la liste d'attente = bookings dont
--     status='waitlisted'. La purge = passage de ces bookings à 'cancelled'.
--   - Recrédit = credits_used - 1 sur la ligne debited_credit_id (inverse exact du
--     débit +1 de debit_credit_fifo). Pas de FIFO inverse, pas de nouvelle ligne.
--   - booked_at est immuable (trigger booking_immutable_guard) → jamais touché ici.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) Horodatage d'annulation (le marqueur d'état reste time_slots.status).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.time_slots
  ADD COLUMN IF NOT EXISTS cancelled_at timestamp with time zone;

-- ─────────────────────────────────────────────────────────────────────────────
-- b) RPC atomique d'annulation de créneau.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_slot_atomic(
  p_slot_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_slot                time_slots%ROWTYPE;
  v_booking             record;
  v_bookings_cancelled  integer := 0;
  v_waitlist_cleared    integer := 0;
  v_credits_refunded    integer := 0;
  v_affected            jsonb   := '[]'::jsonb;
BEGIN
  -- 1. Verrou sur LA ligne du créneau → sérialise annulation / réservations / promotions.
  SELECT * INTO v_slot
  FROM time_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND';
  END IF;

  -- Idempotence : le gérant peut double-cliquer. Aucune erreur, aucun double-recrédit.
  IF v_slot.status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'already_cancelled');
  END IF;

  -- 2. Marquer le créneau annulé (marqueur canonique status + horodatage + motif).
  UPDATE time_slots
  SET status              = 'cancelled',
      cancelled_at        = now(),
      cancellation_reason = p_reason,
      updated_at          = now()
  WHERE id = p_slot_id;

  -- 3. Annuler chaque réservation active (confirmée + liste d'attente) SOUS verrou,
  --    recréditer exactement les débits, collecter les inscrits pour les notifications.
  FOR v_booking IN
    SELECT b.id, b.member_id, b.status, b.debited_credit_id,
           p.email, p.first_name, p.push_token
    FROM bookings b
    JOIN profiles p ON p.id = b.member_id
    WHERE b.slot_id = p_slot_id
      AND b.status IN ('confirmed', 'waitlisted')
    FOR UPDATE OF b
  LOOP
    -- Symétrie transactionnelle : recréditer EXACTEMENT la ligne débitée (used - 1).
    -- Abonnement (debited_credit_id NULL) → rien à recréditer.
    IF v_booking.debited_credit_id IS NOT NULL THEN
      UPDATE member_credits
      SET credits_used = GREATEST(credits_used - 1, 0),
          updated_at   = now()
      WHERE id = v_booking.debited_credit_id;
      v_credits_refunded := v_credits_refunded + 1;
    END IF;

    -- Annuler la réservation. NE PAS toucher booked_at (immuable).
    UPDATE bookings
    SET status            = 'cancelled',
        cancelled_at      = now(),
        cancel_reason     = COALESCE(p_reason, 'slot_cancelled'),
        waitlist_position = NULL
    WHERE id = v_booking.id;

    IF v_booking.status = 'confirmed' THEN
      v_bookings_cancelled := v_bookings_cancelled + 1;
      -- Seuls les inscrits (confirmés) sont notifiés du cours annulé.
      v_affected := v_affected || jsonb_build_object(
        'user_id',         v_booking.member_id,
        'email',           v_booking.email,
        'first_name',      v_booking.first_name,
        'push_token',      v_booking.push_token,
        'credit_refunded', (v_booking.debited_credit_id IS NOT NULL)
      );
    ELSE
      -- Liste d'attente purgée (pas de siège, pas de crédit débité → rien à rendre).
      v_waitlist_cleared := v_waitlist_cleared + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status',             'cancelled',
    'bookings_cancelled', v_bookings_cancelled,
    'credits_refunded',   v_credits_refunded,
    'waitlist_cleared',   v_waitlist_cleared,
    'affected_members',   v_affected
  );
END;
$$;

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role (edge function).
REVOKE ALL ON FUNCTION public.cancel_slot_atomic(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_slot_atomic(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_slot_atomic(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_slot_atomic(uuid, text) TO service_role;
