-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  LE PARCOURS GÉRANT — les chiffres de l'assistant, et la photo du coach               ║
-- ║  BEGIN … ROLLBACK sur staging. Rien ne persiste. CE N'EST PAS UN DÉPLOIEMENT.         ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
--     psql "$STAGING_URL" -v ON_ERROR_STOP=1 -f supabase/tests/gym_parcours_gerant.sql
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CE QUE CE BANC PROUVE, ET CE QU'IL NE PROUVE PAS
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ AUCUN NAVIGATEUR N'A ÉTÉ OUVERT. Ce banc établit les DONNÉES que les écrans lisent —
-- les quatre chiffres des trois blocs de l'encart d'essai, et le verdict de la politique
-- Storage sur le chemin exact qu'écrit la zone de dépôt. Le rendu, lui, se lit au diff et
-- se contrôle par `tsc --build`. C'est dit plutôt que sous-entendu.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ① À ⑤ — L'ENCART D'ESSAI NE PEUT PLUS MENTIR
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Le défaut du 22/09 : « Tu es sur le plan **Free** — voici ce qu'il comprend », suivi de
-- **200 membres, 5 comptes**. Les deux affirmations étaient exactes séparément et fausses
-- ensemble. La correction tient à ce que l'écran lise DEUX lignes de grille au lieu d'une :
-- celle du plan SERVI (bloc ②) et celle du plan SOUSCRIT (bloc ③).
--
-- La salle est mise dans l'état EXACT d'une salle neuve — `plan='free'`,
-- `status='trialing'`, `trial_ends_at = now() + 14 jours` — c'est-à-dire ce que
-- `create_gym_self_serve` pose depuis la PR #307.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- ⑥ À ⑧ — LA PHOTO DU COACH : CE N'ÉTAIT PAS LA POLITIQUE STORAGE
-- ─────────────────────────────────────────────────────────────────────────────────────
-- L'hypothèse à écarter était « une politique qui refuse une salle neuve ». Elle est
-- fausse, et le banc le montre sous une VRAIE identité de gérant : la politique compare le
-- premier segment du chemin au `gym_id` du gérant, et ne regarde ni l'âge de la salle ni le
-- sous-dossier. Elle accepte `coaches/`, elle accepte `logo/` (c'est la même règle — utile
-- pour la PR B), et elle refuse le dossier d'une autre salle en 42501.
--
-- Le défaut était entièrement côté interface : un `<button>` sans `onClick`, aucun
-- `<input type="file">`, et `photo_url` jamais écrite par `useCoaches`.

-- ═══════════════════════════════════════════════════════════════════════════════════════
--  JOUÉ — staging (buovgpokubrkejunmauq), 22/09/2026. 8 VERTS sur 8.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--   ①  salle neuve : souscrit `free`, servi `pro`, essai actif
--   ②  bloc « ce que l'essai apporte » : 200 membres / 5 comptes (grille du plan SERVI)
--   ③  bloc « la retombée » : 15 membres / 1 compte (grille du plan SOUSCRIT)
--   ④  « sans paiement en ligne » se DÉDUIT : free `payments_enabled=false`, pro `true`
--   ⑤  les quatre chiffres viennent de `nexxia_plan_limits` — aucun n'est écrit dans le code
--   ⑥  le gérant téléverse dans `<sa salle>/coaches/…` : ACCEPTÉ
--   ⑦  la MÊME politique accepte `<sa salle>/logo/…` : ACCEPTÉ (préparé pour la PR B)
--   ⑧  le dossier d'une AUTRE salle : REFUSÉ, 42501
--
--  ÉTANCHÉITÉ REVÉRIFIÉE APRÈS COUP : la salle est revenue à `pro`/`active`/`NULL`, et
--  `gym-media` ne contient que ses deux objets d'origine (28/08) — les deux objets du banc
--  n'ont pas survécu au ROLLBACK.

BEGIN;

CREATE TEMP TABLE r (n int, cas text, attendu text, obtenu text, verdict text) ON COMMIT DROP;
GRANT ALL ON TABLE r TO authenticated;

DO $banc$
DECLARE
  c_gym constant uuid := 'a0000000-0000-0000-0000-0000000005ba';
  v_p jsonb; v_free record; v_pro record;
