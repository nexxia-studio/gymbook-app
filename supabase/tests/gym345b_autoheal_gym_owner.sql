-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-345b — LE FILET N'ATTRAPE PLUS UN GÉRANT                                         ║
-- ║  BEGIN … ROLLBACK sur staging. Rien ne persiste. CE N'EST PAS UN DÉPLOIEMENT.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
--     psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/tests/gym345b_autoheal_gym_owner.sql
--
-- ⚠️ CE BANC MODIFIE `auth.users` ET `auth.identities` — dans la transaction, et pour une
-- seule raison : les deux gardes portent précisément là-dessus. Les éprouver sans y
-- toucher reviendrait à tester autre chose. Le ROLLBACK rend les quatre comptes intacts,
-- et l'étanchéité est REVÉRIFIÉE après coup (cf. le relevé en fin de fichier).
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LES QUATRE SITUATIONS, ET POURQUOI IL EN FAUT QUATRE
-- ─────────────────────────────────────────────────────────────────────────────────────
--   m1  gérant en cours d'inscription : identité `email`, `signup_intent = 'gym_owner'`,
--       aucune adhésion            → DOIT ÊTRE IGNORÉ. C'est l'incident du 22/09.
--   m2  inscription Google de l'app mono-salle : aucune identité `email`, aucune adhésion
--                                  → DOIT ÊTRE RATTACHÉ (règle 2). C'est la population
--                                    que la règle 2 visait depuis le début.
--   m3  membre `email` sans adhésion et sans metadata
--                                  → DOIT ÊTRE BLOQUÉ. C'est le durcissement : on ne
--                                    devine pas la salle d'un compte venu d'un formulaire.
--   m4  adhésion unique            → DOIT ÊTRE RATTACHÉ (règle 1, INCHANGÉE). Sans lui, un
--                                    banc vert ne prouverait pas que le durcissement n'a
--                                    pas simplement éteint le filet.
--
-- ⚠️ m3 ET m4 SONT LE CONTRÔLE NÉGATIF DU LOT. Un correctif qui refuse tout le monde est
-- aussi faux qu'un correctif qui accepte tout le monde ; c'est le couple qui le montre.

-- ═══════════════════════════════════════════════════════════════════════════════════════
--  JOUÉ — staging (buovgpokubrkejunmauq), 22/09/2026. 12 VERTS sur 12.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--   ①    4 profils mis sans salle
--   ②    la garde ① ramène le DÉCOMPTE à 3 sur 4 — le disjoncteur ne voit plus le gérant
--   ③④  le filet rend `done`, sur 3 candidats
--   ⑤⑥  le GÉRANT est ignoré : gym_id NULL, 0 adhésion créée
--   ⑦    le membre GOOGLE est rattaché à la salle dédiée (règle 2)
--   ⑧    le membre EMAIL sans adhésion reste NULL — on ne devine pas
--   ⑨    la RÈGLE 1 marche toujours : adhésion unique → rattaché
--   ⑩    bilan 2 réparés / 1 bloqué
--   ⑪⑫  le journal distingue les deux silences : 1 ligne ouverte pour m3, AUCUNE pour m1
--
--  ⚠️ LE BANC EST JOUÉ APRÈS `\i` DE LA MIGRATION, dans la même transaction : le contrôle
--  d'empreinte du § 2 de la migration s'exécute donc AVANT les douze cas. Si le corps
--  n'était pas celui du déployé, rien de ce qui suit ne tournerait.
--
--  ⚠️ LA COURSE DU 22/09 EST PASSÉE PAR LE MCP Supabase, qui n'interprète pas `\i` :
--  la migration y a été collée en ligne, verbatim. Les douze cas sont identiques.
--
--  ÉTANCHÉITÉ REVÉRIFIÉE APRÈS COUP : 0 profil membre sans salle, 0 identité `google`,
--  l'identité `email` de m2 de retour, aucune metadata `gym_owner` ajoutée (la seule qui
--  reste est un compte de staging préexistant, `+salletest1`, déjà `gym_admin`),
--  0 ligne ouverte au journal, et l'empreinte du filet toujours
--  `b1138a3e718a603064ca5e736da29032`.

BEGIN;

\i supabase/migrations/20260922120000_gym345b_autoheal_jamais_un_gerant.sql

CREATE TEMP TABLE r (n int, cas text, attendu text, obtenu text, verdict text) ON COMMIT DROP;

DO $banc$
DECLARE
  c_dediee constant uuid := 'a0000000-0000-0000-0000-0000000005ba'; -- seule dedicated_app_gym
  m1 constant uuid := '81e86ab7-1596-4e21-a054-cb63616f6d4f';
  m2 constant uuid := 'de5ff08d-fb6d-405c-a6a2-464ef16bce31';
  m3 constant uuid := '6c1c8a02-3be7-4ee8-afe8-00547f109806';
  m4 constant uuid := 'e4c76269-5cbf-4b22-bfb9-0b24fd940222';
  v_res jsonb; v_n int; v_gym uuid;
