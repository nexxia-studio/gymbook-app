-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260520125154 : payments_and_member_credits
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gym_id UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mollie_payment_id TEXT UNIQUE,
  plan_id TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paid','failed','expired','canceled')),
  payment_method TEXT,
  checkout_url TEXT,
  credits_granted INTEGER DEFAULT 0,
  nexxia_fee DECIMAL(10,2),
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_gym ON payments(gym_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_mollie ON payments(mollie_payment_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membres voient leurs paiements" ON payments;
CREATE POLICY "Membres voient leurs paiements"
  ON payments FOR SELECT
  USING (member_id = auth.uid());

DROP POLICY IF EXISTS "Gym admin gere les paiements" ON payments;
CREATE POLICY "Gym admin gere les paiements"
  ON payments FOR ALL
  USING (gym_id = get_my_gym_id() AND is_gym_admin())
  WITH CHECK (gym_id = get_my_gym_id() AND is_gym_admin());

CREATE TABLE IF NOT EXISTS member_credits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gym_id UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id TEXT,
  credits_total INTEGER NOT NULL DEFAULT 0,
  credits_used INTEGER NOT NULL DEFAULT 0,
  credits_remaining INTEGER GENERATED ALWAYS AS (credits_total - credits_used) STORED,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_credits_member ON member_credits(member_id);

ALTER TABLE member_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Membres voient leurs credits" ON member_credits;
CREATE POLICY "Membres voient leurs credits"
  ON member_credits FOR SELECT
  USING (member_id = auth.uid());

DROP POLICY IF EXISTS "Gym admin gere les credits" ON member_credits;
CREATE POLICY "Gym admin gere les credits"
  ON member_credits FOR ALL
  USING (gym_id = get_my_gym_id() AND is_gym_admin())
  WITH CHECK (gym_id = get_my_gym_id() AND is_gym_admin());
