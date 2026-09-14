-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-338 — L'ADHÉSION NAÎT AVEC LE RATTACHEMENT, OU ELLE NE NAÎT PAS                 ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CE FICHIER N'EST PAS APPLIQUÉ PAR CE LOT. Le cockpit l'exécute, staging puis prod.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LE FAIT
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 15 profils créés après le 06/09 portaient une salle active SANS ligne `member_gyms`.
-- Le cockpit les a rattrapés. LA SOURCE, elle, ne l'était pas : quatre chemins posent
-- `profiles.gym_id` sans créer l'adhésion. Le trou se recreusait à chaque inscription.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LES ONZE CHEMINS QUI POSENT profiles.gym_id — LISTE ÉTABLIE SUR LE DÉPLOYÉ
-- ─────────────────────────────────────────────────────────────────────────────────────
--   ✅ handle_new_user (trigger auth.users)     — insère l'adhésion (GYM-102 A.4)
--   ✅ switch_active_gym                        — l'EXIGE (PT403) ; n'en crée pas, et ne doit pas
--   ✅ join_gym_self_serve (gym293 → 293b)      — insère l'adhésion
--   🔴 create_gym_self_serve (gym248 → gym308)  — AUCUNE            → corrigé en § 5
--   🔴 invite-team-member (edge, l. 418)        — AUCUNE            → passe par § 2
--   🔴 healProfile (ensureProfile.ts:95)        — AUCUNE            → passe par § 3
--   🔴 ensureProfile repli INSERT (l. 125)      — AUCUNE            → passe par § 3
--   ✅ admin-create-member                      — via createUser + metadata → handle_new_user
--   ✅ team-access                              — ne touche que `role`
--   ✅ admin-update-member                      — gym_id en lecture seule
--   ✅ process_no_shows · mark_attendance_atomic · reset_noshow_counters ·
--      apply_noshow_penalty · request_account_deletion — gym_id en WHERE, jamais en SET
--
-- ⚠️ LE CHEMIN LE PLUS VOLUMINEUX EST LE n° 6, ET IL N'ÉTAIT PAS AU CADRAGE. Une
-- inscription Apple/Google arrive SANS user_metadata (bug prod du 18-19/07, GYM-154) :
-- handle_new_user pose donc gym_id à NULL, et comme son insertion d'adhésion est gardée
-- par `IF v_gym_id IS NOT NULL`, elle ne crée rien non plus. C'est ensuite l'APP qui pose
-- la salle, par un UPDATE client. gym_id apparaît, l'adhésion jamais.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LE GARDE-FOU : DEUX MOITIÉS DISJOINTES, ET UN TRIGGER QUI **REFUSE**
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Un trigger qui CRÉERAIT l'adhésion a été écarté : il masquerait les appelants fautifs,
-- et surtout il rendrait le prochain chemin ajouté STRUCTURELLEMENT dépendant de lui —
-- plus personne n'écrirait l'insertion, et la règle cesserait d'exister dans le code pour
-- ne survivre que dans un trigger.
--
-- Un trigger qui REFUSE a les qualités inverses : l'appelant fautif échoue bruyamment, par
-- son nom, à la première exécution. Il rend la divergence IMPOSSIBLE au lieu de la
-- rattraper. Et ce n'est pas un trigger de plus : trg_gym_id_immutable existe déjà sur
-- cette table et fait déjà ce travail pour la transition X→Y (§ 4).
--
-- Il ne peut PAS couvrir `service_role` : les edge functions doivent pouvoir poser gym_id,
-- et un refus en cours d'instruction les casserait toutes. Pour elles, la garde est la
-- VEILLE (§ 6). Trigger pour le client → impossible ; veille pour le serveur → visible.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 🔴 AUCUNE REPRISE D'HISTORIQUE DANS CE FICHIER
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Le cockpit a rattrapé les 15 (0 divergence au 10/09). Et s'il en restait, un INSERT
-- silencieux ici les ferait disparaître sans que personne ne l'apprenne — exactement ce
-- que ce lot combat. La veille du § 6 les SIGNALE dans l'heure ; c'est ce qu'on veut.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LE MARQUEUR « SALLE D'APP DÉDIÉE »
-- ═════════════════════════════════════════════════════════════════════════════════════
-- C'est l'information qui manquait au serveur. L'app mono-salle (Dopamine) connaît SA
-- salle par sa configuration de build ; la base, elle, n'a aucun moyen de savoir qu'un
-- membre arrivant sans metadata appartient à celle-là et pas à une autre. Sans ce
-- marqueur, la seule façon de faire fonctionner le heal était de laisser le client poser
-- la salle de son choix — la faille que le § 4 ferme.
ALTER TABLE public.nexxia_gyms
  ADD COLUMN IF NOT EXISTS dedicated_app_gym boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.nexxia_gyms.dedicated_app_gym IS
  'GYM-338 — true pour une salle qui dispose de SA PROPRE application mono-salle, dont le '
  'build ne peut désigner qu''elle. Seules ces salles acceptent claim_app_gym() : un '
  'membre arrivant sans metadata (inscription OAuth) y est rattaché sans ambiguïté, parce '
  'qu''il n''existe aucune autre salle que ce build puisse viser. ⚠️ Ne JAMAIS poser ce '
  'drapeau sur une salle du parcours multi-salles : il y ouvrirait un rattachement sans '
  'code d''adhésion et sans plafond de plan.';

