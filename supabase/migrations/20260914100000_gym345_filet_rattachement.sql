-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-345 — LA VEILLE CESSE DE REGARDER : ELLE RÉPARE (FILET TEMPORAIRE)               ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CE FICHIER N'EST PAS APPLIQUÉ PAR CE LOT. Le cockpit l'exécute, staging puis prod.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI, ET POURQUOI MAINTENANT
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Les inscriptions Apple/Google arrivent SANS `gym_id` dans les métadonnées : le trigger
-- pose `profiles.gym_id` à NULL. Jusqu'à vendredi, le heal client rattrapait par un PATCH
-- direct. GYM-338 a durci `enforce_gym_id_immutable` et refuse désormais ce PATCH ; sa
-- porte de remplacement, `claim_app_gym`, n'existe que dans la 1.2.0, PAS ENCORE PUBLIÉE.
-- Entre les deux, tout nouvel inscrit OAuth reste sans salle : Robin Burton (Google,
-- 12/09) et Martin Raets (Apple, 14/09), rattachés à la main.
--
-- `member_gyms_drift()` voyait déjà l'inverse (une salle active sans adhésion). Il lui
-- manquait ce sens-ci — et surtout le geste.
--
-- 🔴 CE FILET EST TEMPORAIRE. Il devient inutile dès que la 1.2.0 est publiée ET adoptée :
-- l'app appellera alors `claim_app_gym` elle-même, au login, avant même que le cron passe.
-- Sa dépose est décrite en fin de fichier — deux instructions.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 « RATTACHÉ À QUELLE SALLE ? » — LA SEULE QUESTION QUI COMPTE
-- ─────────────────────────────────────────────────────────────────────────────────────
-- GYM-338 a fermé la devinette, et ce lot ne la rouvre pas. Trois règles, dans cet ordre,
-- et la troisième est de ne rien faire.
--
--   1. UNE ADHÉSION UNIQUE EXISTANTE → c'est elle. ZÉRO DEVINETTE : le rattachement
--      existe déjà dans `member_gyms`, seul le POINTEUR de salle active manque. C'est
--      exactement la divergence inverse de celle que la veille surveille depuis GYM-338 ;
--      la réparer ferme enfin les deux sens. Cette règle ne s'appuie sur aucune
--      convention — elle lit un fait.
--
--   2. EXACTEMENT UNE SALLE `dedicated_app_gym` → c'est elle. MÊME RÈGLE QUE
--      `claim_app_gym`, mot pour mot : le rattachement ne vaut que là où une seule salle
--      est possible, parce que le build de l'app mono-salle ne peut en désigner aucune
--      autre. Rien de neuf n'est inventé ici ; on applique côté serveur la règle que le
--      client appliquera en 1.2.0.
--
--   3. TOUT LE RESTE → ON NE RÉPARE RIEN, ON ALERTE. Aucune salle marquée, plusieurs
--      salles marquées, plusieurs adhésions : autant de cas où la bonne réponse n'est pas
--      déductible. Mieux vaut un membre sans salle et une alerte qu'un membre dans les
--      données d'un autre client.
--
-- ⚠️ POURQUOI LA RÈGLE 1 PASSE AVANT LA 2, alors que l'incident ne la déclenche jamais
-- (un inscrit OAuth n'a AUCUNE adhésion — l'insertion de `handle_new_user` est gardée par
-- `IF v_gym_id IS NOT NULL`) : parce qu'une adhésion constatée est toujours plus sûre
-- qu'un drapeau de configuration, et que l'ordre inverse ferait primer la convention sur
-- le fait le jour où les deux existent.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ ET LE MODE MULTI ? LE FILET NE DOIT PAS L'ATTEINDRE
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Dans l'app Viniz, un membre sans salle est un état NORMAL : il n'a pas encore choisi.
-- La base, elle, ne sait pas de quelle app vient un compte — aucune colonne ne le dit, et
-- les métadonnées d'inscription posent `gym_id: null` dans les DEUX modes.
--
-- Ce qui protège réellement, et qu'il faut connaître :
--   · la règle 2 exige EXACTEMENT UNE salle marquée. Le drapeau `dedicated_app_gym` ne
--     doit JAMAIS être posé sur une salle du parcours multi-salles (c'est déjà écrit dans
--     le commentaire de la colonne, GYM-338). Tant que cette règle tient, la seule salle
--     que le filet puisse désigner est celle d'une app mono-salle ;
--   · 🔴 LE DRAPEAU EST DONC AUSSI L'INTERRUPTEUR. Le cockpit le retire ou en marque une
--     seconde, et le filet cesse de réparer pour ne plus qu'alerter — sans migration,
--     sans déploiement. C'est volontairement le même levier que la garde : un
--     interrupteur séparé serait un second état à tenir d'accord avec le premier.
--
-- 🔴 CONDITION DE DÉPOSE, À NE PAS MANQUER : le jour où l'app Viniz PUBLIQUE sort avant la
-- 1.2.0, ce filet doit être désactivé — un membre Viniz sans salle serait rattaché à la
-- salle mono-app. À ce jour, aucune build Viniz publique n'existe (cf. le bloc `isViniz`
-- d'app.config.ts, qui note l'absence d'icône de production comme bloquante).

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LE JOURNAL — une ligne par événement, dans la boîte que le cockpit relève déjà
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ `webhook_failures` À NOUVEAU, ET LE NOM RESTE IMPROPRE — même arbitrage qu'en
-- GYM-338 : une seconde table serait un second endroit à surveiller, et personne n'aurait
-- l'habitude de le regarder. Les lignes survivront à la dépose du filet, ce qui est
-- souhaitable : la trace d'un rattachement automatique doit durer plus longtemps que le
-- mécanisme qui l'a produit.
--
-- ⚠️ UNE LIGNE PAR RÉPARATION, contrairement à la veille de GYM-338 qui n'en ouvre QU'UNE.
-- La différence est réelle : là-bas un compteur décrivait un état global ; ici chaque ligne
-- décrit UNE personne, à UNE date, rattachée à UNE salle. Les regrouper reviendrait à
-- perdre l'unité de ce qu'on doit pouvoir justifier.
--
-- `resolved_at` est posé d'emblée sur 'repaired' : une réparation réussie n'est pas une
-- anomalie ouverte, c'est un fait consigné. Seuls 'undeterminable' et 'circuit_breaker'
-- restent OUVERTS — eux appellent une main humaine.
CREATE OR REPLACE FUNCTION public.autoheal_journal(p_stage text, p_count integer, p_detail jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_stage = 'ok' THEN
    -- Retour au vert : on referme les alertes du filet, comme la veille le fait des siennes.
    UPDATE public.webhook_failures SET resolved_at = now()
     WHERE function_name = 'member-gyms-autoheal'
       AND stage IN ('undeterminable', 'circuit_breaker', 'attach_failed')
       AND resolved_at IS NULL;
    RETURN;
  END IF;

  INSERT INTO public.webhook_failures (function_name, stage, detail, resolved_at)
  VALUES ('member-gyms-autoheal', p_stage,
          coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('count', p_count, 'at', now()),
          CASE WHEN p_stage = 'repaired' THEN now() ELSE NULL END);
END;
$function$;

COMMENT ON FUNCTION public.autoheal_journal(text, integer, jsonb) IS
  'GYM-345 — Journal du filet de rattachement, dans webhook_failures. Une ligne par '
  'événement. « repaired » est consigné et refermé aussitôt (ce n''est pas une anomalie) ; '
  '« undeterminable », « circuit_breaker » et « attach_failed » restent ouverts.';

REVOKE ALL ON FUNCTION public.autoheal_journal(text, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.autoheal_journal(text, integer, jsonb) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. LE FILET — fonction SÉPARÉE, pour que la dépose soit un DROP
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ ELLE N'EST PAS FONDUE DANS `member_gyms_drift()`, ET C'EST LE POINT. Le filet est
-- temporaire, la veille ne l'est pas. Les mêler obligerait, au retrait, à réécrire une
-- fonction déployée et à re-vérifier ce qu'on n'a pas voulu toucher — le genre de dépose
-- qu'on repousse jusqu'à l'oublier. Ici, retirer le filet, c'est supprimer cette
-- fonction et une ligne d'appel.
CREATE OR REPLACE FUNCTION public.member_gyms_autoheal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- 🔴 DISJONCTEUR. L'incident tourne à un ou deux comptes par week-end. Au-delà de ce
  -- seuil, ce n'est plus le défaut connu : c'est autre chose, et rattacher une fournée de
  -- membres à une salle sur un diagnostic faux serait pire que le mal. On s'arrête et on
  -- alerte — c'est exactement la situation où un automatisme doit rendre la main.
  c_max_par_passage constant integer := 5;

  v_dedie      uuid;
  v_nb_dedies  integer;
  v_candidats  integer;
  v_repares    integer := 0;
  v_bloques    integer := 0;
  v_p          record;
  v_cible      uuid;
  v_motif      text;
  v_nb_adh     integer;
BEGIN
  -- ── Les candidats : membre, actif, SANS salle active ──────────────────────────────
  -- ⚠️ `role = 'member'` STRICTEMENT. Un gym_admin sans salle relève d'un tout autre
  -- chemin (invite-team-member) et n'a rien à faire dans un rattrapage d'inscription.
  SELECT count(*) INTO v_candidats
    FROM public.profiles
   WHERE deleted_at IS NULL AND role = 'member' AND gym_id IS NULL;

  IF v_candidats = 0 THEN
    PERFORM public.autoheal_journal('ok', 0, NULL);
    RETURN jsonb_build_object('status', 'ok', 'candidates', 0, 'repaired', 0);
  END IF;

  IF v_candidats > c_max_par_passage THEN
    PERFORM public.autoheal_journal(
      'circuit_breaker', v_candidats,
      jsonb_build_object('reason', 'too_many_candidates', 'threshold', c_max_par_passage));
    RAISE LOG '[member-gyms-autoheal] % candidats > seuil % — aucune réparation', v_candidats, c_max_par_passage;
    RETURN jsonb_build_object('status', 'circuit_breaker', 'candidates', v_candidats, 'repaired', 0);
  END IF;

  -- ── La salle d'app dédiée, s'il en existe UNE SEULE ────────────────────────────────
  SELECT count(*) INTO v_nb_dedies FROM public.nexxia_gyms WHERE dedicated_app_gym;
  IF v_nb_dedies = 1 THEN
    SELECT id INTO v_dedie FROM public.nexxia_gyms WHERE dedicated_app_gym;
  ELSE
    v_dedie := NULL;  -- 0 ou ≥ 2 : la règle 2 ne s'applique pas.
  END IF;

  FOR v_p IN
    SELECT id, created_at FROM public.profiles
     WHERE deleted_at IS NULL AND role = 'member' AND gym_id IS NULL
     ORDER BY created_at
  LOOP
    v_cible := NULL;
    v_motif := NULL;

    -- RÈGLE 1 — une adhésion unique : le fait, pas la convention.
    SELECT count(*) INTO v_nb_adh FROM public.member_gyms WHERE member_id = v_p.id;
    IF v_nb_adh = 1 THEN
      SELECT gym_id INTO v_cible FROM public.member_gyms WHERE member_id = v_p.id;
      v_motif := 'sole_membership';

    -- RÈGLE 2 — la salle d'app dédiée unique, et seulement si le membre n'a AUCUNE
    -- adhésion. Avec deux adhésions et aucune salle active, il y a un choix à faire :
    -- ce n'est pas à un cron de le faire.
    ELSIF v_nb_adh = 0 AND v_dedie IS NOT NULL THEN
      v_cible := v_dedie;
      v_motif := 'dedicated_app_gym';
    END IF;

    IF v_cible IS NULL THEN
      v_bloques := v_bloques + 1;
      PERFORM public.autoheal_journal(
        'undeterminable', 1,
        jsonb_build_object('member_id', v_p.id, 'memberships', v_nb_adh,
                           'dedicated_app_gyms', v_nb_dedies));
      CONTINUE;
    END IF;

    -- ⚠️ ON RÉUTILISE `attach_profile_to_gym` (GYM-338), ON NE RÉÉCRIT PAS L'INSERT.
    -- Elle pose l'adhésion PUIS la salle active, dans une seule transaction, et n'écrase
    -- jamais une salle active existante. Un second INSERT ici serait une deuxième
    -- définition de « rattacher », qui finirait par diverger de la première.
    --
    -- ⚠️ UN ÉCHEC SUR UN PROFIL N'ARRÊTE PAS LES AUTRES. Sans ce bloc, une salle supprimée
    -- entre la lecture et l'écriture ferait échouer la fonction ENTIÈRE, donc le passage de
    -- cron, donc aussi la veille qui le suit. Un filet qui tombe sur le premier caillou ne
    -- rattrape personne. L'échec est consigné comme les autres cas non résolus.
    BEGIN
      PERFORM public.attach_profile_to_gym(v_p.id, v_cible, NULL);
      v_repares := v_repares + 1;
    EXCEPTION WHEN OTHERS THEN
      v_bloques := v_bloques + 1;
      PERFORM public.autoheal_journal(
        'attach_failed', 1,
        jsonb_build_object('member_id', v_p.id, 'gym_id', v_cible, 'rule', v_motif,
                           'sqlstate', SQLSTATE, 'message', SQLERRM));
      RAISE LOG '[member-gyms-autoheal] échec sur % → % : %', v_p.id, v_cible, SQLERRM;
      CONTINUE;
    END;

    -- 🔴 CHAQUE RÉPARATION LAISSE SA LIGNE. Un rattachement automatique porte sur une
    -- personne réelle : qui, quand, quelle salle, et SUR QUELLE RÈGLE. Sans le motif, une
    -- ligne ne dirait pas si la salle a été constatée ou déduite — c'est précisément la
    -- distinction que ce lot défend.
    PERFORM public.autoheal_journal(
      'repaired', 1,
      jsonb_build_object('member_id', v_p.id, 'gym_id', v_cible, 'rule', v_motif,
                         'profile_created_at', v_p.created_at));
    RAISE LOG '[member-gyms-autoheal] profil % rattaché à % (règle %)', v_p.id, v_cible, v_motif;
  END LOOP;

  RETURN jsonb_build_object('status', 'done', 'candidates', v_candidats,
                            'repaired', v_repares, 'blocked', v_bloques);
END;
$function$;

COMMENT ON FUNCTION public.member_gyms_autoheal() IS
  'GYM-345 — FILET TEMPORAIRE (jusqu''à la 1.2.0). Rattache les membres actifs sans salle '
  'active : à leur adhésion unique si elle existe, sinon à la salle dedicated_app_gym s''il '
  'n''y en a QU''UNE. Tout autre cas : aucune réparation, une ligne d''alerte. Disjoncteur à '
  '5 candidats par passage. Réutilise attach_profile_to_gym. Se dépose par DROP.';

REVOKE ALL ON FUNCTION public.member_gyms_autoheal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_gyms_autoheal() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. LE BRANCHEMENT — une ligne dans le cron existant
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ ON NE CRÉE PAS UN SECOND CRON. `member-gyms-drift` passe déjà toutes les heures à :50
-- et regarde la même table ; ajouter un second déclencheur ferait deux horaires à tenir
-- d'accord pour un seul sujet. On étend l'instruction planifiée, pas l'ordonnanceur.
--
-- ⚠️ L'ORDRE COMPTE : le filet RÉPARE d'abord, la veille CONSTATE ensuite. L'inverse
-- ferait ouvrir à la veille une alerte que le filet refermerait dans la même seconde.
SELECT cron.unschedule('member-gyms-drift')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'member-gyms-drift');

-- ⚠️ UN BLOC `DO`, ET NON DEUX SELECT NI UN SELECT À DEUX APPELS. Deux instructions dans
-- une commande cron dépendent de la façon dont l'ordonnanceur découpe la chaîne ; deux
-- appels dans une même liste de cibles dépendent d'un ordre d'évaluation que PostgreSQL ne
-- garantit pas. Un bloc procédural, lui, exécute ses PERFORM dans l'ordre écrit — et
-- l'ordre est ici le fond du sujet.
SELECT cron.schedule('member-gyms-drift', '50 * * * *', $CRON$
DO $do$
BEGIN
  PERFORM public.member_gyms_autoheal();
  PERFORM public.member_gyms_drift();
END
$do$;
$CRON$);

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 4. COMMENT DÉPOSER CE FILET APRÈS LA 1.2.0
-- ═════════════════════════════════════════════════════════════════════════════════════
-- CONDITION : la 1.2.0 publiée ET adoptée — c'est-à-dire quand plus aucune ligne
-- 'repaired' n'apparaît sur une période qui couvre le renouvellement du parc. Contrôle :
--
--   SELECT max(created_at) FROM webhook_failures
--    WHERE function_name = 'member-gyms-autoheal' AND stage = 'repaired';
--
-- Tant que cette date avance, des membres arrivent encore sans salle : le filet sert.
--
-- 🔴 ET UNE CONDITION QUI PEUT TOMBER PLUS TÔT : si l'app Viniz PUBLIQUE sort avant la
-- 1.2.0, le filet doit être désactivé LE JOUR MÊME — un membre Viniz sans salle est un
-- état normal, et la règle 2 le rattacherait à la salle mono-app. Désactivation immédiate
-- sans migration : retirer le drapeau `dedicated_app_gym`, ou en marquer une seconde.
--
-- DÉPOSE — deux instructions, et la veille redevient exactement celle de GYM-338 :
--
--   SELECT cron.unschedule('member-gyms-drift');
--   SELECT cron.schedule('member-gyms-drift', '50 * * * *',
--                        $CRON$SELECT public.member_gyms_drift()$CRON$);
--   DROP FUNCTION public.member_gyms_autoheal();
--   -- `autoheal_journal` peut rester : les lignes déjà écrites gardent leur sens, et la
--   -- fonction ne coûte rien. La supprimer aussi est sans risque une fois le filet parti.
