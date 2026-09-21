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

    -- Identité légale COMPLÈTE : c'est ce qu'il faut pour facturer la salle (lot 4) et
    -- pour que SES factures membres soient conformes. Partiel = faux, sans nuance : une
    -- identité à moitié remplie ne permet ni l'un ni l'autre.
    (g.legal_name IS NOT NULL AND btrim(g.legal_name) <> ''
     AND g.legal_form IS NOT NULL AND btrim(g.legal_form) <> ''
     AND g.legal_address IS NOT NULL AND btrim(g.legal_address) <> ''
     AND g.legal_postal_code IS NOT NULL AND btrim(g.legal_postal_code) <> ''
     AND g.legal_city IS NOT NULL AND btrim(g.legal_city) <> ''
     AND g.vat_number IS NOT NULL AND btrim(g.vat_number) <> ''),

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
