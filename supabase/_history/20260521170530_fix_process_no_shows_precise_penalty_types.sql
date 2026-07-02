-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521170530 : fix_process_no_shows_precise_penalty_types
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- Point 2 : retourner 'warning' | 'suspension_48h' | 'suspension_2w'
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
  v_booking         RECORD;
  v_new_count       integer;
  v_suspended_until timestamptz;
  v_penalty_type    text;
  v_notes           text;
BEGIN
  FOR v_booking IN
    SELECT b.id AS booking_id, b.member_id, b.gym_id, b.slot_id, s.ends_at
    FROM bookings b
    JOIN time_slots s ON s.id = b.slot_id
    WHERE b.status        = 'confirmed'
      AND b.checked_in_at IS NULL
      AND s.ends_at       < NOW() - INTERVAL '30 minutes'
      AND s.ends_at       > NOW() - INTERVAL '24 hours'
  LOOP
    UPDATE bookings SET status = 'no_show', updated_at = NOW()
    WHERE id = v_booking.booking_id;

    UPDATE profiles SET noshow_count = COALESCE(noshow_count, 0) + 1, updated_at = NOW()
    WHERE id = v_booking.member_id
    RETURNING noshow_count INTO v_new_count;

    v_suspended_until := NULL;

    IF v_new_count = 1 THEN
      v_penalty_type := 'warning';
      v_notes        := '1er no-show — avertissement. Au 2ème : suspension 48h.';
    ELSIF v_new_count = 2 THEN
      v_suspended_until := NOW() + INTERVAL '48 hours';
      v_penalty_type    := 'suspension_48h';
      v_notes           := '2ème no-show — suspension 48h.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;
    ELSE
      v_suspended_until := NOW() + INTERVAL '336 hours';
      v_penalty_type    := 'suspension_2w';
      v_notes           := v_new_count || 'ème no-show — suspension 2 semaines.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;
    END IF;

    INSERT INTO penalties (gym_id, member_id, booking_id, type, applied_at, expires_at, notes)
    VALUES (v_booking.gym_id, v_booking.member_id, v_booking.booking_id,
            v_penalty_type, NOW(), v_suspended_until, v_notes);

    processed_booking_id := v_booking.booking_id;
    member_id            := v_booking.member_id;
    gym_id               := v_booking.gym_id;
    new_noshow_count     := v_new_count;
    penalty_applied      := v_penalty_type;
    RETURN NEXT;
  END LOOP;
END;
$$;

