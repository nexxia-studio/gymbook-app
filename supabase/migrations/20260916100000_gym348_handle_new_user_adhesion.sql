-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-348 — handle_new_user CRÉE ENFIN L'ADHÉSION (A.4 de GYM-102, jamais appliquée)   ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CE FICHIER N'EST PAS APPLIQUÉ PAR CE LOT. Le cockpit l'exécute, staging puis prod.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CE QUI EST CORRIGÉ, ET DEPUIS QUAND
-- ─────────────────────────────────────────────────────────────────────────────────────
-- La section A.4 de GYM-102 redéfinissait `handle_new_user` avec deux ajouts : l'insertion
-- de l'adhésion, et le décompte du plafond sur `member_gyms`. Elle N'A JAMAIS ÉTÉ APPLIQUÉE
-- en production. Le morceau `gym102_socle_white_label_fonctions` a été réécrit à la main et
-- ne définit que my_gym_memberships, public_gym_branding, public_gym_schedule, search_gyms
-- et switch_active_gym — A.3 et A.4 sont tombées au découpage. A.3 a été rattrapée par
-- accident (GYM-338 a redéfini enforce_gym_id_immutable) ; A.4 par rien.
--
-- VÉRIFIÉ SUR LE DÉPLOYÉ, PAS SUR LE DÉPÔT (16/09) : la dernière migration appliquée à
-- redéfinir cette fonction est `gym248_self_serve_core`. C'est donc son corps qui tourne
-- en production, et c'est de LUI que part ce fichier.
--
-- CONSÉQUENCE MESURÉE : aucune adhésion n'a jamais été créée à l'inscription en production.
-- Toutes celles des membres créés après le 06/09 sont des RÉPARATIONS — l'ordre physique
-- des lignes de member_gyms est décorrélé de la chronologie des inscriptions, signature
-- d'un INSERT … SELECT en masse. Dernier cas en date : Sophie Evelette, 14/09, inscription
-- libre depuis l'app mobile, rattachée à la main le 16/09.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ ANTI-DRIFT STRICT
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Corps recopié depuis `pg_get_functiondef` du DÉPLOYÉ (prod, 16/09), à l'octet près.
-- DEUX modifications, et deux seulement, toutes deux signalées dans le corps par un
-- commentaire « GYM-348 ». Tout le reste — le tri d'intention `gym_owner`, la bascule de
-- claims autour de get_effective_plan, les COALESCE de noms OAuth de GYM-150, le mapping
-- de consentement de GYM-109 — est INCHANGÉ.
--
-- ⚠️ C'EST LA CONFUSION DÉPÔT/DÉPLOYÉ QUI A PRODUIT LE DÉFAUT, et elle a failli le
-- reproduire : le fichier gym102 du dépôt et le corps déployé DIFFÈRENT déjà par le
-- retour à la ligne de la liste de colonnes de l'INSERT. Partir du dépôt aurait réintroduit
-- une différence invisible de plus.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 LA RÈGLE PRODUIT, ET POURQUOI CE FICHIER NE FORCE RIEN
-- ─────────────────────────────────────────────────────────────────────────────────────
--   · app DOPAMINE (mono-salle) → tout inscrit est lié à Dopamine, toujours. L'app pose
--     `gym_id` dans les métadonnées d'inscription (signupGymId() rend FIXED_GYM_ID en
--     mode single) : `v_gym_id` est donc déterminé, et l'adhésion naît avec le profil.
--   · app VINIZ (multi) → lié à la salle qu'il CHOISIT. L'app n'envoie aucun `gym_id`
--     (signupGymId() rend null en multi) : `v_gym_id` reste NULL, aucune adhésion n'est
--     créée, et c'est CORRECT.
--
-- ⚠️ L'INTERVALLE ENTRE L'INSCRIPTION ET LE CHOIX DE SALLE EST UN ÉTAT NORMAL. L'insertion
-- ci-dessous est gardée par `IF v_gym_id IS NOT NULL` : elle ne s'exécute que lorsque la
-- salle est DÉJÀ déterminée, jamais pour la deviner. Un signup Viniz traverse cette
-- fonction sans qu'elle écrive quoi que ce soit dans member_gyms — c'est
-- `join_gym_self_serve` qui rattachera, au moment du choix.
--
-- ⚠️ ET UN SIGNUP REFUSÉ AU PLAFOND NE CRÉE AUCUNE ADHÉSION NON PLUS. La même garde le
-- couvre : quand le plafond est atteint, `v_gym_id` est remis à NULL juste au-dessus.
-- Créer l'adhésion consommerait la place sans que le membre l'obtienne.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  meta          jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  v_intent      text  := meta->>'signup_intent';
  v_wanted_gym  uuid;
  v_role        text;
  v_gym_id      uuid  := NULL;
  v_plan        jsonb;
  v_max_members integer;
  v_members     integer;
  v_claims      text;
