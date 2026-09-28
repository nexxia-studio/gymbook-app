-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-363 — L'ASSISTANT GAGNE UNE SEPTIÈME ÉTAPE : L'IDENTITÉ LÉGALE                  ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- LE FAIT, mesuré en production le 28/09 : les DEUX salles créées en libre-service — The
-- Pulse Box et Iner Studio, toutes deux le 22/09 — ont les SIX champs légaux vides.
-- `gym_legal_identity_complete` rend `false` pour elles deux : elles ne peuvent pas
-- encaisser, et leurs gérants l'ignorent. Dopamine et Pace passent parce que leurs champs
-- ont été remplis À LA MAIN.
--
-- 🔴 POURQUOI CE LOT « DASHBOARD UNIQUEMENT » PORTE QUAND MÊME UNE MIGRATION.
-- Le nombre d'étapes de l'assistant est borné à SIX en TROIS endroits, et
-- `apps/dashboard/src/lib/onboarding.ts` le dit déjà noir sur blanc :
--
--     « Trois endroits doivent rester d'accord — la colonne (CHECK), le RPC
--       set_gym_onboarding_progress (bornes 1..6) et cette constante. »
--
-- Ajouter une septième étape côté écran SANS toucher aux deux autres produirait le pire
-- des résultats : le RPC lèverait `22003` à l'enregistrement, `saveOnboardingProgress`
-- rendrait 'failed'… et la progression locale, elle, avancerait quand même. Le gérant
-- croirait avoir terminé son installation, et la base dirait le contraire. C'est
-- exactement le genre de divergence silencieuse que ce lot existe pour supprimer.
--
-- ⚠️ CE FICHIER NE FAIT QUE DÉPLACER UNE BORNE. Aucune colonne ajoutée, aucune donnée
-- touchée, aucune règle métier créée : la règle d'identité légale existe déjà et reste
-- `gym_legal_identity_missing`, qui n'est pas modifiée ici.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LA BORNE DE LA COLONNE
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ AUCUNE LIGNE N'EST INVALIDÉE : on ÉLARGIT (1..6 → 1..7). Une contrainte élargie ne
-- peut rien rejeter de ce qu'elle acceptait. Vérifié avant écriture : la valeur maximale
-- en production vaut 6.
ALTER TABLE public.nexxia_gyms
  DROP CONSTRAINT IF EXISTS nexxia_gyms_onboarding_step_check;

ALTER TABLE public.nexxia_gyms
  ADD CONSTRAINT nexxia_gyms_onboarding_step_check
  CHECK (onboarding_step >= 1 AND onboarding_step <= 7);

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. LA BORNE DU RPC
-- ═════════════════════════════════════════════════════════════════════════════════════
-- Corps repris À L'IDENTIQUE de la version déployée (lue par pg_get_functiondef le 28/09) :
-- seules les deux bornes changent, et le message d'erreur qui les annonce. Le contrôle
-- d'accès, la clause `deleted_at IS NULL` et le `P0002` sont inchangés — les recopier tels
-- quels est la seule façon de garantir qu'on ne rejoue pas une version antérieure par
-- inadvertance (motif GYM-309).
CREATE OR REPLACE FUNCTION public.set_gym_onboarding_progress(
  p_gym_id uuid, p_step integer, p_completed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid()
               AND p.gym_id = p_gym_id AND p.role IN ('gym_admin','super_admin')
               AND p.deleted_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'set_gym_onboarding_progress: accès refusé' USING ERRCODE = '42501';
  END IF;
  -- GYM-363 — 6 → 7 : l'étape « identité légale » s'ajoute à la fin du parcours.
  IF p_step IS NULL OR p_step < 1 OR p_step > 7 THEN
    RAISE EXCEPTION 'set_gym_onboarding_progress: étape hors bornes (1-7)' USING ERRCODE = '22003';
  END IF;
  UPDATE public.nexxia_gyms SET onboarding_step = p_step,
    onboarding_completed = coalesce(p_completed, false), updated_at = now()
  WHERE id = p_gym_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_gym_onboarding_progress: salle introuvable' USING ERRCODE = 'P0002';
  END IF;
END; $function$;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. CONTRÔLE D'APPLICATION
-- ═════════════════════════════════════════════════════════════════════════════════════
DO $verif$
DECLARE
  v_def text;
  v_max integer;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def FROM pg_constraint
   WHERE conrelid = 'public.nexxia_gyms'::regclass
     AND conname = 'nexxia_gyms_onboarding_step_check';
  IF v_def IS NULL OR v_def NOT LIKE '%<= 7%' THEN
    RAISE EXCEPTION 'GYM-363 : la contrainte ne borne pas à 7 (%)', coalesce(v_def, 'absente');
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'set_gym_onboarding_progress';
  IF v_def IS NULL OR v_def NOT LIKE '%p_step > 7%' THEN
    RAISE EXCEPTION 'GYM-363 : le RPC borne encore à 6';
  END IF;

  -- Aucune ligne existante n'a pu être invalidée par un élargissement — on le VÉRIFIE
  -- quand même, parce qu'un contrôle qui ne peut pas échouer n'apprend rien.
  SELECT max(onboarding_step) INTO v_max FROM public.nexxia_gyms;
  RAISE NOTICE 'GYM-363 : bornes portées à 7. Étape la plus avancée en base : %.', coalesce(v_max, 0);
END
$verif$;
