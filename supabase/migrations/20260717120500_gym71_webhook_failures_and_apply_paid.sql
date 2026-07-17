-- GYM-71 : observabilité + atomicité des webhooks Mollie.
-- Deux objets :
--   1a. Table dead-letter `webhook_failures` (échecs de traitement non silencieux).
--   1b. RPC `apply_paid_payment` : passage à 'paid' + crédits dans UNE transaction
--       (remplace la séquence update-status-puis-crédits non atomique côté TS).
-- NE PAS appliquer manuellement : passage par le cockpit (staging → GO → prod).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1a. Dead-letter table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.webhook_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    function_name text NOT NULL,            -- 'mollie-webhook' | 'mollie-subscription-webhook'
    mollie_id text,                         -- payment/subscription id Mollie
    payment_id uuid,                        -- FK payments.id si connue
    gym_id uuid,
    stage text NOT NULL,                    -- 'payment_lookup' | 'token' | 'mollie_fetch'
                                            -- | 'apply_paid' | 'subscription_create' | 'uncaught' | ...
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,   -- NULL = à traiter
    CONSTRAINT webhook_failures_pkey PRIMARY KEY (id),
    CONSTRAINT webhook_failures_payment_id_fkey FOREIGN KEY (payment_id)
        REFERENCES public.payments(id) ON DELETE SET NULL
);

CREATE INDEX webhook_failures_function_created_idx
    ON public.webhook_failures (function_name, created_at DESC);

-- Index partiel : file d'attente des échecs non résolus.
CREATE INDEX webhook_failures_unresolved_idx
    ON public.webhook_failures (created_at DESC)
    WHERE resolved_at IS NULL;

-- RLS activée SANS policy → accès service_role uniquement (pattern maison,
-- cf. audit_logs). Les edge functions écrivent via SERVICE_ROLE_KEY (bypass RLS).
ALTER TABLE public.webhook_failures ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. RPC atomique : passage à 'paid' + attribution des crédits
-- ─────────────────────────────────────────────────────────────────────────────
-- Symétrie : ne traite QUE le passage à 'paid'. Les statuts failed/expired/
-- canceled/pending restent gérés côté TS (simple update de statut, pas de crédits).
CREATE OR REPLACE FUNCTION public.apply_paid_payment(
    p_payment_id uuid,
    p_payment_method text,
    p_paid_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_payment   payments%ROWTYPE;
    v_credit_id uuid;
BEGIN
    -- Verrou sur la ligne paiement → sérialise les retries concurrents du webhook.
    SELECT * INTO v_payment
    FROM payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'not_found';
    END IF;

    -- Idempotence : un retry Mollie sur un paiement déjà appliqué ne re-crédite pas.
    IF v_payment.status = 'paid' THEN
        RETURN 'already_applied';
    END IF;

    UPDATE payments
    SET status = 'paid',
        payment_method = p_payment_method,
        paid_at = p_paid_at,
        updated_at = now()
    WHERE id = p_payment_id;

    -- Upsert crédits — même logique que le code TS actuel :
    -- ligne (member_id, gym_id, plan_id) existe → += credits_granted, sinon INSERT.
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

    RETURN 'applied';
END;
$$;

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role.
REVOKE ALL ON FUNCTION public.apply_paid_payment(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_paid_payment(uuid, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.apply_paid_payment(uuid, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_paid_payment(uuid, text, timestamptz) TO service_role;
