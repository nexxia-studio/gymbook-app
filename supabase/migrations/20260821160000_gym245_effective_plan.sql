-- GYM-245 : get_effective_plan — résolveur UNIQUE plan + overrides.
--
-- PROBLÈME : deux systèmes de drapeaux coexistent et AUCUN n'est appliqué.
--   - nexxia_plan_limits : limites/drapeaux PAR PLAN. Lu par exactement deux appelants
--     (create-payment:95 et create-subscription:99, pour payments_enabled) — rien d'autre.
--   - nexxia_features    : overrides PAR SALLE. Lu par PERSONNE. gym_has_feature() est
--     déployée mais n'est appelée nulle part dans le monorepo (cf. greps ci-dessous).
--   Et gym_has_feature() ignore complètement nexxia_plan_limits : une salle sans ligne
--   d'override reçoit false pour TOUT, quel que soit son plan. C'est le défaut de fond.
--
-- CIBLE : une seule porte d'entrée. nexxia_plan_limits = défauts du plan,
-- nexxia_features = overrides par salle, get_effective_plan() résout les deux.
--
-- ─── Constats base live (Règle Zéro, 21/08) ──────────────────────────────────
-- 1. Schéma lu sur STAGING (buovgpokubrkejunmauq) via information_schema/OpenAPI.
--    Les 21 colonnes de nexxia_plan_limits et les 6 de nexxia_features sont conformes.
--    ⚠️ Staging a 4 migrations appliquées absentes du dépôt (20260821113153, 120405,
--    121313, 124414) : le schéma a été lu sur la base, pas sur les fichiers du dépôt.
--
-- 2. ⚠️ LES DEUX GRILLES DE PLANS DIFFÈRENT, et c'est structurant :
--      staging : free · starter · pro · premium
--      prod    : free · starter · studio · pro      ← 'studio', pas 'premium'
--    AUCUN nom de plan n'est donc écrit en dur dans une décision de gating : la fonction
--    lit nexxia_plan_limits par jointure sur nexxia_gyms.plan. La seule occurrence d'un
--    nom de plan est la constante du hook trial (v_trial_plan), désactivée, et elle
--    dégrade proprement si la ligne n'existe pas dans la grille locale.
--
-- 3. nexxia_features : 0 ligne en staging, 15 en PROD (une seule salle, Dopamine).
--    Les UPDATE/DELETE de normalisation sont donc des no-ops en staging et n'agiront
--    qu'au déploiement prod. État réel des 15 lignes relevé avant écriture :
--      analytics=true · android_app=false · api_access=false · custom_branding=true
--      export_enabled=true · gift_cards=false · ios_app=true · marketing_emails=true
--      medical_notes=false · multi_site=false · payments_enabled=true
--      qr_code_checkin=true · sms_notifications=false · waitlist_priority=true
--      web_app=true
--
-- 4. Greps monorepo (apps/ + supabase/functions/, hors types générés et baseline) :
--      qr_code_checkin · ios_app · android_app · api_access · multi_site
--      gift_cards · sms_notifications · waitlist_priority
--      web_app · custom_branding · marketing_emails ......... 0 consommateur
--      gym_has_feature ...... types générés + hardening search_path uniquement,
--                             AUCUN appel applicatif
--      nexxia_features ...... types générés + baseline uniquement, AUCUNE lecture
--    Deux faux positifs vérifiés, à ne pas confondre :
--      · `analytics` (8 hits) = le client PostHog (apps/mobile/lib/analytics.ts),
--        sans rapport avec le drapeau.
--      · `medical_notes` (4 hits) = la TABLE medical_notes (cascade delete-account
--        + types générés), sans rapport avec le drapeau homonyme.
--    ⚠️ waitlist_priority est le seul purgé qui valait `true`. Purge confirmée : zéro
--    consommateur, aucune notion de priorité en liste d'attente dans le produit
--    (notify-waitlist / confirm-waitlist sont strictement FIFO).
--
-- 5. Ordre de résolution des commissions répliqué depuis le code DÉPLOYÉ
--    (_shared/commission.ts, utilisé par create-payment et create-subscription) :
--    override ?? taux du plan, où NULL = pas d'override et 0 = override explicite à 0.
--
-- Rejouable : chaque étape est conditionnelle ou idempotente.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═══ a) Normalisation de nexxia_features ═════════════════════════════════════

-- Rejeu : si la cible existe déjà pour la même salle, l'ancienne ligne est supprimée
-- plutôt que renommée — sinon l'UPDATE violerait UNIQUE (gym_id, feature).
WITH renames(old_name, new_name) AS (
  VALUES ('qr_code_checkin', 'qr_checkin_enabled'),
         ('analytics',       'analytics_enabled'),
         ('ios_app',         'ios_app_enabled'),
         ('android_app',     'android_app_enabled'),
         ('api_access',      'api_access_enabled'),
         ('multi_site',      'multi_site_enabled')
)
DELETE FROM public.nexxia_features f
USING renames r
WHERE f.feature = r.old_name
  AND EXISTS (
    SELECT 1 FROM public.nexxia_features t
    WHERE t.gym_id = f.gym_id AND t.feature = r.new_name
  );

