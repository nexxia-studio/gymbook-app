-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260518152545 : add_waitlist_notified_at_to_bookings
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS waitlist_notified_at TIMESTAMPTZ;
