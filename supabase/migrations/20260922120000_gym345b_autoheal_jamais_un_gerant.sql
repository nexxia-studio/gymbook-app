-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-345b — LE FILET NE DOIT JAMAIS ATTRAPER UN GÉRANT                                ║
-- ║  🔴 HOTFIX DÉJÀ APPLIQUÉ EN PRODUCTION PAR LE COCKPIT LE 22/09. Ce fichier ne fait    ║
-- ║  que l'INSCRIRE DANS LE DÉPÔT : appliqué, il ne change rien.                          ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- L'INCIDENT, DATÉ
-- ─────────────────────────────────────────────────────────────────────────────────────
-- `nexxia.studio+gerant1@gmail.com` s'inscrit comme GÉRANT (signup_intent = 'gym_owner'),
-- confirme son email à 11 h 37 — et se retrouve rattaché à Dopamine à 11 h 50, par
-- `member_gyms_autoheal()`, AVANT d'avoir créé sa salle.
--
-- Entre la confirmation de l'email et la création de la salle, un futur gérant est
-- exactement ce que le filet cherche : `role = 'member'` (handle_new_user force ce rôle),
-- `gym_id IS NULL`, et zéro adhésion. La RÈGLE 2 le rattachait donc à la salle d'app
-- dédiée. **Tout gérant en cours d'inscription était exposé** — la fenêtre dure le temps
-- d'un formulaire, et le cron passe toutes les heures.
--
-- ⚠️ CE N'ÉTAIT PAS UNE ERREUR DE DIAGNOSTIC DU FILET, C'ÉTAIT UN ANGLE MORT. Le filet
-- répondait correctement à la question qu'on lui avait posée (« ce membre sans salle,
-- où va-t-il ? ») ; personne ne lui avait dit que certains comptes sans salle ne sont pas
-- des membres mais des gérants qui n'ont pas fini de s'inscrire.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI CE FICHIER EXISTE ALORS QUE LE CORRECTIF EST DÉJÀ EN PRODUCTION
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 SANS LUI, LA PROCHAINE MIGRATION QUI TOUCHE AU FILET RÉÉCRIT LA VERSION FAUTIVE.
-- `20260914100000_gym345_filet_rattachement.sql` porte encore le corps d'origine : un
-- `CREATE OR REPLACE` bâti dessus — ou un simple `db reset` — rouvrirait le trou sans que
-- personne ne s'en aperçoive. Un correctif appliqué à chaud qui ne redescend pas dans le
-- dépôt n'est pas un correctif : c'est une dette avec une date d'expiration inconnue.
--
-- ⚠️ LE CORPS CI-DESSOUS EST LU SUR LE DÉPLOYÉ (`pg_get_functiondef`, production
-- `fcjupgvmjkqztxtwymdb`, 22/09), PAS reconstruit depuis l'ancien fichier. Seuls des
-- COMMENTAIRES ont été rajoutés — aucune instruction n'a été ajoutée, retirée ni
-- réordonnée. Le § 2 le PROUVE plutôt que de l'affirmer.
--
-- ⚠️ STAGING ET PRODUCTION PORTENT LE MÊME CORPS EXÉCUTABLE. Mesuré : leurs
-- `pg_get_functiondef` diffèrent (3876 contre 3588 octets) — mais une fois les
-- commentaires SQL retirés et les blancs normalisés, les deux rendent la MÊME empreinte,
-- `b1138a3e718a603064ca5e736da29032` sur 3148 caractères. La différence était du
-- commentaire, rien d'autre. C'est cette empreinte que le § 2 exige.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LES DEUX GARDES
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ① LE CANDIDAT — un compte `signup_intent = 'gym_owner'` n'est JAMAIS candidat. La garde
--   est posée DEUX FOIS, dans le décompte ET dans la boucle, et ce n'est pas une
--   redondance : le décompte arme le disjoncteur (`c_max_par_passage`). Un gérant compté
--   mais non traité ferait monter le compteur vers le seuil et finirait par bloquer le
--   filet pour de VRAIS membres. Les deux prédicats doivent donc rester identiques.
--
-- ② LA RÈGLE 2 — la salle d'app dédiée n'est servie qu'aux comptes SANS identité `email`,
--   c'est-à-dire aux inscriptions Apple/Google de l'app mono-salle. C'est la population
--   que cette règle visait depuis le début ; elle n'avait simplement jamais été nommée.
--   Un compte email, lui, est passé par un formulaire — il a une salle en tête, et si on
--   ne sait pas laquelle, on ne devine pas.
--
-- ⚠️ LA RÈGLE 1 EST INCHANGÉE, ET C'EST VOLONTAIRE. « Une seule adhésion » est un FAIT
-- observé, pas une convention : le membre EST déjà dans cette salle, il lui manque
-- seulement sa salle active. Aucun gérant en cours d'inscription n'a d'adhésion — la
-- garde ① suffit à les en écarter.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LE FILET, TEL QU'IL TOURNE EN PRODUCTION DEPUIS LE 22/09
-- ═════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.member_gyms_autoheal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  -- 🔴 DISJONCTEUR. Au-delà de ce seuil, ce n'est plus le défaut connu : c'est autre
  -- chose, et rattacher une fournée de membres sur un diagnostic faux serait pire que le
  -- mal. On s'arrête et on alerte.
  c_max_par_passage constant integer := 5;
  v_dedie uuid; v_nb_dedies integer; v_candidats integer;
  v_repares integer := 0; v_bloques integer := 0;
  v_p record; v_cible uuid; v_motif text; v_nb_adh integer;
