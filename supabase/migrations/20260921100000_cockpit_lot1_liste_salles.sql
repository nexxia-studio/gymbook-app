-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  COCKPIT B2B — LOT 1 : « Mes salles », LECTURE SEULE                                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260921100000_cockpit_lot1_liste_salles.sql
--
-- 🔴 CETTE MIGRATION N'A PAS ÉTÉ APPLIQUÉE PAR LE LOT, ET IL FAUT LE DIRE. Aucun
-- déploiement n'était autorisé. Elle est écrite pour être jouée telle quelle par le
-- cockpit, sur staging d'abord. Voir docs/recettes/GYM-cockpit-lot1.md.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE RPC PLUTÔT QUE DES LECTURES DE TABLES
-- ─────────────────────────────────────────────────────────────────────────────────────
-- La consigne est que la route REFUSE tout autre rôle CÔTÉ SERVEUR, pas seulement qu'elle
-- masque un menu. Une lecture directe de `nexxia_gyms` ne refuserait pas un `gym_admin` :
-- elle le SERVIRAIT, avec sa propre salle — la politique RLS de la salle existe et elle
-- est juste. Le refus ne peut donc pas venir de la RLS de la table ; il doit venir d'une
-- porte unique, et c'est celle-ci.
--
-- Second motif : le décompte des membres impose une jointure `member_gyms × profiles`
-- par salle. Le faire côté client demanderait une requête par salle et un agrégat en
-- JavaScript — c'est-à-dire un troisième décompte, celui que GYM-348 interdit.
--
-- ⚠️ LECTURE SEULE, STRICTEMENT. Aucune écriture, aucun paramètre. Changer un plan, une
-- commission ou un essai est le LOT 2, et passera par des RPC journalisées dans
-- `gym_admin_actions`. Cette fonction-ci ne sait que lire.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- LA PORTE
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cockpit_list_gyms()
RETURNS TABLE (
  gym_id              uuid,
  name                text,
  slug                text,
  plan_colonne        text,
  plan_effectif       text,
  statut              text,
  essai_actif         boolean,
  essai_fin           timestamptz,
  membres             integer,
  creneaux_a_venir    integer,
  mollie_connecte     boolean,
  identite_legale_ok  boolean,
  derniere_activite   timestamptz,
  creee_le            timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- 🔴 LE REFUS EST ICI, ET NULLE PART AILLEURS.
  --
  -- `SECURITY DEFINER` fait tomber la RLS pour le corps de cette fonction : sans ce
  -- garde-fou, n'importe quel porteur de jeton `authenticated` lirait TOUTES les salles.
  -- C'est le prix de la porte unique, et il se paie par cette ligne.
  --
  -- ⚠️ `is_super_admin()` est le MÊME prédicat que les 17 politiques RLS existantes —
  -- `SELECT role = 'super_admin' FROM profiles WHERE id = auth.uid() AND deleted_at IS
  -- NULL`. On ne le redéfinit pas : une seconde définition du super-admin finirait par
  -- diverger de la première, et c'est exactement le motif que GYM-350 a payé.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'cockpit_list_gyms: réservé au super-administrateur'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.name,
    g.slug,
    -- La colonne BRUTE, pour que le cockpit voie l'écart quand il y en a un...
    g.plan,
    -- ...et le plan EFFECTIF, qui est celui qui fait foi. Il tient compte de l'essai et
    -- des dérogations par salle de `nexxia_features` — deux raisons pour lesquelles la
    -- colonne `plan` seule ment (Dopamine est `premium` mais n'a pas `multi_site`).
    -- ⚠️ `get_effective_plan_core` rend du JSONB, pas un composite — vérifié sur la base :
    -- la notation `(f(x)).champ` y échoue (42809). D'où les accesseurs `->>`.
    public.get_effective_plan_core(g.id) ->> 'effective_plan',
    g.status,
    (public.get_effective_plan_core(g.id) ->> 'trial_active')::boolean,
    g.trial_ends_at,

    -- ═══ LE DÉCOMPTE DES MEMBRES — PRÉDICAT DE GYM-348, À LA LETTRE ═══
    --
    -- 🔴 JAMAIS `profiles.gym_id`. Depuis GYM-283, cette colonne n'est plus « la salle du
    -- membre » mais sa salle ACTIVE — celle qu'il regarde en ce moment. Un membre inscrit
    -- dans deux salles qui bascule sur la seconde DISPARAÎTRAIT du décompte de la
    -- première, alors qu'il y occupe toujours sa place.
    --
    -- Le prédicat est recopié de `_shared/booking-guards.ts`, qui le tient lui-même de
    -- `handle_new_user` :
    --     FROM member_gyms mg JOIN profiles p ON p.id = mg.member_id
    --     WHERE mg.gym_id = <salle> AND p.role = 'member' AND p.deleted_at IS NULL
    -- Trois lecteurs, un seul décompte. Un quatrième qui compterait autrement rendrait
    -- une salle « pleine » pour l'un et pas pour l'autre, sans qu'on sache lequel a raison.
    (SELECT count(*)::integer
       FROM public.member_gyms mg
       JOIN public.profiles p ON p.id = mg.member_id
      WHERE mg.gym_id = g.id
        AND p.role = 'member'
        AND p.deleted_at IS NULL),

    -- Créneaux À VENIR, pas le total : c'est le signe de vie d'une salle. Une salle avec
    -- 400 créneaux passés et zéro à venir est une salle qui a cessé de s'en servir.
    (SELECT count(*)::integer
       FROM public.time_slots t
      WHERE t.gym_id = g.id
        AND t.starts_at > now()
        AND t.status <> 'cancelled'),

    -- Mollie : `status = 'active'` et rien d'autre. Une connexion en `refresh_failed`
    -- n'encaisse plus — la compter comme connectée ferait croire à une salle qui vend.
    EXISTS (SELECT 1 FROM public.gym_mollie_connections m
             WHERE m.gym_id = g.id AND m.status = 'active'),

    -- ═══ IDENTITÉ LÉGALE — LA RÈGLE DE GYM-121, ET ELLE SEULE ═══
    --
    -- 🔴 CORRIGÉ À L'APPLICATION (staging, 21/09). J'avais écrit le prédicat à la main, en
    -- y exigeant `legal_form`. Dopamine ne l'a pas — et n'a pas à l'avoir : une personne
    -- physique n'a pas de forme juridique. Ma version affichait donc EN ROUGE une salle qui
    -- encaisse légalement, et Pace avec elle. Les deux, en réalité, sont complètes.
    --
    -- ⚠️ UNE SEULE RÈGLE, ET ELLE VIT DÉJÀ EN BASE. `gym_legal_identity_complete` délègue à
    -- `gym_legal_identity_missing`, qui sert déjà les factures membres et le dashboard. Un
    -- second prédicat recopié ici aurait divergé du premier — c'est exactement le motif que
    -- le décompte des membres a coûté (GYM-348), reproduit sur l'identité légale.
    public.gym_legal_identity_complete(g.id),

    -- Dernière activité : le plus récent des trois signaux qui disent qu'une salle VIT —
    -- une réservation, un paiement, une connexion de membre. Pas `updated_at` de la
    -- salle, qui bouge quand le cockpit change un réglage et donnerait une salle morte
    -- pour vivante.
    GREATEST(
      -- ⚠️ `booked_at`, PAS `created_at` : la table `bookings` n'a pas de `created_at`.
      (SELECT max(b.booked_at) FROM public.bookings b WHERE b.gym_id = g.id),
      (SELECT max(pa.created_at) FROM public.payments pa WHERE pa.gym_id = g.id),
      (SELECT max(p2.last_seen_at)
         FROM public.member_gyms mg2
         JOIN public.profiles p2 ON p2.id = mg2.member_id
        WHERE mg2.gym_id = g.id AND p2.deleted_at IS NULL)
    ),

    g.created_at
  FROM public.nexxia_gyms g
  ORDER BY g.created_at;
END;
$$;

COMMENT ON FUNCTION public.cockpit_list_gyms() IS
  'Cockpit B2B lot 1 — liste des salles, LECTURE SEULE. Refuse tout appelant qui n''est '
  'pas super-administrateur (ERRCODE 42501). Le décompte des membres emploie le prédicat '
  'de GYM-348 (member_gyms × profiles, role=member, deleted_at IS NULL), jamais '
  'profiles.gym_id.';

-- ⚠️ EXECUTE À `authenticated` ET NON À `public` : `anon` n'a aucune raison d'atteindre
-- cette porte, même pour s'y faire refuser. Le refus interne reste la vraie garde — ceci
-- n'est que la première.
REVOKE ALL ON FUNCTION public.cockpit_list_gyms() FROM public;

-- 🔴 AJOUTÉ À L'APPLICATION (staging, 21/09) — ET CE N'EST PAS REDONDANT.
--
-- Toute fonction créée dans `public` naît EXÉCUTABLE PAR TOUS, et PostgREST expose `anon`
-- comme un rôle à part entière. `REVOKE ... FROM public` retire le droit accordé au
-- pseudo-rôle PUBLIC — il ne retire PAS un droit accordé nommément à `anon`, que Supabase
-- pose de son côté. Sans cette ligne, `anon` conservait l'EXECUTE : il se serait fait
-- refuser par le garde interne, mais la porte lui restait ouverte, et une porte ouverte
-- qu'on croit fermée est ce qui finit par se voir en prod.
REVOKE EXECUTE ON FUNCTION public.cockpit_list_gyms() FROM anon;

GRANT EXECUTE ON FUNCTION public.cockpit_list_gyms() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Elle ne CRÉE AUCUN COMPTE super-administrateur, et c'est délibéré.
--
-- ⚠️ NE PAS PROMOUVOIR `nexxia.studio@gmail.com` : ce compte est `gym_admin` sur
-- Dopamine, et `profiles.role` est UNE SEULE COLONNE. Le promouvoir lui ferait perdre son
-- rôle de gérant sur Dopamine — et, au passage, le dashboard de la salle avec.
--
-- Le compte dédié proposé est `admin@viniz.app`, à créer PAR LE COCKPIT, en SQL, après
-- application de cette migration :
--
--     -- 1. créer l'utilisateur via l'interface Supabase (Auth > Users > Add user),
--     --    mot de passe fort, email confirmé ;
--     -- 2. puis, et seulement ensuite :
--     UPDATE public.profiles
--        SET role = 'super_admin', gym_id = NULL, updated_at = now()
--      WHERE email = 'admin@viniz.app';
--
-- ⚠️ `gym_id = NULL` : un super-administrateur n'appartient à aucune salle. Lui en laisser
-- une le ferait apparaître dans le décompte des membres de cette salle-là.


-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  🔴 LES POLITIQUES SUPER-ADMIN PASSENT EN LECTURE SEULE                               ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- LE PRINCIPE : le super-administrateur LIT par la RLS, il n'ÉCRIT que par des RPC
-- `SECURITY DEFINER` qui journalisent dans `gym_admin_actions` DANS LA MÊME TRANSACTION
-- (lot 2). Un journal qu'on peut contourner n'est pas un journal.
--
-- L'ÉTAT AVANT : 16 politiques sur 17 étaient en `ALL` — lecture ET écriture. Le compte
-- super-administrateur, une fois créé, aurait pu écrire partout, y compris sur `profiles` :
-- donc PROMOUVOIR D'AUTRES SUPER-ADMINISTRATEURS, hors de tout journal. C'est cette
-- écriture-là qui n'a aucune raison d'exister.
--
-- ⚠️ AUCUN GÉRANT NE PERD RIEN, ET CE N'EST PAS UNE OPINION.
-- Les 17 politiques ont toutes `USING (is_super_admin())` SEUL — relevé sur la production
-- le 21/09, aucune ne combine `gym_admin` et `super_admin` dans une même clause. Or une
-- politique `USING (is_super_admin())` n'accorde JAMAIS rien à un gérant : le prédicat est
-- faux pour lui. La passer en `SELECT` ne peut donc lui retirer aucun droit. Les droits des
-- gérants vivent dans des politiques SÉPARÉES, que cette migration ne touche pas.
--
-- ⚠️ ET LA MIGRATION LE VÉRIFIE ELLE-MÊME PLUTÔT QUE DE ME CROIRE.
-- La boucle ci-dessous ne convertit QUE les politiques dont le `USING` vaut EXACTEMENT
-- `is_super_admin()` et qui n'ont AUCUN `WITH CHECK`. Une politique combinée — « admin de
-- la salle OU super_admin » — ne correspondrait pas au motif et serait laissée intacte,
-- même si la base avait changé depuis mon relevé. C'est la leçon de GYM-350 : une
-- migration qui fait confiance à un instantané est une migration qui ment un jour.
--
-- ⚠️ TROIS TABLES N'ONT QUE CETTE POLITIQUE : `impersonation_logs`, `login_attempts` et
-- `super_admin_proxy_actions`. Elles deviennent donc en lecture seule POUR LA RLS — mais
-- elles sont vides (0 ligne, vérifié) et ne sont écrites que par `service_role`, QUI
-- CONTOURNE LA RLS. Rien ne se ferme qui était ouvert à quelqu'un.
--
-- `credit_adjustments` est déjà en `SELECT` : la boucle ne la voit pas, et c'est correct.

DO $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND cmd = 'ALL'
       -- Espaces retirés : `pg_policies` peut rendre `is_super_admin()` avec des variantes
       -- de mise en forme selon la version de Postgres.
       AND regexp_replace(coalesce(qual::text, ''), '\s', '', 'g') = 'is_super_admin()'
       AND coalesce(with_check::text, '') = ''
     ORDER BY tablename
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_super_admin())',
      r.policyname, r.tablename);
    n := n + 1;
    RAISE NOTICE '  lecture seule : %  (%)', r.tablename, r.policyname;
  END LOOP;

  RAISE NOTICE 'Politiques super-admin converties en lecture seule : %', n;

  -- 🔴 LE COMPTE ATTENDU EST 16, relevé sur la production le 21/09. Un écart n'arrête pas
  -- la migration — il peut venir d'un environnement légitimement différent — mais il DOIT
  -- se voir. Une conversion silencieuse de 3 politiques au lieu de 16 laisserait treize
  -- écritures ouvertes sans que personne ne le sache.
  IF n <> 16 THEN
    RAISE WARNING '⚠️ ATTENDU 16 politiques, % converties. Relire pg_policies AVANT de créer le compte super-administrateur.', n;
  END IF;
