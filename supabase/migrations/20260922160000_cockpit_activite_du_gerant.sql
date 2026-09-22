-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  COCKPIT — UNE SALLE EN CONFIGURATION N'EST PAS UNE SALLE MORTE                       ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- MESURÉ LE 22/09 SUR « The Pulse Box », créée le matin même : 2 activités, 1 coach,
-- 2 créneaux, dernier créneau posé à 10 h 27. Le cockpit affichait « dernière activité : — ».
--
-- POURQUOI. `derniere_activite` ne regardait que ce que font les MEMBRES : réservations,
-- paiements, et la dernière visite d'un membre. Une salle qui n'a pas encore un seul membre
-- ne pouvait donc rien produire — alors que son gérant venait d'y passer la matinée.
--
-- ⚠️ CORPS REPRIS SUR LE DÉPLOYÉ (`pg_get_functiondef`, production, 22/09), PAS sur le
-- fichier du dépôt : la version installée diffère de celle de la migration d'origine —
-- elle appelle `public.gym_legal_identity_complete(g.id)` (la règle canonique GYM-121) là
-- où le fichier portait un prédicat écrit à la main. Cette correction est CONSERVÉE ici.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 CE QUE LE RELEVÉ A RÉVÉLÉ EN PASSANT : UN TERME MORT
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Le troisième terme lisait `profiles.last_seen_at`. Or **cette colonne n'est écrite nulle
-- part** — vérifié sur tout le dépôt : une lecture dans `useMembers`, une note de GYM-203
-- (« télémétrie serveur ; aucune écriture client »), et rien d'autre. Elle vaut `NULL` sur
-- les trois salles de production.
--
-- Le terme n'était donc pas faux : il était VIDE. `derniere_activite` reposait en réalité
-- sur deux termes, pas trois. Le § 2 lui donne enfin une source.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LA VISITE, ENFIN ENREGISTRÉE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ UNE RPC, PAS UN `UPDATE` CLIENT. `last_seen_at` est absente de la liste blanche de
-- colonnes GYM-203 : un client ne peut pas l'écrire, et c'est très bien ainsi — une
-- télémétrie que son sujet peut forger ne vaut rien. La RPC n'accepte aucun paramètre :
-- elle écrit `now()` sur `auth.uid()`, et sur personne d'autre.
--
-- ⚠️ ELLE NE TOUCHE PAS `updated_at`. C'est une visite, pas une modification du profil :
-- faire bouger `updated_at` à chaque chargement de page brouillerait la seule colonne qui
-- dit « cette fiche a changé ».
CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;  -- Pas de session : rien à noter, et surtout rien à refuser bruyamment.
  END IF;

  UPDATE public.profiles
     SET last_seen_at = now()
   WHERE id = v_uid
     AND deleted_at IS NULL
     -- ⚠️ ANTI-BATTEMENT. Le dashboard l'appelle au montage ; un gérant qui navigue
     -- écrirait autrement une ligne par écran. Cinq minutes suffisent largement à la
     -- granularité d'un « vu le ».
     AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes');
END;
$function$;

COMMENT ON FUNCTION public.touch_last_seen() IS
  'GYM — note la visite de l''appelant (profiles.last_seen_at = now()), au plus une fois '
  'toutes les 5 minutes. Aucun paramètre : écrit sur auth.uid() et sur personne d''autre. '
  'Contourne la liste blanche GYM-203, qui interdit l''écriture client de cette colonne.';

