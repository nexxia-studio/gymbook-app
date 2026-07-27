-- GYM-189 : un abonnement peut être payé EN UNE FOIS.
--
-- GYM-188 a rendu créable le plan « Illimité 12 mois — paiement unique »
-- (type='unlimited' + billing_type='one_time'), mais il restait INVENDABLE :
-- apply_paid_payment ne sait que créditer des séances dans member_credits et ne
-- référence jamais member_subscriptions.
--
-- ─── LE BON DISCRIMINANT ─────────────────────────────────────────────────────
-- Ce n'est PAS le mode de paiement (billing_type) qui décide de la contrepartie,
-- c'est la NATURE du plan (gym_plans.type) :
--     type='credits'   → l'achat crédite des séances       (member_credits)
--     type='unlimited' → l'achat ouvre un ABONNEMENT       (member_subscriptions)
-- …que le paiement soit unique ou récurrent.
--
-- ─── Constats base live (Règle Zéro) ─────────────────────────────────────────
--   - apply_paid_payment / resolve_plan_for_payment en base sont IDENTIQUES au repo
--     (aucun drift constaté avant réécriture).
--   - ⚠️ payments.plan_id est un TEXT NOT NULL (pas une FK), il peut contenir des codes
--     legacy ('drop_in', 'pack_10'). member_subscriptions.plan_id est un uuid FK.
--     → on rapproche par gp.id::text = v_payment.plan_id : jamais de cast text→uuid,
--       donc aucun risque d'exception sur un plan_id legacy (simple absence de match).
--   - member_subscriptions n'a AUCUN lien vers payments → il faut une clé d'idempotence
--     explicite pour que le rejeu du webhook Mollie ne crée pas deux abonnements (a).
--   - ACL des deux fonctions : EXECUTE réservé à service_role. Un DROP FUNCTION efface
--     les GRANTs → ils sont réémis explicitement plus bas.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) Clé d'idempotence : quel paiement a ouvert quel abonnement.
--
--    L'index UNIQUE est la garantie DURE : même si deux exécutions concurrentes du
--    webhook franchissaient le verrou applicatif, la seconde INSERT échouerait.
--    Partiel (WHERE ... IS NOT NULL) pour ne pas contraindre les abonnements
--    récurrents existants, qui n'ont pas de paiement d'origine unique.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.member_subscriptions
  ADD COLUMN IF NOT EXISTS source_payment_id uuid REFERENCES public.payments(id);

COMMENT ON COLUMN public.member_subscriptions.source_payment_id IS
  'GYM-189 — paiement unique ayant ouvert cet abonnement (NULL pour un abonnement récurrent Mollie). Clé d''idempotence du rejeu webhook.';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_member_subscriptions_source_payment
  ON public.member_subscriptions (source_payment_id)
  WHERE source_payment_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- b) resolve_plan_for_payment : exposer gym_plans.type.
--
--    ⚠️ Ajouter une colonne au RETURNS TABLE impose un DROP + CREATE (on ne peut pas
--    changer le type de retour d'une fonction par CREATE OR REPLACE).
--    TOUT le reste est conservé À L'IDENTIQUE, is_one_time compris : d'autres appelants
--    s'en servent (create-payment, create-subscription, admin-create-member,
--    mollie-subscription-webhook). Les appelants TS lisent des champs nommés → l'ajout
--    est rétro-compatible pour eux.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.resolve_plan_for_payment(uuid, uuid);

