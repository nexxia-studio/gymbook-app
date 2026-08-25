-- GYM-252 : échéances d'abonnement en échec — état, grâce, suspension.
--
-- ⚠️ NON DÉPLOYÉE (interdit par le ticket). Écrite pour être rejouable : tout est
-- CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS, ou conditionnel.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- LE DÉFAUT
-- ═════════════════════════════════════════════════════════════════════════════
-- Un prélèvement de renouvellement qui échoue ne laisse AUCUNE TRACE aujourd'hui.
-- Constat sur la fonction DÉPLOYÉE (mollie-subscription-webhook, staging, diff
-- repo↔déployé identique le 24/08/2026), branche failed/expired/canceled :
--
--     UPDATE payments SET status = 'failed' WHERE mollie_payment_id = <id>
--
-- Or pour une ÉCHÉANCE, aucune ligne `payments` n'existe : elle n'est écrite que
-- dans la branche `paid` (les renouvellements sont générés par Mollie, rien ne
-- peut être pré-inséré — c'est le motif même de GYM-244). L'UPDATE porte donc sur
-- ZÉRO ligne, sans erreur. `member_subscriptions` n'est pas touché : le membre
-- garde son accès, personne n'est prévenu, et il ne reste rien à retrouver.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- CE QUE MOLLIE FAIT DE SON CÔTÉ — ce qui commande le nombre de NOS relances
-- ═════════════════════════════════════════════════════════════════════════════
--   « Mollie will retry the failed payment up to 5 times. »
--   « If your subscription payment does not succeed, Mollie may attempt it again
--     up to 5 times (once a day), depending on the failure reason. »
--   « Mollie will generally not cancel your subscription when a payment fails. »
--   « After all retries have been exhausted, the subscription will be cancelled. »
--   « Like regular payments your webhook is called for retrieving status updates. »
--   — docs.mollie.com/docs/recurring-payments, consultée le 24/08/2026
--
-- TROIS CONSÉQUENCES DE CONCEPTION, toutes contre-intuitives :
--
--   1. ON N'ENVOIE PAS DE LIEN DE RATTRAPAGE au membre. Mollie retente seul : un
--      paiement manuel en parallèle d'une tentative réussie DOUBLE le débit. Le
--      1er email informe et invite à vérifier le compte ; il ne propose pas de payer.
--
--   2. CHAQUE TENTATIVE RAPPELLE NOTRE WEBHOOK. Sans compteur, le membre recevrait
--      jusqu'à CINQ fois le même email « ton paiement a échoué ». D'où
--      payment_failed_at (posé une seule fois, au premier échec du cycle) et
--      payment_failed_count (incrémenté à chaque tentative) : l'email est adossé à
--      la TRANSITION NULL→now(), pas à la réception d'un webhook.
--
--   3. LA GRÂCE DE 3 JOURS TOMBE DANS LA FENÊTRE DE RETRY DE MOLLIE (jusqu'à 5 j).
--      C'est assumé : on suspend au 3e jour même si Mollie peut encore réussir au
--      4e ou au 5e. La réactivation étant automatique au webhook `paid`, le coût
--      d'une suspension prématurée est faible ; le coût inverse — un mois d'accès
--      gratuit par membre — ne l'est pas.
--
-- ═════════════════════════════════════════════════════════════════════════════
-- LA MACHINE À ÉTATS
-- ═════════════════════════════════════════════════════════════════════════════
--   active ──échec J0──▶ past_due ──J+3 impayé──▶ suspended ──terme──▶ expired
--      ▲                     │                        │
--      └──────── paiement reçu (webhook `paid`) ──────┘
--
--   past_due  : le prélèvement a échoué, L'ACCÈS RESTE OUVERT. C'est pourquoi ce
--               statut est ajouté à TOUS les prédicats « ouvre des droits » plus
--               bas — l'oublier quelque part reviendrait à couper l'accès dès J0,
--               l'inverse exact de la politique.
--   suspended : la grâce est écoulée. L'accès ABONNEMENT est coupé — par le MÊME
--               chemin que l'expiration : le statut sort des prédicats, donc le
--               membre est traité comme non-abonné. Ce n'est pas un drapeau
--               décoratif, c'est le prédicat lui-même.
--
-- ⚠️ SYMÉTRIE VOULUE, ET C'EST UNE CONSÉQUENCE GRATUITE DU MÉCANISME :
--   · les RÉSERVATIONS DÉJÀ FAITES ne sont pas touchées — rien ici ne lit `bookings` ;
--   · les CRÉDITS PRÉPAYÉS restent consommables — un membre suspendu retombe
--     simplement sur debit_credit_fifo, comme n'importe quel non-abonné. Abonnement
--     et carnet de séances sont deux produits distincts ; un impayé sur l'un ne
--     confisque pas l'autre.

-- ═════════════════════════════════════════════════════════════════════════════
-- a) LE STATUT
-- ═════════════════════════════════════════════════════════════════════════════
-- CHECK LIVE constaté le 24/08/2026 (staging) :
--   (active, suspended, expired, cancelled, paused, completed, canceling)
-- 'suspended' EXISTE DÉJÀ — on le réutilise, on n'en invente pas un second.
-- Seul 'past_due' manque. Le nom est repris de nexxia_subscriptions_status_check,
-- qui l'emploie déjà pour exactement cette situation côté abonnements Viniz.
ALTER TABLE public.member_subscriptions
  DROP CONSTRAINT IF EXISTS member_subscriptions_status_check;

ALTER TABLE public.member_subscriptions
  ADD CONSTRAINT member_subscriptions_status_check
  CHECK (status = ANY (ARRAY[
    'active'::text, 'suspended'::text, 'expired'::text, 'cancelled'::text,
    'paused'::text, 'completed'::text, 'canceling'::text,
    'past_due'::text   -- GYM-252
  ]));

-- ═════════════════════════════════════════════════════════════════════════════
-- b) LES COLONNES DE SUIVI
-- ═════════════════════════════════════════════════════════════════════════════
-- ⚠️ `suspended_until` EXISTE DÉJÀ et n'est PAS réemployée : elle porte une
-- suspension DISCIPLINAIRE à durée déterminée (barème d'absences). Une suspension
-- pour impayé n'a pas de terme — elle dure jusqu'au paiement. Mélanger les deux
-- rendrait impossible de distinguer « suspendu parce qu'il ne vient pas » de
-- « suspendu parce qu'il ne paie pas », et le premier balayage automatique
-- lèverait la mauvaise.
ALTER TABLE public.member_subscriptions
  ADD COLUMN IF NOT EXISTS payment_failed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS payment_failed_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_suspended_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_failed_payment_id text;

COMMENT ON COLUMN public.member_subscriptions.payment_failed_at IS
  'GYM-252 — Horodatage du PREMIER échec du cycle impayé en cours. Posé une seule fois '
  '(NULL → now()) ; les retries Mollie ne le réécrivent pas. C''est cette transition qui '
  'déclenche le 1er email membre, et cette date qui fait courir la grâce de 3 jours. '
  'Remis à NULL dès qu''un paiement aboutit.';
COMMENT ON COLUMN public.member_subscriptions.payment_failed_count IS
  'GYM-252 — Nombre de tentatives échouées du cycle en cours (Mollie retente jusqu''à 5 fois, '
  'une fois par jour). Sert au diagnostic et à l''alerte gérant ; ne pilote aucune décision '
  'd''accès — c''est payment_failed_at + la grâce qui la prennent.';
COMMENT ON COLUMN public.member_subscriptions.payment_suspended_at IS
  'GYM-252 — Horodatage de la coupure d''accès pour impayé. Sa transition NULL → now() '
  'déclenche le 2e email membre. Distingue aussi une suspension POUR IMPAYÉ d''une '
  'suspension manuelle/disciplinaire : expire_subscriptions() ne clôt que la première.';
COMMENT ON COLUMN public.member_subscriptions.last_failed_payment_id IS
  'GYM-252 — Dernier mollie_payment_id en échec. Le seul fil pour retrouver la tentative '
  'chez Mollie : aucune ligne payments n''existait auparavant pour une échéance échouée.';

-- Index du balayage quotidien : quelques lignes sur des dizaines de milliers.
CREATE INDEX IF NOT EXISTS idx_member_subscriptions_past_due
  ON public.member_subscriptions (payment_failed_at)
  WHERE status = 'past_due';

-- ═════════════════════════════════════════════════════════════════════════════
-- c) LES PRÉDICATS « OUVRE DES DROITS » — 'past_due' AJOUTÉ PARTOUT
-- ═════════════════════════════════════════════════════════════════════════════
-- ⚠️ ANTI-DRIFT : les trois fonctions ci-dessous sont RECOPIÉES depuis leur
-- définition LIVE (pg_get_functiondef, staging, 24/08/2026). SEUL le prédicat de
-- statut change. C'est la méthode imposée par GYM-195, pour la même raison : ces
-- corps ont divergé du dépôt par le passé, et les réécrire de mémoire perdrait
-- silencieusement une garde.
--
-- ⚠️ OUBLIER UNE SEULE DE CES TROIS FONCTIONS NE CASSE RIEN VISIBLEMENT — ça
-- change juste, en silence, ce que le membre paie ou reçoit. C'est exactement ce
-- qui s'est produit à GYM-195 avec 'canceling'.

