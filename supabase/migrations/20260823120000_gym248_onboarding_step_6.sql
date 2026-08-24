-- GYM-248 — 6e étape d'onboarding : « ton premier coach ».
--
-- ⚠️ DÉJÀ APPLIQUÉE EN STAGING PAR LE COCKPIT. Ce fichier ne sert QU'AU VERSIONNEMENT du
-- dépôt (ledger) : il reproduit le contenu appliqué, et rien n'est déployé depuis la
-- branche UI. Tout y est idempotent et rejouable.
--
-- MOTIF — constaté au premier parcours gérant réel : un créneau EXIGE un coach
-- (GYM-229, `activity_requires_coach`). La séquence d'origine plaçait la création de
-- créneau juste après l'activité, si bien qu'un gérant neuf arrivait sur le planning sans
-- pouvoir rien y poser. Le coach s'intercale donc AVANT le créneau :
--
--   1 · ta salle          2 · ta première activité   3 · TON PREMIER COACH
--   4 · ton premier créneau                          5 · ta politique d'annulation
--   6 · invite tes membres
--
-- Deux choses à tenir d'accord, et elles sont toutes les deux ici :
--   · le CHECK borne la colonne ;
--   · le RPC borne ce que le client peut demander, avec un message lisible plutôt qu'une
--     violation de contrainte brute.
-- Les faire diverger, c'est laisser passer un 6 côté RPC que la table refusera.

-- ═══ a) CHECK : 1..5 → 1..6 ══════════════════════════════════════════════════════
-- Le nom de la contrainte est celui de la base (nexxia_gyms_onboarding_step_check).
-- DROP IF EXISTS puis ADD : rejouable, et sans dépendre de l'ordre d'application.
ALTER TABLE public.nexxia_gyms
  DROP CONSTRAINT IF EXISTS nexxia_gyms_onboarding_step_check;

ALTER TABLE public.nexxia_gyms
  ADD CONSTRAINT nexxia_gyms_onboarding_step_check
  CHECK (onboarding_step >= 1 AND onboarding_step <= 6);

-- ═══ b) RPC de progression, borné 1..6 ═══════════════════════════════════════════
-- onboarding_step / onboarding_completed sont HORS de la liste blanche GYM-180 et doivent
-- le RESTER : ce sont des champs de pilotage produit, pas des réglages d'exploitation. Ce
-- RPC les expose de façon bornée sans rouvrir le GRANT.
CREATE OR REPLACE FUNCTION public.set_gym_onboarding_progress(
  p_gym_id uuid,
  p_step integer,
  p_completed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- SECURITY DEFINER contourne RLS : sans ce garde, n'importe quel porteur de JWT
  -- piloterait l'onboarding de n'importe quelle salle.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.gym_id = p_gym_id
      AND p.role IN ('gym_admin', 'super_admin')
      AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'set_gym_onboarding_progress: accès refusé à la salle %', p_gym_id
      USING ERRCODE = '42501';
  END IF;

  -- Bornes du CHECK ci-dessus, rejouées ici pour refuser avec un message lisible.
  IF p_step < 1 OR p_step > 6 THEN
    RAISE EXCEPTION 'set_gym_onboarding_progress: étape % hors bornes (1..6)', p_step
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.nexxia_gyms
     SET onboarding_step = p_step,
         onboarding_completed = p_completed,
         updated_at = now()
   WHERE id = p_gym_id;
END;
$$;

COMMENT ON FUNCTION public.set_gym_onboarding_progress(uuid, integer, boolean) IS
  'GYM-248 — progression du wizard d''onboarding (1..6). Seul chemin d''écriture de '
  'onboarding_step / onboarding_completed, qui restent hors de la liste blanche GYM-180.';

REVOKE ALL ON FUNCTION public.set_gym_onboarding_progress(uuid, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_gym_onboarding_progress(uuid, integer, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_gym_onboarding_progress(uuid, integer, boolean)
  TO authenticated, service_role;
