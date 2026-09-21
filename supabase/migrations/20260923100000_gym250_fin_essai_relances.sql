-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-250 (PR 2) — LA FIN D'ESSAI, ET CE QU'ON EN DIT AU GÉRANT                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CETTE MIGRATION N'ALLUME PAS L'ESSAI. `v_trial_enabled` reste `false` ici ; l'allumage
-- est `20260923110000_gym250_allumage.sql`, appliqué EN DERNIER par le cockpit, après le
-- banc. Un contrôle en fin de fichier refuse de s'appliquer si la constante a déjà bougé.
--
-- ⚠️ LA SECTION CRON N'EST PAS EXÉCUTÉE PAR CE FICHIER (cf. § 6). Même convention que
-- GYM-116 et GYM-252 : c'est le cockpit qui pose les jobs, par CLONAGE d'un job existant,
-- pour que le secret interne ne transite jamais en clair dans un fichier du dépôt.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- L'EXTINCTION EST TEMPORELLE, ET RIEN ICI NE LA PRODUIT
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Le hook de `get_effective_plan_core` exige `trial_ends_at > now()`. Passée la date, le
-- plan d'essai cesse d'être servi SANS QUE RIEN NE S'EXÉCUTE. Aucun cron n'est nécessaire
-- pour COUPER.
--
-- Ce fichier ne fait donc que deux choses : corriger l'ÉTAT AFFICHÉ (une salle ne peut pas
-- rester `trialing` pour toujours), et PRÉVENIR le gérant — ce que personne ne faisait.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LES TROIS COLONNES DE SUIVI
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Motif GYM-116 (`reminder_14d_sent_at` / `reminder_3d_sent_at` sur member_subscriptions),
-- repris à la lettre : UNE COLONNE PAR JALON, et non un seul `reminder_sent_at`. Un jalon
-- franchi ne doit pas empêcher les autres de partir — avec une colonne unique, le J-0 ne
-- partirait jamais pour une salle ayant reçu son J-3.
ALTER TABLE public.nexxia_gyms
  ADD COLUMN IF NOT EXISTS trial_reminder_j3_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_reminder_j0_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_reminder_j7_sent_at timestamptz;

COMMENT ON COLUMN public.nexxia_gyms.trial_reminder_j3_sent_at IS
  'GYM-250 — instant d''envoi de la relance J-3 avant trial_ends_at. NULL = jamais envoyée. '
  'Remise à NULL par cockpit_set_trial_end : un essai prolongé est un NOUVEL essai.';
COMMENT ON COLUMN public.nexxia_gyms.trial_reminder_j0_sent_at IS
  'GYM-250 — instant d''envoi de la relance du JOUR de fin d''essai (celle qui nomme '
  'l''extinction). NULL = jamais envoyée.';
