-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521142418 : fix_oauth_states_rate_limits_explicit_policies
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- ============================================================
-- SÉCURITÉ #5 — oauth_states et rate_limits
-- Problème : RLS activé mais aucune policy → implicite et fragile
-- Fix : REVOKE table-level + policies explicites + commentaires
-- ============================================================

-- OAUTH_STATES
-- Utilisée uniquement par mollie-connect-oauth (service_role)
-- pour stocker les tokens CSRF anti-replay

REVOKE ALL ON TABLE oauth_states FROM anon;
REVOKE ALL ON TABLE oauth_states FROM authenticated;

CREATE POLICY "Accès interdit — service_role uniquement" ON oauth_states
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE oauth_states IS
  'Tokens CSRF pour le flow OAuth Mollie. Accès service_role uniquement via Edge Functions. Aucun accès client autorisé.';

-- RATE_LIMITS
-- Utilisée pour tracker les tentatives de connexion / actions
-- Jamais accessible directement par un utilisateur

REVOKE ALL ON TABLE rate_limits FROM anon;
REVOKE ALL ON TABLE rate_limits FROM authenticated;

CREATE POLICY "Accès interdit — service_role uniquement" ON rate_limits
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE rate_limits IS
  'Rate limiting des actions sensibles (login, paiements). Accès service_role uniquement via Edge Functions. Aucun accès client autorisé.';

