-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521204902 : security3_webhook_rate_limit
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- ============================================================
-- SÉCURITÉ #3 — Mollie Webhooks
-- Fonction de rate limiting pour les endpoints webhooks
-- ============================================================

CREATE OR REPLACE FUNCTION check_webhook_rate_limit(
  p_identifier text,   -- IP ou payment ID
  p_action     text,   -- 'mollie_webhook' ou 'mollie_sub_webhook'
  p_max_calls  integer DEFAULT 10,  -- max appels
  p_window_seconds integer DEFAULT 60  -- par fenêtre (60s)
)
RETURNS boolean  -- true = autorisé, false = bloqué
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  v_window_start := NOW() - (p_window_seconds || ' seconds')::interval;

  -- Compter les appels dans la fenêtre
  SELECT attempts INTO v_count
  FROM rate_limits
  WHERE identifier    = p_identifier
    AND action        = p_action
    AND window_start  > v_window_start
  LIMIT 1;

  -- Nouveau : insérer ou mettre à jour
  INSERT INTO rate_limits (identifier, action, attempts, window_start)
  VALUES (p_identifier, p_action, 1, NOW())
  ON CONFLICT (identifier, action)
  DO UPDATE SET
    attempts     = CASE
      WHEN rate_limits.window_start > v_window_start
        THEN rate_limits.attempts + 1
      ELSE 1  -- reset si fenêtre expirée
    END,
    window_start = CASE
      WHEN rate_limits.window_start > v_window_start
        THEN rate_limits.window_start
      ELSE NOW()
    END;

  -- Bloquer si dépassement
  RETURN COALESCE(v_count, 0) < p_max_calls;
END;
$$;

REVOKE ALL ON FUNCTION check_webhook_rate_limit(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_webhook_rate_limit(text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION check_webhook_rate_limit(text, text, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION check_webhook_rate_limit(text, text, integer, integer) TO service_role;

COMMENT ON FUNCTION check_webhook_rate_limit IS
  'Sécurité #3 — Rate limiting pour les webhooks Mollie.
   Retourne true si autorisé, false si bloqué.
   Par défaut : 10 appels max par 60 secondes par identifier.';

-- S'assurer que rate_limits a bien une contrainte unique sur (identifier, action)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rate_limits'::regclass
      AND contype  = 'u'
      AND conname ILIKE '%identifier%action%'
  ) THEN
    ALTER TABLE rate_limits
      ADD CONSTRAINT rate_limits_identifier_action_key
      UNIQUE (identifier, action);
  END IF;
END $$;

