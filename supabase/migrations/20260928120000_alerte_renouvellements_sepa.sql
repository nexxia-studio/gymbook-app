-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  SURVEILLANCE DES RENOUVELLEMENTS SEPA — la chaîne qui n'a jamais tourné              ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- CE QUI ARRIVE LE 30/09 : les trois premiers prélèvements automatiques (Robin Hendrix
-- 120 €, Sarah Caughey 110 €, Faustin Canei 120 €), puis deux le 01/10 et un le 04/10.
--
-- 🔴 CE QUI N'A JAMAIS TOURNÉ EN PRODUCTION, ET CE QUI A DÉJÀ TOURNÉ — la nuance compte,
-- parce qu'elle dit où regarder. Vérifié sur la base le 28/09 :
--   · SIX renouvellements ont DÉJÀ été encaissés (lignes `payments` « Renouvellement — … »,
--     du 30/08 au 08/09). La branche `recurring` du webhook a donc bien tourné.
--   · MAIS l'avancement de `next_payment_at` et la remise à NULL de `prenotification_sent_at`
--     sont le fait de GYM-334, déployé le 09/09 — soit APRÈS les six. Leur `updated_at` le
--     confirme : la dernière écriture sur ces lignes est celle de la pré-notification
--     (07:35), pas celle d'un renouvellement.
-- Autrement dit : le maillon qui enchaîne une échéance sur la suivante n'a jamais été
-- exécuté une seule fois. Le 30/09 est sa première.
--
-- ET LE CHEMIN D'ÉCHEC non plus : active → past_due (grâce 3 j) → suspended (GYM-252).
-- Écrit, déployé, jamais éprouvé sur un vrai refus de banque.
--
-- ⚠️ MÊME MÉCANIQUE QUE GYM-359, REPRISE ET NON RÉINVENTÉE : détection en SQL, envoi par
-- Edge Function appelée par cron, trace écrite APRÈS l'envoi, une alerte par épisode, et le
-- retour à la normale se dit aussi. Ce fichier ne DÉTECTE et ne MÉMORISE ; il n'envoie rien.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LE SEUIL DU SILENCE, ET POURQUOI 120 HEURES
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 UN PRÉLÈVEMENT SEPA N'EST PAS INSTANTANÉ, et c'est TOUTE la difficulté du point 1.
-- Mollie crée le paiement à l'échéance, mais il ne passe `paid` que plusieurs jours plus
-- tard. Alerter trop tôt, c'est alerter sur chaque échéance normale.
--
-- MESURÉ — pas supposé — sur les SIX renouvellements réels, en interrogeant l'API Mollie
-- (`createdAt` → `paidAt`) :
--
--     méthode        création → payé
--     creditcard          0,0 h      (2 secondes)
--     directdebit        32,7 h
--     directdebit        32,8 h
--     directdebit        35,6 h
--     directdebit        36,6 h
--     directdebit        77,4 h      ← créé un vendredi 19:30, payé le mardi 00:55
--
-- 🔴 LE CAS À 77 HEURES EST LE CAS NORMAL D'UN WEEK-END : SEPA ne compense pas le samedi.
-- C'est lui qui commande le seuil, pas la moyenne.
--
-- ET IL FAUT Y AJOUTER LE DÉLAI DE CRÉATION. `next_payment_at` est une date à 00:00 UTC ;
-- Mollie crée le prélèvement dans la journée — heures observées : 09:30, 10:30, 13:30,
-- 19:30 UTC. Le pire cas NORMAL depuis l'échéance vaut donc ≈ 20 h + 77 h ≈ 98 heures.
--
--   → SEUIL_SILENCE = 120 heures (5 jours). ~22 h de marge sur le pire cas mesuré, et
--     encore 25 jours d'avance sur l'échéance suivante : on ne l'apprend pas « au
--     prélèvement suivant », qui était le risque de l'autre côté.
--
-- ⚠️ CE SEUIL EST TROP LARGE POUR UNE CARTE (0,0 h mesuré) : un renouvellement par carte
-- silencieux sera connu 5 jours plus tard au lieu de 1. C'est assumé — 7 des 8 mandats sont
-- des domiciliations. À revoir le jour où la carte devient courante, avec la mesure en main.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. L'ÉTAT D'UN ABONNEMENT
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Quatre motifs, et un seul objet : dire ce que le silence ne dirait pas.
--
--   no_debit      🔴 l'échéance est passée de plus de 120 h, le statut est toujours `active`
--                 et rien n'est venu l'avancer. C'est LE PIRE CAS : personne ne s'en plaint.
--                 Le membre garde son accès, il n'est pas débité, et la salle ne le sait pas.
--   past_due      un refus de banque : le webhook d'échec est passé.
--   suspended     la grâce de 3 jours s'est écoulée sans régularisation.
--   chain_stalled 🔴 l'argent est rentré, mais la chaîne ne s'est pas enchaînée. Le plus
--                 insidieux : l'échéance SUIVANTE partira sans avis SEPA — défaut de
--                 conformité, et strictement invisible autrement.
--
-- ⚠️ CE QU'ON N'ALERTE PAS, ET IL FAUT LE DIRE AUSSI FORT : un abonnement qui arrive à son
-- TERME et s'arrête n'est pas un incident. `ends_at` atteint → `expired` (par
-- `expire_subscriptions`) ou `completed` : aucun de ces statuts n'entre ici. De même, une
-- ligne sans échéance à venir (`next_payment_at IS NULL`, Mollie a fini de prélever) n'a
-- rien à signaler — c'est le cas de l'abonnement à paiement unique de la base.
CREATE OR REPLACE FUNCTION public.renewal_incident_state(p_subscription_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH s AS (
    SELECT ms.*, 
           -- Le dernier renouvellement ENCAISSÉ de ce membre dans cette salle.
           --
           -- ⚠️ IL N'Y A PAS DE CLÉ ÉTRANGÈRE ENTRE `payments` ET `member_subscriptions` :
           -- le rapprochement se fait sur (membre, salle) et sur le préfixe de libellé
           -- « Renouvellement — » que pose le webhook. C'est fragile et c'est dit : un
           -- membre qui aurait DEUX abonnements dans la même salle verrait ses
           -- renouvellements confondus. Aucun n'est dans ce cas (vérifié le 28/09), et
           -- une colonne `subscription_id` sur `payments` réglerait ça pour de bon — mais
           -- pas dans un lot d'alerte, deux jours avant la première échéance.
           (SELECT max(p.paid_at) FROM public.payments p
             WHERE p.member_id = ms.member_id AND p.gym_id = ms.gym_id
               AND p.status = 'paid' AND p.plan_name LIKE 'Renouvellement%') AS dernier_renouvellement
      FROM public.member_subscriptions ms
     WHERE ms.id = p_subscription_id
  )
  SELECT jsonb_build_object(
    'statut', s.status,
    'membre', (SELECT btrim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.last_name,''))
                 FROM public.profiles pr WHERE pr.id = s.member_id),
    'formule', s.plan_name,
    'montant', s.amount,
    'echeance', s.next_payment_at,
    'terme', s.ends_at,
    'prenotifie_le', s.prenotification_sent_at,
    'echeances_payees', s.payments_count,
    'echeances_prevues', s.max_payments,
    'echecs', s.payment_failed_count,
    'premier_echec', s.payment_failed_at,
    'suspendu_le', s.payment_suspended_at,
    'dernier_renouvellement', s.dernier_renouvellement,
    'retard_heures', CASE WHEN s.next_payment_at IS NULL THEN NULL
                          ELSE round(extract(epoch FROM (now() - s.next_payment_at)) / 3600.0) END,

    -- ── MOTIF 1 — LE PRÉLÈVEMENT QUI N'ARRIVE PAS ────────────────────────────────────
    -- `status = 'active'` est le discriminant : un refus de banque aurait posé `past_due`.
    -- Actif + en retard = ni succès, ni échec connu. C'est un SILENCE de Mollie.
    'no_debit', (
      s.status = 'active'
      AND s.next_payment_at IS NOT NULL
      AND s.next_payment_at < now() - interval '120 hours'
      AND s.mollie_subscription_id IS NOT NULL
      -- Le terme est passé : plus rien n'est attendu, ce n'est pas un incident.
      AND (s.ends_at IS NULL OR s.ends_at > now())
      -- Mollie a fini de prélever : une date restée en place est un affichage périmé,
      -- pas un prélèvement manquant.
      AND (s.max_payments IS NULL OR coalesce(s.payments_count, 0) < s.max_payments)
      AND coalesce(s.auto_renew, true)
    ),

    -- ── MOTIFS 2 ET 3 — LE CHEMIN D'ÉCHEC ────────────────────────────────────────────
    'past_due',  (s.status = 'past_due'),
    'suspended', (s.status = 'suspended'),

    -- ── MOTIF 4 — L'ARGENT RENTRE, LA CHAÎNE NE S'ENCHAÎNE PAS ───────────────────────
    -- Le webhook écrit `payments_count`, `next_payment_at` et `prenotification_sent_at`
    -- dans UNE SEULE mise à jour. Deux invariants en découlent, et chacun se vérifie :
    --
    --   a. l'échéance a AVANCÉ  → `next_payment_at` > le dernier renouvellement encaissé ;
    --   b. l'avis est REPARTI DE ZÉRO → `prenotification_sent_at` est NULL, ou postérieur
    --      au dernier renouvellement.
    --
    -- 🔴 (b) EST LE DÉFAUT DE CONFORMITÉ : un avis marqué « envoyé » pour l'échéance
    -- précédente empêche l'avis de la suivante de partir. Le membre serait débité sans
    -- préavis SEPA, et RIEN d'autre ne le dirait.
    --
    -- ⚠️ UNE HEURE DE GRÂCE. Les deux écritures se suivent dans le même webhook, à
    -- quelques millisecondes ; lire entre les deux donnerait un faux positif. Une heure est
    -- immense devant cet intervalle et dérisoire devant le mois qui suit.
    'chain_stalled', (
      s.dernier_renouvellement IS NOT NULL
      AND s.dernier_renouvellement < now() - interval '1 hour'
      AND s.status IN ('active', 'past_due', 'suspended')
      AND (
        -- (a) l'échéance n'a pas bougé. `next_payment_at IS NULL` est EXCLU : c'est le cas
        -- normal du dernier prélèvement (Mollie a fini).
        (s.next_payment_at IS NOT NULL AND s.next_payment_at <= s.dernier_renouvellement)
        -- (b) l'avis n'est pas reparti de zéro.
        OR (s.prenotification_sent_at IS NOT NULL
            AND s.prenotification_sent_at < s.dernier_renouvellement)
      )
    ),
    'chain_detail', CASE
      WHEN s.dernier_renouvellement IS NULL THEN NULL
      WHEN s.next_payment_at IS NOT NULL AND s.next_payment_at <= s.dernier_renouvellement
        THEN 'echeance_figee'
      WHEN s.prenotification_sent_at IS NOT NULL
           AND s.prenotification_sent_at < s.dernier_renouvellement
        THEN 'avis_non_reinitialise'
      ELSE NULL END
  )
  FROM s;
