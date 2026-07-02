-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260518210418 : reorder_waitlist_function
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
CREATE OR REPLACE FUNCTION reorder_waitlist(p_slot_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE bookings b
  SET waitlist_position = sub.new_position
  FROM (
    SELECT id,
      ROW_NUMBER() OVER (ORDER BY booked_at ASC) AS new_position
    FROM bookings
    WHERE slot_id = p_slot_id
      AND status = 'waitlisted'
  ) sub
  WHERE b.id = sub.id
    AND b.waitlist_position IS DISTINCT FROM sub.new_position;
END;
$$;