COMMENT ON COLUMN public.nexxia_gyms.trial_reminder_j7_sent_at IS
  'GYM-250 — instant d''envoi de la relance J+7. NULL = jamais envoyée. Après elle, plus '
  'rien : une salle qui n''a pas répondu à trois courriers n''en attend pas un quatrième.';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. LA PURGE DES DATES HÉRITÉES — et pourquoi elle est sûre EXACTEMENT MAINTENANT
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Les prérequis (PR #305) ont retiré le `DEFAULT (now() + 14 days)` de `trial_ends_at`.
-- Restent les dates POSÉES PAR CE DÉFAUT avant son retrait : 0 salle en production (elle
-- était propre), 3 sur 3 en staging — dont une encore dans le futur.
--
-- 🔴 L'ARGUMENT DE SÛRETÉ, ET IL NE TIENT QUE DANS CETTE MIGRATION-CI : les trois colonnes
-- de suivi viennent d'être créées, donc AUCUNE relance n'est jamais partie, donc AUCUN
-- essai n'a jamais réellement couru — la constante n'a jamais été allumée. Toute
-- `trial_ends_at` existante est donc, par construction, un héritage du DEFAUT. Rejouée
-- plus tard, cette purge effacerait de l'histoire vraie ; jouée ici, elle n'efface que du
-- bruit.
--
-- ⚠️ ON ÉPARGNE LES SALLES `trialing`. Aucune n'existe aujourd'hui (0 en prod, 0 en
-- staging), mais si le cockpit en avait posé une entre-temps, ce serait une DÉCISION
-- humaine — elle ne s'efface pas en passant.
--
-- ⚠️ APRÈS CETTE MIGRATION, L'INVARIANT EST : « trial_ends_at NON NULLE = cette salle a,
-- ou a eu, un essai ». C'est lui qui autorise le balayage du § 4 à ne PAS filtrer sur
-- `status` — indispensable, puisque le J-0 et le J+7 partent APRÈS que § 3 a remis la
-- salle en `active`.
DO $purge$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.nexxia_gyms
     SET trial_ends_at = NULL, updated_at = now()
   WHERE trial_ends_at IS NOT NULL
     AND status IS DISTINCT FROM 'trialing';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'GYM-250 purge : % date(s) d''essai héritée(s) effacée(s).', v_n;
END
$purge$;

-- L'index partiel ne couvre que les salles susceptibles d'être relancées. La flotte est
-- minuscule aujourd'hui ; il est posé pour que le balayage horaire reste constant quand
-- elle ne le sera plus.
CREATE INDEX IF NOT EXISTS idx_nexxia_gyms_relances_essai
  ON public.nexxia_gyms (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL
    AND deleted_at IS NULL
    AND (trial_reminder_j3_sent_at IS NULL
      OR trial_reminder_j0_sent_at IS NULL
      OR trial_reminder_j7_sent_at IS NULL);

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. LA CLÔTURE DE L'ÉTAT AFFICHÉ
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ ELLE NE COUPE RIEN, et c'est la phrase à retenir. Le droit est déjà tombé à la
-- seconde où `trial_ends_at` est passée — cette fonction ne fait que cesser d'afficher
-- « en essai » une salle qui ne l'est plus.
--
-- 🔴 ELLE N'EFFACE PAS `trial_ends_at`. La date reste : c'est elle qui permet au J-0 et au
-- J+7 de partir APRÈS la clôture, et c'est la seule trace qu'un essai a eu lieu.
--
-- ⚠️ UNE SALLE `trialing` SANS DATE N'EST PAS TOUCHÉE. C'est un état incohérent, mais il
-- peut être TRANSITOIRE et légitime : le cockpit pose le statut, puis la date, en deux
-- gestes. Clôturer entre les deux défaireait le travail d'Antoine dans l'heure. Le lot 1
-- affiche déjà ce désaccord dans la liste des salles ; c'est là qu'il se corrige.
CREATE OR REPLACE FUNCTION public.close_expired_trials()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gym record;
  v_n   integer := 0;
BEGIN
  FOR v_gym IN
    SELECT id, name, trial_ends_at
      FROM public.nexxia_gyms
     WHERE status = 'trialing'
       AND trial_ends_at IS NOT NULL
       AND trial_ends_at <= now()
       AND deleted_at IS NULL
     FOR UPDATE
  LOOP
    UPDATE public.nexxia_gyms
       SET status = 'active', updated_at = now()
     WHERE id = v_gym.id;

    -- 🔴 JOURNALISÉ COMME UN GESTE DU COCKPIT, dans la MÊME table et la même transaction.
    -- Le lot 2 a rendu `audit_logs` en ajout seul, y compris pour le propriétaire : une
    -- ligne écrite ici ne peut plus être réécrite. `actor_id` NULL = la plateforme, pas un
    -- humain — c'est ce qui distingue cette clôture d'un `cockpit_set_status` manuel.
    INSERT INTO public.audit_logs (gym_id, actor_id, action, resource, resource_id, old_data, new_data)
    VALUES (
      v_gym.id, NULL, 'trial_closed', 'nexxia_gyms', v_gym.id,
      jsonb_build_object('status', 'trialing', 'trial_ends_at', v_gym.trial_ends_at),
      jsonb_build_object('status', 'active', 'reason', 'essai arrivé à son terme (automatique)')
    );

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$function$;

COMMENT ON FUNCTION public.close_expired_trials() IS
  'GYM-250 — remet en ''active'' les salles dont l''essai est arrivé à terme. NE COUPE '
  'AUCUN DROIT (l''extinction est temporelle, portée par le hook de get_effective_plan_core) '
  'et n''efface PAS trial_ends_at. Journalise chaque clôture dans audit_logs, actor_id NULL.';

REVOKE ALL     ON FUNCTION public.close_expired_trials() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_expired_trials() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.close_expired_trials() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 4. LE BALAYAGE DES RELANCES
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Motif `get_pending_subscription_reminders()` (GYM-116) : plpgsql/sql, SECURITY DEFINER,
-- `search_path` figé, UNE LIGNE PAR ENVOI À FAIRE, avec tout ce dont l'Edge Function a
-- besoin — elle ne doit refaire aucune requête par destinataire.
--
-- 🔴 UNE LIGNE PAR GÉRANT, UN JALON PAR SALLE. Dopamine a TROIS `gym_admin` : le courrier
-- part aux trois, mais le jalon est marqué UNE fois, pour la salle. C'est ce que demande
-- l'invariant « chaque relance part une fois par salle » — et c'est pour ça que le
-- marquage n'est pas dans cette fonction mais dans celle du § 5, appelée une fois par
-- groupe.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 CALENDRIER LOCAL DE LA SALLE, JAMAIS UNE DURÉE — LE PIÈGE DU 25/10
-- ─────────────────────────────────────────────────────────────────────────────────────
-- « Trois jours avant » est une distance de CALENDRIER. `trial_ends_at - INTERVAL '3 days'`
-- compte 3 × 86 400 secondes : la nuit du passage à l'heure d'hiver, cela dérive d'une
-- heure — assez pour faire changer de JOUR une relance calculée près de minuit. On
-- soustrait donc deux DATES LOCALES. Même geste qu'à GYM-93, GYM-116 et GYM-319.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LES BORNES, ET POURQUOI ELLES SONT LARGES
-- ─────────────────────────────────────────────────────────────────────────────────────
--   J-3  : jours ENTRE 1 ET 3   — borne basse à 1, pour ne jamais se superposer au J-0.
--   J-0  : jours ENTRE -2 ET 0  — le jour même, plus deux jours de RATTRAPAGE. Un cron
--          manqué (panne, migration, déploiement) ne doit pas perdre le courrier qui
--          NOMME l'extinction : c'est le plus important des trois.
--   J+7  : jours ENTRE -14 ET -7 — l'écart avec la borne du J-0 (-2) garantit qu'une
--          salle ne reçoit jamais deux courriers le même jour.
--
-- ⚠️ 9 H LOCALE. L'heure n'est pas décidée par le cron — il passe toutes les heures et ne
-- reçoit de lignes qu'à 9 h chez la salle. Une salle dans un autre fuseau est servie
-- correctement sans qu'une ligne change ici.
CREATE OR REPLACE FUNCTION public.get_pending_trial_reminders()
RETURNS TABLE (
  gym_id             uuid,
  gym_name           text,
  gym_slug           text,
  admin_id           uuid,
  admin_email        text,
  admin_first_name   text,
  langue             text,
  trial_ends_at      timestamptz,
  days_remaining     integer,
  stage              text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH candidats AS (
    SELECT
      g.id   AS gym_id,
      g.name AS gym_name,
      g.slug AS gym_slug,
      g.trial_ends_at,
      g.trial_reminder_j3_sent_at,
      g.trial_reminder_j0_sent_at,
      g.trial_reminder_j7_sent_at,
      p.id         AS admin_id,
      p.email      AS admin_email,
      p.first_name AS admin_first_name,
      -- 🔴 LA LANGUE DU GÉRANT D'ABORD, celle de la SALLE ensuite, `fr` en dernier
      -- recours. Un gérant néerlandophone d'une salle configurée en français reçoit son
      -- courrier dans SA langue : c'est à lui que la plateforme écrit, pas à sa salle.
      COALESCE(NULLIF(btrim(p.preferred_language), ''),
               NULLIF(btrim(g.default_language), ''),
               'fr') AS langue,
      ((g.trial_ends_at AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels'))::date
       - (NOW()         AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels'))::date) AS jours,
      EXTRACT(HOUR FROM NOW() AT TIME ZONE COALESCE(g.timezone, 'Europe/Brussels'))::int AS heure_locale
    FROM public.nexxia_gyms g
    JOIN public.profiles    p ON p.gym_id = g.id
    WHERE g.deleted_at IS NULL
      -- L'invariant du § 2 : une date NON NULLE veut dire « cette salle a, ou a eu, un
      -- essai ». Aucun filtre sur `status` — le J-0 et le J+7 partent après la clôture.
      AND g.trial_ends_at IS NOT NULL
      -- ⚠️ LE GÉRANT, ET LUI SEUL. Un coach n'a pas à recevoir un courrier commercial sur
      -- l'abonnement de la salle ; un membre encore moins.
      AND p.role = 'gym_admin'
      AND p.deleted_at IS NULL
      AND p.email IS NOT NULL
  )
  SELECT gym_id, gym_name, gym_slug, admin_id, admin_email, admin_first_name, langue,
         trial_ends_at, jours, 'j3'::text
    FROM candidats
   WHERE trial_reminder_j3_sent_at IS NULL AND jours BETWEEN 1 AND 3 AND heure_locale = 9

  UNION ALL

  SELECT gym_id, gym_name, gym_slug, admin_id, admin_email, admin_first_name, langue,
         trial_ends_at, jours, 'j0'::text
    FROM candidats
   WHERE trial_reminder_j0_sent_at IS NULL AND jours BETWEEN -2 AND 0 AND heure_locale = 9

  UNION ALL

  SELECT gym_id, gym_name, gym_slug, admin_id, admin_email, admin_first_name, langue,
         trial_ends_at, jours, 'j7'::text
    FROM candidats
   WHERE trial_reminder_j7_sent_at IS NULL AND jours BETWEEN -14 AND -7 AND heure_locale = 9;
$function$;

COMMENT ON FUNCTION public.get_pending_trial_reminders() IS
  'GYM-250 — relances d''essai à envoyer : une ligne PAR GÉRANT, un jalon par salle. '
  'Jours comptés en dates LOCALES de la salle (piège DST). Ne rend des lignes qu''à 9 h '
  'locale. Aucun filtre sur status : le J-0 et le J+7 partent après close_expired_trials().';

REVOKE ALL     ON FUNCTION public.get_pending_trial_reminders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_pending_trial_reminders() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_pending_trial_reminders() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 5. LE MARQUAGE — une fois par salle, et c'est lui qui porte l'invariant
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Pendant de `mark_subscription_reminder_sent` (GYM-116). Un jalon inconnu n'écrit rien
-- plutôt que d'échouer : le cron traite un lot, une valeur inattendue ne doit pas
-- interrompre les envois des autres salles.
--
-- ⚠️ `IS NULL` DANS LE `WHERE` — ce n'est pas décoratif. Deux exécutions concurrentes du
-- cron (rattrapage, relance manuelle) ne doivent pas repousser l'horodatage : la PREMIÈRE
-- écriture gagne, les suivantes ne touchent aucune ligne. C'est ce qui rend l'invariant
-- « une fois par salle » vrai même en cas de recouvrement.
CREATE OR REPLACE FUNCTION public.mark_trial_reminder_sent(p_gym_id uuid, p_stage text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer := 0;
BEGIN
  IF p_stage = 'j3' THEN
    UPDATE public.nexxia_gyms SET trial_reminder_j3_sent_at = now(), updated_at = now()
     WHERE id = p_gym_id AND trial_reminder_j3_sent_at IS NULL;
  ELSIF p_stage = 'j0' THEN
    UPDATE public.nexxia_gyms SET trial_reminder_j0_sent_at = now(), updated_at = now()
     WHERE id = p_gym_id AND trial_reminder_j0_sent_at IS NULL;
  ELSIF p_stage = 'j7' THEN
    UPDATE public.nexxia_gyms SET trial_reminder_j7_sent_at = now(), updated_at = now()
     WHERE id = p_gym_id AND trial_reminder_j7_sent_at IS NULL;
  ELSE
    RETURN false;
  END IF;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$function$;

COMMENT ON FUNCTION public.mark_trial_reminder_sent(uuid, text) IS
  'GYM-250 — marque un jalon de relance comme envoyé, UNE SEULE FOIS (le WHERE ... IS NULL '
  'rend l''appel idempotent). Rend true si c''est cet appel qui a posé la marque.';

REVOKE ALL     ON FUNCTION public.mark_trial_reminder_sent(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_trial_reminder_sent(uuid, text) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_trial_reminder_sent(uuid, text) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 6. PROLONGER UN ESSAI REMET LES TROIS COMPTEURS À ZÉRO
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 SANS CECI, LE LOT 2 CASSERAIT LES RELANCES. `cockpit_set_trial_end` sait prolonger un
-- essai ; si les marques restaient, une salle prolongée d'un mois ne recevrait PLUS JAMAIS
-- de J-3 ni de J-0 — elle s'éteindrait en silence, exactement le défaut que ce lot corrige.
--
-- ⚠️ UN ESSAI PROLONGÉ EST UN NOUVEL ESSAI. La remise à zéro est donc inconditionnelle,
-- y compris quand la date est RACCOURCIE ou mise à NULL : dans tous les cas le calendrier
-- des relances change, et les marques d'un calendrier périmé ne veulent plus rien dire.
--
-- Corps repris à l'identique du lot 2 (migration 20260921140000), SEUL l'UPDATE change.
CREATE OR REPLACE FUNCTION public.cockpit_set_trial_end(
  p_gym_id        uuid,
  p_trial_ends_at timestamptz,
  p_reason        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_avant timestamptz;
  v_nom   text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: réservé au super-administrateur' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: un motif est obligatoire' USING ERRCODE = '22023';
  END IF;

  IF p_trial_ends_at IS NOT NULL AND p_trial_ends_at > now() + interval '1 year' THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: au-delà d''un an, c''est un plan, pas un essai'
      USING ERRCODE = '22023';
  END IF;

  SELECT g.trial_ends_at, g.name INTO v_avant, v_nom
    FROM public.nexxia_gyms g WHERE g.id = p_gym_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: salle introuvable (%)', p_gym_id USING ERRCODE = 'P0002';
  END IF;

  IF v_avant IS NOT DISTINCT FROM p_trial_ends_at THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: la date d''essai est déjà celle-là' USING ERRCODE = '23505';
  END IF;

  UPDATE public.nexxia_gyms
     SET trial_ends_at             = p_trial_ends_at,
         trial_reminder_j3_sent_at = NULL,
         trial_reminder_j0_sent_at = NULL,
         trial_reminder_j7_sent_at = NULL,
         updated_at                = now()
   WHERE id = p_gym_id;

  INSERT INTO public.audit_logs (gym_id, actor_id, action, resource, resource_id, old_data, new_data)
  VALUES (
    p_gym_id, auth.uid(), 'cockpit_set_trial_end', 'nexxia_gyms', p_gym_id,
    jsonb_build_object('trial_ends_at', v_avant),
    jsonb_build_object('trial_ends_at', p_trial_ends_at, 'reason', btrim(p_reason),
                       'relances_remises_a_zero', true)
  );

  RETURN jsonb_build_object('gym_id', p_gym_id, 'name', v_nom, 'essai_avant', v_avant, 'essai_apres', p_trial_ends_at);
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 7. LES DEUX TÂCHES — À POSER PAR LE COCKPIT, PAS PAR CE FICHIER
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ NE PAS EXÉCUTER CETTE SECTION DEPUIS LE DÉPÔT. `send-trial-reminders` exige le secret
-- interne dans son en-tête : l'écrire ici le mettrait en clair dans git. Le cockpit pose
-- les jobs par CLONAGE d'un job existant, en reprenant sa lecture du vault.
--
--   ① close-expired-trials      — toutes les heures à :40   SELECT public.close_expired_trials()
--        SQL pur, aucun secret. Peut être posé directement.
--
--   ② send-trial-reminders      — toutes les heures à :55   Edge Function
--        Toutes les heures parce que l'heure d'envoi est décidée en SQL, sur l'horloge de
--        la salle (9 h locale) — le cron ne fait que proposer des occasions.
--
-- HORAIRES CHOISIS POUR NE DISPUTER AUCUNE MINUTE aux dix jobs existants, relevés en
-- production le 21/09 : :00 (cleanup-oauth), :05 (expire-subscriptions), :25
-- (send-subscription-reminders), :35 (send-sepa-prenotifications), :50 (member-gyms-drift),
-- la grille des quarts (send-booking-reminders, */15) et les demies (process-no-shows,
-- */30). :40 et :55 sont libres.
--
-- ⚠️ ① AVANT ② DANS L'HEURE, et ce n'est pas indifférent : la clôture passe à :40, la
-- relance à :55. Le gérant qui reçoit son J-0 à 9 h voit donc une salle déjà remise en
-- `active` — pas une salle « en essai » qui lui annonce la fin de son essai.
--
-- ① — posable tel quel :
--
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-expired-trials') THEN
--       PERFORM cron.unschedule('close-expired-trials');
--     END IF;
--   END
--   $$;
--   SELECT cron.schedule('close-expired-trials', '40 * * * *',
--                        $$SELECT public.close_expired_trials()$$);
--
-- ② — À CLONER depuis un job existant (send-subscription-reminders), en ne changeant que
--     le nom, l'horaire et le chemin de la fonction. Le secret reste lu dans le vault,
--     jamais recopié :
--
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-trial-reminders') THEN
--       PERFORM cron.unschedule('send-trial-reminders');
--     END IF;
--   END
--   $$;
--   SELECT cron.schedule('send-trial-reminders', '55 * * * *', $job$
--     SELECT net.http_post(
--       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-trial-reminders',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'X-Internal-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets
--                                WHERE name = 'internal_functions_secret')
--       ),
--       body := '{}'::jsonb
--     );
--   $job$);

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 8. CONTRÔLE D'APPLICATION
-- ═════════════════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_src     text;
  v_cols    integer;
  v_heritee integer;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='nexxia_gyms'
     AND column_name IN ('trial_reminder_j3_sent_at','trial_reminder_j0_sent_at','trial_reminder_j7_sent_at');
  IF v_cols <> 3 THEN
    RAISE EXCEPTION 'GYM-250 : % colonne(s) de suivi sur 3', v_cols;
  END IF;

  SELECT count(*) INTO v_heritee FROM public.nexxia_gyms
   WHERE trial_ends_at IS NOT NULL AND status IS DISTINCT FROM 'trialing';
  IF v_heritee <> 0 THEN
    RAISE EXCEPTION 'GYM-250 : % date(s) héritée(s) ont survécu à la purge', v_heritee;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='cockpit_set_trial_end';
  IF v_src NOT LIKE '%trial_reminder_j3_sent_at = NULL%' THEN
    RAISE EXCEPTION 'GYM-250 : cockpit_set_trial_end ne remet pas les relances à zéro';
  END IF;

  -- ⚠️ CEINTURE : cette migration N'ALLUME PAS l'essai.
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_effective_plan_core';
  IF v_src NOT LIKE '%v_trial_enabled CONSTANT boolean := false%' THEN
    RAISE EXCEPTION 'GYM-250 : v_trial_enabled n''est plus false — l''allumage est la migration suivante';
  END IF;

  RAISE NOTICE 'GYM-250 fin d''essai : colonnes posées, purge faite, relances prêtes, constante toujours éteinte.';
END
$verif$;
