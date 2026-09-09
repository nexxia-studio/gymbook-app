-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-116 (VOLET 2) — RAPPELS D'ÉCHÉANCE D'ABONNEMENT                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CE FICHIER N'EST PAS APPLIQUÉ PAR CE LOT. C'est le cockpit qui l'exécute, staging
-- puis production, et qui substitue ${PROJECT_REF} / ${INTERNAL_FUNCTIONS_SECRET} dans la
-- section cron — même convention que GYM-252 (process-failed-renewals).
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LE BESOIN
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Aucune reconduction tacite n'existe : l'audit GYM-321 l'a établi — `max_payments` vaut
-- `duration_months`, l'abonnement s'arrête de lui-même. Les abonnements de Dopamine
-- arrivent donc à terme sans que personne ne soit prévenu, ni le membre ni le gérant.
-- QUATRE se terminent entre le 30/11 et le 04/12 : le premier rappel utile part le 16/11.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 `ends_at` EST LA SEULE SOURCE DE VÉRITÉ — INVARIANT GYM-321
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Ni `next_payment_at`, ni le statut Mollie, ni `payments_count` n'entrent dans cette
-- décision. GYM-321 a montré que le compteur Mollie s'épuise UN MOIS avant le terme :
-- s'y fier ferait partir les rappels un mois trop tôt, et pour un abonnement payé en une
-- fois (`billing_type = 'one_time'`) il n'y a même pas de compteur.
--
-- ⚠️ CONSÉQUENCE VOULUE : un plan « Illimité 12 mois — paiement unique », qui n'a AUCUN
-- abonnement Mollie (`mollie_subscription_id IS NULL`), est pris en charge exactement
-- comme les autres. Il a un `ends_at`, donc il est rappelé. C'est la raison pour laquelle
-- aucune colonne Mollie n'apparaît dans la requête ci-dessous.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LES DEUX COLONNES DE SUIVI
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Nommées d'après `bookings.reminder_24h_sent_at` / `reminder_2h_sent_at` : même rôle,
-- même forme, même convention. La table dit déjà de quoi il s'agit — les préfixer de
-- `ends_` n'ajouterait rien qu'un abonnement n'a pas d'autre échéance à rappeler.
--
-- ⚠️ UNE COLONNE PAR JALON, ET NON UN SEUL `reminder_sent_at`. Un jalon franchi ne doit
-- pas empêcher l'autre de partir : avec une colonne unique, le J-3 ne partirait jamais
-- pour un membre ayant reçu son J-14.
ALTER TABLE public.member_subscriptions
  ADD COLUMN IF NOT EXISTS reminder_14d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_3d_sent_at  timestamptz;

COMMENT ON COLUMN public.member_subscriptions.reminder_14d_sent_at IS
  'GYM-116 — instant d''envoi du rappel J-14 avant ends_at. NULL = jamais envoyé.';
COMMENT ON COLUMN public.member_subscriptions.reminder_3d_sent_at IS
  'GYM-116 — instant d''envoi du rappel J-3 avant ends_at. NULL = jamais envoyé.';