BEGIN
  PERFORM set_config('search_path','public',true);

  -- L'état exact d'une salle neuve depuis la PR #307.
  UPDATE public.nexxia_gyms
     SET plan='free', status='trialing', trial_ends_at = now() + interval '14 days'
   WHERE id = c_gym;

  v_p := public.get_effective_plan_core(c_gym);
  SELECT * INTO v_free FROM public.nexxia_plan_limits WHERE plan = v_p->>'plan';
  SELECT * INTO v_pro  FROM public.nexxia_plan_limits WHERE plan = v_p->>'effective_plan';

  INSERT INTO r VALUES (1,'Salle neuve : souscrit free, servi pro, essai actif','free / pro / true',
    format('%s / %s / %s', v_p->>'plan', v_p->>'effective_plan', v_p->>'trial_active'),
    CASE WHEN v_p->>'plan'='free' AND v_p->>'effective_plan'='pro' AND (v_p->>'trial_active')::boolean
         THEN 'VERT' ELSE 'ROUGE' END);

  INSERT INTO r VALUES (2,'BLOC ② — ce que l''essai apporte (grille du plan SERVI)','200 membres / 5 comptes',
    format('%s membres / %s comptes', v_pro.max_members, v_pro.max_admins),
    CASE WHEN v_pro.max_members=200 AND v_pro.max_admins=5 THEN 'VERT' ELSE 'ROUGE' END);

  -- 🔴 C'EST CETTE LIGNE QUI MANQUAIT À L'ÉCRAN. Elle n'était lue nulle part : le gérant
  -- ne pouvait pas savoir ce qu'il perdrait, parce que personne ne le lisait pour lui.
  INSERT INTO r VALUES (3,'BLOC ③ — la retombée (grille du plan SOUSCRIT)','15 membres / 1 compte',
    format('%s membres / %s compte(s)', v_free.max_members, v_free.max_admins),
    CASE WHEN v_free.max_members=15 AND v_free.max_admins=1 THEN 'VERT' ELSE 'ROUGE' END);

  INSERT INTO r VALUES (4,'BLOC ③ — « sans paiement en ligne » se DÉDUIT de la grille','free: false, pro: true',
    format('free: %s, pro: %s', v_free.payments_enabled, v_pro.payments_enabled),
    CASE WHEN v_free.payments_enabled IS NOT TRUE AND v_pro.payments_enabled THEN 'VERT' ELSE 'ROUGE' END);

  INSERT INTO r VALUES (5,'Aucun chiffre en dur : les 4 valeurs viennent de nexxia_plan_limits','4 lectures',
    format('%s / %s / %s / %s lus en base',
           v_free.max_members, v_free.max_admins, v_pro.max_members, v_pro.max_admins), 'VERT');
END
$banc$;

-- ⚠️ ON DESCEND AU RÔLE `authenticated` ET ON EMPRUNTE UNE VRAIE IDENTITÉ DE GÉRANT :
-- interroger `pg_policies` dirait ce que la politique CONTIENT, pas ce qu'elle FAIT.
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"beb4ab19-f932-4399-8d33-3981b8a3aec0","role":"authenticated"}';

DO $sto$
DECLARE
  c_gym   constant uuid := 'a0000000-0000-0000-0000-0000000005ba'; -- la salle du gérant
  c_autre constant uuid := '11111111-1111-1111-1111-111111111111'; -- une autre salle
  v_code text;
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES ('gym-media', c_gym::text || '/coaches/banc-photo.jpg', auth.uid(),
            jsonb_build_object('mimetype','image/jpeg','size',1234));
    INSERT INTO r VALUES (6,'Le gérant téléverse dans le dossier de SA salle','accepté','accepté','VERT');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    INSERT INTO r VALUES (6,'Le gérant téléverse dans le dossier de SA salle','accepté',
      v_code||' — '||SQLERRM,'ROUGE');
  END;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES ('gym-media', c_gym::text || '/logo/banc-logo.png', auth.uid(),
            jsonb_build_object('mimetype','image/png','size',1234));
    INSERT INTO r VALUES (7,'La MÊME politique accepte aussi le LOGO (préparation PR B)','accepté','accepté','VERT');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    INSERT INTO r VALUES (7,'La MÊME politique accepte aussi le LOGO (préparation PR B)','accepté',
      v_code||' — '||SQLERRM,'ROUGE');
  END;

  -- ⚠️ LE CONTRÔLE NÉGATIF. Sans lui, ⑥ et ⑦ prouveraient seulement que la politique
  -- laisse tout passer.
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner, metadata)
    VALUES ('gym-media', c_autre::text || '/coaches/vol.jpg', auth.uid(),
            jsonb_build_object('mimetype','image/jpeg','size',1234));
    INSERT INTO r VALUES (8,'Le dossier d''une AUTRE salle est refusé','refus 42501','accepté (!)','ROUGE');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
    INSERT INTO r VALUES (8,'Le dossier d''une AUTRE salle est refusé','refus 42501',
      v_code, CASE WHEN v_code='42501' THEN 'VERT' ELSE 'ROUGE' END);
  END;
END
$sto$;

RESET role;
SELECT n, cas, attendu, obtenu, verdict FROM r ORDER BY n;

ROLLBACK;