BEGIN
  BEGIN
    v_wanted_gym := nullif(meta->>'gym_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_wanted_gym := NULL;
  END;

  v_role := 'member';

  IF v_intent = 'gym_owner' THEN
    v_wanted_gym := NULL;
  END IF;

  IF v_wanted_gym IS NOT NULL THEN
    v_claims := current_setting('request.jwt.claims', true);
    BEGIN
      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
      v_plan := public.get_effective_plan(v_wanted_gym);
    EXCEPTION WHEN OTHERS THEN
      v_plan := NULL;
    END;

    PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);

    IF v_plan IS NULL THEN
      RAISE LOG '[plan-gate] member limit, gym %', v_wanted_gym;
      v_gym_id := NULL;
    ELSE
      v_max_members := nullif(v_plan->'limits'->>'max_members', '')::integer;

      IF v_max_members IS NULL THEN
        v_gym_id := v_wanted_gym;
      ELSE
        -- ═══ GYM-348 — MODIFICATION 1/2 : LE DÉCOMPTE PORTE SUR member_gyms ═══════════
        -- Il portait sur `profiles.gym_id`. Depuis GYM-283 cette colonne n'est plus « la
        -- salle du membre » mais sa salle ACTIVE : un membre inscrit dans deux salles qui
        -- bascule sur la seconde DISPARAISSAIT de ce compte alors qu'il occupe toujours sa
        -- place dans la première — le plafond du plan Free devenait contournable en
        -- faisant tourner les membres.
        --
        -- ⚠️ LA JOINTURE EST INTERNE, ET LES DEUX FILTRES SONT INDISPENSABLES : un compte
        -- SUPPRIMÉ conserve son adhésion (member_gyms n'est jamais purgé — la suppression
        -- est un soft delete qui garde aussi gym_id). Compter sans
        -- `p.deleted_at IS NULL` sur-compterait, et une salle deviendrait « pleine » à
        -- cause de comptes partis.
        --
        -- ⚠️ MÊME PRÉDICAT, À LA LETTRE, que _shared/booking-guards.ts (checkMemberQuota,
        -- corrigé en GYM-283) et que admin-create-member (corrigé en GYM-338) :
        --     FROM member_gyms mg JOIN profiles p ON p.id = mg.member_id
        --     WHERE mg.gym_id = <salle> AND p.role = 'member' AND p.deleted_at IS NULL
        -- Les trois gardes doivent rendre le MÊME chiffre. C'était le dernier des trois à
        -- ne pas le faire.
        SELECT count(*) INTO v_members
          FROM public.member_gyms mg
          JOIN public.profiles p ON p.id = mg.member_id
         WHERE mg.gym_id = v_wanted_gym
           AND p.role = 'member'
           AND p.deleted_at IS NULL;

        IF v_members >= v_max_members THEN
          RAISE LOG '[plan-gate] member limit, gym %', v_wanted_gym;
          v_gym_id := NULL;
        ELSE
          v_gym_id := v_wanted_gym;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.profiles (
    id, email, role, gym_id, first_name, last_name, phone, preferred_language,
    privacy_policy_accepted_at, privacy_policy_version, terms_accepted_at,
    terms_version, marketing_consent, created_at, updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    v_role,
    v_gym_id,
    COALESCE(NULLIF(meta->>'first_name',''), NULLIF(meta->>'given_name',''),
             NULLIF(split_part(meta->>'full_name',' ',1),'')),
    COALESCE(NULLIF(meta->>'last_name',''), NULLIF(meta->>'family_name',''),
             NULLIF(btrim(substr(meta->>'full_name',
             length(split_part(meta->>'full_name',' ',1))+1)),'')),
    meta->>'phone',
    COALESCE(meta->>'preferred_language', 'fr'),
    CASE WHEN meta->>'privacy_policy_accepted' = 'true' THEN now() ELSE NULL END,
    CASE WHEN meta->>'privacy_policy_accepted' = 'true'
         THEN meta->>'legal_version' ELSE NULL END,
    CASE WHEN meta->>'terms_accepted' = 'true' THEN now() ELSE NULL END,
    CASE WHEN meta->>'terms_accepted' = 'true'
         THEN meta->>'legal_version' ELSE NULL END,
    COALESCE((meta->>'marketing_consent')::boolean, false),
    now(),
    now()
  );

  -- ═══ GYM-348 — MODIFICATION 2/2 : L'ADHÉSION NAÎT AVEC LE PROFIL ═══════════════════
  -- C'est le correctif du lot. Sans ces quatre lignes, `profiles.gym_id` était posé et
  -- `member_gyms` restait vide — la divergence que `member_gyms_drift()` (GYM-338) signale
  -- toutes les heures depuis, et que le cockpit répare à la main depuis dix jours.
  --
  -- ⚠️ APRÈS l'INSERT du profil, et non avant : member_gyms.member_id référence
  -- profiles(id). L'ordre inverse violerait la clé étrangère.
  --
  -- ⚠️ GARDÉ PAR `v_gym_id IS NOT NULL` — c'est ce qui respecte la règle produit. Il ne
  -- s'agit pas d'une précaution : c'est la ligne qui distingue « la salle est connue » de
  -- « la salle n'est pas encore choisie » (Viniz multi) et de « le plafond a refusé le
  -- rattachement ». Dans les deux derniers cas, aucune adhésion ne doit naître.
  --
  -- ON CONFLICT DO NOTHING : la fonction est un trigger d'INSERT sur auth.users, donc
  -- normalement non rejouable — mais l'idempotence coûte un mot et ferme le cas d'un
  -- ré-enregistrement d'utilisateur réutilisant un id existant.
  IF v_gym_id IS NOT NULL THEN
    INSERT INTO public.member_gyms (member_id, gym_id)
    VALUES (NEW.id, v_gym_id)
    ON CONFLICT (member_id, gym_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'GYM-348 — Crée le profil à la naissance du compte auth, ET l''adhésion member_gyms '
  'correspondante quand la salle est déterminée. Le décompte du plafond porte sur '
  'member_gyms (même prédicat que booking-guards et admin-create-member). Aucune adhésion '
  'n''est créée quand la salle n''est pas connue (parcours Viniz multi, où l''état est '
  'transitoire et légitime) ni quand le plafond a refusé le rattachement.';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- CE QUE CE FICHIER NE FAIT PAS
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 AUCUNE REPRISE D'HISTORIQUE. Le cockpit a déjà rattaché tous les profils concernés
-- (0 divergence au 16/09), et la veille member_gyms_drift() signalerait un reliquat dans
-- l'heure. Un INSERT … SELECT silencieux ici ferait disparaître un éventuel reste sans que
-- personne ne l'apprenne — exactement ce que ce lot combat. Même refus qu'en GYM-199 et
-- GYM-338.
--
-- ⚠️ LE TRIGGER N'EST PAS REPOSÉ. `on_auth_user_created` existe déjà sur auth.users et
-- pointe sur cette fonction ; `CREATE OR REPLACE` remplace le corps sans y toucher.
