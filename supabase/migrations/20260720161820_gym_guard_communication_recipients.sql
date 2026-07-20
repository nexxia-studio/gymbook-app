-- Garde gym_admin / service_role dans get_communication_recipients.
--
-- Objectif : garantir qu'un appelant `authenticated` (le dashboard l'appelle) ne puisse
-- lister les destinataires QUE de SON gym — un membre authentifié ne doit pas pouvoir
-- énumérer les emails d'un autre gym. Le service_role (Edge send-communication) passe
-- toujours. Le corps (RETURN QUERY) est conservé À L'IDENTIQUE.
--
-- ⚠️ À DÉPLOYER PAR LE COCKPIT AVEC DIFF LIVE PRÉALABLE (fichier NOUVEAU).
-- NB repo : la définition présente dans le baseline porte déjà une garde ÉQUIVALENTE
-- (v_allowed := service_role OR (is_gym_admin AND même gym) + RAISE). Cette migration
-- NORMALISE la garde sous la forme demandée (RAISE 'FORBIDDEN' en tête de corps) et doit
-- donc être diffée contre le live avant application. CREATE OR REPLACE = idempotent.

CREATE OR REPLACE FUNCTION public.get_communication_recipients(p_gym_id uuid, p_segment text DEFAULT 'all'::text)
RETURNS TABLE(member_id uuid, first_name text, email text, push_token text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Garde : service_role OU (gym_admin de CE gym). Sinon interdit.
  IF auth.role() <> 'service_role'
     AND NOT (public.is_gym_admin() AND public.get_my_gym_id() = p_gym_id)
  THEN
    RAISE EXCEPTION 'FORBIDDEN';
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
$$;
