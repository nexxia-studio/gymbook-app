-- GYM-58 — Architecture plan/quota/commission Nexxia
-- Migration déjà appliquée sur prod le 21 mai 2026 via Supabase MCP

ALTER TABLE nexxia_plan_limits
  ADD COLUMN IF NOT EXISTS commission_sepa_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_cb_rate   NUMERIC(5,4) NOT NULL DEFAULT 0;

ALTER TABLE nexxia_plan_limits
  DROP CONSTRAINT IF EXISTS nexxia_plan_limits_plan_check;

ALTER TABLE nexxia_plan_limits
  ADD CONSTRAINT nexxia_plan_limits_plan_check
  CHECK (plan = ANY (ARRAY['free', 'starter', 'studio', 'pro']));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'nexxia_gyms'::regclass
      AND conname = 'nexxia_gyms_plan_check'
  ) THEN
    ALTER TABLE nexxia_gyms DROP CONSTRAINT nexxia_gyms_plan_check;
    ALTER TABLE nexxia_gyms ADD CONSTRAINT nexxia_gyms_plan_check
      CHECK (plan = ANY (ARRAY['free', 'starter', 'studio', 'pro']));
  END IF;
END $$;

UPDATE nexxia_plan_limits SET plan = 'studio' WHERE plan = 'pro_plus';

UPDATE nexxia_plan_limits SET
  max_members = 15, max_slots_per_month = 3, payments_enabled = false,
  notifications_enabled = false, analytics_enabled = false,
  price_cents = 0, commission_sepa_rate = 0, commission_cb_rate = 0
WHERE plan = 'free';

UPDATE nexxia_plan_limits SET
  max_members = 50, max_slots_per_month = NULL, payments_enabled = true,
  notifications_enabled = false, analytics_enabled = false,
  price_cents = 7900, commission_sepa_rate = 0.015, commission_cb_rate = 0.020
WHERE plan = 'starter';

UPDATE nexxia_plan_limits SET
  max_members = 150, max_slots_per_month = NULL, payments_enabled = true,
  notifications_enabled = true, analytics_enabled = false,
  price_cents = 13900, commission_sepa_rate = 0.010, commission_cb_rate = 0.015
WHERE plan = 'studio';

UPDATE nexxia_plan_limits SET
  max_members = NULL, max_slots_per_month = NULL, payments_enabled = true,
  notifications_enabled = true, analytics_enabled = true,
  price_cents = 16900, commission_sepa_rate = 0.005, commission_cb_rate = 0.010
WHERE plan = 'pro';

COMMENT ON COLUMN nexxia_plan_limits.commission_sepa_rate IS
  'Commission Nexxia sur paiements SEPA récurrents. Ex: 0.015 = 1,5%';
COMMENT ON COLUMN nexxia_plan_limits.commission_cb_rate IS
  'Commission Nexxia sur paiements CB one-time (drop-in, carnets). Ex: 0.020 = 2,0%';
