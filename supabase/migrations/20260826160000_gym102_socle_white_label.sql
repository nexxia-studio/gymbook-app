-- GYM-102 (lot 1/5) + GYM-283 — SOCLE SQL de l'app white-label.
--
-- ⚠️ NON DÉPLOYÉE. Idempotente et rejouable.
--
-- 🔴 DÉPENDANCE D'ORDRE, À RESPECTER : cette migration appelle `check_rate_limit`, dont
-- la version DÉPLOYÉE est CASSÉE (ON CONFLICT sur trois colonnes → 42P10 au deuxième
-- appel, cf. GYM-261). La migration 20260826120000_gym261_fix_check_rate_limit.sql DOIT
-- être appliquée AVANT celle-ci, sans quoi `search_gyms` lèvera dès la deuxième recherche
-- d'un même visiteur.
--
-- ═════════════════════════════════════════════════════════════════════════════════════
-- CE QUE CE LOT INSTALLE
-- ═════════════════════════════════════════════════════════════════════════════════════
--   A. member_gyms — un membre peut appartenir à PLUSIEURS salles ; profiles.gym_id
--      devient la salle ACTIVE. Avec la RPC de bascule et l'assouplissement (contrôlé)
--      du verrou GYM-203.
--   B. Trois fonctions PUBLIQUES (anon) : recherche de salle, marque, planning. C'est la
--      SEULE surface publique du produit — chacune est commentée sur ce qu'elle expose,
--      pourquoi c'est acceptable, et ce qu'il ne faut JAMAIS y ajouter.
--
-- MODÈLE SUIVI : `public_gym_legal_identity` (GYM-265) — SECURITY DEFINER, liste de
-- colonnes EXPLICITE, GRANT à anon. Et sa leçon, qui vaut ici mot pour mot : une policy
-- SELECT pour `anon` sur `nexxia_gyms` serait la mauvaise réponse, parce que le GRANT
-- SELECT d'anon porte sur les 47 colonnes de la table — dont `commission_*_override`,
-- `mollie_profile_id`, `plan`, `status`, `trial_ends_at`. On exposerait la grille
-- commerciale de chaque salle pour afficher un logo.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- A.1 — LA TABLE
-- ═════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.member_gyms (
  member_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  gym_id    uuid        NOT NULL REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, gym_id)
);

COMMENT ON TABLE public.member_gyms IS
  'GYM-283 — Appartenances d''un membre à des salles. La clé composite est la garantie : '
  'un membre ne peut appartenir DEUX FOIS à la même salle. C''est la table de VÉRITÉ du '
  'rattachement ; profiles.gym_id n''est plus que la salle ACTIVE (celle affichée).';

-- L'index de la PK sert les lectures « mes salles » ; celui-ci sert le décompte inverse,
-- « combien de membres dans cette salle », qui devient le calcul du plafond (A.4).
CREATE INDEX IF NOT EXISTS idx_member_gyms_gym ON public.member_gyms (gym_id);

-- 🔴 LE CHANGEMENT DE SENS, ÉCRIT LÀ OÙ ON LE LIRA. Sans ce commentaire, le prochain
-- développeur lira `profiles.gym_id` comme « la salle du membre » et écrira une requête
-- fausse dès qu'un membre en aura deux.
COMMENT ON COLUMN public.profiles.gym_id IS
  'GYM-283 — SALLE ACTIVE, et non « la » salle du membre. Depuis les appartenances '
  'multiples, la vérité du rattachement est dans member_gyms ; cette colonne dit '
  'seulement laquelle est affichée en ce moment. ⚠️ Tout décompte de membres doit porter '
  'sur member_gyms : compter ici sous-estimerait une salle dès qu''un membre en regarde '
  'une autre. Modifiable côté client UNIQUEMENT vers une appartenance vérifiée '
  '(trigger trg_gym_id_immutable, GYM-203/283) — via switch_active_gym.';

ALTER TABLE public.member_gyms ENABLE ROW LEVEL SECURITY;

-- ⚠️ LECTURE : SES PROPRES LIGNES, RIEN D'AUTRE. Un membre n'a aucune raison de savoir
-- qui fréquente quelle salle — ce serait un annuaire de clientèle offert au premier
-- compte créé.
DROP POLICY IF EXISTS "Un membre lit ses propres appartenances" ON public.member_gyms;
CREATE POLICY "Un membre lit ses propres appartenances" ON public.member_gyms
  FOR SELECT TO authenticated
  USING (member_id = (select auth.uid()));

