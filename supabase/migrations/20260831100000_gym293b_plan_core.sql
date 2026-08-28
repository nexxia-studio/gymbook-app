-- ═══════════════════════════════════════════════════════════════════════════════════════
-- GYM-293b — LE RÉSOLVEUR DE PLAN SCINDÉ EN CŒUR + ENVELOPPE.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- 🔴 LA CAUSE, MESURÉE : UN CANDIDAT À L'ADHÉSION NE PEUT PAS LIRE LE PLAN DE LA SALLE
-- QU'IL VEUT REJOINDRE.
--
-- `join_gym_self_serve` appelle `get_effective_plan` pour lire `max_members`. Or l'ACL de ce
-- résolveur n'admet que `service_role` OU un profil dont la SALLE ACTIVE est déjà
-- `p_gym_id` :
--
--     IF NOT EXISTS (SELECT 1 FROM profiles p
--                     WHERE p.id = auth.uid() AND p.gym_id = p_gym_id ...)
--       RAISE ... ERRCODE = '42501';
--
-- Un candidat, par DÉFINITION, n'a pas encore cette salle pour salle active. Il ne peut
-- donc JAMAIS passer : le rattachement échouait à tous les coups, et la télémétrie le
-- rapportait en `unavailable` / `join_failed` — un message d'indisponibilité pour un refus
-- structurel.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LE PRINCIPE « RÉSOLVEUR UNIQUE » TIENT — ON NE DUPLIQUE RIEN
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Recopier la lecture du plan dans `join_gym_self_serve` aurait donné DEUX vérités sur le
-- plan d'une salle, qui auraient divergé au premier changement de grille. On sépare donc ce
-- qui est MÉLANGÉ aujourd'hui : le CALCUL du plan, et le DROIT de le demander.
--
--   · `get_effective_plan_core(uuid)` — tout le calcul, AUCUNE ACL. PRIVÉE : révoquée de
--     PUBLIC, `anon` et `authenticated`. Seules les fonctions SECURITY DEFINER du schéma,
--     qui s'exécutent sous le propriétaire, peuvent l'appeler.
--   · `get_effective_plan(uuid)` — l'ACL À L'IDENTIQUE, puis délégation au cœur. Signature,
--     codes d'erreur et format de retour STRICTEMENT inchangés : les quatre gardes serveur
--     et tous les appelants existants ne voient aucune différence.
--
-- ⚠️ L'ACL ELLE-MÊME N'EST PAS TOUCHÉE. Qu'elle regarde `profiles.gym_id` (la salle ACTIVE)
-- plutôt que `member_gyms` (l'appartenance) est une incohérence latente CONNUE — un membre
-- de trois salles ne peut lire le plan que de celle qu'il consulte. Elle est remontée, et
-- hors de ce lot : la corriger ici mêlerait un débloquage à un changement de règle d'accès.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CE QUI A ÉTÉ MESURÉ EN STAGING AVANT CE CORRECTIF (2026-08-28)
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Même salle cible, deux appelants, deux issues — la preuve que le refus vient de l'ACL et
-- non d'une panne du résolveur :
--
--   -- (1) MEMBRE de la salle → le plan se résout
--   select set_config('request.jwt.claims',
--            json_build_object('sub', (select id from auth.users
--                                       where email='member.studiotest@staging.test'),
--                              'role','authenticated')::text, true),
--          public.get_effective_plan((select id from nexxia_gyms
--                                      where slug='studio-test-staging'))
--            ->'limits'->>'max_members';
--   → "200"
--
--   -- (2) CANDIDAT (salle active = dopamine-staging) → refus sec
--   select set_config('request.jwt.claims',
--            json_build_object('sub', (select id from auth.users
--                                       where email='member.yoga@staging.test'),
--                              'role','authenticated')::text, true),
--          public.get_effective_plan((select id from nexxia_gyms
--                                      where slug='studio-test-staging'));
--   → ERROR 42501: get_effective_plan: accès refusé à la salle 1111…1111
--
-- Le candidat de (2) est exactement celui que `join_gym_self_serve` porte : il ne PEUT pas
-- passer, et aucune donnée ne le sauverait.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- PREUVE ATTENDUE APRÈS APPLICATION (à rejouer tel quel, scénario du cockpit)
-- ─────────────────────────────────────────────────────────────────────────────────────
--   do $x$ declare v uuid; begin
--     select id into v from auth.users where email = 'member.yoga@staging.test';
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', v, 'role', 'authenticated')::text, true);
--   end $x$;
--   set local role authenticated;
--   select public.join_gym_self_serve('studio-test-staging');
--
-- Attendu : un jsonb `{"gym_id": …, "created": true, …}`. Avant ce correctif : 42501.
-- ⚠️ Cet appel ÉCRIT (member_gyms) : le rejouer une seconde fois rend `created:false` —
-- c'est l'idempotence de GYM-293, pas un échec. Pour repartir de zéro, retirer la ligne.

-- ═══ 1) LE CŒUR — tout le calcul, aucune ACL ═════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_effective_plan_core(p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── HOOK TRIAL GYM-250 ────────────────────────────────────────────────────
  -- Quand true : une salle en status='trialing' dont trial_ends_at est encore dans le
  -- futur se voit servir les limites du plan v_trial_plan. La branche est ÉCRITE et
  -- parcourue par les tests ; seule cette constante la tient éteinte.
  -- ⚠️ ACTIVER = GYM-250, NE TOUCHER QUE CETTE CONSTANTE. Rien d'autre à modifier ici.
  v_trial_enabled CONSTANT boolean := false;
  -- Seul nom de plan cité dans ce fichier. Ce n'est pas un gate (`if plan = 'x'`) mais
  -- la désignation de la ligne de grille à servir pendant l'essai. Si la grille locale
  -- ne la contient pas, on retombe sur le plan réel de la salle plutôt que d'échouer :
  -- prod et staging ont toutes deux 'pro', mais le code ne le suppose pas.
  v_trial_plan    CONSTANT text    := 'pro';

  v_gym           public.nexxia_gyms%ROWTYPE;
  v_trial_active  boolean := false;
  v_eff_plan      text;
  v_limits        public.nexxia_plan_limits%ROWTYPE;
  v_features      jsonb;
  v_overrides     jsonb;
  v_sepa          numeric;
  v_cb            numeric;
BEGIN
  -- ── La salle ──────────────────────────────────────────────────────────────
  SELECT * INTO v_gym FROM public.nexxia_gyms WHERE id = p_gym_id;
  IF NOT FOUND OR v_gym.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'get_effective_plan: salle % introuvable ou supprimée', p_gym_id
      USING ERRCODE = 'P0002';
  END IF;

  -- ── Plan effectif ─────────────────────────────────────────────────────────
  v_eff_plan := v_gym.plan;

  IF v_trial_enabled
     AND v_gym.status = 'trialing'
     AND v_gym.trial_ends_at IS NOT NULL
     AND v_gym.trial_ends_at > now()
  THEN
    v_trial_active := true;
    -- Dégradation propre si la grille locale ne connaît pas le plan d'essai.
    IF EXISTS (SELECT 1 FROM public.nexxia_plan_limits WHERE plan = v_trial_plan) THEN
      v_eff_plan := v_trial_plan;
    END IF;
  END IF;

  -- ── Défauts du plan ───────────────────────────────────────────────────────
  SELECT * INTO v_limits FROM public.nexxia_plan_limits WHERE plan = v_eff_plan;
  IF NOT FOUND THEN
    -- Erreur d'intégrité : servir des limites vides ouvrirait tout en grand, servir
    -- des limites nulles fermerait tout. Les deux sont pires qu'un échec visible.
    RAISE EXCEPTION 'get_effective_plan: plan % absent de nexxia_plan_limits (salle %)',
      v_eff_plan, p_gym_id USING ERRCODE = 'P0002';
  END IF;

  -- ── Drapeaux : défauts du plan, puis overlay des overrides de la salle ────
  -- Les 10 booléens de la grille. coalesce(..., false) : une colonne NULL vaut « non
  -- accordé » — un droit ne s'accorde jamais par omission.
  v_features := jsonb_build_object(
    'custom_domain',          coalesce(v_limits.custom_domain,          false),
    'payments_enabled',       coalesce(v_limits.payments_enabled,       false),
    'notifications_enabled',  coalesce(v_limits.notifications_enabled,  false),
    'analytics_enabled',      coalesce(v_limits.analytics_enabled,      false),
    'multi_site_enabled',     coalesce(v_limits.multi_site_enabled,     false),
    'ios_app_enabled',        coalesce(v_limits.ios_app_enabled,        false),
    'android_app_enabled',    coalesce(v_limits.android_app_enabled,    false),
    'qr_checkin_enabled',     coalesce(v_limits.qr_checkin_enabled,     false),
    'export_enabled',         coalesce(v_limits.export_enabled,         false),
    'api_access_enabled',     coalesce(v_limits.api_access_enabled,     false)
  );

  -- Overrides par salle : booléens UNIQUEMENT (enabled IS NULL = pas d'avis, on garde
  -- le défaut du plan). `config` n'est pas fusionné ici — aucun consommateur, et un
  -- jsonb libre n'a pas sa place dans une décision de gating.
  -- Les noms hors grille (web_app, custom_branding, marketing_emails) traversent tels
  -- quels : c'est le passthrough voulu.
  SELECT coalesce(jsonb_object_agg(f.feature, f.enabled), '{}'::jsonb)
    INTO v_overrides
    FROM public.nexxia_features f
   WHERE f.gym_id = p_gym_id
     AND f.enabled IS NOT NULL;

  -- `||` : l'opérande de droite gagne. L'override prime sur le défaut du plan, dans
  -- les DEUX sens — il peut retirer un droit que le plan accorde, pas seulement l'ajouter.
  v_features := v_features || v_overrides;

  -- ── Commissions ───────────────────────────────────────────────────────────
  -- ⚠️ Les overrides de commission NE vivent PAS dans nexxia_features : ils sont sur
  -- nexxia_gyms.commission_sepa_rate_override / commission_cb_rate_override, et ils
  -- PRIMENT sur le taux du plan. Ordre répliqué à l'identique de _shared/commission.ts
  -- (code déployé, utilisé par create-payment et create-subscription) :
  --     override ?? taux du plan
  -- NULL = pas d'override ; 0 = override explicite à 0 et l'emporte. D'où IS NOT NULL
  -- et non coalesce sur une valeur falsy.
  v_sepa := CASE WHEN v_gym.commission_sepa_rate_override IS NOT NULL
                 THEN v_gym.commission_sepa_rate_override
                 ELSE v_limits.commission_sepa_rate END;
  v_cb   := CASE WHEN v_gym.commission_cb_rate_override IS NOT NULL
                 THEN v_gym.commission_cb_rate_override
                 ELSE v_limits.commission_cb_rate END;

  -- ── Retour ────────────────────────────────────────────────────────────────
  -- limits : NULL = illimité (c'est la convention de la grille, ex. premium.max_members).
  RETURN jsonb_build_object(
    'plan',           v_gym.plan,
    'effective_plan', v_eff_plan,
    'status',         v_gym.status,
    'trial_active',   v_trial_active,
    'limits', jsonb_build_object(
      'max_members',          v_limits.max_members,
      'max_slots_per_month',  v_limits.max_slots_per_month,
      'max_admins',           v_limits.max_admins,
      'max_sites',            v_limits.max_sites
    ),
    'features',    v_features,
    'commissions', jsonb_build_object('sepa_rate', v_sepa, 'cb_rate', v_cb)
  );
END;
$$;
COMMENT ON FUNCTION public.get_effective_plan_core(uuid) IS
  'GYM-293b — CŒUR du résolveur de plan : calcul seul, AUCUN contrôle d''accès. PRIVÉE — '
  'appelable uniquement depuis les fonctions SECURITY DEFINER du schéma. Le contrôle '
  'd''accès vit dans get_effective_plan(uuid), qui délègue ici.';

-- 🔴 PRIVÉE, ET EXPLICITEMENT. `REVOKE FROM PUBLIC` ne suffit pas : `anon` et
-- `authenticated` sont des RÔLES RÉELS qui tiennent leur droit des DEFAULT PRIVILEGES du
-- schéma (piège constaté en GYM-289). Sans ces trois REVOKE, le cœur SANS ACL serait
-- appelable par n'importe quel porteur de JWT — c'est-à-dire exactement la fuite que l'ACL
-- de l'enveloppe existe pour empêcher.
REVOKE EXECUTE ON FUNCTION public.get_effective_plan_core(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_effective_plan_core(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_effective_plan_core(uuid) FROM authenticated;

-- ═══ 2) L'ENVELOPPE — l'ACL à l'identique, puis délégation ═══════════════════════════
-- Signature, codes d'erreur et format de retour inchangés : `admin-create-member`,
-- `send-notification`, `booking-guards` et `handle_new_user` n'ont rien à savoir de ce
-- refactor, et ne voient aucune différence.
CREATE OR REPLACE FUNCTION public.get_effective_plan(p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_role      text;
  v_is_service    boolean;
BEGIN
  -- ── SÉCURITÉ D'ACCÈS ──────────────────────────────────────────────────────
  -- SECURITY DEFINER contourne RLS : sans ce garde, n'importe quel porteur de JWT
  -- lirait le plan, les limites et les commissions de N'IMPORTE QUELLE salle. Le
  -- paramètre p_gym_id autorise l'APPEL, il ne dit pas AU NOM DE QUI.
  v_jwt_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  v_is_service := (v_jwt_role = 'service_role') OR (current_user = 'service_role');

  IF NOT v_is_service THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.gym_id = p_gym_id
        AND p.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'get_effective_plan: accès refusé à la salle %', p_gym_id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN public.get_effective_plan_core(p_gym_id);
END;
$$;

-- ═══ 3) L'APPELANT — join_gym_self_serve lit désormais le cœur ═══════════════════════
-- ⚠️ RECRÉÉE ICI, PAS MODIFIÉE SUR PLACE dans 20260830100000. Cette migration-là est DÉJÀ
-- APPLIQUÉE en staging (fonction mesurée présente le 2026-08-28) : la retoucher serait un
-- fichier réécrit que plus personne ne rejoue — le correctif ne partirait jamais. Le corps
-- ci-dessous est celui de GYM-293 au caractère près, UNE SEULE ligne changée (l'appel).
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
    -- 🔴 LE CŒUR, PAS L'ENVELOPPE — c'est TOUT le correctif GYM-293b.
    -- `get_effective_plan` refuse un appelant dont la salle active n'est pas `v_gym_id`
    -- (42501). Un candidat, par définition, n'a pas encore cette salle : le rattachement
    -- échouait à tous les coups. Le cœur porte le même calcul sans l'ACL, et n'est
    -- atteignable que d'ici — cette fonction s'exécute SECURITY DEFINER, donc sous son
    -- propriétaire. Le droit de rejoindre est déjà tranché plus haut (auth, plafond,
    -- fenêtre) : ce n'est pas à la lecture du plan de le trancher une seconde fois.
    v_plan := public.get_effective_plan_core(v_gym_id);

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

-- `CREATE OR REPLACE` conserve les privilèges existants ; on les redit pour qu'une base
-- reconstruite depuis zéro n'en dépende pas de l'ordre des fichiers. Même piège `anon`
-- qu'en GYM-289 : les DEFAULT PRIVILEGES du schéma le regreffent sinon.
REVOKE EXECUTE ON FUNCTION public.join_gym_self_serve(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.join_gym_self_serve(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.join_gym_self_serve(text) TO authenticated;
