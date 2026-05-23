-- Sécurité #3 — Rate limiting webhooks Mollie
-- Fonction check_webhook_rate_limit déjà appliquée sur prod via Supabase MCP
-- Ce fichier est uniquement pour la traçabilité Git

-- check_webhook_rate_limit(identifier, action, max_calls, window_seconds)
-- Retourne true si autorisé, false si bloqué
-- Accès service_role uniquement
-- Ne pas ré-appliquer : déjà en prod
