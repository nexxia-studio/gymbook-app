-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-359 — QUAND UNE SALLE N'ARRIVE PLUS À ENCAISSER, ON L'APPREND                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- L'INCIDENT. Du 17 au 23/09, six membres de Dopamine ont tenté 19 achats : tous ont échoué.
-- UN SEUL l'a signalé. Antoine l'a découvert six jours plus tard, en lisant la base à la
-- main. ~680 € en attente.
--
-- 🔴 LE COCKPIT PERMET DE CHERCHER. IL NE PRÉVIENT PAS. C'est tout l'objet de ce lot — et
-- c'est une différence de nature, pas de degré : un tableau de bord répond à qui l'ouvre,
-- une alerte va chercher celui qui ne l'a pas ouvert.
--
-- ⚠️ CE FICHIER N'ENVOIE RIEN. Il DÉTECTE et il MÉMORISE ; l'envoi est le fait de
-- `send-payment-alerts`, appelée par cron. La séparation n'est pas cosmétique : elle permet
-- de n'écrire la trace qu'APRÈS un envoi réussi (voir § 3).

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LES SEUILS, ET POURQUOI CEUX-LÀ
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ UN PAIEMENT `expired` EST NORMAL ISOLÉMENT : un membre ouvre la page Mollie, renonce,
-- et Mollie expire le paiement au bout de 15 à 60 minutes (mesuré sur les 38 expirations de
-- septembre : 16 min au plus court, 60 au plus long, 20 en moyenne). Ce n'est pas un
-- incident, c'est un client qui hésite. Le signal n'est donc PAS l'échec — c'est la
-- RÉPÉTITION doublée de l'ABSENCE de succès.
--
-- DEUX RÈGLES, sur une fenêtre de 24 h, et il suffit de l'une :
--
--   A — LE MEMBRE : un même membre ≥ 2 échecs et AUCUN succès.
--       C'est la règle qui attrape un défaut qui ne frappe qu'un chemin d'achat. Le 23/09,
--       la salle vendait encore (une séance à 20 € passée à 6 h 54) pendant que neuf achats
--       échouaient : la règle B, seule, serait restée muette toute la journée.
--
--   B — LA SALLE : ≥ 3 échecs et AUCUN succès.
--       Celle-ci attrape la panne globale, même si chaque membre n'essaie qu'une fois.
--
-- SIMULÉES SUR LES DONNÉES RÉELLES DE SEPTEMBRE (90 paiements, 52 payés / 38 expirés),
-- heure par heure comme le fera le cron — 5 épisodes en 23 jours :
--
--   ① 03→05/09  · Antoine Baczynski, 3 tentatives, JAMAIS payé (jusqu'à 120 €)
--                 et Romu, 2 échecs puis un paiement le lendemain.        → règle A
--   ② 17→18/09  · 3 échecs, 0 succès                                       → règle B
--   ③ 19→20/09  · un membre, 2 échecs                                      → règle A
--   ④ 21→22/09  · les deux règles                                          → A et B
--   ⑤ 22→23/09  · pic à 15 échecs, 4 membres bloqués                       → A et B
--
-- ⚠️ ZÉRO ALERTE du 01 au 02/09, malgré CINQ échecs le 02 : il y a eu huit paiements le
-- même jour. C'est exactement ce que « sans aucun succès » doit écarter.
--
-- ⚠️ ET L'ÉPISODE ① N'EST PAS UN FAUX POSITIF, vérifié ligne à ligne : Antoine Baczynski a
-- tenté trois fois (15 €, 120 €, 15 €) sans jamais aboutir. C'est une vente perdue que
-- personne n'a vue passer — précisément ce qu'on cherche.
--
-- ⚠️ LA RÈGLE B SEULE aurait donné 3 épisodes et manqué le 23/09 en entier. C'est la
-- mesure qui a fait garder la règle A, pas une préférence.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. L'ÉTAT D'UNE SALLE, SUR 24 H
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ `pending` N'EST PAS UN ÉCHEC : le paiement est en vol. Un membre qui vient de cliquer
-- n'a encore rien raté. C'est aussi ce qui donne à l'alerte son délai incompressible — un
-- achat abandonné ne devient `expired` qu'au bout de 15 à 60 minutes.
CREATE OR REPLACE FUNCTION public.payment_incident_state(p_gym_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH fenetre AS (
    SELECT p.*, (p.status = 'paid') AS reussi,
           (p.status NOT IN ('paid', 'pending')) AS rate
      FROM public.payments p
     WHERE p.gym_id = p_gym_id
       AND p.created_at > now() - interval '24 hours'
  ),
  par_membre AS (
    SELECT member_id,
           count(*) FILTER (WHERE rate)   AS echecs,
           count(*) FILTER (WHERE reussi) AS succes
      FROM fenetre GROUP BY member_id
  ),
  totaux AS (
    SELECT count(*) FILTER (WHERE rate)   AS echecs,
           count(*) FILTER (WHERE reussi) AS succes,
           -- ⚠️ LE MONTANT EN JEU N'EST PAS LA SOMME DES TENTATIVES, et la nuance compte :
           -- Pierre a tenté QUATRE FOIS la même formule à 90 €. Additionner les tentatives
           -- annoncerait 360 € là où la salle risque d'en perdre 90. On somme donc, par
           -- membre, une seule fois chaque FORMULE distincte ratée — ce qu'ils essayaient
           -- réellement d'acheter. Mesuré sur l'incident en cours : 585 € au lieu de 1 555 €.
           coalesce((SELECT sum(x.montant) FROM (
             SELECT DISTINCT member_id, plan_id, amount AS montant
               FROM fenetre WHERE rate) x), 0) AS montant,
           min(created_at) FILTER (WHERE rate) AS premiere,
           max(created_at) FILTER (WHERE rate) AS derniere
      FROM fenetre
  )
  SELECT jsonb_build_object(
    'echecs',   t.echecs,
    'succes',   t.succes,
    'montant',  t.montant,
    'premiere', t.premiere,
    'derniere', t.derniere,
    -- Règle A : au moins un membre à ≥ 2 échecs et 0 succès.
    'membres_bloques', (SELECT count(*) FROM par_membre WHERE echecs >= 2 AND succes = 0),
    'regle_a', EXISTS (SELECT 1 FROM par_membre WHERE echecs >= 2 AND succes = 0),
    'regle_b', (t.echecs >= 3 AND t.succes = 0),
    'membres', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'nom', btrim(coalesce(pr.first_name, '') || ' ' || coalesce(pr.last_name, '')),
               'tentatives', m.echecs,
               'montant', m.montant)
             ORDER BY m.echecs DESC, m.montant DESC)
        FROM (SELECT f.member_id,
                     count(*) FILTER (WHERE f.rate) AS echecs,
                     -- Même règle par membre : une formule ratée dix fois reste une vente.
                     coalesce((SELECT sum(y.amount) FROM (
                       SELECT DISTINCT g2.plan_id, g2.amount FROM fenetre g2
                        WHERE g2.rate AND g2.member_id = f.member_id) y), 0) AS montant,
                     count(*) FILTER (WHERE f.reussi) AS succes
                FROM fenetre f GROUP BY f.member_id) m
        JOIN public.profiles pr ON pr.id = m.member_id
       WHERE m.echecs > 0), '[]'::jsonb),
    -- ⚠️ `gp.id::text = f.plan_id` ET NON L'INVERSE : `payments.plan_id` est un `text`
    -- quand `gym_plans.id` est un `uuid` (relevé sur la base, pas supposé). Écrire la
    -- jointure sans cast lève `operator does not exist: uuid = text` — un défaut de schéma
    -- qu'on contourne ici plutôt que de le corriger dans un lot d'alerte.
    'formules', coalesce((
      SELECT jsonb_agg(DISTINCT gp.name)
        FROM fenetre f JOIN public.gym_plans gp ON gp.id::text = f.plan_id
       WHERE f.rate), '[]'::jsonb)
  )
  FROM totaux t;
