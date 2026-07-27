-- GYM-191 (volet 2) : un abonnement échu n'ouvre plus aucun droit — CEINTURE.
--
-- Le cron gym191_expire_subscriptions est la bretelle : il passe les abonnements échus
-- à 'expired' une fois par heure. Ceci en est la CEINTURE : même si le cron prenait du
-- retard (job désactivé, base en maintenance, migration pas encore appliquée), un
-- abonnement dont le terme est dépassé ne doit ouvrir AUCUN droit.
--
-- Le prédicat devient partout le même :
--     status = 'active' AND (ends_at IS NULL OR ends_at > now())
--
-- ⚠️ ANTI-DRIFT : les deux fonctions ci-dessous sont recopiées depuis leur définition
-- LIVE en prod (pg_get_functiondef), et SEULE la condition d'abonnement est modifiée.
-- Tout le reste — variables, ordre des contrôles, messages, retours — est à l'identique.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) promote_waitlist_atomic — promotion depuis la liste d'attente.
--
--    C'est un vrai chemin d'octroi de droit : si v_has_sub est vrai, le membre est
--    promu SANS débit de crédit. Un abonnement échu lui offrait donc des séances
--    gratuites. Seul le SELECT EXISTS change (ajout de la condition de date).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promote_waitlist_atomic(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slot_id      uuid;
  v_member_id    uuid;
  v_gym_id       uuid;
  v_status       text;
  v_slot_status  text;
  v_capacity     integer;
  v_confirmed    integer;
  v_has_sub      boolean;
  v_credit_id    uuid;
BEGIN
  SELECT slot_id, member_id, gym_id, status
    INTO v_slot_id, v_member_id, v_gym_id, v_status
  FROM bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'BOOKING_NOT_FOUND');
  END IF;
  IF v_status <> 'waitlisted' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'NOT_WAITLISTED');
  END IF;

  SELECT capacity, status INTO v_capacity, v_slot_status
  FROM time_slots
  WHERE id = v_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'SLOT_NOT_FOUND');
  END IF;

  IF v_slot_status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'SLOT_CANCELLED');
  END IF;

  SELECT count(*) INTO v_confirmed
  FROM bookings
  WHERE slot_id = v_slot_id
    AND status = 'confirmed';

  IF v_confirmed >= v_capacity THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'FULL');
  END IF;

  -- GYM-191 — SEULE MODIFICATION : un abonnement dont le terme est dépassé ne compte plus.
  SELECT EXISTS (
    SELECT 1 FROM member_subscriptions
    WHERE member_id = v_member_id AND gym_id = v_gym_id AND status = 'active'
      AND (ends_at IS NULL OR ends_at > now())
  ) INTO v_has_sub;

  IF NOT v_has_sub THEN
    BEGIN
      v_credit_id := public.debit_credit_fifo(v_member_id, v_gym_id, p_booking_id);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'NO_CREDIT' THEN
        RETURN jsonb_build_object('status', 'skipped', 'reason', 'NO_CREDIT');
      ELSE
        RAISE;
      END IF;
    END;
  END IF;

  UPDATE bookings
  SET status = 'confirmed',
      waitlist_position = NULL,
      waitlist_notified_at = NULL,
      waitlist_confirmation_deadline = NULL,
      promoted_from_waitlist_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'status', 'promoted',
    'booking_id', p_booking_id,
    'credit_debited', (NOT v_has_sub),
    'credit_id', v_credit_id
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- b) get_communication_recipients — segments « abonnés » / « à l'unité ».
--
--    Pas un chemin d'accès, mais bien une détermination d'« abonnement valide » :
--    sans la condition de date, un membre échu resterait ciblé comme abonné (et serait
--    exclu du segment 'drop_in') — précisément la population à relancer pour un
--    réabonnement. Seules les deux sous-requêtes changent.
-- ─────────────────────────────────────────────────────────────────────────────
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
      -- GYM-191 — SEULE MODIFICATION : un abonnement échu ne fait plus « abonné ».
      WHEN 'subscribers' THEN EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id AND ms.status = 'active'
          AND (ms.ends_at IS NULL OR ms.ends_at > NOW())
      )
      WHEN 'drop_in' THEN NOT EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id AND ms.status = 'active'
          AND (ms.ends_at IS NULL OR ms.ends_at > NOW())
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
