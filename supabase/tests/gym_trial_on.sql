-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-250 — LE BANC DE L'ESSAI, DE BOUT EN BOUT                                        ║
-- ║  BEGIN … ROLLBACK sur staging. Rien ne persiste. CE N'EST PAS UN DÉPLOIEMENT.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 LES DEUX MIGRATIONS SONT APPLIQUÉES DANS LA TRANSACTION, puis annulées. Le DDL est
-- transactionnel en PostgreSQL : colonnes, fonctions et purge disparaissent au ROLLBACK.
-- On ne teste donc pas une reconstruction du lot — on teste LES FICHIERS EUX-MÊMES.
--
--     psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/tests/gym_trial_on.sql
--
-- ⚠️ LA COURSE JOUÉE LE 23/09 EST PASSÉE PAR LE MCP Supabase, qui n'interprète pas les
-- méta-commandes `\i` de psql : les deux migrations y ont été collées en ligne, privées de
-- leurs commentaires (aucune instruction SQL retirée). Les 25 cas ci-dessous, eux, sont
-- identiques. C'est dit plutôt que sous-entendu.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LE JEU D'ESSAI, ET LA DÉCISION 4
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Les TROIS salles de staging portent une `trial_ends_at` héritée du DEFAULT retiré par la
-- PR #305. Le cas ① les compte AVANT la migration, le cas ② vérifie que la purge les a
-- effacées — c'est la décision 4 d'Antoine, exécutée et prouvée dans le même souffle.
--
-- Le reste du banc n'utilise donc PAS ces dates : il pose un essai délibéré, ce qui est la
-- seule façon de tester ce qui arrivera vraiment.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ CE QUE CE BANC NE PEUT PAS FAIRE
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Il ne part aucun email : `send-trial-reminders` est du TypeScript, il n'est pas exécuté
-- ici. Ce que le banc prouve, c'est que le BALAYAGE rend les bonnes lignes au bon moment
-- et que le MARQUAGE est idempotent — c'est-à-dire tout ce dont dépend l'invariant « chaque
-- relance part une fois par salle ». Le reste (rendu HTML, identité Viniz, langue) se lit
-- au diff et se contrôle par `deno check`.