$function$;

COMMENT ON FUNCTION public.payment_incident_state(uuid) IS
  'GYM-359 — état d''encaissement d''une salle sur 24 h glissantes. `regle_a` = un membre à '
  '2 échecs sans succès ; `regle_b` = 3 échecs sans succès pour la salle. `pending` n''est '
  'jamais compté comme un échec : le paiement est en vol.';

REVOKE ALL     ON FUNCTION public.payment_incident_state(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.payment_incident_state(uuid) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.payment_incident_state(uuid) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. CE QU'IL Y A À ENVOYER — SANS RIEN ÉCRIRE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 CETTE FONCTION NE MÉMORISE RIEN, ET C'EST DÉLIBÉRÉ. Si elle ouvrait la ligne en même
-- temps qu'elle rend le message, un échec d'envoi Slack laisserait une ligne ouverte pour
-- un message jamais parti : l'alerte serait perdue POUR TOUJOURS, et c'est exactement le
-- silence que ce lot existe pour supprimer.
--
-- La trace est donc écrite APRÈS un envoi réussi, par `payment_alert_mark` (§ 4). Le risque
-- résiduel est inversé — un message envoyé deux fois si le marquage échoue — et c'est le
-- bon sens de l'arbitrage : un doublon se lit, un silence ne se lit pas.
--
-- ⚠️ LA LIGNE OUVERTE VIT DANS `webhook_failures`, comme le filet de GYM-345. Le nom est
-- impropre et c'est assumé : cette table EST la boîte aux lettres morte que le cockpit
-- relève déjà. En créer une seconde éparpillerait la surveillance sur deux endroits, dont
-- un que personne n'aurait l'habitude de regarder.
CREATE OR REPLACE FUNCTION public.payment_alerts_pending()
RETURNS TABLE (action text, gym_id uuid, gym_name text, gym_slug text, detail jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_gym   record;
  v_etat  jsonb;
  v_ligne record;
BEGIN
  FOR v_gym IN
    SELECT g.id, g.name, g.slug FROM public.nexxia_gyms g WHERE g.deleted_at IS NULL
  LOOP
    v_etat := public.payment_incident_state(v_gym.id);

    SELECT wf.id, wf.created_at, wf.detail INTO v_ligne
      FROM public.webhook_failures wf
     WHERE wf.function_name = 'payment-alerts'
       AND wf.gym_id = v_gym.id
       AND wf.resolved_at IS NULL
     ORDER BY wf.created_at DESC LIMIT 1;

    IF (v_etat ->> 'regle_a')::boolean OR (v_etat ->> 'regle_b')::boolean THEN
      -- ⚠️ UNE ALERTE PAR ÉPISODE, PAS UNE PAR HEURE. Tant que la ligne est ouverte, on ne
      -- redit rien : une alerte qu'on n'ouvre plus ne vaut rien.
      IF v_ligne.id IS NULL THEN
        action := 'open'; gym_id := v_gym.id; gym_name := v_gym.name; gym_slug := v_gym.slug;
        detail := v_etat;
        RETURN NEXT;
      END IF;
    ELSIF v_ligne.id IS NOT NULL THEN
      -- 🔴 LE RETOUR À LA NORMALE SE DIT AUSSI. Sans ce message, personne ne saurait jamais
      -- si c'est réparé — et la prochaine alerte se lirait comme la continuation de la
      -- précédente.
      action := 'resolved'; gym_id := v_gym.id; gym_name := v_gym.name; gym_slug := v_gym.slug;
      detail := v_etat || jsonb_build_object(
        'ouverte_depuis', v_ligne.created_at,
        'duree_minutes', round(extract(epoch FROM (now() - v_ligne.created_at)) / 60),
        'echecs_episode', coalesce(v_ligne.detail ->> 'echecs', '?'),
        -- Ce qui a rouvert la vente : le dernier paiement réussi de la salle.
        'dernier_succes', (
          SELECT jsonb_build_object(
                   'membre', btrim(coalesce(pr.first_name,'') || ' ' || coalesce(pr.last_name,'')),
                   'montant', p.amount,
                   'quand', p.created_at)
            FROM public.payments p JOIN public.profiles pr ON pr.id = p.member_id
           WHERE p.gym_id = v_gym.id AND p.status = 'paid'
           ORDER BY p.created_at DESC LIMIT 1));
      RETURN NEXT;
    END IF;
    -- Tout va bien et rien n'était ouvert : RIEN. Le silence est le cas nominal.
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.payment_alerts_pending() IS
  'GYM-359 — ce qu''il y a à dire sur Slack : ''open'' à l''entrée en incident, ''resolved'' '
  'au retour à la normale, rien sinon. N''ÉCRIT RIEN — la trace est posée après un envoi '
  'réussi, par payment_alert_mark.';

REVOKE ALL     ON FUNCTION public.payment_alerts_pending() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.payment_alerts_pending() FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.payment_alerts_pending() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 4. LA TRACE, POSÉE APRÈS L'ENVOI
-- ═════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.payment_alert_mark(
  p_gym_id uuid,
  p_action text,
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
    INSERT INTO public.webhook_failures (function_name, stage, gym_id, detail)
    SELECT 'payment-alerts', 'incident', p_gym_id, p_detail
     WHERE NOT EXISTS (
       SELECT 1 FROM public.webhook_failures wf
        WHERE wf.function_name = 'payment-alerts' AND wf.gym_id = p_gym_id
          AND wf.resolved_at IS NULL);
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSIF p_action = 'resolved' THEN
    UPDATE public.webhook_failures
       SET resolved_at = now(),
           detail = detail || jsonb_build_object('resolution', p_detail)
     WHERE function_name = 'payment-alerts' AND gym_id = p_gym_id AND resolved_at IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;

  RETURN v_n > 0;
END;
$function$;

COMMENT ON FUNCTION public.payment_alert_mark(uuid, text, jsonb) IS
  'GYM-359 — ouvre ou referme la ligne d''épisode dans webhook_failures. Appelée APRÈS un '
  'envoi Slack réussi : une trace posée avant l''envoi perdrait l''alerte si Slack échouait.';

REVOKE ALL     ON FUNCTION public.payment_alert_mark(uuid, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.payment_alert_mark(uuid, text, jsonb) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.payment_alert_mark(uuid, text, jsonb) TO service_role;

CREATE INDEX IF NOT EXISTS idx_webhook_failures_alertes_ouvertes
  ON public.webhook_failures (gym_id)
  WHERE function_name = 'payment-alerts' AND resolved_at IS NULL;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 5. LA TÂCHE — À POSER PAR LE COCKPIT, PAS PAR CE FICHIER
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ NE PAS EXÉCUTER CETTE SECTION DEPUIS LE DÉPÔT : `send-payment-alerts` exige le secret
-- interne dans son en-tête. Convention GYM-116 / GYM-252 / GYM-250 — clonage d'un job
-- existant, le secret reste lu dans le vault.
--
--   send-payment-alerts — toutes les heures à :10
--
-- HORAIRE. Les jobs de production occupent :00, :05, :25, :35, :50, la grille des quarts
-- (*/15) et les demies (*/30) ; GYM-250 ajoute :40 et :55. :10 est libre à l'heure — il ne
-- croise `process-failed-renewals` qu'une fois par jour, à 07:10, sur une autre fonction et
-- d'autres tables.
--
-- ⚠️ TOUTES LES HEURES, ET PAS PLUS SOUVENT. Un paiement abandonné met 15 à 60 minutes à
-- devenir `expired` (mesuré) : passer toutes les cinq minutes ne détecterait rien de plus
-- tôt, et multiplierait par douze les occasions de se tromper.
--
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-payment-alerts') THEN
--       PERFORM cron.unschedule('send-payment-alerts');
--     END IF;
--   END
--   $$;
--   SELECT cron.schedule('send-payment-alerts', '10 * * * *', $job$
--     SELECT net.http_post(
--       url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-payment-alerts',
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
  v_gym uuid;
  v_etat jsonb;
BEGIN
  IF to_regprocedure('public.payment_incident_state(uuid)') IS NULL
     OR to_regprocedure('public.payment_alerts_pending()') IS NULL
     OR to_regprocedure('public.payment_alert_mark(uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'GYM-359 : une des trois fonctions manque';
  END IF;

  -- Elle RÉPOND, sur une vraie salle — on ne se contente pas de vérifier qu'elle existe.
  SELECT id INTO v_gym FROM public.nexxia_gyms WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  IF v_gym IS NOT NULL THEN
    v_etat := public.payment_incident_state(v_gym);
    IF v_etat ->> 'regle_a' IS NULL OR v_etat ->> 'regle_b' IS NULL THEN
      RAISE EXCEPTION 'GYM-359 : payment_incident_state ne rend pas ses deux règles';
    END IF;
  END IF;

  RAISE NOTICE 'GYM-359 : détection posée. L''envoi est le fait de send-payment-alerts.';
END
$verif$;
