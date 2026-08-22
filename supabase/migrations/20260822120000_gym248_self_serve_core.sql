-- GYM-248 (morceau 1/2) — Signup self-serve : création de salle scellée serveur,
-- + GYM-257 garde max_members sur l'auto-inscription.
--
-- Aucune UI dans ce lot. Le morceau 2 (pages dashboard + wizard) consomme ce RPC.
--
-- ─── RÈGLE ZÉRO — lectures live STAGING (buovgpokubrkejunmauq, 22/08, cockpit) ────
--
-- 1. handle_new_user() DÉPLOYÉE = un INSERT profiles pur depuis raw_user_meta_data.
--    ⚠️ ELLE NE CONTIENT AUCUN HEAL GYM-154 : le rattachement de rattrapage vit dans
--    l'app mobile (apps/mobile/lib/ensureProfile.ts → healProfile()), PAS ici. Ce
--    fichier n'invente donc aucun heal SQL ; la garde max_members s'applique au seul
--    chemin existant, « meta gym_id fourni ».
--    ⚠️ Le heal MOBILE reste non gardé — il écrit gym_id en direct (colonne autorisée
--    par la liste blanche GYM-203, transition NULL→valeur autorisée par
--    trg_gym_id_immutable). Un compte orphelin créé ici peut donc être rattaché par
--    l'app au prochain démarrage, contournant le plafond. RESTE-À-FAIRE documenté
--    dans la PR, chantier mobile.
--
-- 2. trg_gym_id_immutable / enforce_gym_id_immutable() : lectures repo CONFIRMÉES sur
--    le déployé. La transition NULL→valeur est autorisée, et un SECURITY DEFINER
--    appartenant à postgres sort par l'early-return `current_user IN ('postgres', …)`.
--    → La promotion du RPC passe À TRAVERS le trigger, sans jamais le désactiver.
--
-- 3. Liste blanche GYM-203 (REVOKE UPDATE + GRANT UPDATE (…) TO authenticated) :
--    ce fichier n'y touche pas. Le RPC est SECURITY DEFINER et écrit sous les
--    privilèges du propriétaire ; `role` reste hors de portée d'un jeton client.
--
-- 4. rate_limits LIVE : (id, identifier, action, attempts, window_start,
--    blocked_until, created_at), UNIQUE (identifier, action) — 2 COLONNES.
--    ⚠️ check_rate_limit() déployée est CASSÉE (ON CONFLICT (identifier, action,
--    window_start) ne correspond à aucun index unique → 42P10). Elle n'est ni
--    appelée ni réparée ici : ticket dédié GYM-261. Le RPC porte sa propre logique
--    de fenêtre glissante, calquée sur check_webhook_rate_limit() qui, elle, est
--    correcte (ON CONFLICT sur les 2 bonnes colonnes).
--
-- 5. nexxia_gyms LIVE : NOT NULL sans défaut = `name` et `slug` UNIQUEMENT.
--    `slug` et `subdomain` portent chacun une contrainte UNIQUE.
--    Grilles de plans : staging ET prod sont à free/starter/pro/premium depuis le
--    21/08. La baseline du dépôt est en retard — aucun nom de plan n'est écrit en
--    dur ici hormis 'free' à la création, qui est la valeur produit voulue.
--
-- Rejouable : tout est CREATE OR REPLACE ou conditionnel.
-- ─────────────────────────────────────────────────────────────────────────────────