-- c.1) expire_subscriptions() — clore aussi les impayés arrivés à terme.
--
--   · 'past_due' AJOUTÉ : un abonnement impayé qui atteint son terme est terminé,
--     pas éternellement « en retard de paiement ».
--   · 'suspended' AJOUTÉ **UNIQUEMENT** quand payment_suspended_at IS NOT NULL,
--     c'est-à-dire quand C'EST NOUS qui avons suspendu pour impayé. L'invariant de
--     GYM-195 — « ne touche jamais paused/suspended/cancelled/completed » — visait
--     les suspensions manuelles ; il est préservé mot pour mot pour celles-là.
--     Sans cette clause, une suspension pour impayé resterait affichée « Suspendu »
--     à vie, bien après la fin de l'abonnement.
--   Tout le reste est identique au live : cible 'expired', ends_at NOT NULL et
--   dépassé, RETURNING inchangé.
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
  WHERE (
          ms.status IN ('active', 'canceling', 'past_due')          -- GYM-252
          OR (ms.status = 'suspended' AND ms.payment_suspended_at IS NOT NULL)  -- GYM-252
        )
    AND ms.ends_at IS NOT NULL
    AND ms.ends_at < now()
  RETURNING ms.id, ms.member_id, ms.gym_id, ms.plan_name, ms.ends_at;
