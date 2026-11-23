-- GYM-134 (Communications v1) — la boîte de réception in-app accepte le type 'communication'.
--
-- `public.notifications.type` est borné par `notifications_type_check`, et la liste ne
-- contenait aucun type pour un message du gérant : l'insertion faite par `send-communication`
-- (une ligne par destinataire) aurait été refusée par la contrainte.
--
-- La liste ci-dessous est celle de la base de référence (00000000000000_baseline_prod.sql),
-- À L'IDENTIQUE, plus 'communication'. Aucune ligne existante n'est touchée : on n'ajoute
-- qu'une valeur permise.
--
-- ⚠️ À APPLIQUER AVANT de déployer `send-communication`. Dans l'ordre inverse, les push
-- partent quand même, mais aucune ligne n'est écrite dans la boîte de réception (la
-- fonction journalise l'échec et le signale dans sa réponse : `inbox_written = 0`).

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY[
    'booking_confirmed'::text, 'booking_cancelled'::text, 'booking_reminder'::text,
    'waitlist_promoted'::text, 'session_cancelled_by_gym'::text,
    'no_show_warning_1'::text, 'no_show_warning_2'::text, 'no_show_suspension'::text,
    'subscription_expiring'::text, 'subscription_renewed'::text,
    'subscription_payment_failed'::text, 'subscription_activated'::text,
    'profile_completion_reward'::text, 'medical_certificate_expiring'::text,
    'security_new_login'::text, 'security_password_changed'::text,
    'site_new_available'::text, 'plan_upgraded'::text, 'trial_ending'::text,
    'communication'::text
  ])));
