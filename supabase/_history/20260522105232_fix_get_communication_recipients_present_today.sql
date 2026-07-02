-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260522105232 : fix_get_communication_recipients_present_today
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

CREATE OR REPLACE FUNCTION get_communication_recipients(
  p_gym_id  uuid,
  p_segment text DEFAULT 'all'
)
RETURNS TABLE(
  member_id   uuid,
  first_name  text,
  email       text,
  push_token  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    p.id,
    p.first_name,
    p.email,
    p.push_token
  FROM profiles p
  WHERE p.gym_id     = p_gym_id
    AND p.role       = 'member'
    AND p.deleted_at IS NULL
    AND (p.suspended_until IS NULL OR p.suspended_until < NOW())
    AND (
      p.notification_preferences IS NULL
      OR (p.notification_preferences->>'communications')::boolean IS NOT FALSE
    )
    AND CASE p_segment
      WHEN 'all' THEN true

      WHEN 'subscribers' THEN EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id
          AND ms.gym_id    = p_gym_id
          AND ms.status    = 'active'
      )

      WHEN 'drop_in' THEN NOT EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id
          AND ms.gym_id    = p_gym_id
          AND ms.status    = 'active'
      )

      -- Inscrits ou participants aux cours d'aujourd'hui (timezone Brussels)
      WHEN 'present_today' THEN EXISTS (
        SELECT 1 FROM bookings b
        JOIN time_slots s ON s.id = b.slot_id
        WHERE b.member_id = p.id
          AND b.gym_id    = p_gym_id
          AND b.status    IN ('confirmed', 'no_show')
          AND (s.starts_at AT TIME ZONE 'Europe/Brussels')::date
              = (NOW() AT TIME ZONE 'Europe/Brussels')::date
      )

      ELSE true
    END;
END;
$$;

