-- GYM-391 — la boîte de réception accepte le type 'credits_purchased' (achat de crédits).
--
-- `mollie-webhook` écrit désormais une ligne dans `public.notifications` quand un achat de
-- séances est encaissé. Aucun type existant ne le décrit : 'subscription_activated' est
-- réservé à l'ouverture d'un abonnement.
--
-- La liste ci-dessous est celle de 20261123100000_gym134_notifications_type_communication.sql,
-- À L'IDENTIQUE, plus 'credits_purchased'. Aucune ligne existante n'est touchée : on
-- n'ajoute qu'une valeur permise.
--
-- ⚠️ À APPLIQUER AVANT de déployer `mollie-webhook`. Dans l'ordre inverse, le push part
-- quand même, mais la ligne de l'achat est refusée par la contrainte (`_shared/notify.ts`
-- journalise « ligne non écrite » ; le paiement, lui, n'est pas affecté).

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
    'credits_purchased'::text
  ])));
