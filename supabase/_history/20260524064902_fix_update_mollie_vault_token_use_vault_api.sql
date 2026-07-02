-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260524064902 : fix_update_mollie_vault_token_use_vault_api
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- Fix : utiliser vault.update_secret() au lieu de UPDATE vault.secrets directement
CREATE OR REPLACE FUNCTION update_mollie_vault_token(
  p_vault_id uuid,
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

  -- Utiliser l'API officielle Supabase Vault (pas UPDATE direct sur vault.secrets)
  PERFORM vault.update_secret(p_vault_id, p_new_secret);
END;
$$;

REVOKE ALL ON FUNCTION update_mollie_vault_token(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_mollie_vault_token(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION update_mollie_vault_token(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION update_mollie_vault_token(uuid, text) TO service_role;

