-- ═══════════════════════════════════════════════════════════════════════════════════════
-- GYM-293 — join_gym_self_serve(p_slug) : le MIROIR de create_gym_self_serve, côté membre.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- CE QU'ELLE COMBLE. Un gérant peut créer sa salle en self-serve (GYM-248). Un MEMBRE, lui,
-- ne pouvait rejoindre une salle que par un chemin administré — invitation, création par le
-- gérant. En mode multi, où l'app se présente à un membre qui vient de choisir sa salle dans
-- la recherche, il n'existait aucun moyen de la REJOINDRE : le lien « Créer un compte » a
-- d'ailleurs été masqué pour cette raison (GYM-293, mitigation de #230).
--
-- ⚠️ ELLE NE TOUCHE PAS `handle_new_user`. Le trigger pose déjà la salle à la NAISSANCE du
-- compte quand elle est connue, avec sa propre garde de plafond. Cette RPC couvre le cas
-- qu'il ne peut pas couvrir : le compte existe DÉJÀ (email confirmé, session ouverte) et le
-- rattachement se décide APRÈS. Deux moments, deux chemins ; les faire cohabiter est plus sûr
-- que d'en faire un seul qui devrait deviner lequel des deux il est en train de servir.
--
-- ⚠️ LE DÉCOMPTE DE PLAFOND PORTE SUR `member_gyms`, comme le trigger LIVE. Vérifié en base,
-- pas déduit du dépôt : `handle_new_user` déployée compte bien sur `member_gyms` (GYM-283 l'y
-- a corrigée), alors que le FICHIER de migration GYM-248 montre encore un décompte sur
-- `profiles.gym_id` — il est superseded par GYM-102. Compter sur `profiles.gym_id` serait
-- compter les salles ACTIVES : un membre de la salle A en train de consulter la salle B ne
-- serait pas compté pour A, et le plafond laisserait passer plus de monde qu'il ne le dit.
--
-- Codes d'erreur — MÊME convention que create_gym_self_serve, pour que l'UI mobile n'ait
-- qu'un seul tableau à connaître :
--   PT401  non authentifié            PT404  salle inconnue ou supprimée
--   PT403  email non confirmé         PT429  quota horaire dépassé
--   PT409  salle complète (plafond du plan atteint)