$$;

COMMENT ON FUNCTION public.expire_subscriptions() IS
  'GYM-191/195/252 — Passe à ''expired'' les abonnements dont le terme est dépassé : '
  '''active'', ''canceling'', ''past_due'' (impayé, accès encore ouvert) et les '
  '''suspended'' POUR IMPAYÉ (payment_suspended_at non nul). Ne touche jamais une '
  'suspension manuelle, ni paused/cancelled/completed. Idempotente. Job pg_cron horaire.';

-- c.2) promote_waitlist_atomic — ne pas débiter un crédit à un membre en past_due.
--
--   🔴 SANS CETTE MODIFICATION, LE BUG SERAIT UN VOL. Un membre dont le prélèvement
--   a échoué garde son accès pendant la grâce ; promu depuis une liste d'attente, il
--   se verrait débiter une séance prépayée à laquelle il ne devait pas toucher — ou
--   refuser l'accès en NO_CREDIT alors que son abonnement l'ouvre encore. C'est mot
--   pour mot la régression n°2 décrite par GYM-195, transposée à 'past_due'.
--
--   Recopiée du LIVE ; SEUL le SELECT EXISTS calculant v_has_sub change. Conservés à
--   l'identique : garde SLOT_CANCELLED, verrou FOR UPDATE, contrôle de capacité,
--   limite GYM-196 (v_limit / v_future_count), débit FIFO, valeurs de retour.
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
  v_limit        integer;
  v_future_count integer;
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

  SELECT g.max_active_bookings INTO v_limit
  FROM nexxia_gyms g
  WHERE g.id = v_gym_id;

  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_future_count
    FROM bookings b
    JOIN time_slots s ON s.id = b.slot_id
    WHERE b.member_id = v_member_id
      AND b.status = 'confirmed'
      AND s.starts_at > now();

    IF v_future_count >= v_limit THEN
      RETURN jsonb_build_object(
        'status', 'skipped',
        'reason', 'BOOKING_LIMIT_REACHED',
        'limit', v_limit
      );
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM member_subscriptions
    WHERE member_id = v_member_id AND gym_id = v_gym_id
      AND status IN ('active', 'canceling', 'past_due')   -- GYM-252 : SEULE MODIFICATION
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

-- c.3) get_communication_recipients — segmenter un past_due avec les abonnés.
--   Il l'est encore : il a accès, il est engagé. Le basculer dans 'drop_in' pendant
--   trois jours enverrait la campagne « abonnés » à côté de sa cible.
--   Recopiée du LIVE ; SEULS les deux prédicats de statut changent. Conservés à
--   l'identique : la garde d'accès (service_role OU gym_admin du gym), les filtres
--   deleted_at / suspended_until / notification_preferences, le segment
--   'present_today' et le DISTINCT.
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
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id
          AND ms.status IN ('active', 'canceling', 'past_due')   -- GYM-252
          AND (ms.ends_at IS NULL OR ms.ends_at > NOW())
      )
      WHEN 'drop_in' THEN NOT EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id
          AND ms.status IN ('active', 'canceling', 'past_due')   -- GYM-252
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