BEGIN
  -- ── Les candidats : membre, actif, SANS salle active — et JAMAIS un gérant ────────
  -- ⚠️ `role = 'member'` STRICTEMENT, et la GARDE ① par-dessus. Le rôle ne suffisait pas :
  -- `handle_new_user` pose `role = 'member'` pour TOUT LE MONDE, gérants compris, jusqu'à
  -- ce que `create_gym_self_serve` promeuve. C'est précisément l'angle mort du 22/09.
  SELECT count(*) INTO v_candidats FROM public.profiles p
   WHERE p.deleted_at IS NULL AND p.role = 'member' AND p.gym_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id
                      AND u.raw_user_meta_data->>'signup_intent' = 'gym_owner');

  IF v_candidats = 0 THEN
    PERFORM public.autoheal_journal('ok', 0, NULL);
    RETURN jsonb_build_object('status', 'ok', 'candidates', 0, 'repaired', 0);
  END IF;

  IF v_candidats > c_max_par_passage THEN
    PERFORM public.autoheal_journal('circuit_breaker', v_candidats,
      jsonb_build_object('reason', 'too_many_candidates', 'threshold', c_max_par_passage));
    RAISE LOG '[member-gyms-autoheal] % candidats > seuil % — aucune réparation', v_candidats, c_max_par_passage;
    RETURN jsonb_build_object('status', 'circuit_breaker', 'candidates', v_candidats, 'repaired', 0);
  END IF;

  -- ── La salle d'app dédiée, s'il en existe UNE SEULE ───────────────────────────────
  SELECT count(*) INTO v_nb_dedies FROM public.nexxia_gyms WHERE dedicated_app_gym;
  IF v_nb_dedies = 1 THEN
    SELECT id INTO v_dedie FROM public.nexxia_gyms WHERE dedicated_app_gym;
  ELSE
    v_dedie := NULL;
  END IF;

  -- ⚠️ MÊME PRÉDICAT QUE LE DÉCOMPTE, À LA LETTRE. S'ils divergeaient, le disjoncteur
  -- compterait une population et la boucle en traiterait une autre.
  FOR v_p IN
    SELECT p.id, p.created_at FROM public.profiles p
     WHERE p.deleted_at IS NULL AND p.role = 'member' AND p.gym_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id
                        AND u.raw_user_meta_data->>'signup_intent' = 'gym_owner')
     ORDER BY p.created_at
  LOOP
    v_cible := NULL; v_motif := NULL;

    -- RÈGLE 1 — une adhésion unique : le fait, pas la convention. INCHANGÉE.
    SELECT count(*) INTO v_nb_adh FROM public.member_gyms WHERE member_id = v_p.id;
    IF v_nb_adh = 1 THEN
      SELECT gym_id INTO v_cible FROM public.member_gyms WHERE member_id = v_p.id;
      v_motif := 'sole_membership';

    -- RÈGLE 2 — la salle d'app dédiée unique, sans aucune adhésion.
    -- 🔴 GARDE ② : SEULEMENT un compte sans identité `email`, donc une inscription
    -- Apple/Google de l'app mono-salle. Un compte email est passé par un formulaire :
    -- il a une salle en tête, et si on ne sait pas laquelle, on ne devine pas.
    ELSIF v_nb_adh = 0 AND v_dedie IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.identities i
                       WHERE i.user_id = v_p.id AND i.provider = 'email') THEN
      v_cible := v_dedie;
      v_motif := 'dedicated_app_gym';
    END IF;

    IF v_cible IS NULL THEN
      v_bloques := v_bloques + 1;
      PERFORM public.autoheal_journal('undeterminable', 1,
        jsonb_build_object('member_id', v_p.id, 'memberships', v_nb_adh,
                           'dedicated_app_gyms', v_nb_dedies));
      CONTINUE;
    END IF;

    -- ⚠️ ON RÉUTILISE `attach_profile_to_gym` (GYM-338), ON NE RÉÉCRIT PAS L'INSERT.
    -- ⚠️ ET ON LUI PASSE `NULL` COMME RÔLE : le filet ne promeut personne. C'est aussi ce
    -- qui explique l'état du compte de l'incident — rattaché, mais resté `member`.
    BEGIN
      PERFORM public.attach_profile_to_gym(v_p.id, v_cible, NULL);
      v_repares := v_repares + 1;
    EXCEPTION WHEN OTHERS THEN
      v_bloques := v_bloques + 1;
      PERFORM public.autoheal_journal('attach_failed', 1,
        jsonb_build_object('member_id', v_p.id, 'gym_id', v_cible, 'rule', v_motif,
                           'sqlstate', SQLSTATE, 'message', SQLERRM));
      RAISE LOG '[member-gyms-autoheal] échec sur % → % : %', v_p.id, v_cible, SQLERRM;
      CONTINUE;
    END;

    PERFORM public.autoheal_journal('repaired', 1,
      jsonb_build_object('member_id', v_p.id, 'gym_id', v_cible, 'rule', v_motif,
                         'profile_created_at', v_p.created_at));
    RAISE LOG '[member-gyms-autoheal] profil % rattaché à % (règle %)', v_p.id, v_cible, v_motif;
  END LOOP;

  RETURN jsonb_build_object('status', 'done', 'candidates', v_candidats,
                            'repaired', v_repares, 'blocked', v_bloques);