-- ═══ 0) SLUGIFY ══════════════════════════════════════════════════════════════════
-- Translittération sans dépendance à l'extension `unaccent` (non garantie présente,
-- et une migration ne doit pas installer une extension pour un besoin cosmétique).
-- Les ligatures (æ, œ, ß) sont traitées AVANT translate() : translate() est du
-- caractère-à-caractère et ne sait pas rendre deux lettres pour une.
CREATE OR REPLACE FUNCTION public.gym_slugify(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT btrim(
    regexp_replace(
      translate(
        replace(replace(replace(replace(lower(btrim(p_text)),
          'æ', 'ae'), 'œ', 'oe'), 'ß', 'ss'), 'ø', 'o'),
        'àáâãäåāăąçćĉċčďđèéêëēĕėęěĝğġģĥħìíîïĩīĭįıĵķĺļľłñńņňòóôõöōŏőŕŗřśŝşšţťŧùúûüũūŭůűųŵŷýÿźżž',
        'aaaaaaaaacccccddeeeeeeeeegggghhiiiiiiiiijkllllnnnnoooooooorrrsssstttuuuuuuuuuuwyyyzzz'
      ),
      -- Tout ce qui n'est pas [a-z0-9] devient un tiret, les séquences se replient.
      '[^a-z0-9]+', '-', 'g'
    ),
    '-'
  );
$$;

COMMENT ON FUNCTION public.gym_slugify(text) IS
  'GYM-248 — slug URL depuis un nom de salle : minuscules, accents translittérés, '
  '[a-z0-9-], tirets repliés et rognés. Ne garantit NI l''unicité NI le respect des '
  'slugs réservés : c''est create_gym_self_serve qui suffixe et arbitre.';


-- ═══ 1) create_gym_self_serve ════════════════════════════════════════════════════
--
-- Le client demande, le SERVEUR crée et scelle. Il ne transmet ni rôle ni gym_id —
-- c'est exactement le défaut qui a fait démonter le signup dashboard (GYM-200 §5).
--
-- ── Codes d'erreur ───────────────────────────────────────────────────────────────
-- Chaque refus porte un SQLSTATE DISTINCT, en classe 'PT' : PostgREST lit les trois
-- derniers caractères comme statut HTTP. L'UI du morceau 2 mappe donc indifféremment
-- sur `code` (stable) ou sur le statut, et aucun refus métier ne remonte en 500.
--   PT401  non authentifié          PT409  déjà rattaché à une salle
--   PT403  email non confirmé       PT429  quota horaire dépassé
--   PT404  profil introuvable/supprimé   PT422  nom invalide
-- Le HINT porte le même jeton machine, pour une UI qui préférerait le lire là.
CREATE OR REPLACE FUNCTION public.create_gym_self_serve(
  p_gym_name text,
  p_timezone text DEFAULT 'Europe/Brussels'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Fenêtre et plafond du garde-fou. 3 tentatives / heure, par utilisateur ET par IP.
  c_rl_action   CONSTANT text     := 'create_gym_self_serve';
  c_rl_max      CONSTANT integer  := 3;
  c_rl_window   CONSTANT interval := interval '1 hour';
  -- Slugs que la plateforme se réserve : ils désignent des sous-domaines d'infra, pas
  -- des salles. Une collision ici se traite comme n'importe quelle autre (suffixe -2).
  c_reserved    CONSTANT text[]   := ARRAY['www','app','api','links','staging','admin'];

  v_uid         uuid := auth.uid();
  v_confirmed   timestamptz;
  v_profile     public.profiles%ROWTYPE;
  v_name        text;
  v_base        text;
  v_ident       text;
  v_slug        text;
  v_suffix      integer := 1;
  v_ip          text;
  v_attempts    integer;
  v_gym_id      uuid;
  v_step        integer;
BEGIN
  -- ── a) Authentification ────────────────────────────────────────────────────────
  -- Le GRANT plus bas ferme déjà la porte à `anon`, mais un jeton sans `sub` exploitable
  -- passerait le GRANT sans donner d'identité : on tranche sur auth.uid(), pas sur le rôle.
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'create_gym_self_serve: authentification requise'
      USING ERRCODE = 'PT401', HINT = 'GYM_NOT_AUTHENTICATED';
  END IF;

  -- ── b) Email confirmé ──────────────────────────────────────────────────────────
  -- Sans cette garde, une adresse jetable ou usurpée suffit à faire naître un tenant.
  SELECT u.email_confirmed_at INTO v_confirmed FROM auth.users u WHERE u.id = v_uid;

  IF v_confirmed IS NULL THEN
    RAISE EXCEPTION 'create_gym_self_serve: email non confirmé'
      USING ERRCODE = 'PT403', HINT = 'GYM_EMAIL_NOT_CONFIRMED';
  END IF;

  -- ── c) Profil appelant éligible ────────────────────────────────────────────────
  SELECT * INTO v_profile FROM public.profiles p WHERE p.id = v_uid;

  IF NOT FOUND OR v_profile.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'create_gym_self_serve: profil introuvable ou supprimé'
      USING ERRCODE = 'PT404', HINT = 'GYM_PROFILE_MISSING';
  END IF;

  -- Rattachement EXISTANT = fin de non-recevoir. Un gym_admin en exercice, un coach ou
  -- un simple membre ne fondent pas une seconde salle par ce chemin : le multi-site est
  -- un sujet de plan (max_sites), pas un effet de bord du signup.
  IF v_profile.gym_id IS NOT NULL THEN
    RAISE EXCEPTION 'create_gym_self_serve: compte déjà rattaché à une salle'
      USING ERRCODE = 'PT409', HINT = 'GYM_ALREADY_IN_GYM';
  END IF;

  -- ── d) Rate limit — fenêtre glissante sur (identifier, action) ─────────────────
  -- ⚠️ LIMITE ASSUMÉE, documentée dans la PR : un RAISE annule la transaction, donc
  -- l'incrément d'une tentative REFUSÉE est annulé avec elle. Le compteur ne retient
  -- que les appels qui COMMITENT, c'est-à-dire les créations réussies. La protection
  -- effective est donc « 3 salles créées par heure et par IP », ce qui est bien la
  -- forme d'abus visée (fabrique de tenants). Compter les échecs exigerait une
  -- transaction autonome (dblink/pg_net), hors périmètre de ce lot.
  v_ip := NULL;
  BEGIN
    v_ip := nullif(btrim(split_part(
      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for',
      ',', 1)), '');
  EXCEPTION WHEN OTHERS THEN
    -- En-têtes absents (appel hors PostgREST) ou non-JSON : on se rabat sur le seul
    -- identifiant utilisateur plutôt que d'échouer.
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
        ELSE 1                                  -- fenêtre expirée → on repart de zéro
      END,
      window_start = CASE
        WHEN rate_limits.window_start > now() - c_rl_window
          THEN rate_limits.window_start  -- la fenêtre court depuis le 1er appel
        ELSE now()
      END
    RETURNING attempts INTO v_attempts;

    IF v_attempts > c_rl_max THEN
      RAISE EXCEPTION 'create_gym_self_serve: trop de tentatives, réessayez plus tard'
        USING ERRCODE = 'PT429', HINT = 'GYM_RATE_LIMITED';
    END IF;
  END LOOP;

  -- ── e) Validation du nom ───────────────────────────────────────────────────────
  v_name := btrim(coalesce(p_gym_name, ''));

  -- `length` compte les CARACTÈRES, pas les octets : « Salle Élan » fait bien 10.
  -- La classe [[:alnum:]] est sensible à la locale et accepte les lettres accentuées :
  -- « Éclat » passe, « --- » et « ### » sont refusés — c'est le « pas uniquement des
  -- symboles » demandé.
  IF length(v_name) < 2 OR length(v_name) > 60 OR v_name !~ '[[:alnum:]]' THEN
    RAISE EXCEPTION 'create_gym_self_serve: nom de salle invalide (2 à 60 caractères, au moins un alphanumérique)'
      USING ERRCODE = 'PT422', HINT = 'GYM_INVALID_NAME';
  END IF;

  -- ── f) Slug unique ─────────────────────────────────────────────────────────────
  v_base := public.gym_slugify(v_name);

  -- Filet : un nom composé UNIQUEMENT de caractères alphanumériques non latins (par ex.
  -- en cyrillique ou en grec) passe la validation (e) mais ne laisse rien après
  -- translittération. On repart d'une base neutre plutôt que d'insérer un slug vide,
  -- qui violerait le NOT NULL et surtout produirait une URL inutilisable.
  IF v_base = '' THEN
    v_base := 'salle';
  END IF;

  v_slug := v_base;

  -- slug ET subdomain portent chacun une contrainte UNIQUE, et le RPC pose les deux à
  -- la même valeur : la boucle doit donc vérifier les DEUX colonnes, sinon un subdomain
  -- déjà pris ferait échouer l'INSERT malgré un slug libre.
  -- Les salles supprimées (deleted_at) restent en base et gardent leur slug : elles
  -- comptent comme des collisions, sans quoi l'INSERT violerait la contrainte UNIQUE
  -- (qui, elle, ignore deleted_at).
  WHILE v_slug = ANY (c_reserved)
     OR EXISTS (SELECT 1 FROM public.nexxia_gyms g
                 WHERE g.slug = v_slug OR g.subdomain = v_slug)
  LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base || '-' || v_suffix::text;
  END LOOP;

  -- ── g) Création de la salle ────────────────────────────────────────────────────
  -- status='active' et NON 'trialing' : l'essai est différé à GYM-250, et le hook trial
  -- de get_effective_plan est éteint. Une salle 'trialing' sans trial exploitable serait
  -- un état mensonger.
  -- AUCUN override de commission n'est posé : commission_*_rate_override restent NULL,
  -- donc les taux du plan s'appliquent (ordre de résolution GYM-245).
  INSERT INTO public.nexxia_gyms (
    name,
    slug,
    subdomain,
    timezone,
    plan,
    status,
    onboarding_completed,
    onboarding_step,
    default_language
  ) VALUES (
    v_name,
    v_slug,
    v_slug,
    coalesce(nullif(btrim(p_timezone), ''), 'Europe/Brussels'),
    'free',
    'active',
    false,
    1,
    'fr'
  )
  RETURNING id, onboarding_step INTO v_gym_id, v_step;

  -- ── h) Promotion du profil appelant ────────────────────────────────────────────
  -- gym_id passe de NULL à la nouvelle salle : c'est la transition que
  -- enforce_gym_id_immutable() autorise explicitement. Le trigger n'est PAS désactivé,
  -- et il sort de toute façon par son early-return `current_user IN ('postgres', …)`
  -- puisque cette fonction est SECURITY DEFINER.
  --
  -- La condition `gym_id IS NULL` est REDONDANTE avec la garde (c) — délibérément :
  -- elle rend l'UPDATE atomique face à deux appels concurrents du même compte. Le
  -- second ne mettrait à jour aucune ligne, et le RAISE ci-dessous annule sa salle.
  UPDATE public.profiles
     SET gym_id     = v_gym_id,
         role       = 'gym_admin',
         updated_at = now()
   WHERE id = v_uid
     AND gym_id IS NULL
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_gym_self_serve: compte déjà rattaché à une salle'
      USING ERRCODE = 'PT409', HINT = 'GYM_ALREADY_IN_GYM';
  END IF;

  RETURN jsonb_build_object(
    'gym_id',          v_gym_id,
    'name',            v_name,
    'slug',            v_slug,
    'onboarding_step', v_step
  );
