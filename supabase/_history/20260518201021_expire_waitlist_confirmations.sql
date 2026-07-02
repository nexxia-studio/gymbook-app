-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260518201021 : expire_waitlist_confirmations
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
CREATE OR REPLACE FUNCTION expire_waitlist_confirmations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  expired RECORD;
  next_id UUID;
  delay_minutes INTEGER;
BEGIN
  FOR expired IN
    SELECT id, slot_id, gym_id
    FROM bookings
    WHERE status = 'waitlisted'
      AND waitlist_notified_at IS NOT NULL
      AND waitlist_confirmation_deadline IS NOT NULL
      AND waitlist_confirmation_deadline < now()
    ORDER BY waitlist_confirmation_deadline ASC
  LOOP
    UPDATE bookings
    SET status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = 'waitlist_expired'
    WHERE id = expired.id
      AND status = 'waitlisted';

    SELECT COALESCE(waitlist_confirmation_minutes, 30) INTO delay_minutes
    FROM nexxia_gyms
    WHERE id = expired.gym_id;

    SELECT id INTO next_id
    FROM bookings
    WHERE slot_id = expired.slot_id
      AND status = 'waitlisted'
      AND waitlist_notified_at IS NULL
    ORDER BY waitlist_position ASC NULLS LAST, booked_at ASC
    LIMIT 1;

    IF next_id IS NOT NULL THEN
      UPDATE bookings
      SET waitlist_notified_at = now(),
          waitlist_confirmation_deadline = now() + (delay_minutes * INTERVAL '1 minute')
      WHERE id = next_id;
    END IF;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'expire-waitlist-confirmations',
  '* * * * *',
  $$SELECT expire_waitlist_confirmations()$$
);
