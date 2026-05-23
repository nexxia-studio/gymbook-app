CREATE OR REPLACE FUNCTION update_mollie_vault_token(
  p_vault_id  uuid,
  p_new_secret text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  IF p_vault_id IS NULL THEN
    RAISE EXCEPTION 'vault_id ne peut pas être NULL';
  END IF;

  IF p_new_secret IS NULL OR p_new_secret = '' THEN
    RAISE EXCEPTION 'Le nouveau secret ne peut pas être vide';
  END IF;

  UPDATE vault.secrets
  SET secret     = p_new_secret,
      updated_at = now()
  WHERE id = p_vault_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Secret Vault introuvable pour id: %', p_vault_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION update_mollie_vault_token(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_mollie_vault_token(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION update_mollie_vault_token(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION update_mollie_vault_token(uuid, text) TO service_role;

COMMENT ON FUNCTION update_mollie_vault_token(uuid, text) IS
  'Met à jour un secret Mollie OAuth existant dans Supabase Vault (refresh des tokens).
   Accès service_role uniquement — ne jamais exposer côté client.';
