-- GYM-195 (volet 2) : 'canceling' compte comme abonnement ACTIF, partout côté SQL.
--
-- Rendre 'canceling' écrivable (volet 1) sans ce volet introduirait DEUX régressions :
--
--   1. Un 'canceling' échu ne serait JAMAIS fermé. expire_subscriptions() ne visait que
--      'active' : l'abonnement resterait 'canceling' indéfiniment, statut traité comme
--      actif par _shared/subscription-engagement.ts et par l'app → accès à vie. C'est
--      exactement le bug que GYM-191 a corrigé le matin même pour 'active'.
--
--   2. Un membre en 'canceling' a PAYÉ et reste engagé jusqu'au terme, mais serait traité
--      comme non-abonné : débit d'un crédit à la promotion waitlist (voire refus
--      NO_CREDIT s'il n'en a aucun, alors qu'il a droit d'accès), et exclusion du segment
--      « abonnés » au profit du segment « à l'unité ».
--
-- LA RÈGLE, désormais uniforme (serveur comme app) :
--     status IN ('active','canceling') AND (ends_at IS NULL OR ends_at > now())
-- 'canceling' = résiliation demandée, mandat Mollie annulé, ACCÈS MAINTENU JUSQU'AU TERME.
-- C'est déjà la sémantique de _shared/subscription-engagement.ts et de lib/subscription.ts
-- côté mobile : le SQL les rejoint.
--
-- ⚠️ ANTI-DRIFT : les trois fonctions ci-dessous sont recopiées depuis leur définition
-- LIVE en prod (pg_get_functiondef, lue après le déploiement GYM-191 du matin). SEUL le
-- prédicat de statut change. Sont conservés à l'identique : la ceinture ends_at de
-- GYM-191, la garde SLOT_CANCELLED et le verrou FOR UPDATE de promote_waitlist_atomic,
-- la garde d'accès de get_communication_recipients, les signatures et les ACL.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) expire_subscriptions() — fermer aussi les abonnements en cours de résiliation.
--
--    CIBLE INCHANGÉE : 'expired', jamais 'cancelled'. Un abonnement qui s'éteint À SON
--    TERME est expiré ; 'cancelled' signifierait une fin ANTICIPÉE, ce qui serait faux et
--    ferait perdre l'information « le membre est allé au bout de ce qu'il avait payé ».
--    Tout le reste est identique au live : ends_at IS NOT NULL, ends_at < now(),
--    RETURNING, et les garde-fous paused/suspended/cancelled/completed (qui restent hors
--    du WHERE, donc jamais réécrits).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS TABLE(
  id        uuid,
  member_id uuid,
  gym_id    uuid,
  plan_name text,
  ends_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE member_subscriptions ms
  SET status     = 'expired',
      updated_at = now()
  WHERE ms.status IN ('active', 'canceling')   -- GYM-195 : SEULE MODIFICATION
    AND ms.ends_at IS NOT NULL
    AND ms.ends_at < now()
  RETURNING ms.id, ms.member_id, ms.gym_id, ms.plan_name, ms.ends_at;
$$;

COMMENT ON FUNCTION public.expire_subscriptions() IS
  'GYM-191/195 — Passe à ''expired'' les abonnements dont le terme est dépassé, qu''ils '
  'soient ''active'' ou ''canceling'' (résiliation demandée mais accès encore ouvert : lui '
  'aussi doit se fermer au terme, sans quoi l''accès resterait acquis à vie). '
  'Indispensable depuis GYM-189 : un abonnement payé en une fois n''a aucun webhook Mollie '
  'futur, rien d''autre ne le fermerait. Ne touche jamais paused/suspended/cancelled/completed. '
  'Idempotente. Planifiée toutes les heures (job pg_cron ''expire-subscriptions''). '
  'Retourne les lignes expirées (support d''une future notification d''échéance).';

-- ─────────────────────────────────────────────────────────────────────────────
-- b) promote_waitlist_atomic — ne plus débiter un crédit à un membre encore engagé.
--    Recopiée du live ; seul le SELECT EXISTS calculant v_has_sub change.
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

  -- GYM-195 — SEULE MODIFICATION : 'canceling' compte comme abonnement actif (le membre a
  -- payé et reste engagé jusqu'au terme). La ceinture de date GYM-191 est conservée.
  SELECT EXISTS (
    SELECT 1 FROM member_subscriptions
    WHERE member_id = v_member_id AND gym_id = v_gym_id
      AND status IN ('active', 'canceling')
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
-- c) get_communication_recipients — un membre en résiliation reste un abonné.
--    Recopiée du live ; seules les deux sous-requêtes 'subscribers' / 'drop_in' changent.
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
      -- GYM-195 — SEULE MODIFICATION (ici et dans 'drop_in') : un membre en résiliation
      -- est encore abonné jusqu'au terme. Il doit rester dans « abonnés » et surtout ne
      -- pas basculer dans « à l'unité », qui sert notamment les relances d'abonnement.
      WHEN 'subscribers' THEN EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id
          AND ms.status IN ('active', 'canceling')
          AND (ms.ends_at IS NULL OR ms.ends_at > NOW())
      )
      WHEN 'drop_in' THEN NOT EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id
          AND ms.status IN ('active', 'canceling')
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