WITH renames(old_name, new_name) AS (
  VALUES ('qr_code_checkin', 'qr_checkin_enabled'),
         ('analytics',       'analytics_enabled'),
         ('ios_app',         'ios_app_enabled'),
         ('android_app',     'android_app_enabled'),
         ('api_access',      'api_access_enabled'),
         ('multi_site',      'multi_site_enabled')
)
UPDATE public.nexxia_features f
SET feature = r.new_name, updated_at = now()
FROM renames r
WHERE f.feature = r.old_name;

-- payments_enabled et export_enabled portent déjà le nom canonique : rien à faire.

-- Purge des drapeaux sans contrepartie dans le produit (grep §4 : 0 consommateur).
DELETE FROM public.nexxia_features
WHERE feature IN ('gift_cards', 'sms_notifications', 'medical_notes', 'waitlist_priority');

-- CONSERVÉS tels quels, hors grille : web_app, custom_branding, marketing_emails.
-- Le résolveur les expose en passthrough dans `features` — ils n'ont pas de défaut de
-- plan, ils n'existent que si la salle porte une ligne.

-- Contrainte d'unicité — déjà présente en prod sous le nom
-- nexxia_features_gym_id_feature_key. Contrôle sur les COLONNES et non sur le nom :
-- staging a dérivé et pourrait porter un nom différent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'nexxia_features'
      AND c.contype IN ('u', 'p')
      AND (
        SELECT array_agg(a.attname::text ORDER BY a.attname::text)
        FROM unnest(c.conkey) k
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
      ) = ARRAY['feature', 'gym_id']
  ) THEN
    ALTER TABLE public.nexxia_features
      ADD CONSTRAINT nexxia_features_gym_id_feature_key UNIQUE (gym_id, feature);
  END IF;
END $$;


-- ═══ b) get_effective_plan ═══════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_effective_plan(p_gym_id uuid)
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

  v_jwt_role      text;
  v_is_service    boolean;
  v_gym           public.nexxia_gyms%ROWTYPE;
  v_trial_active  boolean := false;
  v_eff_plan      text;
  v_limits        public.nexxia_plan_limits%ROWTYPE;
  v_features      jsonb;
  v_overrides     jsonb;
  v_sepa          numeric;
  v_cb            numeric;
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

COMMENT ON FUNCTION public.get_effective_plan(uuid) IS
  'GYM-245 — porte d''entrée UNIQUE du gating. nexxia_plan_limits = défauts du plan, '
  'nexxia_features = overrides par salle. Aucun nom de plan en dur côté appelant. '
  'Hook trial GYM-250 présent et désactivé (v_trial_enabled).';

REVOKE ALL ON FUNCTION public.get_effective_plan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_effective_plan(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_effective_plan(uuid) TO authenticated, service_role;


-- ═══ c) gym_has_feature : délégation ═════════════════════════════════════════
-- Signature INCHANGÉE (uuid, text) RETURNS boolean — aucun appelant à migrer, et de
-- toute façon le grep n'en trouve aucun.
--
-- DEUX CHANGEMENTS DE COMPORTEMENT, tous deux voulus :
--   1. La fonction tient enfin compte du PLAN. Avant, elle ne lisait que
--      nexxia_features : une salle sans ligne d'override recevait false pour tout,
--      y compris pour ce que son plan accorde. C'est le défaut qui la rendait
--      inutilisable — et sans doute pourquoi personne ne l'appelait.
--   2. Elle hérite du garde d'accès de get_effective_plan : un appelant qui n'est ni
--      service_role ni rattaché à la salle reçoit désormais une exception au lieu d'un
--      `false` silencieux. C'était une lecture inter-tenant ouverte (la fonction était
--      GRANT à anon) ; le REVOKE ci-dessous ferme la porte.
CREATE OR REPLACE FUNCTION public.gym_has_feature(p_gym_id uuid, p_feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (public.get_effective_plan(p_gym_id) -> 'features' ->> p_feature)::boolean,
    false
  );
$$;

COMMENT ON FUNCTION public.gym_has_feature(uuid, text) IS
  'GYM-245 — délègue à get_effective_plan. Conservée pour compatibilité de signature ; '
  'préférer get_effective_plan, qui rend tout l''état en un appel.';

REVOKE ALL ON FUNCTION public.gym_has_feature(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gym_has_feature(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.gym_has_feature(uuid, text) TO authenticated, service_role;