END;
$function$;

-- Commentaire repris VERBATIM de la production (22/09).
COMMENT ON FUNCTION public.member_gyms_autoheal() IS
  'GYM-345 — FILET TEMPORAIRE. Rattache un membre sans salle : à son adhésion unique si '
  'elle existe (règle 1) ; sinon à la salle dedicated_app_gym s''il n''y en a qu''une ET si '
  'le compte n''a PAS d''identité email (règle 2 — inscriptions Apple/Google de l''app '
  'mono-salle). Ne touche JAMAIS un compte à signup_intent = gym_owner (correctif 22/09).';

-- ACL identique au déployé (`postgres`, `service_role`). Un `CREATE OR REPLACE` la
-- conserve ; on la réaffirme pour que le fichier soit autoportant sur une base neuve.
REVOKE ALL     ON FUNCTION public.member_gyms_autoheal() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.member_gyms_autoheal() TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. CONTRÔLE D'APPLICATION — l'empreinte, pas la bonne foi
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 CE BLOC EST LA PREUVE QUE LE CORPS EST *EXACTEMENT* CELUI QUI TOURNE. Il retire les
-- commentaires SQL, normalise les blancs, et compare l'empreinte au relevé du 22/09 sur
-- LES DEUX environnements. Si une seule instruction avait bougé — un `AND` déplacé, un
-- prédicat recopié de travers — l'empreinte changerait et l'application échouerait.
--
-- ⚠️ CE CONTRÔLE EST VOLONTAIREMENT FRAGILE. Toute réécriture future de cette fonction
-- DOIT casser ici, pour forcer celui qui la réécrit à relire l'incident du 22/09 et à
-- mettre à jour l'empreinte en connaissance de cause. C'est le contraire d'un contrôle
-- qu'on peut ignorer.
DO $verif$
DECLARE
  c_empreinte constant text := 'b1138a3e718a603064ca5e736da29032';
  v_src  text;
  v_nue  text;
  v_md5  text;
  v_g1   integer;
  v_g2   integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'member_gyms_autoheal';

  v_nue := regexp_replace(regexp_replace(v_src, '--[^\n]*', '', 'g'), '\s+', ' ', 'g');
  v_md5 := md5(v_nue);

  IF v_md5 <> c_empreinte THEN
    RAISE EXCEPTION
      'GYM-345b : le corps appliqué ne correspond PAS au déployé du 22/09 (md5 % sur % caractères, attendu %). Relire l''incident avant de toucher à cette fonction.',
      v_md5, length(v_nue), c_empreinte;
  END IF;

  -- Ceinture lisible : même si l'empreinte venait à être mise à jour un jour, ces deux
  -- comptes disent en clair ce qui ne doit jamais disparaître.
  v_g1 := (length(v_src) - length(replace(v_src, 'signup_intent', ''))) / length('signup_intent');
  v_g2 := (length(v_src) - length(replace(v_src, 'auth.identities', ''))) / length('auth.identities');

  IF v_g1 <> 2 THEN
    RAISE EXCEPTION 'GYM-345b : la garde gym_owner doit apparaître DEUX fois (décompte + boucle), trouvée % fois', v_g1;
  END IF;
  IF v_g2 <> 1 THEN
    RAISE EXCEPTION 'GYM-345b : la garde auth.identities doit apparaître UNE fois (règle 2), trouvée % fois', v_g2;
  END IF;

  RAISE NOTICE 'GYM-345b : filet conforme au déployé du 22/09 (md5 %). Les deux gardes sont en place.', v_md5;
END
$verif$;
