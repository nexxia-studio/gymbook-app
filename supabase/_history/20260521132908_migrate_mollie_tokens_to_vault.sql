-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521132908 : migrate_mollie_tokens_to_vault
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- ============================================================
-- SÉCURITÉ #1 — Migration tokens Mollie → Supabase Vault
-- ============================================================
-- Étape 1 : Migrer la ligne existante vers Vault + gym_mollie_connections
-- Étape 2 : Effacer les tokens en clair dans mollie_connections
-- Étape 3 : Ajouter une colonne vault sur mollie_connections (backward compat)
-- ============================================================

DO $$
DECLARE
  v_gym_id          uuid;
  v_access_token    text;
  v_refresh_token   text;
  v_expires_at      timestamptz;
  v_profile_id      text;
  v_profile_name    text;
  v_access_vault_id  uuid;
  v_refresh_vault_id uuid;
BEGIN

  -- Lire la connexion existante
  SELECT
    gym_id, access_token, refresh_token,
    expires_at, mollie_profile_id, mollie_profile_name
  INTO
    v_gym_id, v_access_token, v_refresh_token,
    v_expires_at, v_profile_id, v_profile_name
  FROM mollie_connections
  LIMIT 1;

  IF v_gym_id IS NULL THEN
    RAISE NOTICE 'Aucune donnée à migrer dans mollie_connections.';
    RETURN;
  END IF;

  -- Stocker access_token dans le Vault Supabase (chiffré AES-256)
  SELECT vault.create_secret(
    v_access_token,
    'mollie_access_' || v_gym_id::text,
    'Mollie OAuth access_token — gym ' || v_gym_id::text
  ) INTO v_access_vault_id;

  -- Stocker refresh_token dans le Vault Supabase
  IF v_refresh_token IS NOT NULL AND v_refresh_token != '' THEN
    SELECT vault.create_secret(
      v_refresh_token,
      'mollie_refresh_' || v_gym_id::text,
      'Mollie OAuth refresh_token — gym ' || v_gym_id::text
    ) INTO v_refresh_vault_id;
  END IF;

  -- Insérer (ou mettre à jour) dans gym_mollie_connections
  INSERT INTO gym_mollie_connections (
    id,
    gym_id,
    access_token_vault_id,
    refresh_token_vault_id,
    mollie_profile_id,
    mollie_account_name,
    expires_at,
    status,
    connected_at
  ) VALUES (
    gen_random_uuid(),
    v_gym_id,
    v_access_vault_id,
    v_refresh_vault_id,
    v_profile_id,
    v_profile_name,
    v_expires_at,
    'active',
    now()
  )
  ON CONFLICT (gym_id) DO UPDATE SET
    access_token_vault_id  = EXCLUDED.access_token_vault_id,
    refresh_token_vault_id = EXCLUDED.refresh_token_vault_id,
    mollie_profile_id      = EXCLUDED.mollie_profile_id,
    mollie_account_name    = EXCLUDED.mollie_account_name,
    expires_at             = EXCLUDED.expires_at,
    status                 = 'active',
    last_refreshed_at      = now();

  RAISE NOTICE 'Tokens migrés vers Vault pour gym_id: %', v_gym_id;
  RAISE NOTICE 'access_token_vault_id: %', v_access_vault_id;
  RAISE NOTICE 'refresh_token_vault_id: %', v_refresh_vault_id;

  -- Écraser les tokens en clair par un marqueur non fonctionnel
  UPDATE mollie_connections
  SET
    access_token  = '[MIGRATED_TO_VAULT:' || v_access_vault_id::text || ']',
    refresh_token = '[MIGRATED_TO_VAULT:' || COALESCE(v_refresh_vault_id::text, 'null') || ']',
    updated_at    = now()
  WHERE gym_id = v_gym_id;

  RAISE NOTICE 'Tokens en clair effacés de mollie_connections.';

END $$;

