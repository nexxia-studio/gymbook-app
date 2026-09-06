-- ═══════════════════════════════════════════════════════════════════════════════════════
-- GYM-308 — `create_gym_self_serve` pose la TVA EXPLICITEMENT.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- 🔴 LE DÉFAUT : toute salle créée en self-serve naissait avec vat_rate = 0.
--
-- La RPC scellée de GYM-248 n'écrit pas `vat_rate` dans son INSERT ; la colonne tombe donc
-- sur son DEFAULT, posé à 0 par GYM-180. Résultat : chaque nouvelle salle facture 0 % de
-- TVA à ses membres — sur ses reçus, dans ses emails — jusqu'à ce qu'un gérant y pense.
-- Rien dans le parcours ne le lui demandait, et rien ne le lui signalait.
--
-- ⚠️ ON NE CHANGE PAS LE DEFAULT DE COLONNE, ET C'EST DÉLIBÉRÉ. Un DEFAULT est invisible
-- depuis le code applicatif, il s'applique à TOUT INSERT — y compris ceux d'un script
-- d'import ou d'une fonction à venir — et il se modifie sans que personne ne relise cette
-- RPC. Écrit dans l'INSERT, le taux devient une décision VISIBLE, datée, et attachée au
-- seul chemin de création de salle qui existe.
--
-- ⚠️ FONCTION REPRISE INTÉGRALEMENT DE GYM-248, À DEUX LIGNES PRÈS. Le corps ci-dessous est
-- celui de `20260822120000_gym248_self_serve_core.sql`, recopié sans autre modification que
-- l'ajout de la colonne `vat_rate` et de sa valeur. Toute divergence supplémentaire serait
-- une régression silencieuse sur un chemin scellé : la comparaison se fait au diff.
--
-- ⚠️ N'AFFECTE AUCUNE SALLE EXISTANTE. `CREATE OR REPLACE` ne touche que les créations à
-- venir. Dopamine a déjà été corrigée à 6,00 par le cockpit ; les autres salles gardent le
-- taux qu'elles portent, et leur gérant peut le corriger dans Réglages.

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

  RETURN jsonb_build_object(
    'gym_id',          v_gym_id,
    'name',            v_name,
    'slug',            v_slug,
    'onboarding_step', v_step
  );
END;
$$;