-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-250 — LA COMMISSION NE BOUGE PAS AUJOURD'HUI, ET BOUGERA DEMAIN                 ║
-- ║  Banc TRANSACTIONNEL : BEGIN … ROLLBACK. Rien ne persiste. PAS UN DÉPLOIEMENT.       ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- CE QUE CE BANC DOIT MONTRER, et rien d'autre :
--   ① tant que `v_trial_enabled` est `false`, l'ANCIEN chemin (colonne `nexxia_gyms.plan`
--     → grille → dérogation) et le NOUVEAU (`get_effective_plan_core` → `commissions`)
--     rendent le MÊME taux, pour TOUTE combinaison salle × plan × dérogation.
--     → le changement de `_shared/commission.ts` ne déplace pas un centime avant l'allumage ;
--   ② une fois l'essai allumé, ils DIVERGENT — et c'est la raison d'être du lot.
--
-- ⚠️ ② EST JOUÉ EN REMPLAÇANT LA FONCTION DANS LA TRANSACTION. Le DDL est transactionnel
-- en PostgreSQL : le `CREATE OR REPLACE` d'essai est annulé par le ROLLBACK comme le
-- reste. L'étanchéité est REVÉRIFIÉE après coup, pas supposée.
--
-- ⚠️ CE BANC N'ALLUME RIEN. La constante déployée reste à `false` ; l'allumage est la PR 2.

-- ═══════════════════════════════════════════════════════════════════════════════════════
--  JOUÉ — staging (buovgpokubrkejunmauq), 21/09/2026. 9 VERTS sur 9.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--   ① 0 écart sur 72 comparaisons (3 salles × 3 dérogations × 4 plans × 2 taux)
--   ② le balayage a bien eu lieu : 72, pas 0 — on exige le NOMBRE, pas le verdict (GYM-350)
--   ③ 0 écart sur les 3 salles telles qu'elles sont
--   ④ constante déployée relue AVANT de la remplacer : `false`
--   ⑤ sous essai, l'ancien chemin rend 0,0000 (le taux `free` de la colonne)
--   ⑥ sous essai, le nouveau rend 0,0100 (le taux `pro` du plan effectif)
--   ⑦ 🔴 les deux DIVERGENT : 0,0000 contre 0,0100
--   ⑧ ce que l'écart coûte : 10,68 € par abonnement de 89 €, sur douze échéances —
--      et scellés, puisque l'applicationFee ne change plus après la création
--   ⑨ sous essai, une dérogation à 0 % l'emporte encore (ce qui protège Dopamine)
--
--  ÉTANCHÉITÉ REVÉRIFIÉE APRÈS COUP, pas supposée : `v_trial_enabled` est de nouveau
--  `false` dans la fonction déployée, et les trois salles sont revenues à pro/active avec
--  leurs dérogations à NULL. Le CREATE OR REPLACE d'essai n'a pas survécu au ROLLBACK.
--
--  ⚠️ ① ET ⑦ SE FALSIFIENT L'UN L'AUTRE. Un banc qui rendrait toujours « égal » ne
--  prouverait rien : ⑦ montre le MÊME couple de chemins en désaccord, sur la même base, à
--  la seule différence de la constante. C'est ce qui rend ① crédible.

BEGIN;

CREATE TEMP TABLE r (n int, cas text, attendu text, obtenu text, verdict text) ON COMMIT DROP;

DO $banc$
DECLARE
  v_gym       record;
  v_plan      record;
  v_over      numeric;
  v_anc_sepa  numeric; v_anc_cb numeric;
  v_nou_sepa  numeric; v_nou_cb numeric;
  v_comparees integer := 0;
  v_ecarts    integer := 0;
  v_src       text;
  v_pro_sepa  numeric;