CREATE OR REPLACE FUNCTION public.join_gym_self_serve(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_confirmed    timestamptz;
  v_gym_id       uuid;
  v_gym_name     text;
  v_slug         text := lower(btrim(coalesce(p_slug, '')));
  v_plan         jsonb;
  v_max_members  integer;
  v_members      integer;
  v_ip           text;
  v_ident        text;
  v_attempts     integer;
  v_active       uuid;
  v_created      boolean := false;
  c_rl_action    constant text     := 'join_gym_self_serve';
  c_rl_window    constant interval := interval '1 hour';
  c_rl_max       constant integer  := 5;
BEGIN
  -- ── a) Authentification ──────────────────────────────────────────────────────────
  -- ⚠️ L'IDENTITÉ VIENT DE auth.uid(), JAMAIS D'UN PARAMÈTRE. La fonction est SECURITY
  -- DEFINER : elle contourne la RLS, donc le seul rempart est que l'identité vienne du
  -- jeton. Accepter un p_member_id permettrait de rattacher n'importe qui à n'importe quoi.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'join_gym_self_serve: appel non authentifié'
      USING ERRCODE = 'PT401', HINT = 'GYM_UNAUTHENTICATED';
  END IF;

  -- ── b) Email confirmé ────────────────────────────────────────────────────────────
  -- Même exigence que la création de salle : un email non confirmé, c'est une adresse dont
  -- on ne sait pas si elle appartient à l'appelant. On ne rattache pas un compte non vérifié
  -- à la salle d'un client.
  SELECT email_confirmed_at INTO v_confirmed FROM auth.users WHERE id = v_uid;
  IF v_confirmed IS NULL THEN
    RAISE EXCEPTION 'join_gym_self_serve: email non confirmé'
      USING ERRCODE = 'PT403', HINT = 'GYM_EMAIL_NOT_CONFIRMED';
  END IF;

  -- ── c) Quota horaire ─────────────────────────────────────────────────────────────
  -- Même mécanique que create_gym_self_serve, mêmes limites assumées : un RAISE annule la
  -- transaction, donc l'incrément d'une tentative REFUSÉE est annulé avec elle. Le compteur
  -- ne retient que les appels qui COMMITENT — ici, les rattachements réussis. C'est bien la
  -- forme d'abus visée : l'inscription en masse à des salles.
  v_ip := NULL;
  BEGIN
    v_ip := nullif(btrim(split_part(
      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for',
      ',', 1)), '');
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  FOREACH v_ident IN ARRAY (
    ARRAY['user:' || v_uid::text] || CASE WHEN v_ip IS NULL THEN ARRAY[]::text[]
                                          ELSE ARRAY['ip:' || v_ip] END
  ) LOOP
    INSERT INTO public.rate_limits (identifier, action, attempts, window_start)
    VALUES (v_ident, c_rl_action, 1, now())
    ON CONFLICT (identifier, action) DO UPDATE SET
      attempts = CASE
        WHEN rate_limits.window_start > now() - c_rl_window
          THEN rate_limits.attempts + 1
        ELSE 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start > now() - c_rl_window
          THEN rate_limits.window_start
        ELSE now()
      END
    RETURNING attempts INTO v_attempts;

    IF v_attempts > c_rl_max THEN
      RAISE EXCEPTION 'join_gym_self_serve: trop de tentatives, réessayez plus tard'
        USING ERRCODE = 'PT429', HINT = 'GYM_RATE_LIMITED';
    END IF;
  END LOOP;

  -- ── d) La salle existe, et elle n'est pas supprimée ──────────────────────────────
  -- ⚠️ MÊME FILTRE QUE public_gym_branding : une salle supprimée reste en base et garde son
  -- slug. Sans `deleted_at IS NULL`, un ancien lien rattacherait un membre à une salle qui
  -- n'existe plus pour personne d'autre.
  SELECT id, name INTO v_gym_id, v_gym_name
    FROM public.nexxia_gyms
   WHERE slug = v_slug AND deleted_at IS NULL;

  IF v_gym_id IS NULL THEN
    RAISE EXCEPTION 'join_gym_self_serve: salle inconnue'
      USING ERRCODE = 'PT404', HINT = 'GYM_NOT_FOUND';
  END IF;

  -- ── e) Idempotence AVANT le plafond ──────────────────────────────────────────────
  -- 🔴 L'ORDRE COMPTE. Un membre DÉJÀ rattaché ne doit pas se voir refuser l'entrée parce que
  -- la salle est pleine : il occupe déjà sa place. Vérifier le plafond d'abord ferait échouer
  -- un second appel (reprise réseau, retour d'écran) sur une salle saturée — et laisserait
  -- l'app croire que le rattachement n'a jamais eu lieu.
  IF EXISTS (SELECT 1 FROM public.member_gyms
              WHERE member_id = v_uid AND gym_id = v_gym_id) THEN
    v_created := false;
  ELSE
    -- ── f) Plafond du plan ─────────────────────────────────────────────────────────
    v_plan := public.get_effective_plan(v_gym_id);

    IF v_plan IS NULL THEN
      -- ⚠️ PANNE DE RÉSOLUTION ≠ « AUCUN DROIT ». On ne rattache pas, et on le dit comme une
      -- indisponibilité : laisser passer ouvrirait le plafond à l'infini, refuser en
      -- « salle pleine » accuserait une salle qui ne l'est peut-être pas.
      RAISE EXCEPTION 'join_gym_self_serve: plan indisponible'
        USING ERRCODE = 'PT503', HINT = 'PLAN_RESOLUTION_FAILED';
    END IF;

    v_max_members := nullif(v_plan->'limits'->>'max_members', '')::integer;

    IF v_max_members IS NOT NULL THEN
      -- MÊME prédicat que `handle_new_user` LIVE (corrigé par GYM-283) : les MEMBRES actifs
      -- rattachés à cette salle. Gérants et coachs relèvent de max_admins ; les comptes
      -- supprimés ne consomment pas de place.
      SELECT count(*) INTO v_members
        FROM public.member_gyms mg
        JOIN public.profiles p ON p.id = mg.member_id
       WHERE mg.gym_id = v_gym_id
         AND p.role = 'member'
         AND p.deleted_at IS NULL;

      IF v_members >= v_max_members THEN
        RAISE EXCEPTION 'join_gym_self_serve: salle complète'
          USING ERRCODE = 'PT409', HINT = 'GYM_FULL';
      END IF;
    END IF;

    INSERT INTO public.member_gyms (member_id, gym_id)
    VALUES (v_uid, v_gym_id)
    ON CONFLICT (member_id, gym_id) DO NOTHING;
    v_created := true;
  END IF;

  -- ── g) La salle ACTIVE, posée seulement si elle est vide ─────────────────────────
  -- 🔴 ON N'ÉCRASE JAMAIS UNE SALLE ACTIVE EXISTANTE. Un membre de trois salles qui en
  -- rejoint une quatrième ne doit pas être déplacé sans l'avoir demandé — c'est la règle de
  -- GYM-292, et la bascule a son chemin à elle (`switch_active_gym`). Ici on ne fait que
  -- combler un `NULL`, c'est-à-dire donner une salle à qui n'en avait aucune.
  SELECT gym_id INTO v_active FROM public.profiles WHERE id = v_uid;
  IF v_active IS NULL THEN
    UPDATE public.profiles SET gym_id = v_gym_id, updated_at = now() WHERE id = v_uid;
    v_active := v_gym_id;
  END IF;

  RETURN jsonb_build_object(
    'gym_id',   v_gym_id,
    'name',     v_gym_name,
    'slug',     v_slug,
    'created',  v_created,
    'is_active', v_active = v_gym_id
  );
END;
$$;

COMMENT ON FUNCTION public.join_gym_self_serve(text) IS
  'GYM-293 — rattache le membre APPELANT (auth.uid()) à une salle par son slug. Miroir de '
  'create_gym_self_serve : mêmes gardes (auth, email confirmé, quota 5/h), plafond du plan '
  'compté sur member_gyms. Idempotente. Ne déplace JAMAIS une salle active existante.';

-- ⚠️ REVOKE EXPLICITE SUR anon — LE PIÈGE DU PROJET, constaté en GYM-289. `REVOKE ... FROM
-- PUBLIC` ne suffit PAS : `anon` est un RÔLE RÉEL qui tient son droit des privilèges par
-- défaut du schéma (`ALTER DEFAULT PRIVILEGES ... GRANT EXECUTE ON FUNCTIONS TO anon`). Sans
-- ce second REVOKE, la fonction reste exécutable par un visiteur non connecté — sans
-- conséquence ici (auth.uid() NULL lève PT401) mais le GRANT mentirait sur la surface réelle.
REVOKE EXECUTE ON FUNCTION public.join_gym_self_serve(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_gym_self_serve(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.join_gym_self_serve(text) TO authenticated;