-- 🔴 ÉTAPE DE DÉPLOIEMENT OBLIGATOIRE, À FAIRE AVEC CETTE MIGRATION.
-- Le drapeau ne peut pas être posé ici : l'identifiant de la salle Dopamine vit dans la
-- configuration de build de l'app (EXPO_PUBLIC_*), pas dans le dépôt. Tant qu'il n'est pas
-- posé, claim_app_gym refuse par GYM_NOT_DEDICATED_APP et le heal des inscriptions
-- Apple/Google cesse de fonctionner — l'échec est remonté à Sentry par l'app, donc VISIBLE,
-- mais il faut le prévenir :
--
--   UPDATE public.nexxia_gyms SET dedicated_app_gym = true WHERE id = '<gym Dopamine>';
--
-- Vérification : SELECT id, name, dedicated_app_gym FROM nexxia_gyms WHERE dedicated_app_gym;
-- Attendu : EXACTEMENT une ligne.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. LA PORTE SERVEUR — rattachement + adhésion, une seule transaction
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Les edge functions ne peuvent pas rendre atomiques deux appels PostgREST successifs :
-- entre l'UPDATE et l'INSERT, un échec laisserait exactement la divergence qu'on corrige.
-- Le corps d'une fonction PL/pgSQL, lui, EST une transaction. C'est la raison d'être de
-- cette RPC — pas une commodité d'écriture.
--
-- ⚠️ ELLE NE DÉPLACE JAMAIS UNE SALLE ACTIVE EXISTANTE, même règle que
-- join_gym_self_serve : elle AJOUTE une adhésion, et ne pose gym_id que s'il est absent.
-- Un membre déjà rattaché ailleurs garde la salle qu'il regarde ; c'est switch_active_gym,
-- et lui seul, qui déplace le curseur.
CREATE OR REPLACE FUNCTION public.attach_profile_to_gym(
  p_member_id uuid,
  p_gym_id    uuid,
  p_role      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_active_set boolean := false;
BEGIN
  IF p_member_id IS NULL OR p_gym_id IS NULL THEN
    RAISE EXCEPTION 'attach_profile_to_gym: member_id et gym_id sont requis'
      USING ERRCODE = 'PT422', HINT = 'GYM_MISSING_ARGS';
  END IF;

  -- ⚠️ L'ADHÉSION D'ABORD, LE RATTACHEMENT ENSUITE. L'ordre n'est pas indifférent : le
  -- trigger du § 4 exige une adhésion pour autoriser le gym_id. Poser gym_id en premier
  -- ferait échouer la fonction sur son propre garde-fou dès qu'elle serait appelée par un
  -- rôle non privilégié. L'ordre inverse est correct dans TOUS les cas.
  INSERT INTO public.member_gyms (member_id, gym_id)
  VALUES (p_member_id, p_gym_id)
  ON CONFLICT (member_id, gym_id) DO NOTHING;

  UPDATE public.profiles
     SET gym_id     = p_gym_id,
         role       = COALESCE(p_role, role),
         updated_at = now()
   WHERE id = p_member_id
     AND deleted_at IS NULL
     AND gym_id IS NULL;

  v_active_set := FOUND;

  -- Le rôle se pose même quand la salle active ne bouge pas : invite-team-member scelle un
  -- rôle sur un compte que le trigger d'inscription a pu rattacher lui-même.
  IF NOT v_active_set AND p_role IS NOT NULL THEN
    UPDATE public.profiles
       SET role = p_role, updated_at = now()
     WHERE id = p_member_id AND deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'member_id',      p_member_id,
    'gym_id',         p_gym_id,
    'active_gym_set', v_active_set
  );
