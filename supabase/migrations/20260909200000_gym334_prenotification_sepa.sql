-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  🔴 GYM-334 — PRÉ-NOTIFICATION SEPA. ÉCHÉANCE : DÉPLOYÉ AVANT LE 16/09.               ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CE FICHIER N'EST PAS APPLIQUÉ PAR CE LOT. Le cockpit l'exécute, staging puis prod.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LE FAIT
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Aucune pré-notification n'est envoyée aujourd'hui. Mollie l'a confirmé par écrit le
-- 09/09 : dans notre flux (POST /v2/customers/{id}/subscriptions, OAuth + Application
-- Fees) il n'en envoie AUCUNE, et l'obligation revient au marchand — la salle. Mollie
-- recommande que la plateforme l'envoie en son nom et pour son compte.
--
-- Trois membres sont prélevés le 30/09 : la notification doit partir au plus tard le 16/09.
--
-- ═════════════════════════════════════════════════════════════════════════════════════
-- MOTIF REPRIS DE GYM-116, À L'IDENTIQUE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Colonne de suivi, balayage en dates locales, filtre d'heure locale, marquage après
-- envoi, cron horaire. Le seul changement de fond est le DÉCLENCHEUR : `next_payment_at`
-- au lieu de `ends_at`.
--
-- ⚠️ MAIS UNE DIFFÉRENCE COMMANDE TOUT LE RESTE — voir §0.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 0. 🔴 CE QUE LE CADRAGE SUPPOSAIT, ET QUI N'EXISTAIT PAS
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Le cadrage demandait de « trouver où next_payment_at est mis à jour (branche
-- renouvellement) et d'y remettre la colonne à NULL ». Cet endroit N'EXISTE PAS.
--
-- Vérifié : `next_payment_at` n'est écrit qu'à DEUX endroits, tous deux dans
-- `mollie-subscription-webhook` — à la CRÉATION de l'abonnement (l. 676), et à NULL au
-- DERNIER prélèvement (l. 963, GYM-321). Entre les deux, la branche renouvellement met à
-- jour `payments_count`, le statut et les colonnes d'impayé, mais **jamais la date de
-- prochaine échéance** : elle reste figée sur la date du PREMIER renouvellement.
--
-- 🔴 CONSÉQUENCE POUR CE LOT : sans correctif, UNE SEULE pré-notification partirait par
-- abonnement — celle du premier renouvellement. Après ce prélèvement, `next_payment_at`
-- désignerait une date passée, la fenêtre J-14 ne mordrait plus jamais, et les échéances
-- 3, 4, 5… seraient prélevées sans aucun avis. Le lot corrige donc AUSSI l'avancement de
-- la date, dans la même écriture que la remise à NULL demandée.
--
-- ⚠️ Le défaut existait déjà, sans conséquence visible : personne ne lisait
-- `next_payment_at` pour décider quoi que ce soit. Il devient bloquant le jour où on s'en
-- sert. C'est le même motif qu'en GYM-321 — une colonne juste en apparence, fausse dès
-- qu'on la consulte.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LA COLONNE DE SUIVI
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 ELLE EST REMISE À NULL À CHAQUE PRÉLÈVEMENT RÉUSSI, dans `mollie-subscription-webhook`,
-- au moment même où `next_payment_at` avance. Les deux colonnes forment un couple : la
-- notification vaut POUR UNE ÉCHÉANCE, pas pour un abonnement. Les dissocier ferait couvrir
-- toutes les échéances futures par un seul envoi.
ALTER TABLE public.member_subscriptions
  ADD COLUMN IF NOT EXISTS prenotification_sent_at timestamptz;

COMMENT ON COLUMN public.member_subscriptions.prenotification_sent_at IS
  'GYM-334 — instant d''envoi de la pré-notification SEPA pour l''échéance next_payment_at '
  'EN COURS. 🔴 Remise à NULL à chaque prélèvement réussi, en même temps que l''avancement '
  'de next_payment_at : une notification vaut pour UNE échéance.';

