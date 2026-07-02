-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521154520 : gym33_process_no_shows
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- ============================================================
-- GYM-33 — No-show automatique
-- Détecte les absences 30 min après la fin d'un cours
-- Applique les pénalités selon les règles de Nico :
--   1er no-show  → avertissement
--   2ème no-show → suspension 48h
--   3ème+ no-show → suspension 2 semaines (336h)
-- Notifications email + push : à brancher via Edge Function (GYM-33 phase 2)
-- ============================================================

CREATE OR REPLACE FUNCTION process_no_shows()
RETURNS TABLE(
  processed_booking_id  uuid,
  member_id             uuid,
  gym_id                uuid,
  new_noshow_count      integer,
  penalty_applied       text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking       RECORD;
  v_new_count     integer;
  v_suspended_until timestamptz;
  v_penalty_type  text;
  v_notes         text;
BEGIN
  -- Trouver toutes les réservations confirmées non pointées
  -- dont le cours s'est terminé depuis plus de 30 minutes
  FOR v_booking IN
    SELECT
      b.id           AS booking_id,
      b.member_id,
      b.gym_id,
      b.slot_id,
      s.ends_at
    FROM bookings b
    JOIN time_slots s ON s.id = b.slot_id
    WHERE b.status        = 'confirmed'
      AND b.checked_in_at IS NULL
      AND s.ends_at       < NOW() - INTERVAL '30 minutes'
      AND s.ends_at       > NOW() - INTERVAL '24 hours' -- sécurité : max 24h en arrière
  LOOP

    -- 1. Marquer la réservation comme no_show
    UPDATE bookings
    SET
      status     = 'no_show',
      updated_at = NOW()
    WHERE id = v_booking.booking_id;

    -- 2. Incrémenter le compteur no-show du membre
    UPDATE profiles
    SET
      noshow_count = COALESCE(noshow_count, 0) + 1,
      updated_at   = NOW()
    WHERE id = v_booking.member_id
    RETURNING noshow_count INTO v_new_count;

    -- 3. Appliquer la pénalité selon le compteur
    v_suspended_until := NULL;
    v_penalty_type    := 'warning';
    v_notes           := '';

    IF v_new_count = 1 THEN
      -- 1er no-show : avertissement simple
      v_penalty_type := 'warning';
      v_notes        := '1er no-show — avertissement. Au 2ème : suspension 48h.';

    ELSIF v_new_count = 2 THEN
      -- 2ème no-show : suspension 48h
      v_suspended_until := NOW() + INTERVAL '48 hours';
      v_penalty_type    := 'suspension';
      v_notes           := '2ème no-show — suspension 48h.';

      UPDATE profiles
      SET suspended_until = v_suspended_until
      WHERE id = v_booking.member_id;

    ELSE
      -- 3ème no-show et plus : suspension 2 semaines
      v_suspended_until := NOW() + INTERVAL '336 hours';
      v_penalty_type    := 'suspension';
      v_notes           := v_new_count || 'ème no-show — suspension 2 semaines.';

      UPDATE profiles
      SET suspended_until = v_suspended_until
      WHERE id = v_booking.member_id;

    END IF;

    -- 4. Enregistrer la pénalité
    INSERT INTO penalties (
      gym_id,
      member_id,
      booking_id,
      type,
      applied_at,
      expires_at,
      notes
    ) VALUES (
      v_booking.gym_id,
      v_booking.member_id,
      v_booking.booking_id,
      v_penalty_type,
      NOW(),
      v_suspended_until,
      v_notes
    );

    -- 5. Retourner le résultat pour les logs
    processed_booking_id := v_booking.booking_id;
    member_id            := v_booking.member_id;
    gym_id               := v_booking.gym_id;
    new_noshow_count     := v_new_count;
    penalty_applied      := v_penalty_type;
    RETURN NEXT;

  END LOOP;
END;
$$;

COMMENT ON FUNCTION process_no_shows() IS
  'GYM-33 — Détecte les no-shows 30 min après fin de cours et applique les pénalités.
   Règles Nico : 1er=avertissement / 2ème=48h / 3ème+=2 semaines.
   Appelée par pg_cron toutes les 30 minutes.
   Phase 2 (Claude Code) : brancher les notifications email + push.';

-- ============================================================
-- pg_cron : job toutes les 30 minutes
-- ============================================================

SELECT cron.schedule(
  'process-no-shows',          -- nom du job
  '*/30 * * * *',              -- toutes les 30 minutes
  'SELECT process_no_shows()'
);

