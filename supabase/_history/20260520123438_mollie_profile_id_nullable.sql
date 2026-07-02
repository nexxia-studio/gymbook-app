-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260520123438 : mollie_profile_id_nullable
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
ALTER TABLE mollie_connections ALTER COLUMN mollie_profile_id DROP NOT NULL;