-- ⚠️ AUCUNE POLICY D'ÉCRITURE, ET C'EST VOULU : une appartenance ne se décrète pas
-- soi-même. Elle naît d'un signup (handle_new_user) ou d'un geste serveur. `service_role`
-- ignore RLS ; le GRANT ci-dessous ferme la porte à tous les autres. Sans ce REVOKE, les
-- rôles client héritent des droits par défaut du schéma et pourraient s'auto-inscrire
-- dans n'importe quelle salle — ce qui viderait de son sens tout le contrôle de A.3.
REVOKE ALL ON TABLE public.member_gyms FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.member_gyms TO authenticated;
GRANT ALL    ON TABLE public.member_gyms TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- A.2 — REPRISE DE L'EXISTANT
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ TOUS LES PROFILS RATTACHÉS, PAS SEULEMENT LES MEMBRES. Un gérant a lui aussi un
-- gym_id ; l'exclure ferait de son rattachement une appartenance « non vérifiée », et le
-- trigger de A.3 lui refuserait une bascule que le service_role lui accorde déjà.
-- ON CONFLICT DO NOTHING : rejouable sans effet.
INSERT INTO public.member_gyms (member_id, gym_id, joined_at)
SELECT p.id, p.gym_id, COALESCE(p.created_at, now())
FROM public.profiles p
WHERE p.gym_id IS NOT NULL
ON CONFLICT (member_id, gym_id) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- A.3 — 🔴 LE POINT LE PLUS SENSIBLE DU LOT : ASSOUPLIR SANS OUVRIR
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Le trigger GYM-203 interdit TOUTE modification client de `profiles.gym_id`. Il a été
-- écrit contre une brèche réelle : un membre pouvait se rattacher à une AUTRE salle par
-- un simple PATCH, et lire ses données. C'est une évasion multi-tenant.
--
-- Les appartenances multiples exigent que la bascule devienne possible. La question n'est
-- donc pas « faut-il assouplir » mais « qu'est-ce qui reste interdit ».
--
-- CE QUI RESTE INTERDIT, ET C'EST TOUTE LA GARDE :
--   se rattacher à une salle où l'on n'est PAS déjà membre.
-- La transition n'est autorisée que vers une ligne EXISTANTE de member_gyms — table dont
-- aucun rôle client ne peut écrire (A.1). Le membre choisit donc parmi ses appartenances,
-- il n'en crée aucune. La brèche de GYM-203 reste fermée : le PATCH vers une salle
-- étrangère échoue exactement comme avant.
--
-- ⚠️ DEUX RAISONS QUI SE RENFORCENT, ET C'EST DÉLIBÉRÉ :
--   1. la fonction reste SECURITY INVOKER (elle ne l'a jamais été autrement) : la lecture
--      de member_gyms passe donc par la RLS de A.1, qui ne montre au membre QUE ses
--      propres lignes. Il ne peut pas « voir » une appartenance qui n'est pas la sienne,
--      donc pas non plus la revendiquer ;
--   2. le prédicat exige en plus `member_id = NEW.id`.
-- L'une des deux suffirait ; les deux ensemble font qu'aucune erreur de policy future ne
-- rouvre la brèche à elle seule.
--
-- 🔴 ET CE TRIGGER EST LE SEUL REMPART — VÉRIFIÉ, PAS SUPPOSÉ. On pourrait croire que la
-- liste blanche de colonnes de GYM-203 bloque déjà `gym_id` en amont. C'EST FAUX : le
-- GRANT UPDATE d'`authenticated` sur `profiles` INCLUT bien `gym_id` (relevé le 26/08 —
-- il figure entre `first_name` et `last_name` dans les 24 colonnes accordées). Rien
-- d'autre que ce trigger n'empêche un PATCH direct. C'est pourquoi l'exception ci-dessous
-- est écrite en whitelist (« autorise SI appartenance ») et jamais en blacklist, et
-- pourquoi le test ⑨ — PATCH vers une salle étrangère → 42501 — est le contrôle qui
-- compte dans la recette.
--
-- ⚠️ ANTI-DRIFT : corps recopié depuis la définition LIVE (pg_get_functiondef, 26/08).
-- Le court-circuit service_role, le message et l'ERRCODE 42501 sont conservés à
-- l'identique ; SEULE la condition de refus gagne son exception.
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

  IF OLD.gym_id IS NOT NULL AND NEW.gym_id IS DISTINCT FROM OLD.gym_id THEN
    -- GYM-283 — SEULE MODIFICATION : la bascule vers une appartenance VÉRIFIÉE passe.
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

