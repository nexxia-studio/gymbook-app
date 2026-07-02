-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260701223733 : gym98_guard_get_communication_recipients_null_safe
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
-- GYM-98 Temps 2 (fix null-safe) : le guard précédent était court-circuité
-- par la logique tri-valuée SQL quand auth.role()/is_gym_admin() valent NULL
-- (contexte non authentifié) → il laissait passer au lieu de bloquer.
-- Réécriture fail-safe : on calcule un booléen "autorisé" garanti non-NULL,
-- et on refuse dès qu'il n'est pas TRUE.
CREATE OR REPLACE FUNCTION public.get_communication_recipients(p_gym_id uuid, p_segment text DEFAULT 'all'::text)
 RETURNS TABLE(member_id uuid, first_name text, email text, push_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean := COALESCE(auth.role() = 'service_role', false);
  v_is_admin   boolean := COALESCE(is_gym_admin(), false);
  v_same_gym   boolean := COALESCE(p_gym_id = get_my_gym_id(), false);
  v_allowed    boolean;
BEGIN
  -- Autorisé si service_role, OU (admin ET même gym). Garanti non-NULL.
  v_allowed := v_is_service OR (v_is_admin AND v_same_gym);

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé : réservé aux administrateurs du gym concerné';
  END IF;

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
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id AND ms.status = 'active'
      )
      WHEN 'drop_in' THEN NOT EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id AND ms.status = 'active'
      )
      WHEN 'present_today' THEN EXISTS (
        SELECT 1 FROM bookings b
        JOIN time_slots s ON s.id = b.slot_id
        WHERE b.member_id = p.id AND b.gym_id = p_gym_id
          AND b.status IN ('confirmed', 'no_show')
          AND (s.starts_at AT TIME ZONE 'Europe/Brussels')::date
              = (NOW() AT TIME ZONE 'Europe/Brussels')::date
      )
      ELSE true
    END;
END;
$function$;
