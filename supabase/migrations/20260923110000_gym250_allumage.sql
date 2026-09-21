-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-250 — L'ALLUMAGE. UNE LIGNE.                                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CETTE MIGRATION EST À APPLIQUER EN DERNIER, APRÈS LE BANC. Elle est séparée pour
-- qu'elle puisse être appliquée — ou retenue — seule, et pour que le `git log` montre en
-- un coup d'œil la date à laquelle l'essai a commencé à exister.
--
-- CE QU'ELLE SUPPOSE DÉJÀ FAIT, et qui échoue bruyamment sinon (§ 2) :
--   · PR #305 — `_shared/commission.ts` lit le plan EFFECTIF. Sans elle, chaque
--     abonnement vendu pendant un essai porterait 0 % de commission à vie ;
--   · migration 20260923100000 — colonnes de suivi, purge des dates héritées,
--     `close_expired_trials()`, balayage des relances, remise à zéro par le cockpit.
--
-- ⚠️ POUR REVENIR EN ARRIÈRE : rejouer ce fichier avec `false`. Aucune donnée n'est
-- touchée ici — le hook est un CALCUL, pas un état. Les salles `trialing` retombent
-- simplement sur leur colonne, et les relances continuent de partir (elles ne dépendent
-- pas de la constante, seulement de `trial_ends_at`). C'est voulu : un retour en arrière
-- ne doit pas rendre les gérants muets.

CREATE OR REPLACE FUNCTION public.get_effective_plan_core(p_gym_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- ── HOOK TRIAL GYM-250 — ALLUMÉ LE 23/09/2026 ─────────────────────────────
  -- 🔴 C'EST LA SEULE LIGNE QUE CETTE MIGRATION CHANGE, et c'est tout ce qu'elle fait.
  -- Le reste du corps est repris à l'identique de GYM-293b : pas une virgule de plus.
  --
  -- À partir d'ici, une salle en status='trialing' dont `trial_ends_at` est encore dans
  -- le futur se voit servir les limites, les drapeaux ET LES COMMISSIONS du plan
  -- `v_trial_plan`. Les trois, pas seulement les deux premiers — c'est ce que la PR 1 a
  -- rendu vrai en faisant lire `_shared/commission.ts` sur le plan effectif. Appliquée
  -- avant elle, cette ligne aurait scellé 0 % de commission sur douze mois pour chaque
  -- abonnement vendu pendant un essai.
  --
  -- ⚠️ L'EXTINCTION EST DANS LA CONDITION, ET NULLE PART AILLEURS : `trial_ends_at > now()`.
  -- Passée la date, la branche n'est plus prise, et le plan effectif redevient la colonne
  -- SANS QU'AUCUN CRON NE S'EXÉCUTE. `close_expired_trials()` ne fait que corriger l'état
  -- AFFICHÉ ; si elle ne tournait jamais, les droits tomberaient quand même à l'heure.
  v_trial_enabled CONSTANT boolean := true;
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
  'GYM-293b/250 — CŒUR du résolveur de plan : calcul seul, AUCUN contrôle d''accès. '
  'PRIVÉE — appelable uniquement depuis les fonctions SECURITY DEFINER du schéma. '
  'Hook trial ALLUMÉ depuis le 23/09/2026 (v_trial_enabled = true) : status=''trialing'' '
  'et trial_ends_at future ⇒ limites, drapeaux et commissions du plan d''essai.';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. CONTRÔLE D'APPLICATION — l'allumage refuse de partir seul
-- ═════════════════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_src   text;
  v_cols  integer;
  v_essai jsonb;
  v_gym   uuid;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_effective_plan_core';
  IF v_src NOT LIKE '%v_trial_enabled CONSTANT boolean := true%' THEN
    RAISE EXCEPTION 'GYM-250 : la constante n''est pas passée à true';
  END IF;

  -- 🔴 LE PRÉREQUIS QUI COÛTE DE L'ARGENT. Si la migration de la fin d'essai n'est pas
  -- là, les relances non plus — et une salle s'éteindrait en silence, le défaut même que
  -- ce lot corrige.
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='nexxia_gyms'
     AND column_name IN ('trial_reminder_j3_sent_at','trial_reminder_j0_sent_at','trial_reminder_j7_sent_at');
  IF v_cols <> 3 THEN
    RAISE EXCEPTION 'GYM-250 : appliquer d''abord 20260923100000 (relances absentes : %/3)', v_cols;
  END IF;

  IF to_regprocedure('public.close_expired_trials()') IS NULL THEN
    RAISE EXCEPTION 'GYM-250 : close_expired_trials() absente — appliquer d''abord 20260923100000';
  END IF;

  -- Le hook répond, sur une vraie salle : on ne se contente pas de lire le source.
  SELECT id INTO v_gym FROM public.nexxia_gyms WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
  IF v_gym IS NOT NULL THEN
    v_essai := public.get_effective_plan_core(v_gym);
    IF v_essai -> 'commissions' ->> 'sepa_rate' IS NULL THEN
      RAISE EXCEPTION 'GYM-250 : le résolveur ne rend plus de commissions';
    END IF;
  END IF;

  RAISE NOTICE 'GYM-250 : essai ALLUMÉ. Les salles trialing à date future servent désormais le plan d''essai.';
END
$verif$;
