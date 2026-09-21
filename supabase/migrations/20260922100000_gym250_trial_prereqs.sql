-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-250 — ESSAI DE 14 JOURS : LES PRÉREQUIS                                          ║
-- ║  Rien ne change pour personne : `v_trial_enabled` reste `false` (allumage = PR 2).     ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Cette migration ne fait que DÉSARMER des pièges avant l'allumage. Aucun droit accordé,
-- aucun droit retiré, aucun plan effectif modifié — prouvé au banc
-- (supabase/tests/gym_trial_commission.sql) : tant que la constante est éteinte, le plan
-- effectif EST la colonne, et pas un centime de commission ne bouge.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LES DEFAULT QUI DÉCIDAIENT D'UN DROIT DISPARAISSENT
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 CE QUI ÉTAIT EN BASE, ET QUE PERSONNE N'AVAIT DEMANDÉ :
--     trial_ends_at DEFAULT (now() + '14 days')
--     status        DEFAULT 'trialing'
--
-- MESURÉ. En staging, les TROIS salles portent une `trial_ends_at` héritée de ce DEFAULT
-- alors qu'aucune n'a jamais eu d'essai — dont une (« Studio Test Staging ») dont la date
-- est encore DANS LE FUTUR. En production, les deux salles sont à NULL : elles sont
-- antérieures à ce chemin. La production est propre ; staging ne l'est pas.
--
-- 🔴 POURQUOI C'EST URGENT, ET PAS COSMÉTIQUE. Le cockpit (lot 2) sait déjà poser
-- `status = 'trialing'` depuis la fiche salle. Le jour de l'allumage, ce geste aurait
-- distribué du Pro au hasard des dates héritées : instantanément à « Studio Test
-- Staging », jamais aux deux autres — et personne n'aurait su pourquoi.
--
-- `status` retombe sur 'active' plutôt que de perdre son défaut : un 'trialing' par défaut
-- avec une date NULL serait un état menteur, et la condition du hook (date NON NULLE ET
-- future) ne serait de toute façon jamais satisfaite.
--
-- ⚠️ LA PURGE DES DATES HÉRITÉES N'EST PAS ICI. Elles servent de jeu d'essai au banc de la
-- PR 2, qui les purgera ensuite (décision d'Antoine du 21/09). Retirer le DEFAULT empêche
-- d'en créer de nouvelles ; c'est ce que cette migration doit faire, et rien de plus.
ALTER TABLE public.nexxia_gyms ALTER COLUMN trial_ends_at DROP DEFAULT;
ALTER TABLE public.nexxia_gyms ALTER COLUMN status        SET DEFAULT 'active';

COMMENT ON COLUMN public.nexxia_gyms.trial_ends_at IS
  'GYM-250 — fin de l''essai. AUCUN DEFAULT : la valeur est posée explicitement par '
  'create_gym_self_serve, ou par le cockpit (cockpit_set_trial_end). NULL = aucun essai. '
  'Le hook de get_effective_plan_core exige une date NON NULLE ET FUTURE, en plus de '
  'status = ''trialing''.';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. create_gym_self_serve POSE L'ESSAI, EXPLICITEMENT
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Corps REPRIS À L'IDENTIQUE de GYM-338 (dernière version déployée, relue sur la base le
-- 21/09) — seuls l'INSERT et son commentaire changent.

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
  -- 🔴 GYM-250 — status='trialing' ET trial_ends_at POSÉS EXPLICITEMENT.
  --
  -- Ils l'étaient par DEFAUT DE COLONNE, ce qui est précisément le problème : `status`
  -- valait 'trialing' par défaut mais était écrasé ici en 'active', tandis que
  -- `trial_ends_at` — absent de la liste — recevait en silence `now() + 14 days`. Toute
  -- salle self-serve portait donc une date d'essai que personne n'avait décidée, sous un
  -- statut qui disait le contraire.
  --
  -- ⚠️ MÊME ARGUMENT QUE GYM-308 POUR LA TVA, quelques lignes plus bas, dans cette même
  -- fonction : un DEFAULT est invisible depuis le code, s'applique à tout INSERT (import,
  -- future fonction) et se modifie sans que personne ne relise cette RPC. Une valeur qui
  -- décide d'un droit s'écrit ICI, datée et relisible.
  --
  -- ⚠️ ÉTAT TRANSITOIRE ASSUMÉ, ET IL FAUT LE SAVOIR : tant que `v_trial_enabled` reste
  -- `false` (allumage = PR 2), une salle créée ici est 'trialing' avec une vraie date mais
  -- se voit servir les limites de `free`. `trial_active` rend `false`, le cockpit affiche
  -- le désaccord, et AUCUN droit ne change — `status` n'est lu par aucune politique RLS
  -- (0 sur 85), par aucun écran et par aucune fonction. À l'allumage, ces salles
  -- récupèrent leur essai si la date n'est pas passée : c'est voulu.
  -- AUCUN override de commission n'est posé : commission_*_rate_override restent NULL,
  -- donc les taux du plan s'appliquent (ordre de résolution GYM-245).
  INSERT INTO public.nexxia_gyms (
    name,
    slug,
    subdomain,
    timezone,
    plan,
    status,
    trial_ends_at,
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
    'trialing',
    -- 14 jours pleins à compter de la création. L'extinction est TEMPORELLE : passée cette
    -- date, le hook de get_effective_plan_core cesse de servir le plan d'essai sans que
    -- rien n'ait à s'exécuter. Aucun cron n'est nécessaire pour COUPER — seulement, plus
    -- tard, pour corriger le statut affiché et prévenir le gérant (PR 2).
    now() + interval '14 days',
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
COMMENT ON FUNCTION public.create_gym_self_serve(text, text) IS
  'GYM-248/338/250 — création de salle en libre-service. Pose désormais status=''trialing'' '
  'et trial_ends_at = now() + 14 jours EXPLICITEMENT (plus par DEFAULT de colonne). '
  'Sans effet tant que v_trial_enabled est false dans get_effective_plan_core.';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. CONTRÔLE D'APPLICATION — ce qui doit être vrai après cette migration
-- ═════════════════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_def_trial text;
  v_def_stat  text;
  v_src       text;
BEGIN
  SELECT column_default INTO v_def_trial FROM information_schema.columns
   WHERE table_schema='public' AND table_name='nexxia_gyms' AND column_name='trial_ends_at';
  IF v_def_trial IS NOT NULL THEN
    RAISE EXCEPTION 'GYM-250 : trial_ends_at porte encore un DEFAULT (%)', v_def_trial;
  END IF;

  SELECT column_default INTO v_def_stat FROM information_schema.columns
   WHERE table_schema='public' AND table_name='nexxia_gyms' AND column_name='status';
  IF v_def_stat IS NULL OR v_def_stat NOT LIKE '%active%' THEN
    RAISE EXCEPTION 'GYM-250 : status devrait valoir ''active'' par défaut, trouvé %',
      coalesce(v_def_stat, '(aucun)');
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='create_gym_self_serve';
  IF v_src NOT LIKE '%trial_ends_at%' OR v_src NOT LIKE '%''trialing''%' THEN
    RAISE EXCEPTION 'GYM-250 : create_gym_self_serve ne pose pas l''essai explicitement';
  END IF;

  -- ⚠️ CEINTURE : cette migration NE DOIT PAS allumer l'essai. Si la constante avait
  -- bougé, tout ce qui précède changerait de sens.
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_effective_plan_core';
  IF v_src NOT LIKE '%v_trial_enabled CONSTANT boolean := false%' THEN
    RAISE EXCEPTION 'GYM-250 : v_trial_enabled n''est plus false — l''allumage est la PR 2';
  END IF;

  RAISE NOTICE 'GYM-250 prérequis : DEFAULT retirés, essai posé explicitement, constante toujours éteinte.';
END
$verif$;
