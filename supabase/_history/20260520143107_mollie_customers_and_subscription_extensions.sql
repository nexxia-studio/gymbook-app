-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260520143107 : mollie_customers_and_subscription_extensions
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
CREATE TABLE IF NOT EXISTS mollie_customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gym_id UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mollie_customer_id TEXT NOT NULL,
  has_valid_mandate BOOLEAN DEFAULT false,
  mollie_mandate_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(gym_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_mollie_customers_member ON mollie_customers(member_id);

ALTER TABLE mollie_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membre voit son customer" ON mollie_customers;
CREATE POLICY "Membre voit son customer"
  ON mollie_customers FOR SELECT
  USING (member_id = auth.uid());

DROP POLICY IF EXISTS "Admin voit les customers de sa gym" ON mollie_customers;
CREATE POLICY "Admin voit les customers de sa gym"
  ON mollie_customers FOR ALL
  USING (gym_id = get_my_gym_id() AND is_gym_admin())
  WITH CHECK (gym_id = get_my_gym_id() AND is_gym_admin());

-- Extend member_subscriptions for Mollie recurring plans
ALTER TABLE member_subscriptions
  ALTER COLUMN plan_id DROP NOT NULL;

ALTER TABLE member_subscriptions
  ADD COLUMN IF NOT EXISTS plan_code TEXT,
  ADD COLUMN IF NOT EXISTS plan_name TEXT,
  ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS next_payment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payments_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_payments INTEGER;

CREATE INDEX IF NOT EXISTS idx_member_subscriptions_mollie ON member_subscriptions(mollie_subscription_id);
CREATE INDEX IF NOT EXISTS idx_member_subscriptions_member_status ON member_subscriptions(member_id, status);
