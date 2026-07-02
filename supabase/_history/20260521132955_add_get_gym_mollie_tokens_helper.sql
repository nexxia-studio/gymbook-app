-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521132955 : add_get_gym_mollie_tokens_helper
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- ============================================================
-- Helper function : lire les tokens Mollie depuis le Vault
-- Appelée par les Edge Functions via supabase.rpc()
-- SECURITY DEFINER : accède au vault même sans droits directs
-- ============================================================

CREATE OR REPLACE FUNCTION get_gym_mollie_tokens(p_gym_id uuid)
RETURNS TABLE(
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  status        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT ds.decrypted_secret
     FROM vault.decrypted_secrets ds
     WHERE ds.id = gmc.access_token_vault_id
     LIMIT 1)::text AS access_token,

    (SELECT ds.decrypted_secret
     FROM vault.decrypted_secrets ds
     WHERE ds.id = gmc.refresh_token_vault_id
     LIMIT 1)::text AS refresh_token,

    gmc.expires_at,
    gmc.status
  FROM gym_mollie_connections gmc
  WHERE gmc.gym_id = p_gym_id
  LIMIT 1;
END;
$$;

-- Sécurité : seul le service_role peut appeler cette fonction
REVOKE ALL ON FUNCTION get_gym_mollie_tokens(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_gym_mollie_tokens(uuid) FROM anon;
REVOKE ALL ON FUNCTION get_gym_mollie_tokens(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_gym_mollie_tokens(uuid) TO service_role;

COMMENT ON FUNCTION get_gym_mollie_tokens(uuid) IS
  'Déchiffre et retourne les tokens Mollie OAuth depuis Supabase Vault. Accès service_role uniquement.';

