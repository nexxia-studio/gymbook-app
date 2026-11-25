-- GYM-190 — la boîte de réception accepte un type de plus :
--   'subscription_stopped_by_gym' : la salle a arrêté un abonnement récurrent
--                                   (admin-stop-subscription).
--
-- Aucun type existant ne le décrit : 'subscription_expiring' annonce un terme qui approche,
-- 'subscription_payment_failed' un prélèvement refusé.
--
-- La liste ci-dessous est celle de 20261123140000_gym391_notifications_type_credits_purchased.sql,
-- À L'IDENTIQUE, plus cette valeur. Aucune ligne existante n'est touchée : on n'ajoute
-- qu'une valeur permise.
--
-- ⚠️ À APPLIQUER AVANT de déployer `admin-stop-subscription`. Dans l'ordre inverse, le push
-- part quand même, mais la ligne de ce type est refusée par la contrainte
-- (`_shared/notify.ts` journalise « ligne non écrite » ; l'arrêt de l'abonnement n'est pas
-- affecté).

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
    'communication'::text,
    'credits_purchased'::text, 'session_updated_by_gym'::text,
    'subscription_stopped_by_gym'::text
  ])));