$function$;

COMMENT ON FUNCTION public.renewal_incident_state(uuid) IS
  'Surveillance SEPA — état d''un abonnement au regard de ses renouvellements. Quatre '
  'motifs : no_debit (échéance dépassée de 120 h, statut toujours actif), past_due, '
  'suspended, chain_stalled (encaissé mais next_payment_at figé ou avis non réinitialisé). '
  'Un abonnement arrivé à son terme n''est jamais un incident.';

REVOKE ALL     ON FUNCTION public.renewal_incident_state(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.renewal_incident_state(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.renewal_incident_state(uuid) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. CE QU'IL Y A À ENVOYER — SANS RIEN ÉCRIRE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 MÊME RÈGLE QU'EN GYM-359, ET POUR LA MÊME RAISON : cette fonction NE MÉMORISE RIEN.
-- Si elle ouvrait la ligne en même temps qu'elle rend le message, un échec Slack laisserait
-- une ligne ouverte pour un message jamais parti — l'alerte serait perdue pour toujours.
-- La trace est posée APRÈS un envoi réussi, par `renewal_alert_mark`.
--
-- ⚠️ L'ÉPISODE EST IDENTIFIÉ PAR (ABONNEMENT, MOTIF), ET NON PAR ABONNEMENT SEUL. Un
-- abonnement qui passe `past_due` puis `suspended` vit DEUX faits distincts, tous deux à
-- dire : un refus de banque, puis la coupure d'accès. Une clé par abonnement aurait tu le
-- second, au motif qu'un épisode était déjà ouvert.
--
-- ⚠️ LA CLÉ D'ÉPISODE EST `mollie_id` = `mollie_subscription_id`. La colonne garde son sens
-- (c'est bien un identifiant Mollie), et `stage` porte le motif. Conséquence assumée : un
-- abonnement SANS identifiant Mollie n'est pas surveillé — il n'est de toute façon pas
-- renouvelé automatiquement (l'abonnement à paiement unique de la base est dans ce cas).
CREATE OR REPLACE FUNCTION public.renewal_alerts_pending()
RETURNS TABLE (
  action text, motif text, gym_id uuid, gym_name text, gym_slug text,
  subscription_id uuid, mollie_subscription_id text, detail jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub    record;
  v_etat   jsonb;
  v_motif  text;
  v_actif  boolean;
  v_ligne  record;
BEGIN
  FOR v_sub IN
    SELECT ms.id, ms.gym_id AS gid, ms.mollie_subscription_id AS msid,
           g.name AS gname, g.slug AS gslug
      FROM public.member_subscriptions ms
      JOIN public.nexxia_gyms g ON g.id = ms.gym_id
     WHERE ms.mollie_subscription_id IS NOT NULL
       AND g.deleted_at IS NULL
  LOOP
    v_etat := public.renewal_incident_state(v_sub.id);

    FOREACH v_motif IN ARRAY ARRAY['no_debit', 'past_due', 'suspended', 'chain_stalled']
    LOOP
      v_actif := coalesce((v_etat ->> v_motif)::boolean, false);

      SELECT wf.id, wf.created_at, wf.detail INTO v_ligne
        FROM public.webhook_failures wf
       WHERE wf.function_name = 'renewal-alerts'
         AND wf.mollie_id = v_sub.msid
         AND wf.stage = v_motif
         AND wf.resolved_at IS NULL
       ORDER BY wf.created_at DESC LIMIT 1;

      IF v_actif THEN
        -- ⚠️ UNE ALERTE PAR ÉPISODE, PAS UNE PAR HEURE. Tant que la ligne est ouverte, on
        -- ne redit rien : une alerte qu'on n'ouvre plus ne vaut rien.
        IF v_ligne.id IS NULL THEN
          action := 'open'; motif := v_motif;
          gym_id := v_sub.gid; gym_name := v_sub.gname; gym_slug := v_sub.gslug;
          subscription_id := v_sub.id; mollie_subscription_id := v_sub.msid;
          detail := v_etat;
          RETURN NEXT;
        END IF;
      ELSIF v_ligne.id IS NOT NULL THEN
        -- 🔴 LE RETOUR À LA NORMALE SE DIT AUSSI. Sans lui, personne ne saurait jamais si
        -- c'est réparé — et un `past_due` qui devient `suspended` se lirait comme deux
        -- incidents sans lien, au lieu d'une escalade.
        action := 'resolved'; motif := v_motif;
        gym_id := v_sub.gid; gym_name := v_sub.gname; gym_slug := v_sub.gslug;
        subscription_id := v_sub.id; mollie_subscription_id := v_sub.msid;
        detail := v_etat || jsonb_build_object(
          'ouverte_depuis', v_ligne.created_at,
          'duree_heures', round(extract(epoch FROM (now() - v_ligne.created_at)) / 3600.0));
        RETURN NEXT;
      END IF;
      -- Rien à dire : le silence est le cas nominal.
    END LOOP;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.renewal_alerts_pending() IS
  'Surveillance SEPA — ce qu''il y a à dire sur Slack : ''open'' à l''entrée d''un motif, '
  '''resolved'' à sa disparition, rien sinon. Un épisode = (abonnement, motif). N''ÉCRIT '
  'RIEN : la trace est posée après un envoi réussi, par renewal_alert_mark.';

REVOKE ALL     ON FUNCTION public.renewal_alerts_pending() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.renewal_alerts_pending() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.renewal_alerts_pending() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 4. LA TRACE, POSÉE APRÈS L'ENVOI
-- ═════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.renewal_alert_mark(
  p_mollie_subscription_id text,
  p_motif text,
  p_action text,
  p_gym_id uuid DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_action = 'open' THEN
    -- ⚠️ `WHERE NOT EXISTS` : deux passages concurrents du cron n'ouvrent pas deux lignes.
    INSERT INTO public.webhook_failures (function_name, stage, mollie_id, gym_id, detail)
    SELECT 'renewal-alerts', p_motif, p_mollie_subscription_id, p_gym_id, p_detail
     WHERE NOT EXISTS (
       SELECT 1 FROM public.webhook_failures wf
        WHERE wf.function_name = 'renewal-alerts'
          AND wf.mollie_id = p_mollie_subscription_id
          AND wf.stage = p_motif
          AND wf.resolved_at IS NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF p_action = 'resolved' THEN
    UPDATE public.webhook_failures
       SET resolved_at = now(),
           detail = detail || jsonb_build_object('resolution', p_detail)
     WHERE function_name = 'renewal-alerts'
       AND mollie_id = p_mollie_subscription_id
       AND stage = p_motif
       AND resolved_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  RETURN v_n > 0;
END;
$function$;

COMMENT ON FUNCTION public.renewal_alert_mark(text, text, text, uuid, jsonb) IS
  'Surveillance SEPA — ouvre ou referme la ligne d''épisode (abonnement, motif) dans '
  'webhook_failures. Appelée APRÈS un envoi Slack réussi : une trace posée avant perdrait '
  'l''alerte si Slack échouait.';

REVOKE ALL     ON FUNCTION public.renewal_alert_mark(text, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.renewal_alert_mark(text, text, text, uuid, jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.renewal_alert_mark(text, text, text, uuid, jsonb) TO service_role;

CREATE INDEX IF NOT EXISTS idx_webhook_failures_renouvellements_ouverts
  ON public.webhook_failures (mollie_id, stage)
  WHERE function_name = 'renewal-alerts' AND resolved_at IS NULL;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 5. LA TÂCHE — À POSER PAR LE COCKPIT, PAS PAR CE FICHIER
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ NE PAS EXÉCUTER CETTE SECTION DEPUIS LE DÉPÔT : `send-renewal-alerts` exige le secret
-- interne dans son en-tête. Convention GYM-116 / GYM-252 / GYM-250 / GYM-359 — clonage d'un
-- job existant, le secret reste lu dans le vault.
--
--   send-renewal-alerts — toutes les heures à :20
--
-- HORAIRE. Relevé des jobs de production le 28/09 : :00 (cleanup-oauth-states), :05
-- (expire-subscriptions), :10 (send-payment-alerts), :25 (send-subscription-reminders),
-- :35 (send-sepa-prenotifications), :40 (close-expired-trials), :50 (member-gyms-drift),
-- :55 (send-trial-reminders), plus la grille des quarts (*/15 → :15 :30 :45) et des demies
-- (*/30). **:20 est la seule minute de l'heure qui ne soit prise par aucun job nommé.**
--
-- ⚠️ ET SA PLACE EST BONNE, pas seulement libre : dix minutes après `send-payment-alerts`
-- (les deux émetteurs Slack ne postent jamais dans la même minute), quinze minutes après
-- `expire-subscriptions` (un abonnement arrivé à terme est déjà `expired` quand on le lit,
-- donc jamais pris pour un incident), et quinze minutes AVANT `send-sepa-prenotifications`
-- (on observe l'état des avis avant qu'il ne bouge, pas pendant).
--
-- ⚠️ TOUTES LES HEURES, ET PAS PLUS SOUVENT. Les seuils se comptent en jours ; ce qui
-- justifie l'heure, ce sont les motifs 2 et 3, qui suivent l'arrivée d'un webhook d'échec
-- et peuvent tomber à n'importe quel moment.
--
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-renewal-alerts') THEN
--       PERFORM cron.unschedule('send-renewal-alerts');
--     END IF;
--   END
--   $$;
--   SELECT cron.schedule('send-renewal-alerts', '20 * * * *', $job$
--     SELECT net.http_post(
--       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-renewal-alerts',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'X-Internal-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
--                                WHERE name = 'internal_functions_secret')
--       ),
--       body := '{}'::jsonb
--     );
--   $job$);

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 6. CONTRÔLE D'APPLICATION
-- ═════════════════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_sub uuid;
  v_etat jsonb;
  v_n integer;
BEGIN
  IF to_regprocedure('public.renewal_incident_state(uuid)') IS NULL
     OR to_regprocedure('public.renewal_alerts_pending()') IS NULL
     OR to_regprocedure('public.renewal_alert_mark(text,text,text,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Surveillance SEPA : une des trois fonctions manque';
  END IF;

  -- Elles RÉPONDENT, sur un vrai abonnement — on ne se contente pas de leur existence.
  SELECT id INTO v_sub FROM public.member_subscriptions
   WHERE mollie_subscription_id IS NOT NULL ORDER BY created_at LIMIT 1;
  IF v_sub IS NOT NULL THEN
    v_etat := public.renewal_incident_state(v_sub);
    IF v_etat ->> 'no_debit' IS NULL OR v_etat ->> 'past_due' IS NULL
       OR v_etat ->> 'suspended' IS NULL OR v_etat ->> 'chain_stalled' IS NULL THEN
      RAISE EXCEPTION 'Surveillance SEPA : renewal_incident_state ne rend pas ses quatre motifs';
    END IF;
  END IF;

  SELECT count(*) INTO v_n FROM public.renewal_alerts_pending();
  RAISE NOTICE 'Surveillance SEPA posée. À signaler à l''instant : % alerte(s). L''envoi est le fait de send-renewal-alerts.', v_n;
END
$verif$;
