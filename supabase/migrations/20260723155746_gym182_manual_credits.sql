-- GYM-182 : crédits offerts manuellement par le gérant (parrainage, geste commercial, compensation).
--
-- DÉCISION PRODUIT : les crédits offerts s'ajoutent normalement au solde (le membre ne voit aucune
-- différence, ils se consomment en FIFO comme les autres) mais SANS ligne de paiement — /revenus ne
-- doit contenir que de l'argent réel. Motif obligatoire, tracé dans un JOURNAL COMPTABLE dédié.
--
-- NE PAS appliquer manuellement : passage par le cockpit (staging → GO → prod).
--
-- ─── Constats schéma (Règle Zéro, base live) ───────────────────────────────────
--   - member_credits : plan_id = TEXT nullable (PAS une FK) → 'manual_grant' est une valeur
--     de plan_id valide. credits_remaining est une colonne GÉNÉRÉE (credits_total - credits_used)
--     → on ne l'écrit JAMAIS ; créditer = credits_total += delta. FK gym_id/member_id ON DELETE CASCADE.
--   - Style « acteur » du schéma (audit_logs.actor_id, gym_admin_actions.admin_id, gym_communications.created_by) :
--     REFERENCES profiles(id) SANS ON DELETE (préserve le journal) → granted_by suit ce pattern.
--   - RLS gym-scoped : USING (gym_id = get_my_gym_id() AND is_gym_admin()), + super_admin (is_super_admin()).

-- ─────────────────────────────────────────────────────────────────────────────
-- a) Journal comptable des ajustements de crédits.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.credit_adjustments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id        uuid NOT NULL REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta         integer NOT NULL,          -- demandé par le gérant (positif = don, négatif = retrait), jamais 0
  applied_delta integer NOT NULL,          -- réellement appliqué après clamp (peut être 0 ou partiel)
  reason        text NOT NULL,             -- motif obligatoire (déjà trimé par la RPC)
  granted_by    uuid NOT NULL REFERENCES public.profiles(id),  -- gym_admin auteur (préservé, pas de cascade)
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT credit_adjustments_delta_not_zero CHECK (delta <> 0)
);

CREATE INDEX idx_credit_adjustments_member ON public.credit_adjustments (member_id, created_at DESC);
CREATE INDEX idx_credit_adjustments_gym    ON public.credit_adjustments (gym_id, created_at DESC);

-- RLS : lecture réservée au gym_admin du gym (+ super_admin). Aucune policy d'écriture :
-- les écritures passent EXCLUSIVEMENT par la RPC SECURITY DEFINER (service_role) ci-dessous.
ALTER TABLE public.credit_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Gym admins voient les ajustements du gym" ON public.credit_adjustments
  FOR SELECT USING ((gym_id = get_my_gym_id()) AND is_gym_admin());

CREATE POLICY "Super admins voient tous les ajustements" ON public.credit_adjustments
  FOR SELECT USING (is_super_admin());

-- Exposition Data API : lecture pour le rôle authenticated (les lignes restent filtrées par RLS).
GRANT SELECT ON public.credit_adjustments TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- b) RPC atomique d'ajustement de crédits offerts.
--    Le retrait ne porte QUE sur la ligne 'manual_grant' : on ne retire JAMAIS des crédits PAYÉS.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_member_credits_atomic(
  p_member_id uuid,
  p_gym_id uuid,
  p_delta integer,
  p_reason text,
  p_granted_by uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_reason      text;
  v_credit_id   uuid;
  v_total       integer;
  v_used        integer;
  v_applied     integer;
  v_new_total   integer;
  v_removable   integer;
  v_adj_id      uuid;
  v_clamped     boolean := false;
BEGIN
  -- 1. Validations d'entrée.
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'INVALID_DELTA';
  END IF;
  v_reason := btrim(COALESCE(p_reason, ''));
  IF v_reason = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;

  -- 2. Le membre appartient bien à ce gym.
  PERFORM 1 FROM profiles WHERE id = p_member_id AND gym_id = p_gym_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_IN_GYM';
  END IF;

  -- 3. LA ligne member_credits 'manual_grant' du membre (la plus ancienne), verrouillée.
  --    Créée si absente. C'est la seule ligne touchée : les crédits payés ne bougent jamais.
  SELECT id, credits_total, credits_used
    INTO v_credit_id, v_total, v_used
  FROM member_credits
  WHERE member_id = p_member_id AND gym_id = p_gym_id AND plan_id = 'manual_grant'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO member_credits (gym_id, member_id, plan_id, credits_total, credits_used)
    VALUES (p_gym_id, p_member_id, 'manual_grant', 0, 0)
    RETURNING id, credits_total, credits_used INTO v_credit_id, v_total, v_used;
  END IF;

  -- 4. Calcul de l'appliqué.
  IF p_delta > 0 THEN
    v_applied := p_delta;  -- don : jamais clampé.
  ELSE
    -- Retrait : CLAMP STRICT — ne jamais descendre credits_total sous credits_used.
    -- Max retirable = crédits offerts encore DISPONIBLES sur cette ligne (total - used).
    v_removable := GREATEST(v_total - v_used, 0);
    v_applied := -LEAST(-p_delta, v_removable);  -- négatif ou 0
    IF v_applied <> p_delta THEN
      v_clamped := true;  -- on n'a pas pu tout retirer (solde offert insuffisant).
    END IF;
  END IF;

  v_new_total := v_total + v_applied;

  -- 5. Application sur la ligne offerte (credits_remaining se recalcule tout seul).
  UPDATE member_credits
  SET credits_total = v_new_total,
      updated_at    = now()
  WHERE id = v_credit_id;

  -- 6. Journal comptable dans la MÊME transaction (le delta demandé ET l'appliqué réel).
  INSERT INTO credit_adjustments (gym_id, member_id, delta, applied_delta, reason, granted_by)
  VALUES (p_gym_id, p_member_id, p_delta, v_applied, v_reason, p_granted_by)
  RETURNING id INTO v_adj_id;

  RETURN jsonb_build_object(
    'requested_delta', p_delta,
    'applied_delta',   v_applied,
    'new_total',       v_new_total,
    'new_used',        v_used,
    'new_remaining',   v_new_total - v_used,
    'adjustment_id',   v_adj_id,
    'clamped',         v_clamped
  );
END;
$$;

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role (edge function).
REVOKE ALL ON FUNCTION public.adjust_member_credits_atomic(uuid, uuid, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_member_credits_atomic(uuid, uuid, integer, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.adjust_member_credits_atomic(uuid, uuid, integer, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_member_credits_atomic(uuid, uuid, integer, text, uuid) TO service_role;
