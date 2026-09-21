-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  LOT A — LA LIMITE DE MEMBRES NE BLOQUE PLUS LA RÉSERVATION                          ║
-- ║  Banc TRANSACTIONNEL : BEGIN … ROLLBACK. Rien ne persiste. CE N'EST PAS UN DÉPLOIEMENT║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- CE QUE CE BANC DOIT MONTRER, et rien d'autre :
--   · une salle AU-DELÀ de sa limite laisse réserver ses membres EXISTANTS ;
--   · la même salle REFUSE un NOUVEAU membre ;
--   · le plafond de réservations à venir (GYM-196) a survécu à la séparation.
--
-- ⚠️ LA MISE EN SCÈNE EST ÉCRITE, PUIS ANNULÉE. On abaisse `nexxia_plan_limits.free
-- .max_members` et on fait retomber « Dopamine (Staging Clone) » en `free` — exactement le
-- scénario d'Antoine (40 membres, Free = 15), à l'échelle des données de staging (12
-- membres, Free ramené à 10). Le ROLLBACK final rend la grille et la salle intactes.
--
-- ⚠️ CE BANC NE PEUT PAS EXÉCUTER LE TYPESCRIPT DES EDGE FUNCTIONS. Il joue le SQL que
-- celles-ci appellent, et rejoue à la main la requête de l'ANCIENNE garde pour montrer ce
-- qu'elle aurait répondu. La disparition de cette garde du code, elle, se lit au diff et
-- se contrôle par `deno check` — pas ici. C'est dit plutôt que sous-entendu.

-- ═══════════════════════════════════════════════════════════════════════════════════════
--  JOUÉ — staging (buovgpokubrkejunmauq), 21/09/2026. 12 VERTS sur 13.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--  Le 13ᵉ n'est pas un rouge : le cas ③ est marqué LATENT. Il constate que la colonne et
--  le plan effectif disent la même chose aujourd'hui (`free`/`free`, `trial_active=false`),
--  parce que l'essai est éteint — `v_trial_enabled CONSTANT false`, sujet du LOT B. Le
--  défaut n°2 n'est donc pas OBSERVABLE aujourd'hui ; il s'arme le jour où l'essai
--  s'allume. Le marquer LATENT plutôt que VERT est la seule lecture honnête.
--
--  Mise en scène mesurée : 12 membres pour 10 autorisés.
--   ① 12 > 10 : la salle est strictement au-delà de sa limite
--   ② l'ANCIENNE garde refusait — MEMBER_QUOTA_REACHED — TOUT membre existant
--   ④ à la borne exacte 12/12 : `>=` REFUSE, `>` laisse passer (le défaut n°3, isolé)
--   ⑤ le NOUVEAU chemin : `confirmed`
--   ⑥ la ligne existe vraiment
--   ⑦⑧ GYM-196 intact : plafond 3 lu, et il MORD encore à la 3ᵉ réservation à venir
--   ⑨ un NOUVEAU membre : PT409 « salle complète »
--   ⑩ à la borne exacte 12/12 : PT409 aussi — ici `>=` est JUSTE, c'est le 13ᵉ qu'on refuse
--   ⑪ la place revenue (50), le même appel RATTACHE — la garde n'est pas cassée, elle est
--      juste. ⑨/⑩/⑪ forment leur propre falsification : MÊME appel, MÊME identité, verdicts
--      opposés selon la seule grille. Un banc qui rendrait toujours vert ne le ferait pas.
--   ⑫⑬ les deux gardes d'arrivée SQL passent par le plan EFFECTIF, lu dans pg_proc
--
--  ÉTANCHÉITÉ VÉRIFIÉE APRÈS COUP, et pas supposée : grille free de retour à 15, salle de
--  retour en `pro`, 2 créneaux futurs (pas 4), 0 réservation future pour le membre témoin,
--  0 rattachement pour le témoin extérieur. Rien n'a survécu au ROLLBACK.
--
--  ⚠️ CE BANC NE COUVRE PAS LE TYPESCRIPT. Son pendant est
--  `supabase/functions/_shared/booking-guards_test.ts` (13 assertions, falsifié à exit 1 en
--  rétablissant la lecture de la colonne `plan`).

