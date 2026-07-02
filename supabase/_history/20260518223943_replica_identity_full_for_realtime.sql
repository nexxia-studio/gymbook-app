-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260518223943 : replica_identity_full_for_realtime
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
ALTER TABLE time_slots REPLICA IDENTITY FULL;
ALTER TABLE bookings REPLICA IDENTITY FULL;
