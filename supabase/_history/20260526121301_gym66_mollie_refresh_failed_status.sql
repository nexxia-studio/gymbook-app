-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260526121301 : gym66_mollie_refresh_failed_status
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- GYM-66 : Ajoute 'refresh_failed' comme valeur valide pour gym_mollie_connections.status
-- Vérifie si une contrainte CHECK existe et la remplace
DO $$
BEGIN
  -- Drop existing CHECK constraint on status if any
  ALTER TABLE public.gym_mollie_connections
    DROP CONSTRAINT IF EXISTS gym_mollie_connections_status_check;

  -- Recreate with refresh_failed included
  ALTER TABLE public.gym_mollie_connections
    ADD CONSTRAINT gym_mollie_connections_status_check
    CHECK (status IN ('active', 'revoked', 'refresh_failed'));
END;
$$;

