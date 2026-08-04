-- ─────────────────────────────────────────────────────────────────────────────
-- GYM-210 — Un remboursement PARTIEL conserve les crédits ; un remboursement
--           TOTAL (ou un chargeback) les retire.
--
-- DÉCISION PRODUIT (Antoine, 04/08) : « Un remboursement partiel, c'est un geste
-- commercial. Il n'y a aucun intérêt à rembourser 8 € tout en retirant la séance —
-- ça punirait le membre. Si on rembourse l'entièreté, alors on retire le crédit. »
--
-- CE QUI CHANGE — uniquement le calcul de `v_to_revoke`. L'ancien prorata
--     v_to_revoke := ROUND(v_delta_amount / v_payment.amount * v_payment.credits_granted);
-- n'était pas une règle mais un arrondi. Sur une carte 10 séances il a du sens ; sur un
-- achat à 1 crédit il crée un seuil arbitraire à 50 % du montant :
--     8 €  sur 20 € → ROUND(0,4) = 0 crédit retiré
--     10 € sur 20 € → ROUND(0,5) = 1 crédit retiré
--     12 € sur 20 € → ROUND(0,6) = 1 crédit retiré
-- Un geste commercial de 12 € coûtait sa séance au membre.
--
-- ⚠️ LA RÈGLE PORTE SUR LE STATUT FINAL, PAS SUR LE DELTA. C'est ce qui couvre le cas
-- des remboursements successifs : deux partiels de 10 € sur un paiement de 20 € ne
-- retirent rien au premier passage ('partially_refunded'), puis le second bascule en
-- 'refunded' et retire la TOTALITÉ de credits_granted — y compris les crédits
-- « épargnés » par le premier. On ne raisonne jamais en incréments, et le montant
-- reçu de Mollie (amountRefunded) est déjà un CUMUL, pas un delta.
--
-- ⚠️ CHARGEBACK : p_is_chargeback force le statut 'charged_back'. Le membre a été
-- remboursé de force par sa banque → traité comme un remboursement TOTAL, quel que
-- soit le montant rétrofacturé. Cohérent avec GYM-193, où un chargeback consomme le
-- droit à une offre limitée.
--
-- INCHANGÉ (reproduction fidèle de la définition live, md5 80ff45bf… identique en
-- production et en staging au 04/08) :
--   · le verrou FOR UPDATE sur le paiement ET sur la ligne de crédits ;
--   · l'idempotence p_refunded_amount <= refunded_amount → 'already_applied'
--     (le webhook Mollie rejoue ses appels) ;
--   · le clamp GREATEST(credits_used, …) — on ne retire JAMAIS un crédit déjà
--     consommé par une réservation ;
--   · le calcul du statut ('refunded' si >= amount, sinon 'partially_refunded') ;
--   · la forme du retour jsonb (status, credits_revoked, previous_status).
--
-- v_delta_amount reste calculé : il ne sert plus à la révocation, mais il documente
-- l'incrément traité et son retrait sortirait du périmètre de ce correctif.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_refund_atomic(
  p_payment_id uuid,
  p_refunded_amount numeric,
  p_is_chargeback boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  v_prev_status := v_payment.status;

  IF p_refunded_amount <= v_payment.refunded_amount THEN
    RETURN jsonb_build_object(
      'status', 'already_applied',
      'credits_revoked', 0,
      'previous_status', v_prev_status
    );
  END IF;

  v_delta_amount := p_refunded_amount - v_payment.refunded_amount;

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

  IF COALESCE(v_payment.credits_granted, 0) > 0 AND v_payment.amount > 0 THEN
    -- GYM-210 — SEUL BLOC MODIFIÉ. Règle métier binaire, plus de prorata : on lit le
    -- STATUT FINAL, jamais le delta. Un remboursement total ou un chargeback reprend
    -- l'intégralité de credits_granted (c'est-à-dire les crédits accordés PAR CE
    -- PAIEMENT, pas le solde du membre) ; un partiel n'en reprend aucun.
    IF v_new_status IN ('refunded', 'charged_back') THEN
      v_to_revoke := v_payment.credits_granted;
    ELSE
      v_to_revoke := 0;
    END IF;

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
$function$;

-- Droits identiques à la migration d'origine (GYM-112). CREATE OR REPLACE conserve
-- l'ACL existante ; on les réaffirme pour que la migration soit autoportante.
REVOKE ALL ON FUNCTION public.apply_refund_atomic(uuid, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_refund_atomic(uuid, numeric, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.apply_refund_atomic(uuid, numeric, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_refund_atomic(uuid, numeric, boolean) TO service_role;