BEGIN;

CREATE TEMP TABLE r (n int, cas text, attendu text, obtenu text, verdict text) ON COMMIT DROP;
GRANT ALL ON TABLE r TO authenticated;

DO $banc$
DECLARE
  c_gym     constant uuid := 'a0000000-0000-0000-0000-0000000005ba'; -- Dopamine (Staging Clone)
  c_slug    constant text := 'dopamine-staging';
  c_membre  constant uuid := 'de5ff08d-fb6d-405c-a6a2-464ef16bce31'; -- abonné en cours de cette salle
  c_dehors  constant uuid := '7c4556aa-4ddf-42df-a226-7ba7a10fb00e'; -- membre d'une AUTRE salle
  c_slot    constant uuid := '6f0b32bc-4023-4b56-bae3-c5e6822899bc'; -- créneau futur de la salle

  v_membres   integer;
  v_max       integer;
  v_plan_col  text;
  v_plan_eff  text;
  v_plafond   integer;
  v_futures   integer;
  v_res       jsonb;
  v_code      text;
  v_slot2     uuid;
  v_slot3     uuid;
  v_act       uuid;
  v_ok        boolean;
BEGIN
  PERFORM set_config('search_path', 'public', true);

  -- ══ MISE EN SCÈNE : la salle passe SOUS sa limite ═════════════════════════════════
  UPDATE public.nexxia_plan_limits SET max_members = 10 WHERE plan = 'free';
  UPDATE public.nexxia_gyms SET plan = 'free' WHERE id = c_gym;

  SELECT count(*) INTO v_membres
    FROM public.member_gyms mg JOIN public.profiles p ON p.id = mg.member_id
   WHERE mg.gym_id = c_gym AND p.role = 'member' AND p.deleted_at IS NULL;

  SELECT max_members INTO v_max FROM public.nexxia_plan_limits WHERE plan = 'free';

  INSERT INTO r VALUES (1, 'La salle est STRICTEMENT au-delà de sa limite',
    'membres > max', format('%s membres / %s autorisés', v_membres, v_max),
    CASE WHEN v_membres > v_max THEN 'VERT' ELSE 'ROUGE' END);

  -- ══ ① LE DÉFAUT : CE QUE L'ANCIENNE GARDE DE RÉSERVATION AURAIT RÉPONDU ═══════════
  -- Sa requête, à la lettre : colonne `plan` → grille → compte sur member_gyms → `>=`.
  SELECT plan INTO v_plan_col FROM public.nexxia_gyms WHERE id = c_gym;
  SELECT max_members INTO v_max FROM public.nexxia_plan_limits WHERE plan = v_plan_col;

  INSERT INTO r VALUES (2, 'ANCIENNE garde : tout membre existant était refusé',
    'refus MEMBER_QUOTA_REACHED',
    CASE WHEN v_membres >= v_max THEN 'refus MEMBER_QUOTA_REACHED' ELSE 'passe' END,
    CASE WHEN v_membres >= v_max THEN 'VERT' ELSE 'ROUGE' END);

  -- ② Elle lisait la COLONNE, pas le plan effectif.
  v_plan_eff := public.get_effective_plan_core(c_gym) ->> 'effective_plan';
  INSERT INTO r VALUES (3, 'ANCIENNE garde : colonne vs plan effectif',
    'les deux sources nommées',
    format('colonne=%s · effectif=%s · essai_actif=%s', v_plan_col, v_plan_eff,
           public.get_effective_plan_core(c_gym) ->> 'trial_active'),
    -- ⚠️ HONNÊTETÉ : l'essai étant ÉTEINT (v_trial_enabled CONSTANT false, sujet du lot B),
    -- les deux valeurs coïncident aujourd'hui. Le défaut est LATENT : il s'arme le jour où
    -- l'essai s'allume. Ce banc ne peut pas l'observer, il le NOMME.
    CASE WHEN v_plan_col = v_plan_eff THEN 'LATENT — non observable tant que l''essai est éteint'
         ELSE 'VERT' END);

  -- ③ La borne : à EXACTEMENT la limite, `>=` refusait ce que le plan autorise.
  UPDATE public.nexxia_plan_limits SET max_members = v_membres WHERE plan = 'free';
  INSERT INTO r VALUES (4, format('ANCIENNE garde à la borne exacte (%s/%s)', v_membres, v_membres),
    'refusait (>=) ce que `>` aurait laissé passer',
    format('>= : %s · > : %s',
           CASE WHEN v_membres >= v_membres THEN 'REFUS' ELSE 'passe' END,
           CASE WHEN v_membres > v_membres THEN 'REFUS' ELSE 'passe' END),
    CASE WHEN v_membres >= v_membres AND NOT (v_membres > v_membres) THEN 'VERT' ELSE 'ROUGE' END);

  -- Retour au scénario « au-delà de la limite » pour la suite.
  UPDATE public.nexxia_plan_limits SET max_members = 10 WHERE plan = 'free';

  -- ══ LE NOUVEAU CHEMIN : LE MEMBRE EXISTANT RÉSERVE ════════════════════════════════
  -- create_booking_atomic est ce que create-booking appelle APRÈS ses gardes. Le quota de
  -- membres n'y a jamais été et n'y entre pas : c'est bien la garde Edge qui bloquait.
  v_res := public.create_booking_atomic(c_membre, c_slot, c_gym, true, NULL);
  INSERT INTO r VALUES (5, 'NOUVEAU chemin : un membre existant réserve malgré le dépassement',
    'confirmed', coalesce(v_res ->> 'status', '(null)'),
    CASE WHEN v_res ->> 'status' = 'confirmed' THEN 'VERT' ELSE 'ROUGE' END);

  SELECT EXISTS (SELECT 1 FROM public.bookings b
                  WHERE b.id = (v_res ->> 'booking_id')::uuid
                    AND b.member_id = c_membre AND b.slot_id = c_slot
                    AND b.status = 'confirmed') INTO v_ok;
  INSERT INTO r VALUES (6, 'La réservation existe vraiment en base',
    'ligne confirmed sur le bon créneau', CASE WHEN v_ok THEN 'trouvée' ELSE 'absente' END,
    CASE WHEN v_ok THEN 'VERT' ELSE 'ROUGE' END);

  -- ══ GYM-196 A SURVÉCU À LA SÉPARATION ═════════════════════════════════════════════
  SELECT max_active_bookings INTO v_plafond FROM public.nexxia_gyms WHERE id = c_gym;
  INSERT INTO r VALUES (7, 'GYM-196 : le plafond est toujours lu (getMaxActiveBookings)',
    'une valeur non nulle', coalesce(v_plafond::text, 'null'),
    CASE WHEN v_plafond IS NOT NULL THEN 'VERT' ELSE 'ROUGE' END);

  -- Deux créneaux futurs de plus, pour atteindre le plafond et vérifier qu'il MORD encore.
  SELECT activity_id INTO v_act FROM public.time_slots WHERE id = c_slot;
  INSERT INTO public.time_slots (gym_id, activity_id, starts_at, ends_at, capacity, status)
  VALUES (c_gym, v_act, now() + interval '3 days', now() + interval '3 days 1 hour', 8, 'scheduled')
  RETURNING id INTO v_slot2;
  INSERT INTO public.time_slots (gym_id, activity_id, starts_at, ends_at, capacity, status)
  VALUES (c_gym, v_act, now() + interval '4 days', now() + interval '4 days 1 hour', 8, 'scheduled')
  RETURNING id INTO v_slot3;

  PERFORM public.create_booking_atomic(c_membre, v_slot2, c_gym, true, NULL);
  PERFORM public.create_booking_atomic(c_membre, v_slot3, c_gym, true, NULL);

  SELECT count(*) INTO v_futures
    FROM public.bookings b JOIN public.time_slots t ON t.id = b.slot_id
   WHERE b.member_id = c_membre AND b.status = 'confirmed' AND t.starts_at > now();

  INSERT INTO r VALUES (8, 'GYM-196 mord encore : le plafond est atteint',
    format('%s réservations à venir >= plafond %s', v_plafond, v_plafond),
    format('%s à venir / plafond %s', v_futures, v_plafond),
    CASE WHEN v_futures >= v_plafond THEN 'VERT' ELSE 'ROUGE' END);

  -- ══ L'ARRIVÉE, ELLE, EST TOUJOURS REFUSÉE ═════════════════════════════════════════
  -- join_gym_self_serve lit auth.uid() : on emprunte l'identité d'un membre d'une AUTRE
  -- salle, qui n'est donc pas encore rattaché à celle-ci.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', c_dehors::text, 'role', 'authenticated')::text, true);
  BEGIN
    v_res := public.join_gym_self_serve(c_slug);
    INSERT INTO r VALUES (9, 'NOUVEAU membre sur une salle au-delà de sa limite',
      'refus GYM_FULL', 'rattaché (!)', 'ROUGE');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    INSERT INTO r VALUES (9, 'NOUVEAU membre sur une salle au-delà de sa limite',
      'refus PT409 (GYM_FULL)', format('%s — %s', v_code, SQLERRM),
      CASE WHEN v_code = 'PT409' THEN 'VERT' ELSE 'ROUGE' END);
  END;

  -- À la borne EXACTE, l'arrivée doit AUSSI être refusée : ici `>=` est juste, c'est le
  -- 13ᵉ qu'on refuse, pas les 12 déjà là.
  UPDATE public.nexxia_plan_limits SET max_members = v_membres WHERE plan = 'free';
  BEGIN
    v_res := public.join_gym_self_serve(c_slug);
    INSERT INTO r VALUES (10, format('NOUVEAU membre à la borne exacte (%s/%s)', v_membres, v_membres),
      'refus PT409 (GYM_FULL)', 'rattaché (!)', 'ROUGE');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    INSERT INTO r VALUES (10, format('NOUVEAU membre à la borne exacte (%s/%s)', v_membres, v_membres),
      'refus PT409 (GYM_FULL)', format('%s — %s', v_code, SQLERRM),
      CASE WHEN v_code = 'PT409' THEN 'VERT' ELSE 'ROUGE' END);
  END;

  -- Et quand il reste de la place, elle passe : la garde n'est pas cassée, elle est juste.
  UPDATE public.nexxia_plan_limits SET max_members = 50 WHERE plan = 'free';
  BEGIN
    v_res := public.join_gym_self_serve(c_slug);
    INSERT INTO r VALUES (11, 'NOUVEAU membre quand il reste de la place',
      'rattaché', coalesce(v_res ->> 'gym_id', v_res::text),
      CASE WHEN (v_res ->> 'gym_id') = c_gym::text THEN 'VERT' ELSE 'ROUGE' END);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    INSERT INTO r VALUES (11, 'NOUVEAU membre quand il reste de la place',
      'rattaché', format('%s — %s', v_code, SQLERRM), 'ROUGE');
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  -- ══ LA GARDE D'ARRIVÉE LIT LE PLAN EFFECTIF, PAS LA COLONNE ═══════════════════════
  INSERT INTO r VALUES (12, 'La garde d''arrivée passe par get_effective_plan_core',
    'présent dans le corps de join_gym_self_serve',
    CASE WHEN (SELECT pg_get_functiondef(p.oid) LIKE '%get_effective_plan_core%'
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname='public' AND p.proname='join_gym_self_serve')
         THEN 'présent' ELSE 'absent' END,
    CASE WHEN (SELECT pg_get_functiondef(p.oid) LIKE '%get_effective_plan_core%'
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname='public' AND p.proname='join_gym_self_serve')
         THEN 'VERT' ELSE 'ROUGE' END);

  INSERT INTO r VALUES (13, 'handle_new_user passe par get_effective_plan',
    'présent dans le corps du trigger',
    CASE WHEN (SELECT pg_get_functiondef(p.oid) LIKE '%get_effective_plan%'
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname='public' AND p.proname='handle_new_user')
         THEN 'présent' ELSE 'absent' END,
    CASE WHEN (SELECT pg_get_functiondef(p.oid) LIKE '%get_effective_plan%'
                 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname='public' AND p.proname='handle_new_user')
         THEN 'VERT' ELSE 'ROUGE' END);
END
$banc$;

SELECT n, cas, attendu, obtenu, verdict FROM r ORDER BY n;

ROLLBACK;
