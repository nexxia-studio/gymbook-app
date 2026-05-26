-- GYM-66 : autoriser status='refresh_failed' dans gym_mollie_connections
ALTER TABLE gym_mollie_connections
  DROP CONSTRAINT IF EXISTS gym_mollie_connections_status_check;

ALTER TABLE gym_mollie_connections
  ADD CONSTRAINT gym_mollie_connections_status_check
  CHECK (status IN ('active', 'expired', 'revoked', 'refresh_failed'));
