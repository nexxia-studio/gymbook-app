CREATE OR REPLACE FUNCTION create_mollie_vault_tokens(
  p_gym_id        uuid,
  p_access_token  text,
  p_refresh_token text DEFAULT NULL
)
RETURNS TABLE(
  access_vault_id  uuid,
  refresh_vault_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_access_vault_id  uuid;
  v_refresh_vault_id uuid;
BEGIN
  -- Supprimer les anciens secrets Vault si ils existent déjà (reconnexion)
  DELETE FROM vault.secrets
  WHERE name = 'mollie_access_' || p_gym_id::text
     OR name = 'mollie_refresh_' || p_gym_id::text;

  -- Créer le secret access_token dans le Vault
  SELECT vault.create_secret(
    p_access_token,
    'mollie_access_' || p_gym_id::text,
    'Mollie OAuth access_token — gym ' || p_gym_id::text
  ) INTO v_access_vault_id;

  -- Créer le secret refresh_token dans le Vault (si fourni)
  IF p_refresh_token IS NOT NULL AND p_refresh_token != '' THEN
    SELECT vault.create_secret(
      p_refresh_token,
      'mollie_refresh_' || p_gym_id::text,
      'Mollie OAuth refresh_token — gym ' || p_gym_id::text
    ) INTO v_refresh_vault_id;
  END IF;

  RETURN QUERY SELECT v_access_vault_id, v_refresh_vault_id;
END;
$$;

-- Accès service_role uniquement
REVOKE ALL ON FUNCTION create_mollie_vault_tokens(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_mollie_vault_tokens(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION create_mollie_vault_tokens(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_mollie_vault_tokens(uuid, text, text) TO service_role;

COMMENT ON FUNCTION create_mollie_vault_tokens(uuid, text, text) IS
  'Crée ou remplace les secrets Mollie OAuth dans Supabase Vault pour un gym.
   Retourne les UUIDs vault à stocker dans gym_mollie_connections.
   Accès service_role uniquement — ne jamais exposer côté client.';
