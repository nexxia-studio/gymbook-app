-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521145248 : gym58_plan_limits_commission_rates
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- ============================================================
-- GYM-58 — Architecture plan/quota/commission Nexxia
-- Ordre : colonnes → drop contrainte → rename → updates → nouvelle contrainte
-- ============================================================

-- 1. Nouvelles colonnes commission
ALTER TABLE nexxia_plan_limits
  ADD COLUMN IF NOT EXISTS commission_sepa_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_cb_rate   NUMERIC(5,4) NOT NULL DEFAULT 0;

-- 2. Drop les contraintes existantes (plan_check sur les 2 tables)
ALTER TABLE nexxia_plan_limits DROP CONSTRAINT nexxia_plan_limits_plan_check;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nexxia_gyms'::regclass
      AND conname = 'nexxia_gyms_plan_check'
  ) THEN
    ALTER TABLE nexxia_gyms DROP CONSTRAINT nexxia_gyms_plan_check;
  END IF;
END $$;

-- 3. Renommer pro_plus → studio (avant d'ajouter la nouvelle contrainte)
UPDATE nexxia_plan_limits SET plan = 'studio' WHERE plan = 'pro_plus';

-- 4. Ajouter les nouvelles contraintes avec 'studio'
ALTER TABLE nexxia_plan_limits
  ADD CONSTRAINT nexxia_plan_limits_plan_check
  CHECK (plan = ANY (ARRAY['free', 'starter', 'studio', 'pro']));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nexxia_gyms' AND column_name = 'plan'
  ) THEN
    ALTER TABLE nexxia_gyms ADD CONSTRAINT nexxia_gyms_plan_check
      CHECK (plan = ANY (ARRAY['free', 'starter', 'studio', 'pro']));
  END IF;
END $$;

-- 5. Mettre à jour les valeurs de chaque plan

-- FREE — Freemium ultra-limité, sans paiements
UPDATE nexxia_plan_limits SET
  max_members           = 15,
  max_slots_per_month   = 3,
  payments_enabled      = false,
  notifications_enabled = false,
  analytics_enabled     = false,
  price_cents           = 0,
  commission_sepa_rate  = 0,
  commission_cb_rate    = 0
WHERE plan = 'free';

-- STARTER — Coachs et petits studios
UPDATE nexxia_plan_limits SET
  max_members           = 50,
  max_slots_per_month   = NULL,
  payments_enabled      = true,
  notifications_enabled = false,
  analytics_enabled     = false,
  price_cents           = 7900,
  commission_sepa_rate  = 0.015,
  commission_cb_rate    = 0.020
WHERE plan = 'starter';

-- STUDIO — Leurre stratégique
UPDATE nexxia_plan_limits SET
  max_members           = 150,
  max_slots_per_month   = NULL,
  payments_enabled      = true,
  notifications_enabled = true,
  analytics_enabled     = false,
  price_cents           = 13900,
  commission_sepa_rate  = 0.010,
  commission_cb_rate    = 0.015
WHERE plan = 'studio';

-- PRO — Plan cible, membres illimités (Nico reste ici ✅)
UPDATE nexxia_plan_limits SET
  max_members           = NULL,
  max_slots_per_month   = NULL,
  payments_enabled      = true,
  notifications_enabled = true,
  analytics_enabled     = true,
  price_cents           = 16900,
  commission_sepa_rate  = 0.005,
  commission_cb_rate    = 0.010
WHERE plan = 'pro';

-- 6. Commentaires
COMMENT ON COLUMN nexxia_plan_limits.commission_sepa_rate IS
  'Commission Nexxia sur paiements SEPA récurrents. Ex: 0.015 = 1,5%';
COMMENT ON COLUMN nexxia_plan_limits.commission_cb_rate IS
  'Commission Nexxia sur paiements CB one-time (drop-in, carnets). Ex: 0.020 = 2,0%';

