-- GYM-391 — la boîte de réception accepte deux types de plus :
--   'credits_purchased'      : achat de crédits encaissé (mollie-webhook) ;
--   'session_updated_by_gym' : cours ou série modifié par la salle (slot-series-op).
--
-- Aucun type existant ne les décrit : 'subscription_activated' est réservé à l'ouverture
-- d'un abonnement, 'session_cancelled_by_gym' à une annulation.
--
-- La liste ci-dessous est celle de 20261123100000_gym134_notifications_type_communication.sql,
-- À L'IDENTIQUE, plus ces deux valeurs. Aucune ligne existante n'est touchée : on n'ajoute
-- que des valeurs permises.
--
-- ⚠️ À APPLIQUER AVANT de déployer `mollie-webhook` et `slot-series-op`. Dans l'ordre
-- inverse, les push partent quand même, mais les lignes de ces deux types sont refusées par
-- la contrainte (`_shared/notify.ts` journalise « ligne non écrite » ; ni le paiement ni la
-- modification du cours ne sont affectés).

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
    'credits_purchased'::text, 'session_updated_by_gym'::text
  ])));
