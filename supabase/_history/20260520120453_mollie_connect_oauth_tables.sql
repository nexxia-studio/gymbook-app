-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260520120453 : mollie_connect_oauth_tables
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
CREATE TABLE IF NOT EXISTS mollie_oauth_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  gym_admin_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mollie_oauth_states_state ON mollie_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_mollie_oauth_states_expires ON mollie_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS mollie_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gym_id UUID NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE UNIQUE,
  gym_admin_id UUID NOT NULL REFERENCES profiles(id),
  mollie_profile_id TEXT NOT NULL,
  mollie_profile_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  is_test_mode BOOLEAN DEFAULT true,
  connected_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE mollie_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE mollie_oauth_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Gym admin voit sa connexion Mollie" ON mollie_connections;
CREATE POLICY "Gym admin voit sa connexion Mollie"
  ON mollie_connections FOR ALL
  USING (gym_id = get_my_gym_id() AND is_gym_admin())
  WITH CHECK (gym_id = get_my_gym_id() AND is_gym_admin());

DROP POLICY IF EXISTS "Service role manages oauth states" ON mollie_oauth_states;
CREATE POLICY "Service role manages oauth states"
  ON mollie_oauth_states FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
