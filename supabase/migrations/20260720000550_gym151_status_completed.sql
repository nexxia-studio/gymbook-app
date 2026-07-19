-- GYM-151 (volet 1) : ajout du statut 'completed' à member_subscriptions.
--
-- Migration INERTE : elle étend seulement le CHECK de statut. AUCUNE ligne ne reçoit
-- 'completed' pour l'instant — la logique applicative qui posera ce statut viendra au
-- volet 2 (build 13).
--
-- Usage futur : distinguer un abonnement arrivé naturellement à terme (engagement honoré
-- jusqu'au bout, 'completed') d'une résiliation anticipée ('cancelled') ou d'une expiration
-- subie ('expired'). Valeur ANALYTIQUE : mesurer le churn réel (cancelled) sans le polluer
-- avec les fins de contrat normales (completed).
--
-- Constat schéma (Règle Zéro) : contrainte réelle du baseline =
--   member_subscriptions_status_check CHECK (status IN
--     ('active','suspended','expired','cancelled','paused'))
-- On la recrée à l'identique + 'completed'.
--
-- NE PAS appliquer manuellement : passage par le cockpit (staging → GO → prod).

ALTER TABLE public.member_subscriptions
  DROP CONSTRAINT IF EXISTS member_subscriptions_status_check;

ALTER TABLE public.member_subscriptions
  ADD CONSTRAINT member_subscriptions_status_check CHECK (status = ANY (ARRAY[
    'active'::text,
    'suspended'::text,
    'expired'::text,
    'cancelled'::text,
    'paused'::text,
    'completed'::text
  ]));