END;
$$;

COMMENT ON FUNCTION public.create_gym_self_serve(text, text) IS
  'GYM-248 — création de salle self-serve. Le client ne transmet NI rôle NI gym_id : '
  'le serveur crée la salle (plan free, status active) et scelle l''appelant en '
  'gym_admin. Refus distincts par SQLSTATE PT4xx. Ne touche ni crédits, ni paiements, '
  'ni réservations.';

-- Réservé aux comptes authentifiés. `anon` n'a rien à faire ici : la fonction lit
-- auth.uid() et refuserait de toute façon, mais un GRANT superflu est une porte.
REVOKE ALL ON FUNCTION public.create_gym_self_serve(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_gym_self_serve(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_gym_self_serve(text, text) TO authenticated;


-- ═══ 2) handle_new_user — durcissement + garde max_members (GYM-257) ═════════════
--
-- ⚠️ DEUX CORRECTIFS DE SÉCURITÉ, en plus de la garde de plan :
--
--  (i) ÉLÉVATION DE PRIVILÈGE PAR METADATA — la version déployée recopiait
--      `COALESCE(meta->>'role', 'member')` tel quel. Un signup public avec
--      user_metadata {"role":"gym_admin","gym_id":"<uuid>"} s'auto-promouvait gérant
--      d'une salle existante : mêmes conséquences que GYM-203 (tous les membres, tous
--      les paiements, tout le CA), par un chemin différent.
--
--      Inventaire des metadata `role` réellement posées (grep monorepo, 22/08) :
--        apps/mobile/stores/useAuthStore.ts:91 ......... role: 'member'   (+ gym_id)
--        apps/dashboard/src/stores/useAuthStore.ts ..... AUCUN role, AUCUN gym_id
--                                                       (retirés par GYM-200 §5)
--        OAuth Apple/Google (OAuthButtons.tsx) ......... aucune metadata du tout
--        supabase/functions/admin-create-member:282 .... role: 'member'   (service_role)
--        supabase/functions/invite-team-member:362 ..... role: requestedRole,
--                                                       validé contre
--                                                       INVITABLE_ROLES = ['gym_admin']
--
--      → Côté CLIENT, la seule valeur légitime est 'member', qui est déjà le défaut :
--        aucune liste blanche à ouvrir, `role` est forcé.
--      → MAIS invite-team-member fait naître de VRAIS gym_admin par ce trigger, et ne
--        repasse JAMAIS sur profiles.role ensuite (il enchaîne sur createCoachEntry
--        puis l'email). Forcer 'member' sans discriminant casserait toute invitation
--        de gérant. Le discriminant retenu est NEW.invited_at : il est posé par
--        l'endpoint GoTrue `invite`, qui exige service_role, et n'est atteignable par
--        AUCUN signup public.
--        ⚠️ CETTE HYPOTHÈSE EST À VÉRIFIER AVANT APPLICATION (cf. PR, test ⑧) : selon
--        la version de GoTrue, invited_at peut être posé par un UPDATE POSTÉRIEUR à
--        l'INSERT, auquel cas le trigger le verrait NULL. Le sens de l'échec est
--        volontairement le sens SÛR — un gérant invité atterrirait en 'member'
--        (dégradation réparable) et jamais l'inverse.
--
-- (ii) ANTI-CAPTURE signup_intent='gym_owner' — ce compte est destiné à
--      create_gym_self_serve : ni rôle, ni rattachement, quoi que disent les metadata.
--
-- Le reste du corps est conservé à l'identique de la version déployée.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Rôles qu'une INVITATION serveur peut légitimement sceller. Miroir exact de
  -- INVITABLE_ROLES dans supabase/functions/invite-team-member/index.ts:40 —
  -- les deux listes se modifient ENSEMBLE.
  c_invitable   CONSTANT text[] := ARRAY['gym_admin'];

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
  -- Salle DEMANDÉE (pas encore accordée).
  BEGIN
    v_wanted_gym := nullif(meta->>'gym_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    -- Un gym_id non-UUID est une metadata forgée : on l'ignore au lieu de faire
    -- échouer la création du compte auth.
    v_wanted_gym := NULL;
  END;

  -- ── Rôle ───────────────────────────────────────────────────────────────────────
  IF v_intent = 'gym_owner' THEN
    -- Anti-capture : aucun rôle, aucun rattachement. create_gym_self_serve promouvra.
    v_role       := 'member';
    v_wanted_gym := NULL;
  ELSIF NEW.invited_at IS NOT NULL AND (meta->>'role') = ANY (c_invitable) THEN
    -- Invitation émise par le serveur (service_role) : le rôle a été décidé par
    -- l'invitant, validé contre une liste fermée des deux côtés.
    v_role := meta->>'role';
  ELSE
    -- Tout le reste — signup public, OAuth, admin-create-member : membre, point.
    v_role := 'member';
  END IF;

  -- ── Rattachement + garde de plan (GYM-257) ─────────────────────────────────────
  IF v_wanted_gym IS NOT NULL THEN
    IF v_role <> 'member' THEN
      -- Un gérant invité relève de max_admins, PAS de max_members : le plafond de
      -- membres ne doit pas bloquer l'arrivée d'un gérant. (Le plafond d'admins est
      -- déjà appliqué en amont par invite-team-member, GYM-246.)
      v_gym_id := v_wanted_gym;
    ELSE
      -- get_effective_plan() est SECURITY DEFINER et exige service_role OU un profil
      -- déjà rattaché à la salle. Ici auth.uid() est NULL (on est dans la transaction
      -- GoTrue) et le profil n'existe pas encore : sans ce set_config, la fonction
      -- lèverait 42501 à CHAQUE inscription et plus personne ne serait rattaché.
      -- La portée est la transaction (is_local = true) et la valeur est restaurée
      -- juste après ; un abort de sous-transaction la restaure de toute façon.
      v_claims := current_setting('request.jwt.claims', true);
      BEGIN
        PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
        v_plan := public.get_effective_plan(v_wanted_gym);
        PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
        -- Salle introuvable, supprimée, plan absent de la grille, panne : on ne
        -- tranche pas sans savoir → rattachement REFUSÉ.
        v_plan := NULL;
      END;

      IF v_plan IS NULL THEN
        RAISE LOG '[plan-gate] member limit, gym %', v_wanted_gym;
        v_gym_id := NULL;
      ELSE
        -- NULL = illimité (convention de la grille GYM-245).
        v_max_members := nullif(v_plan->'limits'->>'max_members', '')::integer;

        IF v_max_members IS NULL THEN
          v_gym_id := v_wanted_gym;
        ELSE
          -- MÊME prédicat que GYM-246 (admin-create-member/index.ts:227-232) :
          -- les MEMBRES actifs de cette salle. Gérants et coachs relèvent de
          -- max_admins ; les comptes supprimés ne consomment pas de place.
          SELECT count(*) INTO v_members
            FROM public.profiles p
           WHERE p.gym_id = v_wanted_gym
             AND p.role = 'member'
             AND p.deleted_at IS NULL;

          IF v_members >= v_max_members THEN
            -- ⚠️ PAS D'EXCEPTION : elle annulerait la transaction GoTrue et le compte
            -- auth ne naîtrait pas. Décision produit actée : le compte EXISTE, sans
            -- rattachement. L'écran mobile « salle complète » relève du chantier
            -- mobile (reste-à-faire documenté dans la PR).
            RAISE LOG '[plan-gate] member limit, gym %', v_wanted_gym;
            v_gym_id := NULL;
          ELSE
            v_gym_id := v_wanted_gym;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- ── INSERT du profil (corps conservé de la version déployée) ───────────────────
  INSERT INTO public.profiles (
    id,
    email,
    role,
    gym_id,
    first_name,
    last_name,
    phone,
    preferred_language,
    privacy_policy_accepted_at,
    privacy_policy_version,
    terms_accepted_at,
    terms_version,
    marketing_consent,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    v_role,      -- GYM-248 : plus jamais recopié depuis les metadata client
    v_gym_id,    -- GYM-257 : NULL si la salle est pleine ou le plan irrésolu
    -- GYM-150 — mapping OAuth : first_name / given_name / 1er mot de full_name
    COALESCE(NULLIF(meta->>'first_name',''), NULLIF(meta->>'given_name',''),
             NULLIF(split_part(meta->>'full_name',' ',1),'')),
    -- GYM-150 — mapping OAuth : last_name / family_name / reste de full_name
    COALESCE(NULLIF(meta->>'last_name',''), NULLIF(meta->>'family_name',''),
             NULLIF(btrim(substr(meta->>'full_name',
             length(split_part(meta->>'full_name',' ',1))+1)),'')),
    meta->>'phone',
    COALESCE(meta->>'preferred_language', 'fr'),
    CASE WHEN meta->>'privacy_policy_accepted' = 'true' THEN now() ELSE NULL END,
    CASE WHEN meta->>'privacy_policy_accepted' = 'true'
         THEN NULLIF(meta->>'legal_version','') ELSE NULL END,
    CASE WHEN meta->>'terms_accepted' = 'true' THEN now() ELSE NULL END,
    CASE WHEN meta->>'terms_accepted' = 'true'
         THEN NULLIF(meta->>'legal_version','') ELSE NULL END,
    COALESCE((meta->>'marketing_consent')::boolean, false),
    now(),
    now()
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'GYM-248/GYM-257 — role n''est PLUS recopié depuis les user_metadata client (forcé à '
  '''member'', sauf invitation serveur reconnue par NEW.invited_at et validée contre '
  'INVITABLE_ROLES). Le rattachement à une salle est soumis au plafond max_members du '
  'plan (get_effective_plan) : salle pleine ou plan irrésolu → profil créé SANS gym_id '
  'et RAISE LOG, jamais d''exception (elle casserait la transaction GoTrue). '
  'signup_intent=''gym_owner'' → aucun rattachement, compte destiné à create_gym_self_serve.';
