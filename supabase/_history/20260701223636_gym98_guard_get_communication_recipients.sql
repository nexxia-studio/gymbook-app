-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260701223636 : gym98_guard_get_communication_recipients
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
-- GYM-98 Temps 2 : guard interne sur get_communication_recipients.
-- Corps identique à l'original + bloc de contrôle d'accès en tête.
-- Autorise : service_role (Edge Function send-communication) OU gym_admin authentifié
-- demandant SON propre gym. Refuse tout le reste (anon, membre, admin d'un autre gym).
CREATE OR REPLACE FUNCTION public.get_communication_recipients(p_gym_id uuid, p_segment text DEFAULT 'all'::text)
 RETURNS TABLE(member_id uuid, first_name text, email text, push_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- GYM-98 guard : service_role OU gym_admin de SON propre gym uniquement
  IF auth.role() <> 'service_role'
     AND NOT (is_gym_admin() AND p_gym_id = get_my_gym_id())
  THEN
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
$function$;

-- Fermer l'exposition anon (grant PUBLIC + direct), garder authenticated + service_role
REVOKE EXECUTE ON FUNCTION public.get_communication_recipients(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_communication_recipients(uuid, text) TO authenticated, service_role;
