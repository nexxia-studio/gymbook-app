-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260701223211 : gym98_revoke_security_definer_execute_from_public
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================
-- GYM-98 — Temps 1 : le droit EXECUTE vient d'un GRANT TO PUBLIC.
-- REVOKE FROM PUBLIC (+ anon, authenticated) puis re-GRANT explicite à service_role.
-- Idempotent. get_communication_recipients EXCLUE (traitée en Temps 2 avec guard).

DO $$
DECLARE
  fns text[] := ARRAY[
    'request_account_deletion',
    'decrypt_medical',
    'encrypt_medical',
    'allocate_invoice_number',
    'resolve_plan_for_payment',
    'reorder_waitlist',
    'process_no_shows',
    'mark_reminder_sent',
    'get_pending_reminders',
    'expire_waitlist_confirmations',
    'rls_auto_enable'
  ];
  fn text;
  sig text;
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    FOR sig IN
      SELECT p.oid::regprocedure::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', sig);
      RAISE NOTICE 'Locked down %', sig;
    END LOOP;
  END LOOP;
END $$;