CREATE FUNCTION public.resolve_plan_for_payment(p_gym_id uuid, p_plan_id uuid)
RETURNS TABLE(
  plan_id uuid, gym_id uuid, name text, billing_type text, is_one_time boolean,
  price_cents integer, currency text, credit_count integer, duration_months integer,
  plan_type text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select gp.id, gp.gym_id, gp.name, gp.billing_type, (gp.billing_type='one_time'),
         gp.price_cents, coalesce(gp.currency,'EUR'), gp.credit_count, gp.duration_months,
         gp.type
  from public.gym_plans gp
  where gp.id=p_plan_id and gp.gym_id=p_gym_id and gp.active=true;
$$;

REVOKE ALL ON FUNCTION public.resolve_plan_for_payment(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_plan_for_payment(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_plan_for_payment(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_plan_for_payment(uuid, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- c) apply_paid_payment : créditer des séances OU ouvrir un abonnement.
--
--    Retour élargi de text à jsonb (donc DROP + CREATE) pour dire ce qui a été
--    RÉELLEMENT délivré — le webhook en a besoin pour ne pas annoncer « N séances
--    ajoutées » à qui vient d'acheter un abonnement.
--    La clé `result` conserve EXACTEMENT les valeurs de l'ancien retour texte
--    ('not_found' | 'already_applied' | 'applied') : les appelants ne changent que
--    d'accès (result->>'result'), pas de logique.
--
--    NON-RÉGRESSION : le chemin 'credits' est le DÉFAUT. On ne bascule sur l'abonnement
--    que si le plan est retrouvé dans gym_plans ET porte type='unlimited'. Un plan_id
--    legacy (non-UUID, absent de gym_plans) retombe donc sur le comportement actuel,
--    à l'octet près — c'est le chemin de toutes les ventes existantes.
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.apply_paid_payment(uuid, text, timestamptz);

CREATE FUNCTION public.apply_paid_payment(
    p_payment_id uuid,
    p_payment_method text,
    p_paid_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_payment   payments%ROWTYPE;
    v_credit_id uuid;
    v_plan      gym_plans%ROWTYPE;
    v_sub_id    uuid;
    v_starts_at timestamptz;
    v_ends_at   timestamptz;
BEGIN
    -- Verrou sur la ligne paiement → sérialise les retries concurrents du webhook.
    SELECT * INTO v_payment
    FROM payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('result', 'not_found');
    END IF;

    -- Idempotence de 1er niveau : un retry Mollie sur un paiement déjà appliqué ne
    -- re-crédite rien et ne ré-ouvre aucun abonnement.
    IF v_payment.status = 'paid' THEN
        RETURN jsonb_build_object(
            'result', 'already_applied',
            'subscription_id', (SELECT id FROM member_subscriptions
                                WHERE source_payment_id = v_payment.id)
        );
    END IF;

    UPDATE payments
    SET status = 'paid',
        payment_method = p_payment_method,
        paid_at = p_paid_at,
        updated_at = now()
    WHERE id = p_payment_id;

    -- Nature de la contrepartie. Rapprochement par TEXTE (cf. en-tête) : un plan_id
    -- legacy ne matche simplement pas et laisse v_plan NULL → chemin crédits.
    SELECT gp.* INTO v_plan
    FROM gym_plans gp
    WHERE gp.id::text = v_payment.plan_id
      AND gp.gym_id   = v_payment.gym_id;

    -- ── Cas ABONNEMENT (type='unlimited', paiement unique ou récurrent) ──────────
    IF FOUND AND v_plan.type = 'unlimited' THEN

        -- Idempotence de 2e niveau, explicite : cet abonnement a-t-il déjà été ouvert
        -- par CE paiement ? (filet si le statut avait été posé 'paid' par un autre chemin)
        SELECT id INTO v_sub_id
        FROM member_subscriptions
        WHERE source_payment_id = v_payment.id;

        IF v_sub_id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'result', 'applied',
                'delivered', 'subscription',
                'subscription_id', v_sub_id,
                'subscription_created', false
            );
        END IF;

        v_starts_at := COALESCE(p_paid_at, now());
        -- Durée de l'engagement. duration_months est NOT NULL pour un type='unlimited'
        -- (contrainte gym_plans_check) ; COALESCE = ceinture et bretelles.
        v_ends_at   := v_starts_at + make_interval(months => COALESCE(v_plan.duration_months, 1));

        -- Forme reprise TELLE QUELLE de mollie-subscription-webhook (seule écriture
        -- existante de member_subscriptions) : mêmes colonnes, même statut initial.
        -- Différences assumées, propres au paiement unique :
        --   mollie_subscription_id / mollie_customer_id / next_payment_at = NULL
        --     (aucun mandat récurrent chez Mollie),
        --   auto_renew = false et payments_count = max_payments
        --     (l'engagement est intégralement payé : plus aucune échéance à venir).
        INSERT INTO member_subscriptions (
            gym_id, member_id, plan_id, plan_name, status,
            amount, starts_at, ends_at,
            max_payments, payments_count, auto_renew,
            source_payment_id
        ) VALUES (
            v_payment.gym_id, v_payment.member_id, v_plan.id, v_plan.name, 'active',
            v_payment.amount, v_starts_at, v_ends_at,
            1, 1, false,
            v_payment.id
        )
        RETURNING id INTO v_sub_id;

        RETURN jsonb_build_object(
            'result', 'applied',
            'delivered', 'subscription',
            'subscription_id', v_sub_id,
            'subscription_created', true,
            'ends_at', v_ends_at
        );
    END IF;

    -- ── Cas CRÉDITS (comportement historique, STRICTEMENT inchangé) ──────────────
    -- Upsert crédits : ligne (member_id, gym_id, plan_id) existe → += credits_granted,
    -- sinon INSERT.
    SELECT id INTO v_credit_id
    FROM member_credits
    WHERE member_id = v_payment.member_id
      AND gym_id = v_payment.gym_id
      AND plan_id = v_payment.plan_id
    FOR UPDATE;

    IF v_credit_id IS NOT NULL THEN
        UPDATE member_credits
        SET credits_total = credits_total + COALESCE(v_payment.credits_granted, 0),
            updated_at = now()
        WHERE id = v_credit_id;
    ELSE
        INSERT INTO member_credits (gym_id, member_id, plan_id, credits_total, credits_used)
        VALUES (v_payment.gym_id, v_payment.member_id, v_payment.plan_id,
                COALESCE(v_payment.credits_granted, 0), 0);
    END IF;

    RETURN jsonb_build_object(
        'result', 'applied',
        'delivered', 'credits',
        'credits_granted', COALESCE(v_payment.credits_granted, 0)
    );
END;
$$;

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role.
REVOKE ALL ON FUNCTION public.apply_paid_payment(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_paid_payment(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.apply_paid_payment(uuid, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paid_payment(uuid, text, timestamptz) TO service_role;
