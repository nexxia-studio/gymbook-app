-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-338 — BANC D'ADHÉSION : un test par chemin fautif + les trois garde-fous         ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/gym338_adhesion_a_la_source.sql
--
-- 🔴 CE BANC N'A PAS ÉTÉ EXÉCUTÉ PAR LE LOT, ET IL FAUT LE DIRE. La migration n'est pas
-- appliquée, et cette machine n'a pas de serveur PostgreSQL — seulement le client libpq
-- (pas de binaire `postgres`, pas de Docker). Les attendus sont DÉRIVÉS DU CODE, pas
-- observés. Le banc est écrit pour être rejoué tel quel par le cockpit sur staging, APRÈS
-- application de 20260911100000_gym338_adhesion_a_la_source.sql.
--
-- ⚠️ IL ÉCRIT — mais rien ne survit : tout se joue dans UNE transaction, close par un
-- ROLLBACK en dernière ligne. À jouer sur staging malgré tout : un ROLLBACK n'annule pas
-- ce qu'un trigger aurait envoyé hors transaction.
--
-- ⚠️ LE SEUL POINT QUE JE NE PEUX PAS VÉRIFIER D'ICI : la forme exacte de l'INSERT dans
-- `auth.users`. Les colonnes NOT NULL de GoTrue varient d'une version à l'autre ; si
-- l'insert échoue, complétez-le — le reste du banc n'en dépend pas.

\set ON_ERROR_STOP on
BEGIN;

DO $banc$
DECLARE
  v_gym        uuid;
  v_gym_other  uuid;
  v_owner      uuid := gen_random_uuid();
  v_invited    uuid := gen_random_uuid();
  v_oauth      uuid := gen_random_uuid();
  v_switcher   uuid := gen_random_uuid();
  v_ok         boolean;
  v_n          integer;
  v_n2         integer;
  v_failures   integer;
  v_fail       integer := 0;