-- Le balayage lit `status`, `ends_at` et les deux colonnes de suivi. L'index partiel ne
-- couvre que les lignes susceptibles d'être rappelées : sur une table qui grandira avec
-- l'historique, il évite de reparcourir tous les abonnements clos à chaque heure.
CREATE INDEX IF NOT EXISTS idx_member_subscriptions_rappels_echeance
  ON public.member_subscriptions (ends_at)
  WHERE status = 'active'
    AND ends_at IS NOT NULL
    AND (reminder_14d_sent_at IS NULL OR reminder_3d_sent_at IS NULL);

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. LE BALAYAGE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Motif repris de `get_pending_reminders()` (GYM-32 / GYM-93) : plpgsql, SECURITY
-- DEFINER, `search_path` figé, une ligne par envoi à faire, avec tout ce dont l'Edge
-- Function a besoin — elle ne doit refaire aucune requête par membre.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 CALENDRIER LOCAL DE LA SALLE, JAMAIS UNE DURÉE — LE PIÈGE DU 25/10
-- ─────────────────────────────────────────────────────────────────────────────────────
-- « Quatorze jours avant » est une distance de CALENDRIER, pas une durée. Écrire
-- `ends_at - INTERVAL '14 days'` compte 14 × 86 400 secondes : la nuit du 25/10, où
-- Bruxelles passe de UTC+2 à UTC+1, cela dérive d'une heure — assez pour faire changer
-- de JOUR un rappel calculé près de minuit.
--
-- On soustrait donc deux DATES LOCALES, ce qui rend un entier de jours civils et ne
-- manipule aucune milliseconde. C'est le geste de GYM-93 (`AT TIME ZONE` sur l'horloge de
-- la salle) et celui de GYM-319 (`renewal-date.ts` : « calendrier local, jamais
-- d'arithmétique sur l'instant »).
--
-- ⚠️ `COALESCE(g.timezone, 'Europe/Brussels')` : la colonne est nullable, et une salle
-- sans fuseau renseigné doit garder le comportement d'aujourd'hui plutôt que disparaître
-- du balayage.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 L'HEURE D'ENVOI EST DÉCIDÉE ICI, PAS DANS LE CRON
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Le cron tourne TOUTES LES HEURES ; c'est cette fonction qui ne rend des lignes que
-- pendant l'heure locale d'envoi. Deux raisons, et la seconde est celle qui tranche :
--
--   1. Un `cron` s'exprime en UTC. « 10 h du matin » y est INEXPRIMABLE à l'année : il
--      faudrait 09:00 UTC en hiver et 08:00 UTC en été, donc rééditer le job deux fois
--      par an — ou accepter qu'un rappel parte à 11 h la moitié de l'année.
--   2. MULTI-SALLES. Une salle dans un autre fuseau doit recevoir ses rappels à 10 h
--      CHEZ ELLE. Un horaire UTC unique ne peut pas le faire ; ce filtre, si.
--
-- 10 h : le membre est réveillé (le cadrage exclut 3 h du matin), et il lui reste la
-- journée pour agir — écrire à sa salle, se réabonner — avant la fermeture.
CREATE OR REPLACE FUNCTION public.get_pending_subscription_reminders()
RETURNS TABLE (
  subscription_id     uuid,
  member_id           uuid,
  gym_id              uuid,
  plan_name           text,
  ends_at             timestamptz,
  days_remaining      integer,
  member_email        text,
  member_first_name   text,
  preferred_language  text,
  push_token          text,
  reminder_type       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH candidats AS (
    SELECT
      ms.id,
      ms.member_id,
      ms.gym_id,
      ms.plan_name,
      ms.ends_at,
      ms.reminder_14d_sent_at,
      ms.reminder_3d_sent_at,
      p.email,
      p.first_name,
      p.preferred_language,
      p.push_token,
      -- L'entier de jours civils, dans le calendrier de la salle.
      ((ms.ends_at AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels'))::date
       - (NOW()     AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels'))::date) AS jours,
      EXTRACT(HOUR FROM NOW() AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels'))::int AS heure_locale
    FROM member_subscriptions ms
    JOIN profiles     p ON p.id = ms.member_id
    JOIN nexxia_gyms  g ON g.id = ms.gym_id
    WHERE
      -- ⚠️ 'active' SEULEMENT, et c'est un choix.
      --   · 'canceling' est EXCLU : le membre a demandé l'arrêt, il connaît la date. Lui
      --     rappeler qu'elle approche se lirait comme une relance commerciale.
      --   · 'past_due' / 'suspended' sont EXCLUS : ces membres sont déjà dans la relance
      --     d'impayé (GYM-252), qui leur parle de la MÊME facture. Deux courriers
      --     concurrents sur le même sujet valent moins qu'un seul.
      --   · Depuis GYM-321, un abonnement dont Mollie a fini de prélever RESTE 'active'
      --     jusqu'à son terme : ce filtre couvre donc bien le dernier mois.
      ms.status = 'active'
      AND ms.ends_at IS NOT NULL
      -- Le compte est vivant. Un membre supprimé n'a rien à recevoir.
      AND p.deleted_at IS NULL
      AND p.email IS NOT NULL
      -- Mêmes préférences que les rappels de cours : opt-out respecté, absence = opt-in.
      AND (
        p.notification_preferences IS NULL
        OR (p.notification_preferences->>'reminders')::boolean IS NOT FALSE
      )
      -- ── 🔴 LE MEMBRE A-T-IL DÉJÀ REPRIS ? ────────────────────────────────────────
      -- S'il existe, pour la MÊME salle, un autre abonnement vivant qui couvre AU-DELÀ
      -- du terme qu'on s'apprête à annoncer, alors la continuité est déjà assurée et le
      -- rappel n'a plus d'objet — il inquiéterait pour rien.
      --
      -- ⚠️ COMPARAISON SUR `ends_at`, PAS SUR LA DATE DE CRÉATION. Un abonnement acheté
      -- plus tard mais couvrant une période ANTÉRIEURE (régularisation, geste
      -- commercial) ne prolonge rien : c'est la couverture qui compte, pas l'ordre d'achat.
      --
      -- ⚠️ LES CRÉDITS À L'UNITÉ NE COMPTENT PAS. Acheter une carte de séances n'est pas
      -- reconduire un abonnement : le membre perdrait quand même son illimité sans le
      -- savoir. `member_credits` est donc délibérément absent de ce test.
      AND NOT EXISTS (
        SELECT 1
        FROM member_subscriptions autre
        WHERE autre.member_id = ms.member_id
          AND autre.gym_id    = ms.gym_id
          AND autre.id       <> ms.id
          AND autre.status IN ('active', 'canceling')
          AND autre.ends_at IS NOT NULL
          AND autre.ends_at > ms.ends_at
      )
  )
  -- ── J-14 ────────────────────────────────────────────────────────────────────────
  -- Borne basse à 4 et non à 14 : le jalon est « il reste AU PLUS 14 jours », pas
  -- « exactement 14 ». Un cron manqué (panne, migration, salle créée tard) rattrape donc
  -- le rappel le lendemain au lieu de le perdre pour toujours. La borne haute des 4 jours
  -- l'empêche de se superposer au J-3 : un membre ne reçoit jamais les deux le même jour.
  SELECT id, member_id, gym_id, plan_name, ends_at, jours,
         email, first_name, COALESCE(preferred_language, 'fr'), push_token, '14d'::text
  FROM candidats
  WHERE reminder_14d_sent_at IS NULL
    AND jours BETWEEN 4 AND 14
    AND heure_locale = 10

  UNION ALL

  -- ── J-3 ─────────────────────────────────────────────────────────────────────────
  -- Borne basse à 0 : le jour même compte encore, l'accès court jusqu'à `ends_at`.
  -- Un terme DÉPASSÉ (jours < 0) ne rend rien : on ne rappelle pas une échéance passée,
  -- ce serait annoncer une décision au lieu de la préparer.
  SELECT id, member_id, gym_id, plan_name, ends_at, jours,
         email, first_name, COALESCE(preferred_language, 'fr'), push_token, '3d'::text
  FROM candidats
  WHERE reminder_3d_sent_at IS NULL
    AND jours BETWEEN 0 AND 3
    AND heure_locale = 10;
$function$;

COMMENT ON FUNCTION public.get_pending_subscription_reminders() IS
  'GYM-116 — abonnements dont le terme (ends_at, seule source de vérité) approche et dont '
  'le rappel J-14 ou J-3 n''est pas encore parti. Jours comptés en dates LOCALES de la '
  'salle (piège DST). Ne rend des lignes qu''à 10 h locale.';

REVOKE ALL     ON FUNCTION public.get_pending_subscription_reminders() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_pending_subscription_reminders() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. LE MARQUAGE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Copie conforme de `mark_reminder_sent(uuid, text)`, sur l'autre table. Un jalon inconnu
-- n'écrit rien plutôt que d'échouer : le cron traite un lot, et une valeur inattendue ne
-- doit pas interrompre les envois des autres membres.
CREATE OR REPLACE FUNCTION public.mark_subscription_reminder_sent(
  p_subscription_id uuid,
  p_reminder_type   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_reminder_type = '14d' THEN
    UPDATE member_subscriptions
    SET reminder_14d_sent_at = NOW(), updated_at = NOW()
    WHERE id = p_subscription_id;
  ELSIF p_reminder_type = '3d' THEN
    UPDATE member_subscriptions
    SET reminder_3d_sent_at = NOW(), updated_at = NOW()
    WHERE id = p_subscription_id;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.mark_subscription_reminder_sent(uuid, text) IS
  'GYM-116 — marque le jalon de rappel comme envoyé. Pendant de mark_reminder_sent.';

REVOKE ALL     ON FUNCTION public.mark_subscription_reminder_sent(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mark_subscription_reminder_sent(uuid, text) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 4. LE CRON
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ L'URL ET LE SECRET SONT À SUBSTITUER PAR ENVIRONNEMENT — ce fichier n'est PAS
-- déployé, c'est le cockpit qui exécute cette section avec les valeurs de la cible.
-- Même convention que GYM-252.
--
-- HORAIRE : toutes les heures à :25.
--   · Toutes les heures parce que l'heure d'envoi est décidée en SQL, sur l'horloge de la
--     salle (voir la fonction) — le cron ne fait que proposer des occasions.
--   · À :25 pour ne disputer aucune minute aux jobs existants : expire-subscriptions
--     tourne à :05, send-reminders sur la grille des quarts (:00 :15 :30 :45),
--     process-no-shows aux demies. :25 est libre.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-subscription-reminders') THEN
    PERFORM cron.unschedule('send-subscription-reminders');
  END IF;
END $$;

SELECT cron.schedule('send-subscription-reminders', '25 * * * *', $CRON$
  SELECT net.http_post(
    url := 'https://${PROJECT_REF}.supabase.co/functions/v1/send-subscription-reminders',
    headers := '{"Content-Type":"application/json","X-Internal-Secret":"${INTERNAL_FUNCTIONS_SECRET}"}'::jsonb,
    body := '{}'::jsonb
  )
$CRON$);