-- La RPC est la porte NOMMÉE de la bascule : elle refuse explicitement (PT403) plutôt que
-- de laisser le trigger lever un 42501 que le client ne saurait pas interpréter.
CREATE OR REPLACE FUNCTION public.switch_active_gym(p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'switch_active_gym: appel non authentifié'
      USING ERRCODE = 'PT401', HINT = 'GYM_UNAUTHENTICATED';
  END IF;

  -- ⚠️ LE CONTRÔLE PORTE SUR L'APPELANT (auth.uid()), JAMAIS SUR UN PARAMÈTRE. La
  -- fonction est SECURITY DEFINER : elle contourne la RLS, donc le seul rempart est que
  -- l'identité vienne du jeton. Accepter un p_member_id rendrait la bascule possible pour
  -- le compte de n'importe qui.
  IF NOT EXISTS (
    SELECT 1 FROM public.member_gyms
    WHERE member_id = v_uid AND gym_id = p_gym_id
  ) THEN
    RAISE EXCEPTION 'switch_active_gym: aucune appartenance à cette salle'
      USING ERRCODE = 'PT403', HINT = 'GYM_NOT_A_MEMBER';
  END IF;

  UPDATE public.profiles
  SET gym_id = p_gym_id, updated_at = now()
  WHERE id = v_uid;

  RETURN jsonb_build_object('status', 'switched', 'gym_id', p_gym_id);
END;
$function$;

COMMENT ON FUNCTION public.switch_active_gym(uuid) IS
  'GYM-283 — Bascule la salle ACTIVE du membre appelant. Refuse (PT403) toute salle où il '
  'n''est pas déjà membre : la bascule choisit parmi les appartenances, elle n''en crée '
  'aucune. L''identité vient TOUJOURS de auth.uid(), jamais d''un paramètre.';

REVOKE ALL     ON FUNCTION public.switch_active_gym(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.switch_active_gym(uuid) TO authenticated, service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- A.4 — 🔴 LE PIÈGE DU PLAFOND : COMPTER SUR member_gyms
-- ═════════════════════════════════════════════════════════════════════════════════════
-- `handle_new_user` compte aujourd'hui les membres avec
--     SELECT count(*) FROM profiles WHERE gym_id = <salle> AND role='member' …
-- Avec des appartenances multiples, un membre qui bascule ailleurs DISPARAÎT de ce
-- décompte alors qu'il occupe toujours sa place : le plafond du plan Free deviendrait
-- contournable — il suffirait de faire basculer les membres à tour de rôle.
--
-- Le décompte porte donc sur member_gyms, qui ne bouge pas quand la salle active change.
-- La jointure sur profiles est conservée pour les deux filtres qui comptent : `role` et
-- `deleted_at` (un compte supprimé ne consomme pas de place).
--
-- ⚠️ ANTI-DRIFT : corps recopié depuis le LIVE. DEUX ajouts, aucun autre changement —
-- le décompte, et l'insertion dans member_gyms quand le rattachement est accordé.
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
        -- GYM-283 — AJOUT 1/2 : le décompte porte sur member_gyms, pas sur profiles.gym_id.
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
    privacy_policy_accepted_at, privacy_policy_version,
    terms_accepted_at, terms_version, marketing_consent, created_at, updated_at
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

  -- GYM-283 — AJOUT 2/2 : l'appartenance naît ICI, et seulement si le rattachement a été
  -- ACCORDÉ. Un signup refusé par le plafond laisse v_gym_id à NULL : il ne doit créer
  -- aucune appartenance, sinon la place serait consommée sans que le membre l'ait.
  IF v_gym_id IS NOT NULL THEN
    INSERT INTO public.member_gyms (member_id, gym_id)
    VALUES (NEW.id, v_gym_id)
    ON CONFLICT (member_id, gym_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- ⚠️ RESTE À FAIRE, HORS PÉRIMÈTRE SQL — SIGNALÉ, PAS CORRIGÉ :
-- `_shared/booking-guards.ts → checkMemberQuota` (Edge, TypeScript) compte lui aussi sur
--     .from('profiles').eq('gym_id', gymId).eq('role','member').is('deleted_at', null)
-- et porte donc EXACTEMENT le même défaut. Il est appelé par create-booking et
-- admin-book-member. Tant qu'il n'est pas repris, le plafond reste contournable à la
-- RÉSERVATION même s'il ne l'est plus à l'INSCRIPTION. C'est du code de fonction Edge :
-- interdit dans ce lot, à faire dans le suivant.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- B — LA SURFACE PUBLIQUE (anon)
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Ces trois fonctions sont TOUT ce que le produit expose sans authentification. Chacune
-- a une liste de colonnes explicite ; ajouter une colonne ici, c'est la publier sur
-- Internet. Le réflexe doit être : « de quoi l'écran a-t-il besoin ? », jamais
-- « prenons la ligne ».

-- ── B.1 — RECHERCHE DE SALLE ────────────────────────────────────────────────────────
-- EXPOSE : slug, name, city, logo_url. Rien d'autre.
-- POURQUOI C'EST ACCEPTABLE : ce sont les quatre éléments d'une vignette de résultat, et
--   ils figurent déjà sur la page publique de la salle et dans ses conditions de vente.
-- 🔴 NE JAMAIS AJOUTER : l'ADRESSE (rue) — une commune situe, une rue permet de se
--   présenter chez quelqu'un ; l'email et le téléphone (moisson de contacts) ; `plan`,
--   `status`, `trial_ends_at`, `commission_*` (grille commerciale) ; le nombre de
--   membres (renseignement concurrentiel offert).
--
-- 🔴 PORTE PUBLIQUE = CIBLE D'ÉNUMÉRATION. Sans limite, cette fonction rend l'annuaire
-- complet des salles Viniz en quelques minutes (« a », « b », « c »…). D'où :
--   · moins de 3 caractères → VIDE, sans erreur : c'est ce qui coupe le balayage par
--     préfixe court, et rendre une erreur apprendrait à l'appelant qu'il a touché une
--     limite ;
--   · rate limit par IP : 30 recherches / 15 min. Un humain qui tape un nom avec
--     anti-rebond en déclenche quelques-unes et corrige deux ou trois fois ; 30 laisse
--     de la marge à un NAT d'entreprise, là où une énumération en demande des milliers.
--   · LIMIT 10 : un écran de recherche n'affiche pas plus, et une page suivante serait
--     un outil de moisson.
--
-- ⚠️ IP ABSENTE ⇒ ON LAISSE PASSER. Sans en-tête `x-forwarded-for` exploitable, un
-- identifiant de repli constant limiterait TOUS les visiteurs ensemble : le premier
-- curieux fermerait la recherche pour tout le monde. Extraction identique à
-- create_gym_self_serve (GYM-248).
--
-- ⚠️ INSENSIBILITÉ AUX ACCENTS PAR `gym_slugify` ET NON PAR `unaccent` : l'extension
-- unaccent N'EST PAS installée (vérifié le 26/08 : pg_cron, pg_net, pg_stat_statements,
-- pg_trgm, pgcrypto, plpgsql, supabase_vault, uuid-ossp). `gym_slugify` est déjà déployée,
-- IMMUTABLE, et fait exactement ce travail — c'est le choix qu'avait fait GYM-248 pour la
-- même raison. « Saint-Étienne Fitness » → « saint-etienne-fitness », donc une recherche
-- « etienne » trouve.
CREATE OR REPLACE FUNCTION public.search_gyms(p_query text)
RETURNS TABLE (
  slug     text,
  name     text,
  city     text,
  logo_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_q     text;
  v_ip    text;
  v_ok    boolean;
BEGIN
  v_q := btrim(coalesce(p_query, ''));

  -- Vide, jamais d'erreur : une frappe en cours n'est pas une faute.
  IF length(v_q) < 3 THEN
    RETURN;
  END IF;

  BEGIN
    v_ip := nullif(btrim(split_part(
      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for',
      ',', 1)), '');
  EXCEPTION WHEN OTHERS THEN
    v_ip := NULL;
  END;

  IF v_ip IS NOT NULL THEN
    v_ok := public.check_rate_limit('ip:' || v_ip, 'gym_search', 30, 15);
    IF NOT v_ok THEN
      RAISE EXCEPTION 'search_gyms: trop de recherches, réessayez plus tard'
        USING ERRCODE = 'PT429', HINT = 'GYM_SEARCH_RATE_LIMITED';
    END IF;
  END IF;

  RETURN QUERY
  SELECT g.slug, g.name, g.city, g.logo_url
  FROM public.nexxia_gyms g
  WHERE g.deleted_at IS NULL
    AND g.status <> 'cancelled'
    AND g.slug IS NOT NULL
    AND (
      public.gym_slugify(g.name)              LIKE '%' || public.gym_slugify(v_q) || '%'
      OR public.gym_slugify(coalesce(g.city, '')) LIKE '%' || public.gym_slugify(v_q) || '%'
    )
  ORDER BY g.name
  LIMIT 10;
END;
$function$;

COMMENT ON FUNCTION public.search_gyms(text) IS
  'GYM-102 — Recherche PUBLIQUE de salles. Rend UNIQUEMENT slug, name, city, logo_url. '
  '⚠️ NE JAMAIS y ajouter l''adresse (rue), l''email, le téléphone, ni aucune donnée '
  'commerciale (plan, status, trial_*, commission_*) : c''est une surface Internet. '
  'Moins de 3 caractères → vide. Rate-limitée par IP (30/15 min) : une porte publique est '
  'une cible d''énumération.';

REVOKE ALL     ON FUNCTION public.search_gyms(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.search_gyms(text) TO anon, authenticated;

-- ── B.2 — MARQUE DE LA SALLE ────────────────────────────────────────────────────────
-- EXPOSE : slug, name, logo_url, primary_color, secondary_color.
-- POURQUOI C'EST ACCEPTABLE : l'écran de connexion doit porter les couleurs de la salle
--   AVANT toute authentification — c'est le principe même du white-label. Ces valeurs
--   sont déjà visibles de tout membre, et de quiconque reçoit un email de la salle.
-- 🔴 NE JAMAIS AJOUTER : les colonnes d'identité légale (elles ont leur fonction dédiée,
--   `public_gym_legal_identity`, avec sa propre justification), ni le contact, ni rien
--   de commercial. Une fonction par usage : c'est ce qui permet de raisonner sur ce
--   qu'on publie.
-- ⚠️ Pas de rate limit : l'appel exige de connaître le slug, il ne permet donc aucune
--   énumération — contrairement à la recherche.
CREATE OR REPLACE FUNCTION public.public_gym_branding(p_slug text)
RETURNS TABLE (
  slug            text,
  name            text,
  logo_url        text,
  primary_color   text,
  secondary_color text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
  SELECT g.slug, g.name, g.logo_url, g.primary_color, g.secondary_color
  FROM public.nexxia_gyms g
  WHERE (g.slug = lower(btrim(p_slug)) OR g.subdomain = lower(btrim(p_slug)))
    AND g.deleted_at IS NULL
  LIMIT 1;
$function$;

COMMENT ON FUNCTION public.public_gym_branding(text) IS
  'GYM-102 — Marque PUBLIQUE d''une salle (écran de connexion white-label, avant '
  'authentification). Rend UNIQUEMENT slug, name, logo_url et les deux couleurs. '
  '⚠️ NE JAMAIS y ajouter d''identité légale (voir public_gym_legal_identity), de contact, '
  'ni de donnée commerciale.';

REVOKE ALL     ON FUNCTION public.public_gym_branding(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.public_gym_branding(text) TO anon, authenticated;

-- ── B.3 — PLANNING PUBLIC ───────────────────────────────────────────────────────────
-- EXPOSE : activité (nom, couleur), coach (PRÉNOM/NOM D'AFFICHAGE SEUL), début, fin,
--   capacité, places restantes.
-- POURQUOI C'EST ACCEPTABLE : c'est l'affiche du club — l'information qu'une salle
--   imprime sur sa vitrine. Le nom du coach est déjà public sur la page de la salle.
-- 🔴 NE JAMAIS AJOUTER :
--   · l'identité des membres, ni aucune réservation nominative — le planning dirait qui
--     s'entraîne quand, ce qui est une donnée de fréquentation personnelle ;
--   · les PRIX et toute donnée commerciale ;
--   · `notes`, `cancellation_reason`, `series_id`, `site_id` — colonnes internes ;
--   · `coaches.profile_id` (lien vers un compte), `photo_url` ou `bio` sans décision
--     explicite du coach.
-- ⚠️ Les places restantes viennent de `bookings_count` (compteur maintenu par trigger) et
--   JAMAIS d'une lecture de `bookings` : on publie un NOMBRE, on n'approche pas la table
--   qui porte les identités.
--
-- ⚠️ FENÊTRE BORNÉE PAR booking_horizon_days. Un appelant ne doit pas pouvoir demander
--   trois ans de planning : ce serait à la fois un aspirateur de données et un déni de
--   service à une requête. La borne est celle que la salle a elle-même choisie pour ses
--   membres — publier plus loin que ce que voit un abonné n'aurait aucun sens.
CREATE OR REPLACE FUNCTION public.public_gym_schedule(
  p_slug text,
  p_from timestamptz DEFAULT now(),
  p_to   timestamptz DEFAULT NULL
)
RETURNS TABLE (
  slot_id         uuid,
  starts_at       timestamptz,
  ends_at         timestamptz,
  activity_name   text,
  activity_color  text,
  coach_name      text,
  capacity        integer,
  seats_available integer
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_gym_id  uuid;
  v_horizon integer;
  v_from    timestamptz;
  v_to      timestamptz;
BEGIN
  SELECT g.id, COALESCE(g.booking_horizon_days, 30)
    INTO v_gym_id, v_horizon
  FROM public.nexxia_gyms g
  WHERE (g.slug = lower(btrim(p_slug)) OR g.subdomain = lower(btrim(p_slug)))
    AND g.deleted_at IS NULL
  LIMIT 1;

  -- Slug inconnu → vide, jamais d'erreur : distinguer « salle absente » de « salle sans
  -- cours » apprendrait à un curieux quels slugs existent.
  IF v_gym_id IS NULL THEN
    RETURN;
  END IF;

  -- Bornage. `GREATEST` sur le début : on ne remonte pas le passé au-delà de la veille
  -- (utile pour afficher « aujourd'hui » quel que soit le fuseau de l'appelant).
  -- `LEAST` sur la fin : jamais au-delà de l'horizon choisi par la salle.
  v_from := GREATEST(COALESCE(p_from, now()), now() - interval '1 day');
  v_to   := LEAST(
    COALESCE(p_to, now() + make_interval(days => v_horizon)),
    now() + make_interval(days => v_horizon)
  );

  IF v_to <= v_from THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ts.id,
    ts.starts_at,
    ts.ends_at,
    a.name,
    a.color,
    c.name,
    ts.capacity,
    GREATEST(ts.capacity - COALESCE(ts.bookings_count, 0), 0)
  FROM public.time_slots ts
  JOIN public.activities a ON a.id = ts.activity_id
  LEFT JOIN public.coaches c ON c.id = ts.coach_id
  WHERE ts.gym_id = v_gym_id
    AND ts.starts_at >= v_from
    AND ts.starts_at <  v_to
    -- Créneaux annulés exclus, et activités masquées du planning exclues (GYM-228) :
    -- ce qui n'est pas montré aux membres n'a pas à être montré au public.
    AND COALESCE(ts.status, 'scheduled') <> 'cancelled'
    AND a.active = true
    AND COALESCE(a.hidden_in_planning, false) = false
  ORDER BY ts.starts_at
  LIMIT 500;
END;
$function$;

COMMENT ON FUNCTION public.public_gym_schedule(text, timestamptz, timestamptz) IS
  'GYM-102 — Planning PUBLIC d''une salle. Rend activité, coach (nom d''affichage seul), '
  'horaires, capacité et places restantes. ⚠️ NE JAMAIS y ajouter d''identité de membre, '
  'de réservation nominative, de prix, ni de colonne interne (notes, cancellation_reason, '
  'series_id, site_id). Les places restantes viennent du compteur time_slots.bookings_count, '
  'jamais d''une lecture de `bookings`. Fenêtre bornée par nexxia_gyms.booking_horizon_days.';

REVOKE ALL     ON FUNCTION public.public_gym_schedule(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.public_gym_schedule(text, timestamptz, timestamptz) TO anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- SCÉNARIO DE VÉRIFICATION — à exécuter par le cockpit
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ LES SLUGS DIFFÈRENT PAR ENVIRONNEMENT (relevé le 26/08) :
--      staging → 'dopamine-staging' (Ougrée), 'studio-test-staging' (Liège),
--                'studio-yoga-test-1'
--      prod    → 'dopamine'
--    Les exemples ci-dessous emploient les slugs de STAGING.
--
-- ① Recherche trop courte → vide, sans erreur
--    SELECT * FROM public.search_gyms('do');   -- attendu : 0 ligne
--    ⚠️ 'do' matcherait pourtant « Dopamine » : c'est bien la garde des 3 caractères qui
--       coupe, AVANT même d'atteindre la requête. C'est ce qu'il faut constater.
-- ② Recherche valide → 4 colonnes, et RIEN d'autre
--    SELECT * FROM public.search_gyms('dopamine');   -- 1 ligne
--    SELECT * FROM public.search_gyms('OUGRÉE');     -- 1 ligne (casse + accents ignorés)
--    SELECT * FROM public.search_gyms('LIÈGE');      -- 1 ligne (studio-test-staging)
--    SELECT * FROM public.search_gyms('studio');     -- 2 lignes
--    -- attendu : slug, name, city, logo_url — et AUCUNE autre colonne
-- ③ Rate limit — exige un vrai appel PostgREST (l'en-tête x-forwarded-for n'existe pas
--    depuis l'éditeur SQL, où la fonction laisse donc passer, par conception) :
--      curl -s -X POST "$URL/rest/v1/rpc/search_gyms" -H "apikey: $ANON" \
--           -H 'Content-Type: application/json' -d '{"p_query":"studio"}'
--    31 appels depuis la même IP en 15 min → le 31e lève PT429 / GYM_SEARCH_RATE_LIMITED.
--    ⚠️ Prérequis : la migration GYM-261 doit être appliquée, sinon le 2e appel lève 42P10.
-- ④ Branding en ANON (clé anon, aucune session)
--    SELECT * FROM public.public_gym_branding('dopamine-staging');
--    -- attendu : 1 ligne, 5 colonnes ; slug inconnu → 0 ligne, pas d'erreur
-- ⑤ Planning en ANON — AUCUNE donnée membre
--    SELECT * FROM public.public_gym_schedule('dopamine-staging');
--    -- attendu : uniquement les 8 colonnes déclarées ; seats_available cohérent avec
--    --           capacity − bookings_count ; aucun créneau 'cancelled'
-- ⑥ Fenêtre hors horizon → bornée
--    SELECT max(starts_at) FROM public.public_gym_schedule(
--             'dopamine-staging', now(), now() + interval '3 years');
--    -- attendu : <= now() + 30 jours (booking_horizon_days de la salle)
-- ⑦ member_gyms : reprise complète et cloisonnement
--    SELECT (SELECT count(*) FROM public.profiles   WHERE gym_id IS NOT NULL) AS profils,
--           (SELECT count(*) FROM public.member_gyms)                          AS appartenances;
--    -- attendu : égaux (16 = 16 en staging au 26/08)
--    -- puis, avec le JWT d'un MEMBRE : SELECT * FROM member_gyms;
--    -- attendu : SES lignes uniquement — jamais celles d'un autre
-- ⑧ Bascule vers une salle d'appartenance → OK
--    SELECT public.switch_active_gym('<gym dont il est membre>');
--    -- attendu : {"status":"switched", ...} et profiles.gym_id mis à jour
-- ⑨ Bascule vers une salle ÉTRANGÈRE → REFUS  (LE TEST QUI COMPTE)
--    SELECT public.switch_active_gym('<salle où il n''est PAS membre>');
--    -- attendu : PT403 / GYM_NOT_A_MEMBER
--    -- et le contournement direct doit rester fermé, avec le JWT du membre :
--    --   UPDATE profiles SET gym_id = '<salle étrangère>' WHERE id = auth.uid();
--    -- attendu : 42501 GYM_ID_IMMUTABLE — inchangé depuis GYM-203
-- ⑩ Non-régression : un signup se comporte exactement comme avant
--    -- créer un compte avec user_metadata.gym_id = <salle>
--    -- attendu : profiles.gym_id posé comme avant, ET une ligne member_gyms créée
--    -- puis vérifier le plafond : saturer max_members, faire basculer un membre vers une
--    -- autre salle, et constater que la place N'EST PAS libérée (c'est tout l'objet du
--    -- passage du décompte sur member_gyms).