BEGIN
  PERFORM set_config('search_path', 'public', true);

  -- ══ ① BALAYAGE COMPLET : salle × plan × dérogation ════════════════════════════════
  -- Les dérogations testées : NULL (aucune), 0 (dérogation explicite à 0 — le cas
  -- Dopamine, celui qui piège un `coalesce` naïf), et 0.03 (une valeur quelconque).
  FOR v_gym IN SELECT id, name, plan, commission_sepa_rate_override AS os,
                      commission_cb_rate_override AS oc
                 FROM public.nexxia_gyms WHERE deleted_at IS NULL LOOP
    FOREACH v_over IN ARRAY ARRAY[NULL, 0, 0.03]::numeric[] LOOP
      FOR v_plan IN SELECT plan FROM public.nexxia_plan_limits LOOP

        UPDATE public.nexxia_gyms
           SET plan = v_plan.plan,
               commission_sepa_rate_override = v_over,
               commission_cb_rate_override   = v_over
         WHERE id = v_gym.id;

        -- ANCIEN chemin, rejoué à la lettre : la COLONNE, puis la grille, la dérogation
        -- primant (`IS NOT NULL`, jamais un coalesce sur une valeur falsy).
        SELECT CASE WHEN g.commission_sepa_rate_override IS NOT NULL
                    THEN g.commission_sepa_rate_override ELSE l.commission_sepa_rate END,
               CASE WHEN g.commission_cb_rate_override IS NOT NULL
                    THEN g.commission_cb_rate_override ELSE l.commission_cb_rate END
          INTO v_anc_sepa, v_anc_cb
          FROM public.nexxia_gyms g
          JOIN public.nexxia_plan_limits l ON l.plan = g.plan
         WHERE g.id = v_gym.id;

        -- NOUVEAU chemin : ce que lit désormais `commissionFromPlan`.
        SELECT (c ->> 'sepa_rate')::numeric, (c ->> 'cb_rate')::numeric
          INTO v_nou_sepa, v_nou_cb
          FROM (SELECT public.get_effective_plan_core(v_gym.id) -> 'commissions' AS c) s;

        v_comparees := v_comparees + 2;
        IF v_anc_sepa IS DISTINCT FROM v_nou_sepa THEN v_ecarts := v_ecarts + 1; END IF;
        IF v_anc_cb   IS DISTINCT FROM v_nou_cb   THEN v_ecarts := v_ecarts + 1; END IF;
      END LOOP;
    END LOOP;

    -- Remise en l'état de CETTE salle avant de passer à la suivante.
    UPDATE public.nexxia_gyms
       SET plan = v_gym.plan,
           commission_sepa_rate_override = v_gym.os,
           commission_cb_rate_override   = v_gym.oc
     WHERE id = v_gym.id;
  END LOOP;

  INSERT INTO r VALUES (1, 'Balayage salle × plan × dérogation : aucun écart',
    '0 écart', format('%s écart(s) sur %s comparaisons', v_ecarts, v_comparees),
    CASE WHEN v_ecarts = 0 THEN 'VERT' ELSE 'ROUGE' END);

  -- ⚠️ UN BANC QUI NE COMPARE RIEN EST VERT AUSSI. On exige le NOMBRE, pas le verdict —
  -- c'est la règle de GYM-350. 3 salles × 3 dérogations × 4 plans × 2 taux = 72.
  INSERT INTO r VALUES (2, 'Le balayage a bien eu lieu',
    'au moins 24 comparaisons', format('%s comparaisons', v_comparees),
    CASE WHEN v_comparees >= 24 THEN 'VERT' ELSE 'ROUGE' END);

  -- ══ ÉTAT RÉEL, SANS RIEN TOUCHER ══════════════════════════════════════════════════
  v_ecarts := 0; v_comparees := 0;
  FOR v_gym IN SELECT id, name FROM public.nexxia_gyms WHERE deleted_at IS NULL LOOP
    SELECT CASE WHEN g.commission_sepa_rate_override IS NOT NULL
                THEN g.commission_sepa_rate_override ELSE l.commission_sepa_rate END
      INTO v_anc_sepa
      FROM public.nexxia_gyms g JOIN public.nexxia_plan_limits l ON l.plan = g.plan
     WHERE g.id = v_gym.id;
    SELECT (public.get_effective_plan_core(v_gym.id) -> 'commissions' ->> 'sepa_rate')::numeric
      INTO v_nou_sepa;
    v_comparees := v_comparees + 1;
    IF v_anc_sepa IS DISTINCT FROM v_nou_sepa THEN v_ecarts := v_ecarts + 1; END IF;
  END LOOP;

  INSERT INTO r VALUES (3, 'Les salles telles qu''elles sont aujourd''hui',
    '0 écart', format('%s écart(s) sur %s salles', v_ecarts, v_comparees),
    CASE WHEN v_ecarts = 0 AND v_comparees > 0 THEN 'VERT' ELSE 'ROUGE' END);

  -- ══ ② LA RAISON DU LOT : sous essai, les deux chemins DIVERGENT ═══════════════════
  -- On allume la constante DANS LA TRANSACTION, en remplaçant la fonction par une copie
  -- de son propre code source où `false` devient `true`. Aucune réécriture manuelle : le
  -- banc ne peut pas se tromper sur le corps, il part de celui qui est déployé.
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_effective_plan_core';

  IF v_src NOT LIKE '%v_trial_enabled CONSTANT boolean := false%' THEN
    INSERT INTO r VALUES (4, 'Constante déployée trouvée', 'false',
      '(motif introuvable dans le corps)', 'ROUGE');
  ELSE
    INSERT INTO r VALUES (4, 'Constante déployée AVANT le banc', 'false', 'false', 'VERT');
    EXECUTE replace(v_src,
      'v_trial_enabled CONSTANT boolean := false',
      'v_trial_enabled CONSTANT boolean := true');

    -- Une salle en essai : colonne `free`, essai vers `pro`, date dans le futur.
    SELECT id INTO v_gym FROM public.nexxia_gyms WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1;
    UPDATE public.nexxia_gyms
       SET plan = 'free', status = 'trialing', trial_ends_at = now() + interval '7 days',
           commission_sepa_rate_override = NULL, commission_cb_rate_override = NULL
     WHERE id = v_gym.id;

    SELECT commission_sepa_rate INTO v_pro_sepa FROM public.nexxia_plan_limits WHERE plan = 'pro';

    SELECT l.commission_sepa_rate INTO v_anc_sepa
      FROM public.nexxia_gyms g JOIN public.nexxia_plan_limits l ON l.plan = g.plan
     WHERE g.id = v_gym.id;
    SELECT (public.get_effective_plan_core(v_gym.id) -> 'commissions' ->> 'sepa_rate')::numeric
      INTO v_nou_sepa;

    INSERT INTO r VALUES (5, 'SOUS ESSAI : l''ancien chemin lit la colonne `free`',
      format('%s (taux free)', 0.0000), v_anc_sepa::text,
      CASE WHEN v_anc_sepa = 0 THEN 'VERT' ELSE 'ROUGE' END);

    INSERT INTO r VALUES (6, 'SOUS ESSAI : le nouveau chemin sert le taux du plan EFFECTIF',
      format('%s (taux pro)', v_pro_sepa), v_nou_sepa::text,
      CASE WHEN v_nou_sepa = v_pro_sepa THEN 'VERT' ELSE 'ROUGE' END);

    INSERT INTO r VALUES (7, '🔴 LES DEUX CHEMINS DIVERGENT — c''est la raison du lot',
      'ancien <> nouveau', format('ancien=%s · nouveau=%s', v_anc_sepa, v_nou_sepa),
      CASE WHEN v_anc_sepa IS DISTINCT FROM v_nou_sepa THEN 'VERT' ELSE 'ROUGE' END);

    -- Sur un abonnement de 89,00 €, ce que l'écart coûte RÉELLEMENT sur douze échéances.
    INSERT INTO r VALUES (8, 'Ce que l''écart coûte sur un abonnement de 89 € × 12 échéances',
      'non nul', format('%s € perdus', round(8900 * (v_nou_sepa - v_anc_sepa) * 12 / 100, 2)),
      CASE WHEN v_nou_sepa > v_anc_sepa THEN 'VERT' ELSE 'ROUGE' END);

    -- ⚠️ ET LA DÉROGATION PRIME TOUJOURS, essai ou non : c'est ce qui protège Dopamine.
    UPDATE public.nexxia_gyms SET commission_sepa_rate_override = 0 WHERE id = v_gym.id;
    SELECT (public.get_effective_plan_core(v_gym.id) -> 'commissions' ->> 'sepa_rate')::numeric
      INTO v_nou_sepa;
    INSERT INTO r VALUES (9, 'Sous essai, une dérogation à 0 % l''emporte encore',
      '0', v_nou_sepa::text,
      CASE WHEN v_nou_sepa = 0 THEN 'VERT' ELSE 'ROUGE' END);
  END IF;
END
$banc$;

SELECT n, cas, attendu, obtenu, verdict FROM r ORDER BY n;

ROLLBACK;
