-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521204420 : gym35_gym_communications
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- ============================================================
-- GYM-35 — Communications gérant → membres
-- Table d'historique + fonction de segmentation
-- UI dashboard + Edge Function : Claude Code (phase 2)
-- ============================================================

-- ÉTAPE 1 : Table principale des communications
CREATE TABLE IF NOT EXISTS gym_communications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gym_id       uuid NOT NULL REFERENCES nexxia_gyms(id) ON DELETE CASCADE,
  created_by   uuid NOT NULL REFERENCES profiles(id),

  -- Contenu
  title        text NOT NULL,
  body         text NOT NULL,
  template     text NOT NULL DEFAULT 'custom'
               CHECK (template IN ('info', 'closure', 'promo', 'cancellation', 'custom')),

  -- Ciblage
  segment      text NOT NULL DEFAULT 'all'
               CHECK (segment IN ('all', 'subscribers', 'drop_in', 'present_today')),

  -- Canaux
  send_push    boolean NOT NULL DEFAULT true,
  send_email   boolean NOT NULL DEFAULT false,

  -- Statut
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  sent_at      timestamptz,
  recipient_count integer DEFAULT 0,

  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- ÉTAPE 2 : Table des destinataires (pour l'historique par membre)
CREATE TABLE IF NOT EXISTS gym_communication_recipients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  communication_id uuid NOT NULL REFERENCES gym_communications(id) ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES profiles(id),
  push_sent        boolean DEFAULT false,
  email_sent       boolean DEFAULT false,
  sent_at          timestamptz DEFAULT now()
);

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_gym_communications_gym_id
  ON gym_communications(gym_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gym_communication_recipients_comm
  ON gym_communication_recipients(communication_id);

-- ÉTAPE 3 : RLS
ALTER TABLE gym_communications ENABLE ROW LEVEL SECURITY;
ALTER TABLE gym_communication_recipients ENABLE ROW LEVEL SECURITY;

-- Gérant : voit et gère les communications de son gym
CREATE POLICY "Gérant gère ses communications" ON gym_communications
  FOR ALL USING (gym_id = get_my_gym_id() AND is_gym_admin())
  WITH CHECK (gym_id = get_my_gym_id() AND is_gym_admin());

-- Super admin : voit tout
CREATE POLICY "Super admin voit tout" ON gym_communications
  FOR ALL USING (is_super_admin());

-- Recipients : service_role uniquement (Edge Function)
CREATE POLICY "Service role uniquement" ON gym_communication_recipients
  AS RESTRICTIVE FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ÉTAPE 4 : Fonction de segmentation
-- Retourne les membres à notifier selon le segment choisi
CREATE OR REPLACE FUNCTION get_communication_recipients(
  p_gym_id  uuid,
  p_segment text DEFAULT 'all'
)
RETURNS TABLE(
  member_id   uuid,
  first_name  text,
  email       text,
  push_token  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    p.id,
    p.first_name,
    p.email,
    p.push_token
  FROM profiles p
  WHERE p.gym_id     = p_gym_id
    AND p.role       = 'member'
    AND p.deleted_at IS NULL
    AND (p.suspended_until IS NULL OR p.suspended_until < NOW())
    -- Respecter les préférences de notification
    AND (
      p.notification_preferences IS NULL
      OR (p.notification_preferences->>'communications')::boolean IS NOT FALSE
    )
    -- Filtrage par segment
    AND CASE p_segment
      WHEN 'all' THEN true

      WHEN 'subscribers' THEN EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id
          AND ms.gym_id    = p_gym_id
          AND ms.status    = 'active'
      )

      WHEN 'drop_in' THEN NOT EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id
          AND ms.gym_id    = p_gym_id
          AND ms.status    = 'active'
      )

      WHEN 'present_today' THEN EXISTS (
        SELECT 1 FROM bookings b
        JOIN time_slots s ON s.id = b.slot_id
        WHERE b.member_id = p.id
          AND b.gym_id    = p_gym_id
          AND b.status    = 'confirmed'
          AND s.starts_at::date = CURRENT_DATE
      )

      ELSE true
    END;
END;
$$;

COMMENT ON FUNCTION get_communication_recipients(uuid, text) IS
  'GYM-35 — Retourne les membres à notifier pour une communication gérant.
   Segments : all / subscribers / drop_in / present_today.
   Respecte les préférences de notification et exclut les suspendus.';

-- ÉTAPE 5 : Templates prédéfinis (pour l''UI dashboard)
COMMENT ON COLUMN gym_communications.template IS
  'Templates : info (annonce générale), closure (fermeture exceptionnelle),
   promo (promotion), cancellation (annulation cours), custom (message libre)';

COMMENT ON COLUMN gym_communications.segment IS
  'Ciblage : all (tous), subscribers (abonnés actifs),
   drop_in (sans abonnement), present_today (présents aujourd''hui)';