END;
$function$;

COMMENT ON FUNCTION public.attach_profile_to_gym(uuid, uuid, text) IS
  'GYM-338 — Porte SERVEUR du rattachement : crée l''adhésion member_gyms ET pose la salle '
  'active dans la MÊME transaction. Réservée à service_role. N''écrase jamais une salle '
  'active existante (seul switch_active_gym déplace le curseur). Idempotente.';

REVOKE ALL ON FUNCTION public.attach_profile_to_gym(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_profile_to_gym(uuid, uuid, text) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. LA PORTE CLIENT — le heal GYM-154, sans le trou
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Le heal mobile posait gym_id par un UPDATE direct. Le § 4 le lui interdit désormais ;
-- cette RPC est sa route de remplacement. Elle fait la même chose — et l'adhésion avec.
--
-- CE QU'ELLE VÉRIFIE, ET POURQUOI CHAQUE CONDITION :
--   · appelant authentifié, et rattachement de SOI (auth.uid()) : jamais un paramètre ;
--   · profil sans salle : elle RATTACHE, elle ne DÉPLACE pas (sinon elle rouvrirait la
--     brèche de GYM-203 par une autre porte) ;
--   · salle marquée `dedicated_app_gym` : c'est ce qui distingue « le build ne peut viser
--     qu'elle » de « le membre a choisi cette salle-là ». Sans cette condition, la RPC
--     serait exactement la faille qu'on ferme, avec un nom plus rassurant.
CREATE OR REPLACE FUNCTION public.claim_app_gym(p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'claim_app_gym: appel non authentifié'
      USING ERRCODE = 'PT401', HINT = 'GYM_UNAUTHENTICATED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.nexxia_gyms
    WHERE id = p_gym_id AND dedicated_app_gym = true
  ) THEN
    RAISE EXCEPTION 'claim_app_gym: cette salle n''a pas d''application dédiée'
      USING ERRCODE = 'PT403', HINT = 'GYM_NOT_DEDICATED_APP';
  END IF;

  -- Déjà rattaché : on ne bouge RIEN et on le dit. Le heal est appelé à chaque login ;
  -- lever ici transformerait un no-op attendu en erreur Sentry à chaque ouverture d'app.
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND gym_id IS NOT NULL AND deleted_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status', 'already_attached');
  END IF;

  INSERT INTO public.member_gyms (member_id, gym_id)
  VALUES (v_uid, p_gym_id)
  ON CONFLICT (member_id, gym_id) DO NOTHING;

  UPDATE public.profiles
     SET gym_id = p_gym_id, updated_at = now()
   WHERE id = v_uid AND gym_id IS NULL AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'already_attached');
  END IF;

  RETURN jsonb_build_object('status', 'attached', 'gym_id', p_gym_id);
