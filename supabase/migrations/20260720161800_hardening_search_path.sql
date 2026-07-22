-- Hardening search_path — appliqué live les 19-20/07/2026 (cockpit MCP), versionné a posteriori. Idempotent.
--
-- Fige search_path = public sur les fonctions listées (protection contre le détournement de
-- résolution de noms). Rejouable sans effet. Signatures vérifiées en live par le cockpit.
-- NB : cancel_slot_atomic et apply_refund_atomic ont déjà leur SET search_path dans leurs
-- migrations d'origine (GYM-143 / GYM-112) — non repris ici pour éviter tout doublon.

ALTER FUNCTION public.allocate_invoice_number(p_payment_id uuid) SET search_path = public;
ALTER FUNCTION public.apply_paid_payment(p_payment_id uuid, p_payment_method text, p_paid_at timestamptz) SET search_path = public;
ALTER FUNCTION public.check_rate_limit(p_identifier text, p_action text, p_max_attempts integer, p_window_minutes integer) SET search_path = public;
ALTER FUNCTION public.check_webhook_rate_limit(p_identifier text, p_action text, p_max_calls integer, p_window_seconds integer) SET search_path = public;
ALTER FUNCTION public.cleanup_oauth_states() SET search_path = public;
ALTER FUNCTION public.create_booking_atomic(p_member_id uuid, p_slot_id uuid, p_gym_id uuid, p_has_subscription boolean, p_existing_booking_id uuid) SET search_path = public;
ALTER FUNCTION public.create_mollie_vault_tokens(p_gym_id uuid, p_access_token text, p_refresh_token text) SET search_path = public;
ALTER FUNCTION public.debit_credit_fifo(p_member_id uuid, p_gym_id uuid, p_booking_id uuid) SET search_path = public;
ALTER FUNCTION public.decrypt_medical(ciphertext bytea, secret_id uuid) SET search_path = public;
ALTER FUNCTION public.encrypt_medical(plaintext text, secret_id uuid) SET search_path = public;
ALTER FUNCTION public.expire_waitlist_confirmations() SET search_path = public;
ALTER FUNCTION public.get_communication_recipients(p_gym_id uuid, p_segment text) SET search_path = public;
ALTER FUNCTION public.get_gym_mollie_tokens(p_gym_id uuid) SET search_path = public;
ALTER FUNCTION public.get_my_gym_id() SET search_path = public;
ALTER FUNCTION public.get_my_role() SET search_path = public;
ALTER FUNCTION public.get_pending_reminders() SET search_path = public;
ALTER FUNCTION public.gym_has_feature(p_gym_id uuid, p_feature text) SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.is_gym_admin() SET search_path = public;
ALTER FUNCTION public.is_super_admin() SET search_path = public;
ALTER FUNCTION public.mark_reminder_sent(p_booking_id uuid, p_reminder_type text) SET search_path = public;
ALTER FUNCTION public.notify_next_in_waitlist(p_slot_id uuid) SET search_path = public;
ALTER FUNCTION public.process_no_shows() SET search_path = public;
ALTER FUNCTION public.promote_waitlist_atomic(p_booking_id uuid) SET search_path = public;
ALTER FUNCTION public.protect_booking_immutable_columns() SET search_path = public;
ALTER FUNCTION public.reorder_waitlist(p_slot_id uuid) SET search_path = public;
ALTER FUNCTION public.request_account_deletion(p_user_id uuid) SET search_path = public;
ALTER FUNCTION public.resolve_plan_for_payment(p_gym_id uuid, p_plan_id uuid) SET search_path = public;
ALTER FUNCTION public.rls_auto_enable() SET search_path = public;
ALTER FUNCTION public.track_consent_changes() SET search_path = public;
ALTER FUNCTION public.update_mollie_vault_token(p_vault_id uuid, p_new_secret text) SET search_path = public;
ALTER FUNCTION public.update_slot_bookings_count() SET search_path = public;
ALTER FUNCTION public.update_timestamp() SET search_path = public;