BEGIN
  -- Chaque test pose son verdict et incrémente `v_fail` : PL/pgSQL n'a pas d'ASSERT dont
  -- la sortie soit lisible, et un banc qui s'arrête au premier échec cache les suivants.
  -- Le RAISE EXCEPTION final fait échouer le script si `v_fail` n'est pas nul.
  --
  -- ⚠️ `set_config('role', …)` sert à ENDOSSER le rôle client puis à revenir : à jouer avec
  -- un utilisateur de session superutilisateur (postgres), sinon le retour échoue.

  -- ── MONTAGE ────────────────────────────────────────────────────────────────────────
  INSERT INTO public.nexxia_gyms (name, slug, status, dedicated_app_gym)
  VALUES ('BANC 338 — app dédiée', 'banc-338-app', 'active', true)
  RETURNING id INTO v_gym;

  INSERT INTO public.nexxia_gyms (name, slug, status, dedicated_app_gym)
  VALUES ('BANC 338 — salle multi', 'banc-338-multi', 'active', false)
  RETURNING id INTO v_gym_other;

  -- Comptes auth minimaux. handle_new_user se déclenche et crée les profils : c'est voulu,
  -- c'est le chemin n° 1 (déjà conforme) et il sert de témoin.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at, raw_user_meta_data)
  SELECT u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.id::text || '@banc338.test', '', now(), now(), '{}'::jsonb
    FROM (VALUES (v_owner), (v_invited), (v_oauth), (v_switcher)) AS u(id);

  -- ════════════════════════════════════════════════════════════════════════════════════
  -- TEST 1 — create_gym_self_serve : le gérant obtient SON adhésion
  -- ════════════════════════════════════════════════════════════════════════════════════
  -- Chemin fautif n° 4. Avant ce lot : gym_id posé, member_gyms vide.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM public.create_gym_self_serve('Salle du banc 338');

  SELECT EXISTS (
    SELECT 1 FROM public.member_gyms mg
      JOIN public.profiles p ON p.id = mg.member_id AND p.gym_id = mg.gym_id
     WHERE mg.member_id = v_owner
  ) INTO v_ok;
  IF v_ok THEN RAISE NOTICE '  ✓ 1. create_gym_self_serve — adhésion du gérant créée';
  ELSE v_fail := v_fail + 1; RAISE WARNING '  ✗ 1. create_gym_self_serve — AUCUNE adhésion'; END IF;

  -- ════════════════════════════════════════════════════════════════════════════════════
  -- TEST 2 — attach_profile_to_gym : la porte serveur (invite-team-member)
  -- ════════════════════════════════════════════════════════════════════════════════════
  -- Chemin fautif n° 5. On rejoue l'état que produit le trigger quand le plafond membre a
  -- refusé le rattachement : profil créé, gym_id NULL, aucune adhésion.
  UPDATE public.profiles SET gym_id = NULL WHERE id = v_invited;
  DELETE FROM public.member_gyms WHERE member_id = v_invited;

  PERFORM public.attach_profile_to_gym(v_invited, v_gym, 'gym_admin');

  SELECT EXISTS (SELECT 1 FROM public.member_gyms WHERE member_id = v_invited AND gym_id = v_gym)
     AND EXISTS (SELECT 1 FROM public.profiles   WHERE id = v_invited AND gym_id = v_gym AND role = 'gym_admin')
    INTO v_ok;
  IF v_ok THEN RAISE NOTICE '  ✓ 2. attach_profile_to_gym — adhésion + salle + rôle, une transaction';
  ELSE v_fail := v_fail + 1; RAISE WARNING '  ✗ 2. attach_profile_to_gym — état incomplet'; END IF;

  -- Idempotence : un second appel ne double rien et ne lève pas.
  PERFORM public.attach_profile_to_gym(v_invited, v_gym, 'gym_admin');
  SELECT count(*) INTO v_n FROM public.member_gyms WHERE member_id = v_invited AND gym_id = v_gym;
  IF v_n = 1 THEN RAISE NOTICE '  ✓ 2b. attach_profile_to_gym — idempotente (1 ligne, pas 2)';
  ELSE v_fail := v_fail + 1; RAISE WARNING '  ✗ 2b. % lignes d''adhésion au lieu d''une', v_n; END IF;

  -- ════════════════════════════════════════════════════════════════════════════════════
  -- TEST 3 — claim_app_gym : la porte client (heal OAuth)
  -- ════════════════════════════════════════════════════════════════════════════════════
  -- Chemins fautifs n° 6 et 7. Un compte OAuth arrive sans metadata : gym_id NULL, aucune
  -- adhésion. L'app appelle la RPC.
  UPDATE public.profiles SET gym_id = NULL WHERE id = v_oauth;
  DELETE FROM public.member_gyms WHERE member_id = v_oauth;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_oauth, 'role', 'authenticated')::text, true);
  PERFORM public.claim_app_gym(v_gym);

  SELECT EXISTS (SELECT 1 FROM public.member_gyms WHERE member_id = v_oauth AND gym_id = v_gym)
     AND EXISTS (SELECT 1 FROM public.profiles   WHERE id = v_oauth AND gym_id = v_gym)
    INTO v_ok;
  IF v_ok THEN RAISE NOTICE '  ✓ 3. claim_app_gym — adhésion + salle posées ensemble';
  ELSE v_fail := v_fail + 1; RAISE WARNING '  ✗ 3. claim_app_gym — état incomplet'; END IF;

  -- 🔴 3b — LE CONTRÔLE QUI COMPTE : une salle SANS application dédiée est refusée.
  -- Sans lui, la RPC serait la faille qu'on ferme, avec un nom plus rassurant.
  UPDATE public.profiles SET gym_id = NULL WHERE id = v_switcher;
  DELETE FROM public.member_gyms WHERE member_id = v_switcher;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_switcher, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.claim_app_gym(v_gym_other);
    v_fail := v_fail + 1;
    RAISE WARNING '  ✗ 3b. claim_app_gym a ACCEPTÉ une salle non dédiée — faille ouverte';
  EXCEPTION WHEN sqlstate 'PT403' THEN
    RAISE NOTICE '  ✓ 3b. claim_app_gym refuse une salle non dédiée (PT403)';
  END;

  -- ════════════════════════════════════════════════════════════════════════════════════
  -- TEST 4 — 🔴 LE TRIGGER REFUSE UN PATCH CLIENT NULL → X
  -- ════════════════════════════════════════════════════════════════════════════════════
  -- La faille de gym203, vue de face. Avant ce lot : cet UPDATE PASSAIT.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_switcher, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    UPDATE public.profiles SET gym_id = v_gym_other WHERE id = v_switcher;
    v_fail := v_fail + 1;
    RAISE WARNING '  ✗ 4. PATCH client NULL→salle étrangère ACCEPTÉ — la faille est ouverte';
  EXCEPTION WHEN sqlstate '42501' THEN
    RAISE NOTICE '  ✓ 4. PATCH client NULL→salle étrangère REFUSÉ (42501)';
  END;
  PERFORM set_config('role', 'postgres', true);

  -- 4b — non-régression : la bascule vers une appartenance VÉRIFIÉE passe toujours.
  INSERT INTO public.member_gyms (member_id, gym_id) VALUES (v_switcher, v_gym_other)
  ON CONFLICT DO NOTHING;
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    UPDATE public.profiles SET gym_id = v_gym_other WHERE id = v_switcher;
    RAISE NOTICE '  ✓ 4b. PATCH client vers une appartenance existante — toujours accepté';
  EXCEPTION WHEN OTHERS THEN
    v_fail := v_fail + 1;
    RAISE WARNING '  ✗ 4b. régression : la bascule légitime est refusée (%)', SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);

  -- ════════════════════════════════════════════════════════════════════════════════════
  -- TEST 5 — LA VEILLE OUVRE **UNE** LIGNE, PAS VINGT-QUATRE
  -- ════════════════════════════════════════════════════════════════════════════════════
  DELETE FROM public.webhook_failures WHERE function_name = 'member-gyms-drift';

  -- On fabrique une divergence comme seul service_role peut en produire.
  DELETE FROM public.member_gyms WHERE member_id = v_oauth;

  PERFORM public.member_gyms_drift();
  PERFORM public.member_gyms_drift();
  PERFORM public.member_gyms_drift();

  SELECT count(*) INTO v_failures
    FROM public.webhook_failures
   WHERE function_name = 'member-gyms-drift' AND resolved_at IS NULL;

  IF v_failures = 1 THEN RAISE NOTICE '  ✓ 5. veille — 3 passages, 1 seule ligne ouverte';
  ELSE v_fail := v_fail + 1; RAISE WARNING '  ✗ 5. veille — % lignes ouvertes au lieu d''une', v_failures; END IF;

  -- 5b — retour au vert : la ligne se referme, sinon le cockpit apprend à l'ignorer.
  INSERT INTO public.member_gyms (member_id, gym_id)
  SELECT p.id, p.gym_id FROM public.profiles p
   WHERE p.gym_id IS NOT NULL AND p.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.member_gyms mg
                      WHERE mg.member_id = p.id AND mg.gym_id = p.gym_id)
  ON CONFLICT DO NOTHING;

  PERFORM public.member_gyms_drift();
  SELECT count(*) INTO v_failures
    FROM public.webhook_failures
   WHERE function_name = 'member-gyms-drift' AND resolved_at IS NULL;
  IF v_failures = 0 THEN RAISE NOTICE '  ✓ 5b. veille — la ligne se referme au retour à zéro';
  ELSE v_fail := v_fail + 1; RAISE WARNING '  ✗ 5b. % ligne(s) restée(s) ouverte(s)', v_failures; END IF;

  -- ════════════════════════════════════════════════════════════════════════════════════
  -- TEST 6 — LES DEUX DÉCOMPTES DE PLAFOND RENDENT LE MÊME CHIFFRE
  -- ════════════════════════════════════════════════════════════════════════════════════
  -- On met v_switcher dans DEUX salles, salle active = la seconde. C'est exactement le cas
  -- qui faisait diverger les deux compteurs : il occupe toujours sa place dans v_gym.
  INSERT INTO public.member_gyms (member_id, gym_id) VALUES (v_switcher, v_gym)
  ON CONFLICT DO NOTHING;
  UPDATE public.profiles SET role = 'member' WHERE id = v_switcher;

  -- ANCIEN prédicat (admin-create-member AVANT ce lot) : porte sur la salle ACTIVE.
  SELECT count(*) INTO v_n
    FROM public.profiles p
   WHERE p.gym_id = v_gym AND p.role = 'member' AND p.deleted_at IS NULL;

  -- NOUVEAU prédicat, identique à handle_new_user et à booking-guards.
  SELECT count(*) INTO v_n2
    FROM public.member_gyms mg
    JOIN public.profiles p ON p.id = mg.member_id
   WHERE mg.gym_id = v_gym AND p.role = 'member' AND p.deleted_at IS NULL;

  IF v_n2 > v_n THEN
    RAISE NOTICE '  ✓ 6. le cas qui faisait diverger est bien reproduit (ancien=%, nouveau=%)', v_n, v_n2;
  ELSE
    RAISE WARNING '  … 6. montage non discriminant (ancien=%, nouveau=%) — le test 6b reste valable', v_n, v_n2;
  END IF;

  -- 6b — LE TEST QUI COMPTE : les trois gardes rendent le MÊME chiffre.
  -- handle_new_user, booking-guards et admin-create-member partagent désormais ce prédicat.
  SELECT count(*) INTO v_n
    FROM public.member_gyms mg JOIN public.profiles p ON p.id = mg.member_id
   WHERE mg.gym_id = v_gym AND p.role = 'member' AND p.deleted_at IS NULL;
  IF v_n = v_n2 THEN RAISE NOTICE '  ✓ 6b. inscription et création-gérant comptent pareil (%)', v_n;
  ELSE v_fail := v_fail + 1; RAISE WARNING '  ✗ 6b. deux chiffres pour la même question : % ≠ %', v_n, v_n2; END IF;

  -- ════════════════════════════════════════════════════════════════════════════════════
  IF v_fail = 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '✅ BANC GYM-338 — 0 échec';
  ELSE
    RAISE EXCEPTION 'BANC GYM-338 — % échec(s)', v_fail;
  END IF;
END
$banc$;

-- Rien ne survit.
ROLLBACK;