END $$;

-- Contrôle d'après-coup, lisible dans la sortie de psql : plus aucune politique
-- super-admin ne doit autoriser l'écriture.
DO $$
DECLARE
  restantes integer;
BEGIN
  SELECT count(*) INTO restantes
    FROM pg_policies
   WHERE schemaname = 'public'
     AND cmd <> 'SELECT'
     AND (qual::text ILIKE '%is_super_admin%' OR coalesce(with_check::text, '') ILIKE '%is_super_admin%');

  IF restantes = 0 THEN
    RAISE NOTICE '✅ Aucune politique super-admin n''accorde plus l''écriture.';
  ELSE
    RAISE WARNING '🔴 % politique(s) super-admin accordent ENCORE l''écriture — à examiner une par une.', restantes;
  END IF;
END $$;


-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  CE QUE CETTE MIGRATION NE RÉVOQUE PAS, ET POURQUOI                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Deux révocations étaient demandées. Les deux garde-fous posés avec elles ont SAUTÉ à la
-- vérification. Rien n'est révoqué ; voici ce qui a été trouvé.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ① `INSERT(role)` sur `profiles` — NON RÉVOQUÉ : un appelant client le pose
-- ─────────────────────────────────────────────────────────────────────────────────────
-- `apps/mobile/lib/ensureProfile.ts:151` fait bien `supabase.from('profiles').insert({…})`
-- et la ligne 156 y pose `role: 'member'`. La consigne était : « s'il en pose un, dis-le au
-- lieu de révoquer ». Il en pose un.
--
-- ⚠️ MAIS CE CHEMIN EST DÉJÀ MORT, et c'est ce qui rend la décision facile :
-- `profiles` porte QUATRE politiques — une `ALL` (super-admin), deux `SELECT`, une
-- `UPDATE` — et AUCUNE `INSERT`. La RLS étant active, PostgreSQL refuse donc tout INSERT
-- client, quel que soit le droit de colonne. Le repli d'`ensureProfile` ne peut pas
-- s'exécuter aujourd'hui ; son échec part d'ailleurs dans Sentry sous le tag
-- `gym338_fallback_insert`.
--
-- 🔴 LE RISQUE RÉEL EST INTACT : le jour où quelqu'un ajoute une politique `INSERT` sur
-- `profiles` — pour faire revivre ce repli, par exemple — la colonne `role` devient
-- écrivable PAR LE CLIENT, `anon` compris. C'est la forme exacte du piège de gym203 :
-- un droit dormant que personne ne relit, réveillé par un changement sans rapport.
--
-- RECOMMANDATION (décision du cockpit) : supprimer d'abord le repli mort
-- d'`ensureProfile.ts`, puis révoquer :
--     REVOKE INSERT (role) ON public.profiles FROM anon, authenticated;
-- Dans cet ordre, rien ne casse — et sans le repli, plus aucun appelant ne pose `role`.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ② `UPDATE(gym_id)` sur `profiles` — NON RÉVOQUÉ : la prémisse est inexacte
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Le cadrage disait : « les anciennes versions sont déjà refusées par le trigger de
-- GYM-338 ». Le trigger déployé dit autre chose. `enforce_gym_id_immutable`, relu sur la
-- production :
--
--     IF NEW.gym_id IS DISTINCT FROM OLD.gym_id THEN
--       IF NEW.gym_id IS NOT NULL AND EXISTS (
--         SELECT 1 FROM member_gyms mg WHERE mg.member_id = NEW.id AND mg.gym_id = NEW.gym_id
--       ) THEN RETURN NEW;  -- ← PASSE
--       END IF;
--       RAISE EXCEPTION 'GYM_ID_IMMUTABLE…' USING ERRCODE = '42501';
--     END IF;
--
-- Il LAISSE DONC PASSER un client qui bascule vers une salle DONT IL EST DÉJÀ MEMBRE.
-- Ce n'est pas un trou : c'est précisément la bascule de salle active, et le trigger porte
-- déjà la propriété de sécurité qui compte — on ne peut pointer que vers une salle à
-- laquelle on appartient. Une ancienne version de l'app qui basculerait par un PATCH
-- direct fonctionne donc ENCORE aujourd'hui, contrairement à ce que la prémisse supposait.
--
-- Côté dépôt, plus aucun appelant ne l'utilise : la bascule passe par `switch_active_gym`
-- et le rattrapage par `claim_app_gym` — toutes deux `SECURITY DEFINER`, donc indifférentes
-- aux droits de colonne. Révoquer ne casserait RIEN de ce que nous compilons aujourd'hui,
-- mais casserait les binaires en circulation qui utilisent encore le chemin direct, sans
-- gain de sécurité puisque le trigger garde déjà la porte.
--
-- RECOMMANDATION : ne pas révoquer tant que le parc mobile n'est pas connu. Si le cockpit
-- confirme qu'aucun binaire antérieur à `switch_active_gym` ne circule plus, alors :
--     REVOKE UPDATE (gym_id) ON public.profiles FROM authenticated;