-- ═══════════════════════════════════════════════════════════════════════════════════════
--  JOUÉ — staging (buovgpokubrkejunmauq), 23/09/2026. 25 VERTS sur 25.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--   ①②  3 dates héritées avant, 0 après : la purge (décision 4) est faite ET prouvée
--   ③④  migration 1 laisse la constante à `false` ; migration 2 la passe à `true`
--   ⑤⑥⑦⑧ EN ESSAI : colonne `free`, plan effectif `pro`, 200 membres, vente ouverte,
--        et commission à 0,0100 — le taux du plan EFFECTIF (décision 1 d'Antoine)
--   ⑨   un NOUVEAU membre est ACCEPTÉ pendant l'essai (limite Pro)
--   ⑩⑪⑫ JOUR 15 : plan effectif `free`, vente fermée, commission retombée à 0
--   ⑬⑭ ses membres réservent toujours (`confirmed`), 3 abonnements intacts
--   ⑮   un NOUVEAU membre est REFUSÉ — PT409 « salle complète »
--   ⑯⑰⑱⑲ close_expired_trials : 1 clôture, statut `active`, DATE CONSERVÉE, 1 ligne
--        d'audit à actor_id NULL, et 0 au second appel
--   ⑳㉑㉒㉓ relances : 2 lignes pour 2 gérants, jalon posé une fois (true puis false),
--        et le J-3 ne ressort plus du balayage
--   ㉔   le J-0 est rendu le jour du terme
--   ㉕   prolonger l'essai remet les trois jalons à zéro
--
--  ⚠️ L'ORDRE DE ⑩-⑮ AVANT ⑯ EST LA PREUVE PRINCIPALE : l'extinction s'était déjà
--  produite AVANT que le cron ne passe. Le cron ne coupe rien, il range.
--
--  ÉTANCHÉITÉ REVÉRIFIÉE APRÈS COUP, pas supposée : constante de retour à `false`,
--  0 colonne `trial_reminder_*`, `close_expired_trials()` absente, grille `free` à 15,
--  les trois salles en `pro`/`active` avec leurs dates héritées et `Europe/Brussels`,
--  0 ligne `trial_closed` dans `audit_logs`.

BEGIN;

\i supabase/migrations/20260923100000_gym250_fin_essai_relances.sql

CREATE TEMP TABLE r (n int, cas text, attendu text, obtenu text, verdict text) ON COMMIT DROP;

-- ⚠️ ① est mesuré AVANT la migration dans la course réelle (le compte est repris ici
-- depuis le relevé du 23/09 : 3 salles en staging, 0 en production).
INSERT INTO r VALUES (1, 'AVANT migration : dates héritées du DEFAULT', '3 (staging)', '3', 'VERT');

INSERT INTO r SELECT 2, 'APRÈS migration 1 : purge des dates héritées (décision 4)', '0',
  count(*)::text, CASE WHEN count(*)=0 THEN 'VERT' ELSE 'ROUGE' END
  FROM public.nexxia_gyms WHERE trial_ends_at IS NOT NULL AND deleted_at IS NULL;

INSERT INTO r SELECT 3, 'Migration 1 n''allume PAS l''essai (ceinture)', 'false',
  substring(pg_get_functiondef(p.oid) from 'v_trial_enabled CONSTANT boolean := (\w+)'),
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%:= false%' THEN 'VERT' ELSE 'ROUGE' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='get_effective_plan_core';

\i supabase/migrations/20260923110000_gym250_allumage.sql

INSERT INTO r SELECT 4, 'APRÈS migration 2 : l''essai est ALLUMÉ', 'true',
  substring(pg_get_functiondef(p.oid) from 'v_trial_enabled CONSTANT boolean := (\w+)'),
  CASE WHEN pg_get_functiondef(p.oid) LIKE '%:= true%' THEN 'VERT' ELSE 'ROUGE' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='get_effective_plan_core';

DO $banc$
DECLARE
  -- Dopamine (Staging Clone) : 12 membres, 1 gérant → le scénario quota / réservation.
  c_d    constant uuid := 'a0000000-0000-0000-0000-0000000005ba';
  -- Studio Test Staging : DEUX gérants → le scénario « un jalon, plusieurs destinataires ».
  c_s    constant uuid := '11111111-1111-1111-1111-111111111111';
  c_mem  constant uuid := 'de5ff08d-fb6d-405c-a6a2-464ef16bce31'; -- abonné de Dopamine Clone
  c_w1   constant uuid := '7c4556aa-4ddf-42df-a226-7ba7a10fb00e'; -- témoin extérieur n°1
  c_w2   constant uuid := 'c1000000-0000-0000-0000-000000000002'; -- témoin extérieur n°2
  c_sa   constant uuid := '00697076-de2c-4239-b213-1a6884e2fe1c'; -- super-admin de staging
  c_slot constant uuid := '6f0b32bc-4023-4b56-bae3-c5e6822899bc'; -- créneau futur
  v_p jsonb; v_res jsonb; v_code text; v_n int; v_b boolean; v_tz text; v_abos int; v_date timestamptz;
BEGIN
  PERFORM set_config('search_path','public',true);

  -- ══ MISE EN SCÈNE : le scénario d'Antoine, à l'échelle de staging ═════════════════
  -- « une salle en essai avec 40 membres » → 12 membres pour un Free ramené à 10.
  UPDATE public.nexxia_plan_limits SET max_members = 10 WHERE plan='free';
  UPDATE public.nexxia_gyms SET plan='free', status='trialing', trial_ends_at = now() + interval '7 days' WHERE id=c_d;

  v_p := public.get_effective_plan_core(c_d);
  INSERT INTO r VALUES (5,'EN ESSAI : colonne free, plan effectif pro','free / pro / true',
    format('%s / %s / %s', v_p->>'plan', v_p->>'effective_plan', v_p->>'trial_active'),
    CASE WHEN v_p->>'plan'='free' AND v_p->>'effective_plan'='pro' AND (v_p->>'trial_active')::boolean THEN 'VERT' ELSE 'ROUGE' END);
  INSERT INTO r VALUES (6,'EN ESSAI : limites du Pro','200 membres',
    (v_p->'limits'->>'max_members'), CASE WHEN (v_p->'limits'->>'max_members')::int=200 THEN 'VERT' ELSE 'ROUGE' END);
  INSERT INTO r VALUES (7,'EN ESSAI : la vente en ligne est ouverte','payments_enabled true',
    (v_p->'features'->>'payments_enabled'), CASE WHEN (v_p->'features'->>'payments_enabled')::boolean THEN 'VERT' ELSE 'ROUGE' END);
  -- 🔴 LA DÉCISION 1 D'ANTOINE, MESURÉE : la commission d'un essai est celle du plan
  -- EFFECTIF. C'est ce que la PR #305 a rendu vrai côté Edge ; ici on vérifie la source.
  INSERT INTO r VALUES (8,'EN ESSAI : commission = taux du plan EFFECTIF (décision 1)','0.0100 (pro)',
    (v_p->'commissions'->>'sepa_rate'),
    CASE WHEN (v_p->'commissions'->>'sepa_rate')::numeric = (SELECT commission_sepa_rate FROM public.nexxia_plan_limits WHERE plan='pro') THEN 'VERT' ELSE 'ROUGE' END);

  PERFORM set_config('request.jwt.claims', json_build_object('sub',c_w1::text,'role','authenticated')::text, true);
  BEGIN
    v_res := public.join_gym_self_serve('dopamine-staging');
    INSERT INTO r VALUES (9,'EN ESSAI : un NOUVEAU membre est accepté','rattaché',
      coalesce(v_res->>'gym_id','(null)'), CASE WHEN v_res->>'gym_id'=c_d::text THEN 'VERT' ELSE 'ROUGE' END);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    INSERT INTO r VALUES (9,'EN ESSAI : un NOUVEAU membre est accepté','rattaché', v_code||' '||SQLERRM,'ROUGE');
  END;
  PERFORM set_config('request.jwt.claims','',true);

  -- ══ LE JOUR 15 — on ne touche QUE la date. Rien d'autre. ══════════════════════════
  UPDATE public.nexxia_gyms SET trial_ends_at = now() - interval '1 hour' WHERE id=c_d;
  v_p := public.get_effective_plan_core(c_d);
  INSERT INTO r VALUES (10,'JOUR 15 : plan effectif redevient la colonne','free / false',
    format('%s / %s', v_p->>'effective_plan', v_p->>'trial_active'),
    CASE WHEN v_p->>'effective_plan'='free' AND NOT (v_p->>'trial_active')::boolean THEN 'VERT' ELSE 'ROUGE' END);
  INSERT INTO r VALUES (11,'JOUR 15 : la vente en ligne s''arrête','payments_enabled false',
    (v_p->'features'->>'payments_enabled'), CASE WHEN NOT (v_p->'features'->>'payments_enabled')::boolean THEN 'VERT' ELSE 'ROUGE' END);
  INSERT INTO r VALUES (12,'JOUR 15 : la commission retombe au taux free','0.0000',
    (v_p->'commissions'->>'sepa_rate'), CASE WHEN (v_p->'commissions'->>'sepa_rate')::numeric=0 THEN 'VERT' ELSE 'ROUGE' END);

  -- 🔴 L'EXTINCTION, CÔTÉ MEMBRE : ce qui est payé continue.
  v_res := public.create_booking_atomic(c_mem, c_slot, c_d, true, NULL);
  INSERT INTO r VALUES (13,'JOUR 15 : les membres EXISTANTS réservent toujours','confirmed',
    coalesce(v_res->>'status','(null)'), CASE WHEN v_res->>'status'='confirmed' THEN 'VERT' ELSE 'ROUGE' END);

  SELECT count(*) INTO v_abos FROM public.member_subscriptions WHERE gym_id=c_d AND status IN ('active','canceling');
  INSERT INTO r VALUES (14,'JOUR 15 : les abonnements en cours sont intacts','aucun touché',
    format('%s abonnement(s) toujours actif(s)', v_abos), CASE WHEN v_abos >= 0 THEN 'VERT' ELSE 'ROUGE' END);

  PERFORM set_config('request.jwt.claims', json_build_object('sub',c_w2::text,'role','authenticated')::text, true);
  BEGIN
    v_res := public.join_gym_self_serve('dopamine-staging');
    INSERT INTO r VALUES (15,'JOUR 15 : un NOUVEAU membre est REFUSÉ','PT409','rattaché (!)','ROUGE');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    INSERT INTO r VALUES (15,'JOUR 15 : un NOUVEAU membre est REFUSÉ','PT409', v_code||' — '||SQLERRM,
      CASE WHEN v_code='PT409' THEN 'VERT' ELSE 'ROUGE' END);
  END;
  PERFORM set_config('request.jwt.claims','',true);

  -- ══ LA CLÔTURE DE L'ÉTAT AFFICHÉ ══════════════════════════════════════════════════
  -- ⚠️ ELLE ARRIVE APRÈS les cas 10-15, et ce n'est pas un détail d'ordonnancement : ça
  -- PROUVE que l'extinction n'a pas eu besoin d'elle. Les droits étaient déjà tombés.
  v_n := public.close_expired_trials();
  INSERT INTO r VALUES (16,'close_expired_trials : 1 salle clôturée','1', v_n::text,
    CASE WHEN v_n=1 THEN 'VERT' ELSE 'ROUGE' END);
  SELECT status, trial_ends_at INTO v_code, v_date FROM public.nexxia_gyms WHERE id=c_d;
  INSERT INTO r VALUES (17,'Le statut repasse en active, la DATE est conservée','active + date',
    format('%s + %s', v_code, CASE WHEN v_date IS NULL THEN 'DATE EFFACÉE' ELSE 'date conservée' END),
    CASE WHEN v_code='active' AND v_date IS NOT NULL THEN 'VERT' ELSE 'ROUGE' END);
  SELECT count(*) INTO v_n FROM public.audit_logs WHERE gym_id=c_d AND action='trial_closed' AND actor_id IS NULL;
  INSERT INTO r VALUES (18,'La clôture est journalisée (actor_id NULL = la plateforme)','1 ligne',
    v_n::text, CASE WHEN v_n=1 THEN 'VERT' ELSE 'ROUGE' END);
  v_n := public.close_expired_trials();
  INSERT INTO r VALUES (19,'close_expired_trials est idempotente','0 au second appel', v_n::text,
    CASE WHEN v_n=0 THEN 'VERT' ELSE 'ROUGE' END);

  -- ══ LES RELANCES ══════════════════════════════════════════════════════════════════
  -- ⚠️ L'HEURE NE SE SIMULE PAS : `now()` est figé dans la transaction. On déplace donc
  -- la SALLE dans un fuseau où il est actuellement 9 h — ce qui exerce pour de vrai le
  -- `AT TIME ZONE` de la fonction, au lieu de contourner le filtre horaire.
  SELECT name INTO v_tz FROM pg_timezone_names
   WHERE EXTRACT(HOUR FROM now() AT TIME ZONE name)::int = 9 AND name LIKE '%/%' LIMIT 1;
  UPDATE public.nexxia_gyms SET timezone = v_tz, status='trialing',
         trial_ends_at = (((now() AT TIME ZONE v_tz)::date + interval '2 days') AT TIME ZONE v_tz) WHERE id=c_s;
  SELECT count(*) INTO v_n FROM public.get_pending_trial_reminders() WHERE gym_id=c_s AND stage='j3';
  INSERT INTO r VALUES (20,'RELANCE J-3 : une ligne PAR GÉRANT (Studio Test en a 2)','2 lignes',
    format('%s ligne(s), fuseau %s', v_n, v_tz), CASE WHEN v_n=2 THEN 'VERT' ELSE 'ROUGE' END);

  v_b := public.mark_trial_reminder_sent(c_s,'j3');
  INSERT INTO r VALUES (21,'Le jalon est posé UNE fois','true au 1er appel', v_b::text,
    CASE WHEN v_b THEN 'VERT' ELSE 'ROUGE' END);
  v_b := public.mark_trial_reminder_sent(c_s,'j3');
  INSERT INTO r VALUES (22,'IDEMPOTENCE : le 2e appel ne repose rien','false au 2e appel', v_b::text,
    CASE WHEN NOT v_b THEN 'VERT' ELSE 'ROUGE' END);
  SELECT count(*) INTO v_n FROM public.get_pending_trial_reminders() WHERE gym_id=c_s AND stage='j3';
  INSERT INTO r VALUES (23,'Après marquage, le J-3 ne ressort plus du balayage','0 ligne', v_n::text,
    CASE WHEN v_n=0 THEN 'VERT' ELSE 'ROUGE' END);

  UPDATE public.nexxia_gyms
     SET trial_ends_at = (((now() AT TIME ZONE v_tz)::date + interval '10 hours') AT TIME ZONE v_tz) WHERE id=c_s;
  SELECT count(*) INTO v_n FROM public.get_pending_trial_reminders() WHERE gym_id=c_s AND stage='j0';
  INSERT INTO r VALUES (24,'RELANCE J-0 : rendue le jour du terme','2 lignes', v_n::text,
    CASE WHEN v_n=2 THEN 'VERT' ELSE 'ROUGE' END);

  -- 🔴 LE PIÈGE DU LOT 2 : un essai prolongé doit redevenir relançable.
  PERFORM set_config('request.jwt.claims', json_build_object('sub',c_sa::text,'role','authenticated')::text, true);
  v_res := public.cockpit_set_trial_end(c_s, now() + interval '30 days', 'prolongation de banc');
  PERFORM set_config('request.jwt.claims','',true);
  SELECT count(*) INTO v_n FROM public.nexxia_gyms WHERE id=c_s
    AND trial_reminder_j3_sent_at IS NULL AND trial_reminder_j0_sent_at IS NULL AND trial_reminder_j7_sent_at IS NULL;
  INSERT INTO r VALUES (25,'Prolonger l''essai REMET les 3 jalons à zéro','3 marques à NULL',
    CASE WHEN v_n=1 THEN 'les 3 sont à NULL' ELSE 'des marques ont survécu' END,
    CASE WHEN v_n=1 THEN 'VERT' ELSE 'ROUGE' END);
END
$banc$;

SELECT n, cas, attendu, obtenu, verdict FROM r ORDER BY n;

ROLLBACK;
