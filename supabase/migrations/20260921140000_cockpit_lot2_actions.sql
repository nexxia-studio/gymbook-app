-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  COCKPIT B2B — LOT 2 : les gestes, et le journal qui les retient                      ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260921140000_cockpit_lot2_actions.sql
--
-- 🔴 NON APPLIQUÉE PAR LE LOT. Aucun déploiement n'était autorisé. À jouer sur staging
-- d'abord. Voir docs/recettes/GYM-cockpit-lot2.md.
--
-- LE PRINCIPE, posé au lot 1 et non négociable : le super-administrateur LIT par la RLS,
-- il n'ÉCRIT QUE par des RPC `SECURITY DEFINER` qui vérifient `is_super_admin()` en
-- première ligne et journalisent DANS LA MÊME TRANSACTION. Un journal qu'on peut
-- contourner n'est pas un journal.

-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  § 1 — `audit_logs` DEVIENT EN AJOUT SEUL, POUR TOUT LE MONDE                         ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- POURQUOI `audit_logs` ET NON `gym_admin_actions` : cette dernière porte une politique
-- `ALL` côté gérant dont le `WITH CHECK` est nul — PostgreSQL réutilise alors le `USING`
-- comme contrôle d'écriture, et un gérant peut MODIFIER ou SUPPRIMER les lignes de sa
-- salle. Il pourrait donc effacer la trace d'une action de la plateforme sur SA salle.
-- Elle porte en outre un CHECK sur une liste fermée d'`action_type` et décrit un geste de
-- GÉRANT sur un MEMBRE — ce que ceci n'est pas. `admin-replay-mollie-webhook` avait déjà
-- tranché pareil, pour les mêmes raisons.
--
-- `audit_logs` a exactement la forme voulue — `old_data` / `new_data` sont l'état AVANT et
-- l'état APRÈS — et ses deux seules politiques sont en `SELECT` : côté client, elle est
-- déjà en ajout seul.
--
-- 🔴 MAIS « CÔTÉ CLIENT » NE SUFFIT PAS. Les RPC `SECURITY DEFINER` s'exécutent en
-- PROPRIÉTAIRE et contournent la RLS. Sans le trigger ci-dessous, une RPC future mal
-- écrite — ou `service_role` — pourrait réécrire l'historique. Avec lui, personne ne le
-- peut. C'est la différence entre « la RLS l'interdit » et « c'est impossible ».

CREATE OR REPLACE FUNCTION public.enforce_audit_logs_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  RAISE EXCEPTION
    'AUDIT_LOGS_APPEND_ONLY: un journal d''audit ne se modifie pas et ne s''efface pas (tentative de % sur la ligne %)',
    TG_OP, COALESCE(OLD.id::text, '(inconnue)')
    USING ERRCODE = '42501';
END;
$$;

COMMENT ON FUNCTION public.enforce_audit_logs_append_only() IS
  'Cockpit lot 2 — rend public.audit_logs en AJOUT SEUL, y compris pour service_role et '
  'les fonctions SECURITY DEFINER, qui contournent la RLS. Une purge de rétention RGPD '
  'devra désactiver ce trigger EXPLICITEMENT, en connaissance de cause — pas avant.';

DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_audit_logs_append_only();

-- ⚠️ DROITS DORMANTS — la mine de gym203, fermée ici.
-- `anon` et `authenticated` détiennent DELETE, INSERT, UPDATE et TRUNCATE au niveau TABLE.
-- Inerte aujourd'hui : `audit_logs` n'a AUCUNE politique d'écriture, la RLS refuse donc
-- tout. Mais le jour où quelqu'un ajoute une politique d'écriture — pour une raison sans
-- rapport — ces droits s'éveillent d'un coup, sans que personne ne relise cette ligne.
--
-- ✅ VÉRIFIÉ AVANT DE RÉVOQUER : aucun code applicatif n'écrit `audit_logs` depuis un
-- client. Le seul écrivain est `admin-replay-mollie-webhook`, qui emploie un client
-- `service_role` — que cette révocation ne concerne pas.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated;

