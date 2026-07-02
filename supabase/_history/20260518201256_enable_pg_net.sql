-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260518201256 : enable_pg_net
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
