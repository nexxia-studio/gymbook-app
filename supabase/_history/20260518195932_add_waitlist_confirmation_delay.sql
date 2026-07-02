-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260518195932 : add_waitlist_confirmation_delay
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
ALTER TABLE nexxia_gyms 
  ADD COLUMN IF NOT EXISTS waitlist_confirmation_minutes INTEGER DEFAULT 30 NOT NULL;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS waitlist_confirmation_deadline TIMESTAMPTZ;

ALTER TABLE nexxia_gyms
  ADD CONSTRAINT waitlist_confirmation_minutes_range
  CHECK (waitlist_confirmation_minutes BETWEEN 10 AND 120);