END;
$function$;

COMMENT ON FUNCTION public.claim_app_gym(uuid) IS
  'GYM-338 — Porte CLIENT du premier rattachement (heal GYM-154 des inscriptions OAuth, '
  'qui arrivent sans user_metadata). Pose l''adhésion ET la salle active dans la même '
  'transaction. Refuse (PT403) toute salle non marquée dedicated_app_gym : le membre ne '
  'choisit pas sa salle, il rejoint la seule que son application puisse désigner. '
  'L''identité vient TOUJOURS de auth.uid().';

REVOKE ALL ON FUNCTION public.claim_app_gym(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_app_gym(uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 4. LE TRIGGER QUI REFUSE — la moitié « impossible »
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ ANTI-DRIFT : corps recopié depuis la définition GYM-102 (la plus récente). Le
-- court-circuit service_role, le message et l'ERRCODE 42501 sont conservés À L'IDENTIQUE.
-- UNE SEULE chose change : la condition d'entrée perd `OLD.gym_id IS NOT NULL`.
--
-- Le trigger lui-même n'est PAS reposé : il est déjà BEFORE UPDATE ... WHEN (OLD.gym_id IS
-- DISTINCT FROM NEW.gym_id), ce qui couvre déjà NULL → valeur. Seul le corps décidait de
-- laisser passer.
CREATE OR REPLACE FUNCTION public.enforce_gym_id_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin')
     OR auth.role() = 'service_role'
  THEN
    RETURN NEW;
  END IF;

  -- 🔴 GYM-338 — LA GARDE `OLD.gym_id IS NOT NULL` A SAUTÉ, ET C'EST TOUTE LA CORRECTION.
  -- Elle laissait passer SANS AUCUN CONTRÔLE la transition NULL → n'importe quelle salle,
  -- parce que gym203 l'avait ouverte exprès pour le heal GYM-154. En mono-salle c'était
  -- sans portée. En multi, tout compte sans salle — inscription OAuth, ou signup refusé au
  -- plafond — pouvait se rattacher à la salle de SON choix par un PATCH direct : sans code
  -- d'adhésion, sans plafond de plan, sans facturation. Le heal légitime passe désormais
  -- par claim_app_gym() ci-dessous, qui pose l'adhésion AVANT le gym_id.
  IF NEW.gym_id IS DISTINCT FROM OLD.gym_id THEN
    -- GYM-283 — la bascule vers une appartenance VÉRIFIÉE passe. GYM-338 : c'est
    -- désormais AUSSI ce qui autorise le premier rattachement. Une seule règle pour les
    -- deux transitions — « le client ne va que là où il est déjà membre » — au lieu d'une
    -- règle pour la bascule et d'une exception muette pour la naissance.
    IF NEW.gym_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.member_gyms mg
      WHERE mg.member_id = NEW.id
        AND mg.gym_id    = NEW.gym_id
    ) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'GYM_ID_IMMUTABLE: le rattachement à une salle ne peut pas être modifié depuis le client (profil %)',
      OLD.id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.enforce_gym_id_immutable() IS
  'GYM-338 — Le client ne pose gym_id que vers une appartenance member_gyms EXISTANTE, '
  'premier rattachement COMPRIS. gym203 laissait la transition NULL → n''importe quelle '
  'salle entièrement libre (pour le heal GYM-154) : sans portée en mono-salle, c''était en '
  'multi un rattachement sans code d''adhésion, sans plafond de plan et sans facturation. '
  'Le heal légitime passe désormais par claim_app_gym(). service_role reste court-circuité '
  '— sa garde à lui est la veille member_gyms_drift().';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 5. create_gym_self_serve — L'ADHÉSION DU GÉRANT
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ ANTI-DRIFT : corps recopié depuis gym308 (la définition la plus récente), à
-- l'identique. UN SEUL ajout, signalé dans le corps : l'INSERT member_gyms, juste avant le
-- RETURN, donc après que la promotion du profil a été confirmée par son IF NOT FOUND.
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
    default_language,
    -- 🔴 GYM-308 — LA TVA EST POSÉE EXPLICITEMENT, PAS HÉRITÉE DU DEFAULT.
    -- Le DEFAULT de la colonne vaut 0 (GYM-180) : toute salle créée en self-serve
    -- naissait donc SANS TVA, et facturait 0 % à ses membres jusqu'à ce qu'un gérant
    -- pense à la corriger — ce que rien ne lui demandait de faire.
    --
    -- ⚠️ ÉCRIT ICI ET NON CHANGÉ EN DEFAULT DE COLONNE, et c'est la consigne du ticket :
    -- un DEFAULT est invisible depuis le code, il s'applique à tout INSERT (y compris ceux
    -- d'un script d'import ou d'une future fonction) et il se modifie sans que personne ne
    -- relise cette RPC. Écrit ici, le taux est une DÉCISION visible, datée, et attachée au
    -- seul chemin de création de salle qui existe.
    --
    -- 6,00 % = taux belge de l'accès aux installations sportives. C'est le marché de
    -- lancement ; le gérant peut le corriger dans Réglages → Informations légales, et le
    -- wizard le lui AFFICHE pour qu'il ne le subisse pas.
    vat_rate
  ) VALUES (
    v_name,
    v_slug,
    v_slug,
    coalesce(nullif(btrim(p_timezone), ''), 'Europe/Brussels'),
    'free',
    'active',
    false,
    1,
    'fr',
    6.00
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

  -- 🔴 GYM-338 — L'ADHÉSION NAÎT ICI, DANS LA MÊME TRANSACTION QUE LA PROMOTION.
  -- Elle manquait : le gérant qui créait sa salle obtenait un gym_id sans ligne
  -- member_gyms. GYM-102 avait pourtant explicitement inclus les gérants dans sa reprise
  -- (« un gérant a lui aussi un gym_id ; l'exclure ferait de son rattachement une
  -- appartenance NON VÉRIFIÉE »). Sans elle, switch_active_gym refuserait au gérant le
  -- retour vers sa propre salle, et le trigger durci ci-dessus refuserait son PATCH.
  INSERT INTO public.member_gyms (member_id, gym_id)
  VALUES (v_uid, v_gym_id)
  ON CONFLICT (member_id, gym_id) DO NOTHING;

  RETURN jsonb_build_object(
    'gym_id',          v_gym_id,
    'name',            v_name,
    'slug',            v_slug,
    'onboarding_step', v_step
  );
END;
$$;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 6. LA VEILLE — la moitié « visible », pour ce que le trigger ne peut pas couvrir
-- ═════════════════════════════════════════════════════════════════════════════════════
-- La divergence a grandi CINQ JOURS en silence. C'est le vrai défaut : pas qu'elle soit
-- née, mais que personne ne l'ait su. À l'heure, on l'aurait appris le jour même.
--
-- ⚠️ ELLE ÉCRIT DANS `webhook_failures`, ET LE NOM DEVIENT IMPROPRE — assumé. Cette table
-- EST la boîte aux lettres morte que le cockpit relève déjà ; en créer une seconde
-- éparpillerait la surveillance sur deux endroits, dont un que personne n'aurait
-- l'habitude de regarder. Un nom imparfait coûte moins qu'une table oubliée.
--   function_name = 'member-gyms-drift'   (et non un nom de webhook : c'est le détournement)
--   stage         = 'missing_membership'
--   detail        = { count, sample[…], detected_at }
--
-- 🔴 IDEMPOTENTE — UNE LIGNE OUVERTE, PAS VINGT-QUATRE PAR JOUR. Tant qu'une ligne non
-- résolue existe pour ce motif, la veille MET À JOUR son `detail` au lieu d'en ouvrir une
-- seconde. Une boîte aux lettres qu'on noie est une boîte qu'on cesse de lire — et c'est
-- exactement comme ça qu'on ne voit pas la divergence suivante.
CREATE OR REPLACE FUNCTION public.member_gyms_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count  integer;
  v_sample jsonb;
  v_open   uuid;
BEGIN
  -- ⚠️ `deleted_at IS NULL` : un compte supprimé conserve son gym_id (intégrité des stats
  -- de la salle) et son adhésion n'est jamais retirée — les deux restent donc alignés. Le
  -- compter ici produirait un faux positif permanent.
  SELECT count(*),
         coalesce(jsonb_agg(jsonb_build_object('member_id', d.id, 'gym_id', d.gym_id))
                  FILTER (WHERE d.rn <= 20), '[]'::jsonb)
    INTO v_count, v_sample
    FROM (
      SELECT p.id, p.gym_id, row_number() OVER (ORDER BY p.created_at DESC) AS rn
        FROM public.profiles p
       WHERE p.gym_id IS NOT NULL
         AND p.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.member_gyms mg
            WHERE mg.member_id = p.id AND mg.gym_id = p.gym_id
         )
    ) d;

  IF v_count = 0 THEN
    -- Retour au vert : la ligne ouverte est refermée. Sans cela, une divergence corrigée
    -- laisserait une alerte éternelle, et le cockpit apprendrait à l'ignorer.
    UPDATE public.webhook_failures
       SET resolved_at = now()
     WHERE function_name = 'member-gyms-drift'
       AND resolved_at IS NULL;
    RETURN jsonb_build_object('status', 'ok', 'count', 0);
  END IF;

  SELECT id INTO v_open
    FROM public.webhook_failures
   WHERE function_name = 'member-gyms-drift'
     AND resolved_at IS NULL
   ORDER BY created_at
   LIMIT 1;

  IF v_open IS NOT NULL THEN
    UPDATE public.webhook_failures
       SET detail = jsonb_build_object(
             'count', v_count, 'sample', v_sample,
             'last_seen_at', now(), 'first_seen_at', detail->>'first_seen_at')
     WHERE id = v_open;
    RETURN jsonb_build_object('status', 'still_open', 'count', v_count, 'failure_id', v_open);
  END IF;

  INSERT INTO public.webhook_failures (function_name, stage, detail)
  VALUES ('member-gyms-drift', 'missing_membership',
          jsonb_build_object('count', v_count, 'sample', v_sample,
                             'first_seen_at', now(), 'last_seen_at', now()))
  RETURNING id INTO v_open;

  RAISE LOG '[member-gyms-drift] % profil(s) rattaché(s) sans adhésion', v_count;
  RETURN jsonb_build_object('status', 'opened', 'count', v_count, 'failure_id', v_open);
END;
$function$;

COMMENT ON FUNCTION public.member_gyms_drift() IS
  'GYM-338 — Veille horaire : compte les profils actifs dont la salle active n''a pas '
  'd''adhésion member_gyms, et ouvre UNE ligne webhook_failures tant que la divergence '
  'dure (mise à jour, jamais dupliquée). Referme la ligne au retour à zéro. Couvre ce que '
  'le trigger ne peut pas couvrir : les écritures service_role.';

REVOKE ALL ON FUNCTION public.member_gyms_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_gyms_drift() TO service_role;

-- Rejouable : unschedule conditionnel préalable, sinon cron.schedule lèverait sur un nom
-- déjà pris (même motif que reset-noshow-counters, GYM-175).
SELECT cron.unschedule('member-gyms-drift')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'member-gyms-drift');

-- À 50 : à l'écart des crons de l'heure ronde (send-subscription-reminders à :25,
-- send-sepa-prenotifications à :35) — une veille ne doit pas concourir avec les envois.
SELECT cron.schedule('member-gyms-drift', '50 * * * *', $CRON$SELECT public.member_gyms_drift()$CRON$);