REVOKE ALL     ON FUNCTION public.touch_last_seen() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_last_seen() FROM anon;
GRANT  EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. `derniere_activite` COMPTE AUSSI LE GÉRANT
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Sept termes désormais, en deux familles :
--
--   CE QUE FONT LES MEMBRES — réservations, paiements, et la visite d'un membre.
--   CE QUE FAIT LE GÉRANT   — activités créées, créneaux créés, coachs créés, et sa
--                             propre visite au dashboard.
--
-- ⚠️ `created_at` ET NON `updated_at` sur les trois objets de configuration. Un `updated_at`
-- bouge aussi quand un TRIGGER touche la ligne (`trg_update_bookings_count` sur les
-- créneaux, par exemple) : la « dernière activité » se mettrait alors à jour toute seule
-- au premier membre qui réserve, et dirait « le gérant est venu » alors qu'il n'est pas
-- venu. On ne compte que des CRÉATIONS, qui sont toujours des gestes humains.
--
-- ⚠️ LA VISITE EST LUE SUR `profiles.gym_id`, PAS SUR `member_gyms`. Le terme existant
-- passe par l'adhésion ; un gérant en a une depuis GYM-338, mais pas ceux des salles
-- antérieures. Le nouveau terme les rattrape, et il coûte une lecture indexée.
--
-- ⚠️ `GREATEST` IGNORE LES `NULL` en PostgreSQL (contrairement à la somme) : une salle sans
-- paiement ni réservation rend bien la date de son dernier créneau, et non `NULL`.
CREATE OR REPLACE FUNCTION public.cockpit_list_gyms()
RETURNS TABLE(
  gym_id uuid, name text, slug text, plan_colonne text, plan_effectif text,
  statut text, essai_actif boolean, essai_fin timestamp with time zone,
  membres integer, creneaux_a_venir integer, mollie_connecte boolean,
  identite_legale_ok boolean, derniere_activite timestamp with time zone,
  creee_le timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- 🔴 LE REFUS EST ICI. SECURITY DEFINER fait tomber la RLS pour ce corps : sans ce
  -- garde-fou, tout porteur de jeton authenticated lirait TOUTES les salles.
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'cockpit_list_gyms: réservé au super-administrateur' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    g.id, g.name, g.slug, g.plan,
    public.get_effective_plan_core(g.id) ->> 'effective_plan',
    g.status,
    (public.get_effective_plan_core(g.id) ->> 'trial_active')::boolean,
    g.trial_ends_at,
    -- Prédicat de GYM-348, à la lettre — jamais profiles.gym_id.
    (SELECT count(*)::integer FROM public.member_gyms mg
       JOIN public.profiles p ON p.id = mg.member_id
      WHERE mg.gym_id = g.id AND p.role = 'member' AND p.deleted_at IS NULL),
    (SELECT count(*)::integer FROM public.time_slots t
      WHERE t.gym_id = g.id AND t.starts_at > now() AND t.status <> 'cancelled'),
    EXISTS (SELECT 1 FROM public.gym_mollie_connections m
             WHERE m.gym_id = g.id AND m.status = 'active'),
    -- La règle canonique (GYM-121), jamais une seconde définition.
    public.gym_legal_identity_complete(g.id),
    GREATEST(
      -- ── Ce que font les MEMBRES ────────────────────────────────────────────────
      (SELECT max(b.booked_at) FROM public.bookings b WHERE b.gym_id = g.id),
      (SELECT max(pa.created_at) FROM public.payments pa WHERE pa.gym_id = g.id),
      (SELECT max(p2.last_seen_at) FROM public.member_gyms mg2
         JOIN public.profiles p2 ON p2.id = mg2.member_id
        WHERE mg2.gym_id = g.id AND p2.deleted_at IS NULL),
      -- ── Ce que fait le GÉRANT ──────────────────────────────────────────────────
      (SELECT max(ac.created_at) FROM public.activities ac WHERE ac.gym_id = g.id),
      (SELECT max(ts.created_at) FROM public.time_slots ts WHERE ts.gym_id = g.id),
      (SELECT max(co.created_at) FROM public.coaches co WHERE co.gym_id = g.id),
      (SELECT max(p3.last_seen_at) FROM public.profiles p3
        WHERE p3.gym_id = g.id AND p3.deleted_at IS NULL)
    ),
    g.created_at
  FROM public.nexxia_gyms g
  ORDER BY g.created_at;
END;
$function$;

COMMENT ON FUNCTION public.cockpit_list_gyms() IS
  'Cockpit lot 1 — liste des salles pour le super-administrateur (42501 sinon). '
  '`derniere_activite` compte désormais l''activité du GÉRANT (activités, créneaux et '
  'coachs CRÉÉS, et sa visite au dashboard) en plus de celle des membres : une salle en '
  'configuration ne doit pas paraître morte.';

REVOKE ALL     ON FUNCTION public.cockpit_list_gyms() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cockpit_list_gyms() FROM anon;
GRANT  EXECUTE ON FUNCTION public.cockpit_list_gyms() TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. CONTRÔLE D'APPLICATION
-- ═════════════════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_src text;
  v_n   integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='cockpit_list_gyms';

  -- La correction appliquée à la main le 21/09 doit avoir SURVÉCU à cette réécriture.
  IF v_src NOT LIKE '%gym_legal_identity_complete%' THEN
    RAISE EXCEPTION 'COCKPIT : la règle canonique GYM-121 a été perdue en réécrivant la fonction';
  END IF;

  -- Les quatre termes du gérant.
  v_n := 0;
  IF v_src LIKE '%public.activities ac%' THEN v_n := v_n + 1; END IF;
  IF v_src LIKE '%public.time_slots ts%'  THEN v_n := v_n + 1; END IF;
  IF v_src LIKE '%public.coaches co%'     THEN v_n := v_n + 1; END IF;
  IF v_src LIKE '%p3.gym_id = g.id%'      THEN v_n := v_n + 1; END IF;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'COCKPIT : % terme(s) d''activité gérant sur 4', v_n;
  END IF;

  IF to_regprocedure('public.touch_last_seen()') IS NULL THEN
    RAISE EXCEPTION 'COCKPIT : touch_last_seen() absente — le terme de visite resterait vide';
  END IF;

  RAISE NOTICE 'COCKPIT : dernière activité élargie au gérant, touch_last_seen posée.';
END
$verif$;