BEGIN
  PERFORM set_config('search_path','public',true);

  UPDATE public.profiles SET gym_id = NULL WHERE id IN (m1, m2, m3, m4);
  DELETE FROM public.member_gyms WHERE member_id IN (m1, m2, m3);
  DELETE FROM public.member_gyms WHERE member_id = m4 AND gym_id <> c_dediee;

  UPDATE auth.users SET raw_user_meta_data =
    coalesce(raw_user_meta_data,'{}'::jsonb) || jsonb_build_object('signup_intent','gym_owner')
   WHERE id = m1;

  DELETE FROM auth.identities WHERE user_id = m2;
  INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
  VALUES (m2::text, m2, jsonb_build_object('sub', m2::text), 'google', now(), now());

  INSERT INTO r SELECT 1, 'Mise en scène : 4 candidats potentiels', '4 profils sans salle',
    count(*)::text, CASE WHEN count(*)=4 THEN 'VERT' ELSE 'ROUGE' END
    FROM public.profiles WHERE id IN (m1,m2,m3,m4) AND gym_id IS NULL;

  -- 🔴 LE DÉCOMPTE D'ABORD. La garde y est posée aussi, et pas par redondance : c'est lui
  -- qui arme le disjoncteur. Un gérant compté mais non traité ferait monter le compteur
  -- vers le seuil et finirait par bloquer le filet pour de VRAIS membres.
  SELECT count(*) INTO v_n FROM public.profiles p
   WHERE p.deleted_at IS NULL AND p.role='member' AND p.gym_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=p.id
                      AND u.raw_user_meta_data->>'signup_intent'='gym_owner');
  INSERT INTO r VALUES (2,'GARDE ① : le gérant est exclu du DÉCOMPTE (disjoncteur)','3 candidats sur 4',
    v_n::text, CASE WHEN v_n=3 THEN 'VERT' ELSE 'ROUGE' END);

  v_res := public.member_gyms_autoheal();
  INSERT INTO r VALUES (3,'Le filet a tourné sans disjoncter','status done',
    coalesce(v_res->>'status','(null)'), CASE WHEN v_res->>'status'='done' THEN 'VERT' ELSE 'ROUGE' END);
  INSERT INTO r VALUES (4,'Candidats vus par le filet','3',
    coalesce(v_res->>'candidates','(null)'), CASE WHEN (v_res->>'candidates')::int=3 THEN 'VERT' ELSE 'ROUGE' END);

  SELECT gym_id INTO v_gym FROM public.profiles WHERE id=m1;
  INSERT INTO r VALUES (5,'GÉRANT EMAIL : IGNORÉ — c''est l''incident du 22/09','gym_id reste NULL',
    coalesce(v_gym::text,'NULL'), CASE WHEN v_gym IS NULL THEN 'VERT' ELSE 'ROUGE' END);
  SELECT count(*) INTO v_n FROM public.member_gyms WHERE member_id=m1;
  INSERT INTO r VALUES (6,'GÉRANT EMAIL : aucune adhésion créée','0', v_n::text,
    CASE WHEN v_n=0 THEN 'VERT' ELSE 'ROUGE' END);

  SELECT gym_id INTO v_gym FROM public.profiles WHERE id=m2;
  INSERT INTO r VALUES (7,'MEMBRE GOOGLE : rattaché à la salle dédiée (règle 2)','salle dédiée',
    CASE WHEN v_gym=c_dediee THEN 'salle dédiée' ELSE coalesce(v_gym::text,'NULL') END,
    CASE WHEN v_gym=c_dediee THEN 'VERT' ELSE 'ROUGE' END);

  SELECT gym_id INTO v_gym FROM public.profiles WHERE id=m3;
  INSERT INTO r VALUES (8,'GARDE ② : membre EMAIL sans adhésion — on ne devine pas','gym_id reste NULL',
    coalesce(v_gym::text,'NULL'), CASE WHEN v_gym IS NULL THEN 'VERT' ELSE 'ROUGE' END);

  SELECT gym_id INTO v_gym FROM public.profiles WHERE id=m4;
  INSERT INTO r VALUES (9,'RÈGLE 1 INCHANGÉE : adhésion unique → rattaché','rattaché',
    CASE WHEN v_gym IS NOT NULL THEN 'rattaché' ELSE 'NULL' END,
    CASE WHEN v_gym IS NOT NULL THEN 'VERT' ELSE 'ROUGE' END);

  INSERT INTO r VALUES (10,'Bilan du filet : 2 réparés, 1 bloqué','2 / 1',
    format('%s / %s', v_res->>'repaired', v_res->>'blocked'),
    CASE WHEN (v_res->>'repaired')::int=2 AND (v_res->>'blocked')::int=1 THEN 'VERT' ELSE 'ROUGE' END);

  -- ⚠️ LE JOURNAL DISTINGUE DEUX SILENCES, ET C'EST TOUT LE POINT DU LOT. Un membre qu'on
  -- refuse de deviner laisse une ligne OUVERTE (quelqu'un doit trancher). Un gérant, lui,
  -- ne laisse RIEN : il n'a jamais été examiné, il n'y a pas de décision en attente.
  SELECT count(*) INTO v_n FROM public.webhook_failures
   WHERE function_name='member-gyms-autoheal' AND stage='undeterminable' AND resolved_at IS NULL
     AND detail->>'member_id' = m3::text;
  INSERT INTO r VALUES (11,'Le refus de deviner est JOURNALISÉ (undeterminable)','1 ligne ouverte',
    v_n::text, CASE WHEN v_n=1 THEN 'VERT' ELSE 'ROUGE' END);
  SELECT count(*) INTO v_n FROM public.webhook_failures
   WHERE function_name='member-gyms-autoheal' AND detail->>'member_id' = m1::text;
  INSERT INTO r VALUES (12,'Le gérant ne laisse AUCUNE trace : il n''a jamais été examiné','0 ligne',
    v_n::text, CASE WHEN v_n=0 THEN 'VERT' ELSE 'ROUGE' END);
END
$banc$;

SELECT n, cas, attendu, obtenu, verdict FROM r ORDER BY n;

ROLLBACK;