-- ═════════════════════════════════════════════════════════════════════════════
-- d) LE BALAYAGE J+3
-- ═════════════════════════════════════════════════════════════════════════════
-- La grâce est un PARAMÈTRE, pas une constante magique : elle est l'argument de la
-- fonction, avec la valeur produit en défaut. L'appelant (process-failed-renewals)
-- porte la même valeur dans une constante nommée — les deux sont citées l'une chez
-- l'autre pour qu'un changement d'un seul côté se voie.
--
-- Idempotente : le WHERE exclut ce qui est déjà suspendu, et RETURNING ne rend que
-- les lignes RÉELLEMENT basculées. C'est ce retour — et lui seul — qui déclenche le
-- 2e email : rejouer le balayage dix fois dans la journée n'envoie rien de plus.
CREATE OR REPLACE FUNCTION public.suspend_overdue_subscriptions(p_grace_days integer DEFAULT 3)
RETURNS TABLE(
  id                   uuid,
  member_id            uuid,
  gym_id               uuid,
  plan_name            text,
  amount               numeric,
  payment_failed_at    timestamptz,
  payment_failed_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE member_subscriptions ms
  SET status               = 'suspended',
      payment_suspended_at = now(),
      updated_at           = now()
  WHERE ms.status = 'past_due'
    AND ms.payment_failed_at IS NOT NULL
    AND ms.payment_failed_at < now() - make_interval(days => p_grace_days)
    -- Ceinture : un abonnement déjà arrivé à terme relève d'expire_subscriptions(),
    -- pas de la suspension. Sans elle, les deux balayages se disputeraient la ligne
    -- et le membre recevrait « ton accès est suspendu » pour un abonnement fini.
    AND (ms.ends_at IS NULL OR ms.ends_at > now())
  RETURNING ms.id, ms.member_id, ms.gym_id, ms.plan_name, ms.amount,
            ms.payment_failed_at, ms.payment_failed_count;
$$;

COMMENT ON FUNCTION public.suspend_overdue_subscriptions(integer) IS
  'GYM-252 — Suspend les abonnements ''past_due'' dont la grâce (3 jours par défaut) est '
  'écoulée. Ne rend QUE les lignes réellement basculées : c''est le déclencheur du 2e email '
  'membre. Idempotente. Appelée par l''Edge Function process-failed-renewals (cron quotidien).';

REVOKE ALL ON FUNCTION public.suspend_overdue_subscriptions(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.suspend_overdue_subscriptions(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suspend_overdue_subscriptions(integer) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- e) LE JOB QUOTIDIEN
-- ═════════════════════════════════════════════════════════════════════════════
-- ⚠️ PAS DE NOUVEAU SERVICE : le motif est celui de send-booking-reminders et de
-- process-no-shows — pg_cron appelle une Edge Function par net.http_post avec
-- X-Internal-Secret. Aucune infrastructure supplémentaire.
--
-- Pourquoi pas du SQL pur dans le job horaire expire-subscriptions : le balayage doit
-- ENVOYER DES EMAILS. Postgres ne le peut pas, et la suspension sans son email serait
-- une coupure d'accès muette — précisément le défaut que ce lot corrige.
--
-- 07:10 UTC : après le passage de nuit des prélèvements SEPA, et à une heure où le
-- gérant lira l'alerte le jour même. Décalé de expire-subscriptions (:05) pour ne pas
-- disputer la même ligne à la même minute.
--
-- ⚠️ L'URL ET LE SECRET SONT À SUBSTITUER PAR ENVIRONNEMENT, comme les jobs
-- existants de la baseline. Ce fichier n'est PAS déployé : c'est le cockpit qui
-- exécutera cette section avec les valeurs de l'environnement visé.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-failed-renewals') THEN
    PERFORM cron.unschedule('process-failed-renewals');
  END IF;
END $$;

SELECT cron.schedule('process-failed-renewals', '10 7 * * *', $CRON$
  SELECT net.http_post(
    url := 'https://${PROJECT_REF}.supabase.co/functions/v1/process-failed-renewals',
    headers := '{"Content-Type":"application/json","X-Internal-Secret":"${INTERNAL_FUNCTIONS_SECRET}"}'::jsonb,
    body := '{}'::jsonb
  )
$CRON$);
