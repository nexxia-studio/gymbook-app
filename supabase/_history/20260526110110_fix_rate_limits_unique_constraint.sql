-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260526110110 : fix_rate_limits_unique_constraint
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- Drop the 3-column unique constraint (incompatible with ON CONFLICT (identifier, action))
ALTER TABLE public.rate_limits
  DROP CONSTRAINT IF EXISTS rate_limits_identifier_action_window_start_key;

-- Add the correct 2-column unique constraint that matches the RPC
ALTER TABLE public.rate_limits
  ADD CONSTRAINT rate_limits_identifier_action_key UNIQUE (identifier, action);

