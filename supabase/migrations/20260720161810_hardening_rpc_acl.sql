-- Hardening ACL des RPC — appliqué live le 20/07/2026 (cockpit MCP), versionné a posteriori. Idempotent.
--
-- Verrouille l'exécution des fonctions sensibles (Vault Mollie, médical, cron interne,
-- rate-limit, résolution de plan…) au service_role uniquement. Exception :
-- get_communication_recipients reste exécutable par authenticated (le dashboard l'appelle)
-- — la restriction gym_admin/même-gym est portée DANS le corps de la fonction
-- (cf. migration gym_guard_communication_recipients). Rejouable sans effet.

REVOKE ALL ON FUNCTION public.get_gym_mollie_tokens(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_gym_mollie_tokens(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.create_mollie_vault_tokens(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_mollie_vault_tokens(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.update_mollie_vault_token(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_mollie_vault_token(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.decrypt_medical(bytea, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decrypt_medical(bytea, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.encrypt_medical(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encrypt_medical(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.request_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.allocate_invoice_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.check_webhook_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_webhook_rate_limit(text, text, integer, integer) TO service_role;
REVOKE ALL ON FUNCTION public.expire_waitlist_confirmations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_waitlist_confirmations() TO service_role;
REVOKE ALL ON FUNCTION public.get_pending_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_reminders() TO service_role;
REVOKE ALL ON FUNCTION public.mark_reminder_sent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_reminder_sent(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.process_no_shows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_no_shows() TO service_role;
REVOKE ALL ON FUNCTION public.reorder_waitlist(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_waitlist(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_plan_for_payment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_plan_for_payment(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
REVOKE ALL ON FUNCTION public.get_communication_recipients(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_communication_recipients(uuid, text) TO authenticated, service_role;