-- ⚠️ TRUNCATE MÉRITE SA MENTION : il ne déclenche PAS un trigger FOR EACH ROW. Le retirer
-- à `anon` et `authenticated` est donc la SEULE protection contre un vidage de table par
-- un porteur de jeton. `service_role` le conserve — c'est le chemin de la purge assumée.

-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  § 2 — LES GESTES                                                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- Quatre RPC, une par geste, plutôt qu'une fonction générique à discriminant : chacune
-- porte SA validation, et se relit seule. Le garde et l'écriture au journal sont recopiés
-- dans chacune — c'est délibéré : une fonction d'aide partagée serait une cinquième
-- surface à protéger, pour n'économiser que six lignes.
--
-- TOUTES suivent la même forme :
--   1. `is_super_admin()` ou 42501 ;
--   2. motif obligatoire ;
--   3. `SELECT … FOR UPDATE` — l'état AVANT est capturé sous verrou, donc cohérent avec
--      l'écriture qui suit ; deux gestes simultanés ne peuvent pas journaliser le même
--      « avant » ;
--   4. refus des non-changements — un double-clic ne doit pas produire deux lignes ;
--   5. UPDATE ;
--   6. INSERT dans `audit_logs`, MÊME TRANSACTION : si le journal échoue, le geste est
--      annulé. C'est ce qui rend le journal non contournable.
--
-- ⚠️ `old_data` NE PORTE QUE L'ÉTAT AVANT, et le motif vit dans `new_data`. C'est ce qui
-- rend le RETOUR ARRIÈRE mécanique : rejouer la même RPC avec la valeur lue dans `old_data`
-- ramène exactement l'état précédent. Mêler le motif à `old_data` obligerait à le filtrer.
--
-- ⚠️ AUCUN SECRET DANS `new_data` — règle posée par `admin-replay-mollie-webhook`, et le
-- GÉRANT de la salle lit ces lignes (politique « Gym admins voient les logs de leur gym »).
-- C'est assumé : une intervention de l'éditeur sur une salle doit être visible par elle.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- a. LE PLAN
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cockpit_set_plan(
  p_gym_id uuid,
  p_plan   text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_avant text;
  v_nom   text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'cockpit_set_plan: réservé au super-administrateur' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'cockpit_set_plan: un motif est obligatoire' USING ERRCODE = '22023';
  END IF;

  -- ⚠️ VALIDÉ CONTRE `nexxia_plan_limits`, LA GRILLE VIVANTE — jamais contre une liste
  -- écrite ici. Les grilles ont déjà différé entre staging et production ; un plan recopié
  -- dans le code aurait menti au premier ajout de palier. Le CHECK de la colonne reste le
  -- second filet, pas le premier.
  IF NOT EXISTS (SELECT 1 FROM public.nexxia_plan_limits l WHERE l.plan = p_plan) THEN
    RAISE EXCEPTION 'cockpit_set_plan: plan inconnu de la grille (%)', p_plan USING ERRCODE = '22023';
  END IF;

  SELECT g.plan, g.name INTO v_avant, v_nom
    FROM public.nexxia_gyms g WHERE g.id = p_gym_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cockpit_set_plan: salle introuvable (%)', p_gym_id USING ERRCODE = 'P0002';
  END IF;

  IF v_avant IS NOT DISTINCT FROM p_plan THEN
    RAISE EXCEPTION 'cockpit_set_plan: la salle est déjà en « % »', p_plan USING ERRCODE = '23505';
  END IF;

  UPDATE public.nexxia_gyms SET plan = p_plan, updated_at = now() WHERE id = p_gym_id;

  INSERT INTO public.audit_logs (gym_id, actor_id, action, resource, resource_id, old_data, new_data)
  VALUES (
    p_gym_id, auth.uid(), 'cockpit_set_plan', 'nexxia_gyms', p_gym_id,
    jsonb_build_object('plan', v_avant),
    jsonb_build_object('plan', p_plan, 'reason', btrim(p_reason))
  );

  RETURN jsonb_build_object('gym_id', p_gym_id, 'name', v_nom, 'plan_avant', v_avant, 'plan_apres', p_plan);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- b. LE STATUT
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cockpit_set_status(
  p_gym_id uuid,
  p_status text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_avant text;
  v_nom   text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'cockpit_set_status: réservé au super-administrateur' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'cockpit_set_status: un motif est obligatoire' USING ERRCODE = '22023';
  END IF;

  -- ⚠️ LES VALEURS DU CHECK, ET ELLES SEULES. Relevées sur la base :
  -- `nexxia_gyms_status_check` → active, trialing, suspended, cancelled. Poser une valeur
  -- hors liste ferait échouer l'UPDATE sur la contrainte — mais avec un message Postgres
  -- illisible, APRÈS avoir pris le verrou. On refuse avant, et on dit quoi.
  IF p_status NOT IN ('active', 'trialing', 'suspended', 'cancelled') THEN
    RAISE EXCEPTION 'cockpit_set_status: statut inconnu (%) — attendu active, trialing, suspended ou cancelled', p_status
      USING ERRCODE = '22023';
  END IF;

  SELECT g.status, g.name INTO v_avant, v_nom
    FROM public.nexxia_gyms g WHERE g.id = p_gym_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cockpit_set_status: salle introuvable (%)', p_gym_id USING ERRCODE = 'P0002';
  END IF;

  IF v_avant IS NOT DISTINCT FROM p_status THEN
    RAISE EXCEPTION 'cockpit_set_status: la salle est déjà « % »', p_status USING ERRCODE = '23505';
  END IF;

  UPDATE public.nexxia_gyms SET status = p_status, updated_at = now() WHERE id = p_gym_id;

  INSERT INTO public.audit_logs (gym_id, actor_id, action, resource, resource_id, old_data, new_data)
  VALUES (
    p_gym_id, auth.uid(), 'cockpit_set_status', 'nexxia_gyms', p_gym_id,
    jsonb_build_object('status', v_avant),
    jsonb_build_object('status', p_status, 'reason', btrim(p_reason))
  );

  RETURN jsonb_build_object('gym_id', p_gym_id, 'name', v_nom, 'statut_avant', v_avant, 'statut_apres', p_status);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- c. L'ESSAI
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- 🔴 C'EST LE GESTE QUI MANQUAIT. Le lot 1 montre que l'essai de Pace est terminé depuis
-- le 07/09 sans que rien ne l'ait signalé ni clos : le résolveur dégrade bien les features,
-- mais aucun humain n'avait de bouton.
--
-- `p_trial_ends_at` NULL = CLORE l'essai (la salle n'en a plus). Une date future = le
-- prolonger. Une date passée est acceptée : c'est la façon de dire « il s'est terminé là ».
CREATE OR REPLACE FUNCTION public.cockpit_set_trial_end(
  p_gym_id        uuid,
  p_trial_ends_at timestamptz,
  p_reason        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_avant timestamptz;
  v_nom   text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: réservé au super-administrateur' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: un motif est obligatoire' USING ERRCODE = '22023';
  END IF;

  -- Borne haute : un essai de dix ans est une erreur de saisie, pas une décision.
  IF p_trial_ends_at IS NOT NULL AND p_trial_ends_at > now() + interval '1 year' THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: au-delà d''un an, c''est un plan, pas un essai'
      USING ERRCODE = '22023';
  END IF;

  SELECT g.trial_ends_at, g.name INTO v_avant, v_nom
    FROM public.nexxia_gyms g WHERE g.id = p_gym_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: salle introuvable (%)', p_gym_id USING ERRCODE = 'P0002';
  END IF;

  IF v_avant IS NOT DISTINCT FROM p_trial_ends_at THEN
    RAISE EXCEPTION 'cockpit_set_trial_end: la date d''essai est déjà celle-là' USING ERRCODE = '23505';
  END IF;

  UPDATE public.nexxia_gyms SET trial_ends_at = p_trial_ends_at, updated_at = now() WHERE id = p_gym_id;

  INSERT INTO public.audit_logs (gym_id, actor_id, action, resource, resource_id, old_data, new_data)
  VALUES (
    p_gym_id, auth.uid(), 'cockpit_set_trial_end', 'nexxia_gyms', p_gym_id,
    jsonb_build_object('trial_ends_at', v_avant),
    jsonb_build_object('trial_ends_at', p_trial_ends_at, 'reason', btrim(p_reason))
  );

  RETURN jsonb_build_object('gym_id', p_gym_id, 'name', v_nom, 'essai_avant', v_avant, 'essai_apres', p_trial_ends_at);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- d. LES DÉROGATIONS DE COMMISSION
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ ELLES VIVENT SUR `nexxia_gyms`, PAS DANS `nexxia_features` — relevé sur la base :
-- `commission_sepa_rate_override` et `commission_cb_rate_override`, `numeric`, NULL par
-- défaut. `nexxia_features` porte des drapeaux booléens PAR SALLE (c'est ce qui retire
-- `multi_site` à Dopamine) ; les taux n'y ont pas leur place. On respecte ce qui existe.
--
-- NULL = pas de dérogation, la salle suit le taux de son plan. Dopamine est aujourd'hui à
-- 0.0000 sur les deux — une dérogation EXPLICITE, à ne pas confondre avec l'absence.
--
-- Les DEUX taux sont posés par le même appel : ils décrivent une seule décision
-- commerciale, et les séparer permettrait un état mi-dérogé que personne n'a voulu.
CREATE OR REPLACE FUNCTION public.cockpit_set_commission_override(
  p_gym_id    uuid,
  p_sepa_rate numeric,
  p_cb_rate   numeric,
  p_reason    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sepa_avant numeric;
  v_cb_avant   numeric;
  v_nom        text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'cockpit_set_commission_override: réservé au super-administrateur' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'cockpit_set_commission_override: un motif est obligatoire' USING ERRCODE = '22023';
  END IF;

  -- Un taux est une FRACTION (0.0150 = 1,5 %), pas un pourcentage. Une saisie à « 1.5 »
  -- prélèverait 150 % de chaque paiement ; la borne haute est là pour ça, et 0.5 (50 %)
  -- est déjà bien au-delà de tout ce qui est commercialement plausible.
  IF (p_sepa_rate IS NOT NULL AND (p_sepa_rate < 0 OR p_sepa_rate > 0.5))
     OR (p_cb_rate IS NOT NULL AND (p_cb_rate < 0 OR p_cb_rate > 0.5)) THEN
    RAISE EXCEPTION 'cockpit_set_commission_override: un taux se donne en FRACTION, entre 0 et 0.5 (0.0150 = 1,5 %%)'
      USING ERRCODE = '22023';
  END IF;

  -- ⚠️ LES DEUX ENSEMBLE OU AUCUN : un seul des deux renseigné laisserait la salle
  -- dérogée sur un moyen de paiement et pas sur l'autre, sans que ce soit une décision.
  IF (p_sepa_rate IS NULL) <> (p_cb_rate IS NULL) THEN
    RAISE EXCEPTION 'cockpit_set_commission_override: poser les deux taux, ou aucun (retrait de la dérogation)'
      USING ERRCODE = '22023';
  END IF;

  SELECT g.commission_sepa_rate_override, g.commission_cb_rate_override, g.name
    INTO v_sepa_avant, v_cb_avant, v_nom
    FROM public.nexxia_gyms g WHERE g.id = p_gym_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cockpit_set_commission_override: salle introuvable (%)', p_gym_id USING ERRCODE = 'P0002';
  END IF;

  IF v_sepa_avant IS NOT DISTINCT FROM p_sepa_rate AND v_cb_avant IS NOT DISTINCT FROM p_cb_rate THEN
    RAISE EXCEPTION 'cockpit_set_commission_override: ces taux sont déjà en place' USING ERRCODE = '23505';
  END IF;

  UPDATE public.nexxia_gyms
     SET commission_sepa_rate_override = p_sepa_rate,
         commission_cb_rate_override   = p_cb_rate,
         updated_at = now()
   WHERE id = p_gym_id;

  INSERT INTO public.audit_logs (gym_id, actor_id, action, resource, resource_id, old_data, new_data)
  VALUES (
    p_gym_id, auth.uid(), 'cockpit_set_commission_override', 'nexxia_gyms', p_gym_id,
    jsonb_build_object('commission_sepa_rate_override', v_sepa_avant,
                       'commission_cb_rate_override',   v_cb_avant),
    jsonb_build_object('commission_sepa_rate_override', p_sepa_rate,
                       'commission_cb_rate_override',   p_cb_rate,
                       'reason', btrim(p_reason))
  );

  RETURN jsonb_build_object('gym_id', p_gym_id, 'name', v_nom,
                            'sepa_avant', v_sepa_avant, 'cb_avant', v_cb_avant,
                            'sepa_apres', p_sepa_rate, 'cb_apres', p_cb_rate);
END;
$$;

-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  § 3 — LES DROITS                                                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 `REVOKE … FROM anon` NOMMÉMENT, et ce n'est pas redondant : toute fonction de `public`
-- naît exécutable par tous, et PostgREST expose `anon` comme un rôle à part entière.
-- `REVOKE … FROM PUBLIC` retire le droit du pseudo-rôle PUBLIC — il NE retire PAS celui que
-- Supabase accorde nommément à `anon`. Le lot 1 l'avait manqué ; il l'a corrigé à
-- l'application. On ne refait pas l'erreur.

REVOKE ALL ON FUNCTION public.cockpit_set_plan(uuid, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.cockpit_set_plan(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cockpit_set_plan(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.cockpit_set_status(uuid, text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.cockpit_set_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cockpit_set_status(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.cockpit_set_trial_end(uuid, timestamptz, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.cockpit_set_trial_end(uuid, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cockpit_set_trial_end(uuid, timestamptz, text) TO authenticated;

REVOKE ALL ON FUNCTION public.cockpit_set_commission_override(uuid, numeric, numeric, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.cockpit_set_commission_override(uuid, numeric, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.cockpit_set_commission_override(uuid, numeric, numeric, text) TO authenticated;

-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  CONTRÔLES D'APRÈS-COUP, lisibles dans la sortie de psql                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
DO $$
DECLARE
  v_anon integer;
  v_trig integer;
  v_ecr  integer;
BEGIN
  SELECT count(*) INTO v_anon
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname LIKE 'cockpit\_%'
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_anon = 0 THEN
    RAISE NOTICE '✅ Aucune fonction cockpit_* n''est exécutable par anon.';
  ELSE
    RAISE WARNING '🔴 % fonction(s) cockpit_* restent exécutables par anon.', v_anon;
  END IF;

  SELECT count(*) INTO v_trig FROM pg_trigger
   WHERE tgrelid = 'public.audit_logs'::regclass AND tgname = 'trg_audit_logs_append_only';

  IF v_trig = 1 THEN
    RAISE NOTICE '✅ audit_logs est en ajout seul (trigger posé).';
  ELSE
    RAISE WARNING '🔴 Le trigger d''ajout seul sur audit_logs est ABSENT.';
  END IF;

  SELECT count(*) INTO v_ecr
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'audit_logs'
     AND grantee IN ('anon', 'authenticated')
     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

  IF v_ecr = 0 THEN
    RAISE NOTICE '✅ Plus aucun droit d''écriture dormant sur audit_logs pour anon/authenticated.';
  ELSE
    RAISE WARNING '🔴 % droit(s) d''écriture subsistent sur audit_logs.', v_ecr;
  END IF;
END $$;
