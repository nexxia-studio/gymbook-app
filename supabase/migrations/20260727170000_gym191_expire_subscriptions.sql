-- GYM-191 : expiration automatique des abonnements arrivés à terme.
--
-- PROBLÈME : rien n'a jamais fermé un abonnement.
--   - Un abonnement RÉCURRENT se referme (mal) via le webhook Mollie, qui passe
--     status='completed' à la dernière échéance (isFinal).
--   - Un abonnement PAYÉ EN UNE FOIS (GYM-189) n'a AUCUN webhook futur : Mollie ne
--     rappellera jamais. Rien, nulle part, ne le fermait.
-- Combiné au contrôle d'accès qui ne lisait que status='active' (corrigé dans la
-- migration jumelle gym191_subscription_date_guard), un membre ayant payé 1000 €
-- pour 12 mois conservait un accès illimité À VIE.
--
-- ─── Constats base live (Règle Zéro) ─────────────────────────────────────────
--   - 4 jobs pg_cron en prod (cleanup-oauth-states, expire-waitlist-confirmations,
--     send-booking-reminders, process-no-shows) : AUCUN ne touche member_subscriptions.
--   - Pattern des jobs « SQL pur » : SELECT cron.schedule(nom, planif, $$SELECT fn()$$).
--     Les jobs qui appellent une Edge passent par net.http_post — inutile ici, aucune
--     logique applicative n'est requise. On suit donc le pattern SQL pur.
--   - CHECK des statuts : 'active' | 'suspended' | 'expired' | 'cancelled' | 'paused'
--     | 'completed'. Sémantique retenue :
--       active     → en cours, ouvre les droits
--       paused     → gelé (GYM-190 à venir) : le temps ne court PAS, ne doit pas expirer
--       suspended  → suspendu par la salle (sanction) : décision manuelle, pas au cron
--       expired    → terme atteint (ce que cette fonction pose)
--       cancelled  → résilié avant terme
--       completed  → engagement allé jusqu'au bout (posé par le webhook récurrent)
--   - member_subscriptions est VIDE en prod : premier passage sans effet, risque nul.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) La fonction d'expiration.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS TABLE(
  id        uuid,
  member_id uuid,
  gym_id    uuid,
  plan_name text,
  ends_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE member_subscriptions ms
  SET status     = 'expired',
      updated_at = now()
  WHERE ms.status  = 'active'      -- UNIQUEMENT 'active' : voir garde-fous ci-dessous
    AND ms.ends_at IS NOT NULL     -- sans terme connu → on ne présume rien
    AND ms.ends_at < now()
  RETURNING ms.id, ms.member_id, ms.gym_id, ms.plan_name, ms.ends_at;
$$;

-- GARDE-FOUS (le WHERE ci-dessus est volontairement étroit) :
--   - 'paused' n'est JAMAIS touché : un abonnement gelé (GYM-190) verra son ends_at
--     dépassé pendant la pause, c'est normal — l'expirer annulerait le gel.
--   - 'suspended' / 'cancelled' / 'completed' ne sont jamais réécrits : ce sont des
--     états déjà clôturés ou décidés par un humain, les repasser à 'expired' effacerait
--     l'information la plus précise (pourquoi l'abonnement s'est terminé).
--   - ends_at IS NULL → ignoré (abonnement sans terme, ex. récurrent infini).
--   - IDEMPOTENTE par construction : la ligne passe à 'expired' et ne matche donc plus
--     le WHERE au passage suivant. Deux exécutions concurrentes sont sûres (l'UPDATE
--     verrouille les lignes ; la seconde ne voit plus 'active').

COMMENT ON FUNCTION public.expire_subscriptions() IS
  'GYM-191 — Passe à ''expired'' les abonnements actifs dont le terme est dépassé. '
  'Indispensable depuis GYM-189 : un abonnement payé en une fois n''a aucun webhook Mollie '
  'futur, rien d''autre ne le fermerait. Ne touche jamais paused/suspended/cancelled/completed. '
  'Idempotente. Planifiée toutes les heures (job pg_cron ''expire-subscriptions''). '
  'Retourne les lignes expirées (support d''une future notification d''échéance).';

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role.
-- Le job pg_cron tourne sous le rôle propriétaire (postgres), qui conserve EXECUTE.
REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM anon;
REVOKE ALL ON FUNCTION public.expire_subscriptions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.expire_subscriptions() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- b) Planification horaire (pattern des jobs SQL purs existants).
--
--    Rejouable : on déprogramme d'abord si le job existe déjà, sinon cron.schedule
--    lèverait sur un nom en double.
--    Minute 5 plutôt que 0 : 'cleanup-oauth-states' occupe déjà le haut de l'heure,
--    inutile de faire démarrer les deux au même instant.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.unschedule('expire-subscriptions')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-subscriptions');

SELECT cron.schedule('expire-subscriptions', '5 * * * *', $$SELECT expire_subscriptions()$$);
