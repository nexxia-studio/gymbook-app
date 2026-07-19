-- GYM-112 : remboursements Mollie (total / partiel / chargeback).
-- Le gérant rembourse un paiement carte depuis /revenus. Le remboursement part du solde
-- Mollie du gym ; les crédits NON CONSOMMÉS sont retirés ; le paiement change de statut.
-- La VÉRITÉ arrive par le webhook Mollie (amountRefunded cumulé) — jamais par l'UI.
--
-- NE PAS appliquer manuellement : passage par le cockpit (staging → GO → prod).
--
-- Constats schéma (Règle Zéro) :
--   - payments : status CHECK ('pending','paid','failed','expired','canceled') ; colonnes
--     amount numeric(10,2), credits_granted integer, member_id, gym_id, plan_id (text).
--     AUCUNE colonne de remboursement n'existe → on ajoute refunded_amount + refunded_at.
--   - member_credits : credits_total / credits_used (PAS "credits_granted" — cette colonne
--     est sur payments) ; credits_remaining est GÉNÉRÉE (total - used). Il n'y a PAS de FK
--     payment→crédits : apply_paid_payment rattache les crédits par (member_id, gym_id,
--     plan_id) et incrémente credits_total de payments.credits_granted. Le retrait suit le
--     même lien, en sens inverse.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) Étendre le CHECK de statut (recréation propre).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_status_check CHECK (status = ANY (ARRAY[
    'pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'canceled'::text,
    'refunded'::text, 'partially_refunded'::text, 'charged_back'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- b) Colonnes de remboursement (cumul + horodatage du dernier refund).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(10,2) NOT NULL DEFAULT 0;
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS refunded_at timestamp with time zone;

-- ─────────────────────────────────────────────────────────────────────────────
-- c) RPC atomique de remboursement (moule apply_paid_payment).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_refund_atomic(
  p_payment_id uuid,
  p_refunded_amount numeric,
  p_is_chargeback boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment      payments%ROWTYPE;
  v_prev_status  text;
  v_new_status   text;
  v_delta_amount numeric;
  v_to_revoke    integer;
  v_credit       member_credits%ROWTYPE;
  v_new_total    integer;
  v_revoked      integer := 0;
BEGIN
  -- Verrou sur la ligne paiement → sérialise les retries concurrents du webhook.
  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  v_prev_status := v_payment.status;

  -- IDEMPOTENCE : le webhook Mollie renvoie le CUMUL amountRefunded (pas le delta).
  -- Un cumul <= à celui déjà enregistré = retry → aucune action, aucun double-retrait.
  IF p_refunded_amount <= v_payment.refunded_amount THEN
    RETURN jsonb_build_object(
      'status', 'already_applied',
      'credits_revoked', 0,
      'previous_status', v_prev_status
    );
  END IF;

  -- Delta réellement remboursé sur CE call — base du retrait de crédits au prorata.
  -- (Gère les remboursements partiels successifs sans double-compter.)
  v_delta_amount := p_refunded_amount - v_payment.refunded_amount;

  -- Nouveau statut : le chargeback prime ; sinon total (cumul >= montant) vs partiel.
  IF p_is_chargeback THEN
    v_new_status := 'charged_back';
  ELSIF p_refunded_amount >= v_payment.amount THEN
    v_new_status := 'refunded';
  ELSE
    v_new_status := 'partially_refunded';
  END IF;

  UPDATE payments
  SET refunded_amount = p_refunded_amount,
      refunded_at     = now(),
      status          = v_new_status,
      updated_at      = now()
  WHERE id = p_payment_id;

  -- RETRAIT DES CRÉDITS (symétrie inverse d'apply_paid_payment, qui avait crédité
  -- credits_total de payments.credits_granted sur la ligne (member_id, gym_id, plan_id)).
  -- Prorata : ROUND(delta / montant * credits_granted) crédits pour ce delta remboursé.
  -- CLAMP : credits_total ne descend JAMAIS sous credits_used → un membre ayant déjà
  -- consommé des séances ne passe pas en négatif (le solde restant tombe au plus à 0,
  -- l'historique consommé reste vrai). credits_revoked = ce qui est RÉELLEMENT retiré.
  IF COALESCE(v_payment.credits_granted, 0) > 0 AND v_payment.amount > 0 THEN
    v_to_revoke := ROUND(v_delta_amount / v_payment.amount * v_payment.credits_granted);

    IF v_to_revoke > 0 THEN
      SELECT * INTO v_credit
      FROM member_credits
      WHERE member_id = v_payment.member_id
        AND gym_id    = v_payment.gym_id
        AND plan_id   = v_payment.plan_id
      FOR UPDATE;

      IF FOUND THEN
        v_new_total := GREATEST(v_credit.credits_used, v_credit.credits_total - v_to_revoke);
        v_revoked   := v_credit.credits_total - v_new_total;
        IF v_revoked > 0 THEN
          UPDATE member_credits
          SET credits_total = v_new_total,
              updated_at    = now()
          WHERE id = v_credit.id;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'status', v_new_status,
    'credits_revoked', v_revoked,
    'previous_status', v_prev_status
  );
END;
$$;

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role (webhook).
REVOKE ALL ON FUNCTION public.apply_refund_atomic(uuid, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_refund_atomic(uuid, numeric, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.apply_refund_atomic(uuid, numeric, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_refund_atomic(uuid, numeric, boolean) TO service_role;
