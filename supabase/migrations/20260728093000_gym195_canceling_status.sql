-- GYM-195 : ajout du statut 'canceling' à member_subscriptions.
--
-- PROBLÈME — un « 200 menteur » réintroduit par un désaccord code ↔ schéma :
-- cancel-subscription écrit status='canceling', valeur ABSENTE du CHECK. L'UPDATE échoue
-- donc systématiquement, et comme son résultat n'était pas vérifié, l'échec passait
-- inaperçu : Mollie annulait réellement le mandat SEPA, la base restait 'active', la
-- fonction répondait ok:true et le membre recevait « Résiliation confirmée ».
-- C'est exactement ce que GYM-113 avait éliminé, revenu par une autre porte.
--
-- ─── DÉCISION (cockpit) : ON ALIGNE LE SCHÉMA SUR LE CODE ────────────────────
-- 'canceling' n'est pas une coquille : il porte une sémantique métier réelle, celle du
-- modèle d'engagement ferme GYM-113. Cinq endroits du code le supposent déjà
-- (_shared/subscription-engagement, delete-account, lib/subscription mobile, l'écran
-- abonnement, cancel-subscription). C'est le CHECK qui est en retard.
--
--   'canceling' → RÉSILIATION DEMANDÉE, ACCÈS MAINTENU JUSQU'AU TERME.
--                 Le mandat Mollie est annulé (plus aucun prélèvement à venir) mais
--                 l'engagement déjà payé court jusqu'à ends_at : le membre garde ses
--                 droits. C'est un état TRANSITOIRE et ENCORE ACTIF.
--   'cancelled' → RÉSILIATION EFFECTIVE, plus aucun droit. État TERMINAL.
--
-- Les confondre reviendrait soit à couper l'accès d'un membre qui a payé jusqu'au terme,
-- soit à laisser des droits ouverts après la fin réelle du contrat.
--
-- ─── Constats base live (Règle Zéro) ─────────────────────────────────────────
--   - Nom RÉEL de la contrainte : member_subscriptions_status_check.
--   - Liste RÉELLE avant migration :
--       'active' | 'suspended' | 'expired' | 'cancelled' | 'paused' | 'completed'
--   - member_subscriptions est VIDE en prod (0 ligne, tous statuts confondus).
--     Aucune ligne ne peut donc être invalidée — et de toute façon le CHECK ne fait
--     que S'ÉLARGIR (sur-ensemble strict, aucune valeur retirée) : une migration
--     élargissante ne peut par construction invalider aucune ligne existante.

ALTER TABLE public.member_subscriptions
  DROP CONSTRAINT IF EXISTS member_subscriptions_status_check;

ALTER TABLE public.member_subscriptions
  ADD CONSTRAINT member_subscriptions_status_check CHECK (status = ANY (ARRAY[
    'active'::text,
    'suspended'::text,
    'expired'::text,
    'cancelled'::text,
    'paused'::text,
    'completed'::text,
    'canceling'::text
  ]));

COMMENT ON COLUMN public.member_subscriptions.status IS
  'Cycle de vie de l''abonnement. active = en cours ; canceling = résiliation demandée, '
  'mandat Mollie annulé mais accès maintenu jusqu''à ends_at (engagement ferme GYM-113) — '
  'état transitoire ENCORE ACTIF, à ne pas confondre avec cancelled ; cancelled = résiliation '
  'effective (terminal) ; expired = terme dépassé (posé par le cron expire_subscriptions, '
  'GYM-191) ; completed = engagement honoré jusqu''au bout ; paused = gelé ; suspended = '
  'suspendu par la salle.';
