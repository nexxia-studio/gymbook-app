-- GYM-174 : pointage des présences par le gérant (inversion de la logique no-show).
--
-- DÉCISION CENTRALE : NON POINTÉ = PRÉSENT. Le no-show n'est plus déduit automatiquement
-- par le cron ; il devient un acte EXPLICITE du gérant depuis /planning, avec pénalités
-- appliquées à CE moment-là. Nouveau statut 'excused' : absent SANS perte de crédit
-- (jugement du gérant, sans limite).
--
-- NE PAS appliquer manuellement : passage par le cockpit (staging → GO → prod).
--
-- ─── Constats schéma (Règle Zéro, vérifiés sur la base live prod) ───────────────
--   - bookings_status_check réel = ('confirmed','cancelled','no_show','attended','waitlisted').
--     On ajoute 'excused' (recréation DROP + ADD, liste complète).
--   - Débit/recrédit : symétrie stricte avec debit_credit_fifo / cancel_slot_atomic.
--     Recrédit = credits_used - 1 (GREATEST 0) sur LA ligne bookings.debited_credit_id ;
--     re-débit = credits_used + 1 (clamp credits_total) sur la même ligne. Jamais de FIFO
--     ici : on inverse exactement le débit tracé, comme cancel_slot_atomic.
--   - Escalade de pénalité REPRISE À L'IDENTIQUE de process_no_shows (baseline GYM-33/59) :
--     1er no-show = warning / 2e = suspension 48h / 3e+ = suspension 336h (2 semaines),
--     UPDATE profiles.noshow_count + suspended_until, INSERT penalties(booking_id).
--   - Trigger protect_booking_immutable_columns ne protège que
--     slot_id/gym_id/member_id/booked_at/subscription_id → status/checked_in_at/
--     checked_in_method sont librement modifiables. RAS.
--
--   ⚠️ INCOHÉRENCE PROD DÉCOUVERTE (à remonter au cockpit) :
--     process_no_shows (live prod) INSÈRE type ∈ ('warning','suspension_48h','suspension_2w'),
--     mais penalties_type_check (live prod) n'autorise QUE
--     ('warning_1','warning_2','suspension','reset'). Le tout premier no-show réel aurait
--     échoué (violation de CHECK, rollback de la transaction) — jamais déclenché car la
--     table penalties est VIDE à ce jour. Le fichier _history
--     20260521170530_fix_process_no_shows_precise_penalty_types documente l'intention
--     « retourner 'warning' | 'suspension_48h' | 'suspension_2w' » : c'est donc le CHECK
--     qui est resté périmé, pas la fonction. On étend le CHECK en SUR-ENSEMBLE (legacy 4
--     valeurs conservées + 3 valeurs réellement émises) pour que l'INSERT fonctionne enfin.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) bookings.status : ajout de 'excused' (recréation à l'identique + excused).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_status_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_status_check CHECK (status = ANY (ARRAY[
    'confirmed'::text,
    'cancelled'::text,
    'no_show'::text,
    'attended'::text,
    'waitlisted'::text,
    'excused'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- b) penalties.type : réconciliation du CHECK périmé (cf. encadré ci-dessus).
--    Sur-ensemble = legacy ('warning_1','warning_2','suspension','reset') + valeurs
--    réellement émises par le code ('warning','suspension_48h','suspension_2w').
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.penalties
  DROP CONSTRAINT IF EXISTS penalties_type_check;

ALTER TABLE public.penalties
  ADD CONSTRAINT penalties_type_check CHECK (type = ANY (ARRAY[
    'warning_1'::text,
    'warning_2'::text,
    'suspension'::text,
    'reset'::text,
    'warning'::text,
    'suspension_48h'::text,
    'suspension_2w'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- c) mark_attendance_atomic : pointage atomique d'UNE réservation par le gérant.
--    Cibles : 'attended' | 'no_show' | 'excused'. Gère crédit (symétrie stricte) et
--    pénalités (pose ET retrait symétrique), le tout dans une seule transaction.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_attendance_atomic(
  p_booking_id uuid,
  p_new_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking          record;
  v_prev             text;
  v_credit_movement  text := NULL;
  v_penalty          jsonb := NULL;
  v_new_count        integer;
  v_suspended_until  timestamptz;
  v_penalty_type     text;
  v_notes            text;
  v_deleted_expires  timestamptz;
  v_prev_suspended   timestamptz;
  v_checked_in_at    timestamptz;
  v_checked_method   text;
BEGIN
  -- 0. Cible valide ?
  IF p_new_status NOT IN ('attended', 'no_show', 'excused') THEN
    RAISE EXCEPTION 'INVALID_STATUS';
  END IF;

  -- 1. Verrou sur LA ligne de réservation.
  SELECT id, member_id, gym_id, status, debited_credit_id
    INTO v_booking
  FROM bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOOKING_NOT_FOUND';
  END IF;

  v_prev := v_booking.status;

  -- 2. Idempotence : cible = statut actuel → aucun mouvement.
  IF v_prev = p_new_status THEN
    RETURN jsonb_build_object(
      'status', 'unchanged',
      'previous_status', v_prev,
      'credit_movement', NULL,
      'penalty', NULL
    );
  END IF;

  -- 3. Source acceptée ? Un booking cancelled/waitlisted n'est pas pointable.
  IF v_prev NOT IN ('confirmed', 'attended', 'no_show', 'excused') THEN
    RAISE EXCEPTION 'INVALID_SOURCE_STATUS';
  END IF;

  -- 4. MOUVEMENTS DE CRÉDIT (uniquement si un crédit a été débité pour ce booking).
  --    Symétrie stricte : excused = pas de perte de crédit.
  IF v_booking.debited_credit_id IS NOT NULL THEN
    IF p_new_status = 'excused' AND v_prev IN ('confirmed', 'attended', 'no_show') THEN
      -- Vers excused → RECRÉDIT exact (inverse du débit).
      UPDATE member_credits
      SET credits_used = GREATEST(credits_used - 1, 0),
          updated_at   = now()
      WHERE id = v_booking.debited_credit_id;
      v_credit_movement := 'refunded';
    ELSIF v_prev = 'excused' AND p_new_status IN ('attended', 'no_show') THEN
      -- Sortie d'excused → RE-DÉBIT (clamp à credits_total).
      UPDATE member_credits
      SET credits_used = LEAST(credits_used + 1, credits_total),
          updated_at   = now()
      WHERE id = v_booking.debited_credit_id;
      v_credit_movement := 'debited';
    END IF;
  END IF;

  -- 5. PÉNALITÉS.
  -- 5a. POSE d'un no_show (depuis tout statut ≠ no_show) : escalade IDENTIQUE à
  --     process_no_shows (GYM-33/59).
  IF p_new_status = 'no_show' THEN
    UPDATE profiles SET noshow_count = COALESCE(noshow_count, 0) + 1, updated_at = now()
    WHERE id = v_booking.member_id
    RETURNING noshow_count INTO v_new_count;

    v_suspended_until := NULL;

    IF v_new_count = 1 THEN
      v_penalty_type := 'warning';
      v_notes        := '1er no-show — avertissement. Au 2ème : suspension 48h.';
    ELSIF v_new_count = 2 THEN
      v_suspended_until := now() + INTERVAL '48 hours';
      v_penalty_type    := 'suspension_48h';
      v_notes           := '2ème no-show — suspension 48h.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;
    ELSE
      v_suspended_until := now() + INTERVAL '336 hours';
      v_penalty_type    := 'suspension_2w';
      v_notes           := v_new_count || 'ème no-show — suspension 2 semaines.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;
    END IF;

    INSERT INTO penalties (gym_id, member_id, booking_id, type, applied_at, expires_at, notes)
    VALUES (v_booking.gym_id, v_booking.member_id, p_booking_id,
            v_penalty_type, now(), v_suspended_until, v_notes);

    v_penalty := jsonb_build_object(
      'action', 'applied',
      'type', v_penalty_type,
      'noshow_count', v_new_count,
      'expires_at', v_suspended_until
    );

  -- 5b. SORTIE d'un no_show (vers attended/excused) : symétrie inverse.
  ELSIF v_prev = 'no_show' AND p_new_status IN ('attended', 'excused') THEN
    UPDATE profiles SET noshow_count = GREATEST(COALESCE(noshow_count, 0) - 1, 0), updated_at = now()
    WHERE id = v_booking.member_id
    RETURNING noshow_count INTO v_new_count;

    -- Suspension en cours du membre, avant retrait de la pénalité.
    SELECT suspended_until INTO v_prev_suspended FROM profiles WHERE id = v_booking.member_id;

    -- Retirer LA pénalité de ce booking (capture son échéance).
    DELETE FROM penalties
    WHERE booking_id = p_booking_id
    RETURNING expires_at INTO v_deleted_expires;

    -- Si la pénalité supprimée portait la suspension en cours → recalcul depuis le reste.
    IF v_deleted_expires IS NOT NULL
       AND v_prev_suspended IS NOT NULL
       AND v_prev_suspended = v_deleted_expires THEN
      UPDATE profiles
      SET suspended_until = (
            SELECT MAX(expires_at)
            FROM penalties
            WHERE member_id = v_booking.member_id
              AND expires_at IS NOT NULL
              AND expires_at > now()
          ),
          updated_at = now()
      WHERE id = v_booking.member_id;
    END IF;

    v_penalty := jsonb_build_object(
      'action', 'reverted',
      'noshow_count', v_new_count,
      'removed_expires_at', v_deleted_expires
    );
  END IF;

  -- 6. checked_in_at / checked_in_method : présence constatée uniquement si attended.
  IF p_new_status = 'attended' THEN
    v_checked_in_at := now();
    v_checked_method := 'manual';
  ELSE
    v_checked_in_at := NULL;
    v_checked_method := NULL;
  END IF;

  UPDATE bookings
  SET status            = p_new_status,
      checked_in_at     = v_checked_in_at,
      checked_in_method = v_checked_method,
      updated_at        = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'status', 'updated',
    'previous_status', v_prev,
    'credit_movement', v_credit_movement,
    'penalty', v_penalty
  );
END;
$$;

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role (edge function).
REVOKE ALL ON FUNCTION public.mark_attendance_atomic(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_attendance_atomic(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.mark_attendance_atomic(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_attendance_atomic(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- d) REFONTE de process_no_shows : INVERSION GYM-174.
--    La fonction ne marque PLUS AUCUN no_show et n'applique PLUS AUCUNE pénalité.
--    Nouveau rôle : finaliser en 'attended' (présence par défaut) les réservations
--    'confirmed' dont le créneau est terminé depuis plus de 24h. checked_in_at reste
--    NULL (présence par défaut, non constatée physiquement). Le no-show est désormais
--    un acte explicite du gérant via mark_attendance_atomic.
--    Nom conservé (le pg_cron l'appelle déjà). Signature de retour simplifiée.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.process_no_shows();

CREATE OR REPLACE FUNCTION public.process_no_shows()
RETURNS TABLE(finalized_booking_id uuid, member_id uuid, gym_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE bookings b
  SET status = 'attended', updated_at = now()
  FROM time_slots s
  WHERE s.id = b.slot_id
    AND b.status = 'confirmed'
    AND s.ends_at < now() - INTERVAL '24 hours'
  RETURNING b.id, b.member_id, b.gym_id;
END;
$$;

COMMENT ON FUNCTION public.process_no_shows() IS
  'GYM-174 — INVERSION : non pointé = présent. Ne marque plus aucun no-show et n''applique
   plus aucune pénalité (c''était la logique GYM-33, désormais déplacée dans
   mark_attendance_atomic, déclenchée explicitement par le gérant). Rôle actuel : finaliser
   en ''attended'' les réservations ''confirmed'' dont le créneau est terminé depuis > 24h
   (checked_in_at laissé NULL = présence par défaut). Nom conservé car appelée par pg_cron.';

-- ACL inchangée (service_role uniquement) — réappliquée après recréation.
REVOKE ALL ON FUNCTION public.process_no_shows() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_no_shows() FROM anon;
REVOKE ALL ON FUNCTION public.process_no_shows() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_no_shows() TO service_role;