CREATE INDEX IF NOT EXISTS idx_member_subscriptions_prenotification
  ON public.member_subscriptions (next_payment_at)
  WHERE status = 'active'
    AND next_payment_at IS NOT NULL
    AND prenotification_sent_at IS NULL;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. LE BALAYAGE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 LA FENÊTRE : 14..16 EN NOMINAL, 1..13 EN RATTRAPAGE. PAS 11..14.
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Le cadrage proposait « 11..14 pour le cas nominal ». Je propose l'inverse, et voici
-- pourquoi : l'obligation est d'informer AU MOINS 14 JOURS AVANT. Dans une fenêtre 11..14,
-- TROIS VALEURS SUR QUATRE produisent une notification qui NE RESPECTE PAS le délai — la
-- fenêtre nominale normaliserait la non-conformité, et le journal ne permettrait même pas
-- de distinguer les envois conformes des autres.
--
-- 14..16 met la tolérance du côté SÛR : les trois valeurs sont conformes (plus de 14 jours
-- reste conforme), et un cron manqué un jour est rattrapé le lendemain SANS sortir de la
-- conformité. C'est la même idée de fenêtre auto-réparatrice qu'en GYM-116, orientée dans
-- le sens que la règle impose.
--
-- ⚠️ ET LE RATTRAPAGE EXISTE QUAND MÊME, entre 1 et 13 jours, parce que ne rien envoyer
-- est pire que d'envoyer tard. Il est marqué `is_catchup` pour que l'Edge Function le
-- journalise comme tel : un envoi non conforme doit être VISIBLE, jamais silencieux.
--
-- ⚠️ RIEN EN DESSOUS DE 1 JOUR. Le jour du prélèvement, ce n'est plus une PRÉ-notification :
-- c'est un avis d'opération, qui n'a pas la même fonction et que ce lot ne prétend pas
-- rendre. Envoyer là donnerait l'illusion d'une obligation remplie.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CALENDRIER LOCAL, JAMAIS UNE DURÉE — le piège du 25/10
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Identique à GYM-116 et GYM-319 : on soustrait deux DATES LOCALES, ce qui rend un entier
-- de jours civils. `next_payment_at - INTERVAL '14 days'` compterait 14 × 86 400 s et
-- dériverait d'une heure la nuit du 25/10 — assez pour faire changer de JOUR un envoi
-- calculé près de minuit, et donc pour faire passer une notification conforme sous les
-- 14 jours.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CE QUI EST NOTIFIÉ, ET RIEN D'AUTRE
-- ─────────────────────────────────────────────────────────────────────────────────────
--  · `status = 'active'` — un abonnement `canceling` ne sera plus prélevé (le mandat est
--    annulé chez Mollie) : lui annoncer un prélèvement serait faux et inquiétant.
--    `past_due` / `suspended` relèvent de la relance d'impayé (GYM-252), pas d'ici.
--  · `next_payment_at IS NOT NULL` — pas d'échéance, pas d'avis. Couvre le plan payé en
--    une fois (`billing_type = 'one_time'`), qui n'a aucun prélèvement à venir.
--  · `payments_count < max_payments` — le compteur épuisé signifie que Mollie ne
--    prélèvera plus. `max_payments IS NULL` (abonnement sans terme) ne bloque pas.
--
-- ⚠️ `notification_preferences` N'EST PAS CONSULTÉ, et c'est délibéré. Une pré-notification
-- SEPA n'est pas un service de confort : c'est l'information qui précède un débit sur le
-- compte du membre. Elle relève du même régime que la facture — le membre ne peut pas s'en
-- désabonner. Même raisonnement que la scission de garde décidée en GYM-116.
CREATE OR REPLACE FUNCTION public.get_pending_sepa_prenotifications()
RETURNS TABLE (
  subscription_id     uuid,
  member_id           uuid,
  gym_id              uuid,
  plan_name           text,
  amount              numeric,
  next_payment_at     timestamptz,
  days_remaining      integer,
  is_catchup          boolean,
  member_email        text,
  member_first_name   text,
  preferred_language  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH candidats AS (
    SELECT
      ms.id, ms.member_id, ms.gym_id, ms.plan_name, ms.amount, ms.next_payment_at,
      p.email, p.first_name, p.preferred_language,
      ((ms.next_payment_at AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels'))::date
       - (NOW()            AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels'))::date) AS jours,
      EXTRACT(HOUR FROM NOW() AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels'))::int AS heure_locale
    FROM member_subscriptions ms
    JOIN profiles    p ON p.id = ms.member_id
    JOIN nexxia_gyms g ON g.id = ms.gym_id
    WHERE ms.status = 'active'
      AND ms.next_payment_at IS NOT NULL
      AND ms.prenotification_sent_at IS NULL
      AND (ms.max_payments IS NULL OR coalesce(ms.payments_count, 0) < ms.max_payments)
      AND p.deleted_at IS NULL
      AND p.email IS NOT NULL
  )
  SELECT id, member_id, gym_id, plan_name, amount, next_payment_at, jours,
         (jours < 14) AS is_catchup,
         email, first_name, COALESCE(preferred_language, 'fr')
  FROM candidats
  WHERE heure_locale = 9
    AND jours BETWEEN 1 AND 16;
$function$;

COMMENT ON FUNCTION public.get_pending_sepa_prenotifications() IS
  'GYM-334 — abonnements dont le prochain prélèvement approche et dont la pré-notification '
  'SEPA n''est pas partie. Fenêtre conforme 14..16 jours ; 1..13 = rattrapage (is_catchup), '
  'hors délai légal mais préférable au silence. Jours comptés en dates LOCALES de la salle.';

REVOKE ALL     ON FUNCTION public.get_pending_sepa_prenotifications() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_pending_sepa_prenotifications() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. LE MARQUAGE
-- ═════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mark_sepa_prenotification_sent(p_subscription_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE member_subscriptions
  SET prenotification_sent_at = NOW(), updated_at = NOW()
  WHERE id = p_subscription_id;
END;
$function$;

COMMENT ON FUNCTION public.mark_sepa_prenotification_sent(uuid) IS
  'GYM-334 — marque la pré-notification comme envoyée pour l''échéance en cours.';

REVOKE ALL     ON FUNCTION public.mark_sepa_prenotification_sent(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.mark_sepa_prenotification_sent(uuid) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 4. LE CRON
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ URL ET SECRET À SUBSTITUER PAR ENVIRONNEMENT — ce fichier n'est pas déployé.
--
-- Toutes les heures à :35. L'heure d'ENVOI (9 h locale de la salle) est décidée en SQL,
-- pas ici — même raison qu'en GYM-116 : « 9 h » est inexprimable en cron UTC à l'année, et
-- une salle d'un autre fuseau doit être servie à 9 h chez elle.
--
-- 9 h et non 10 h (GYM-116) : ce courrier annonce un débit sur un compte bancaire. Le
-- membre doit pouvoir agir dans la journée — vérifier sa provision, écrire à sa salle.
--
-- :35 pour ne disputer aucune minute : expire-subscriptions à :05, send-reminders sur la
-- grille des quarts, process-no-shows aux demies, send-subscription-reminders à :25.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-sepa-prenotifications') THEN
    PERFORM cron.unschedule('send-sepa-prenotifications');
  END IF;
END $$;

SELECT cron.schedule('send-sepa-prenotifications', '35 * * * *', $CRON$
  SELECT net.http_post(
    url := 'https://${PROJECT_REF}.supabase.co/functions/v1/send-sepa-prenotifications',
    headers := '{"Content-Type":"application/json","X-Internal-Secret":"${INTERNAL_FUNCTIONS_SECRET}"}'::jsonb,
    body := '{}'::jsonb
  )
$CRON$);
