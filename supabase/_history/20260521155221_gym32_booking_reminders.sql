-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521155221 : gym32_booking_reminders
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- ============================================================
-- GYM-32 — Rappels automatiques avant cours
-- Règles : 24h avant → email + push / 2h avant → push uniquement
-- Idempotence : colonnes reminder_24h_sent_at / reminder_2h_sent_at
-- pg_cron toutes les 15 minutes
-- Phase 2 (Claude Code) : Edge Function send-reminders pour email + push
-- ============================================================

-- ÉTAPE 1 : Colonnes de tracking sur bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reminder_2h_sent_at  timestamptz DEFAULT NULL;

COMMENT ON COLUMN bookings.reminder_24h_sent_at IS
  'GYM-32 — Timestamp d''envoi du rappel 24h avant le cours. NULL = pas encore envoyé.';
COMMENT ON COLUMN bookings.reminder_2h_sent_at IS
  'GYM-32 — Timestamp d''envoi du rappel 2h avant le cours. NULL = pas encore envoyé.';

-- Index pour optimiser la requête du cron
CREATE INDEX IF NOT EXISTS idx_bookings_reminders
  ON bookings (status, reminder_24h_sent_at, reminder_2h_sent_at)
  WHERE status = 'confirmed';

-- ============================================================
-- ÉTAPE 2 : Fonction qui détecte les bookings à rappeler
-- Retourne la liste pour que l'Edge Function envoie les notifs
-- ============================================================

CREATE OR REPLACE FUNCTION get_pending_reminders()
RETURNS TABLE(
  booking_id        uuid,
  member_id         uuid,
  gym_id            uuid,
  slot_id           uuid,
  slot_starts_at    timestamptz,
  activity_name     text,
  coach_name        text,
  member_email      text,
  member_first_name text,
  push_token        text,
  reminder_type     text   -- '24h' ou '2h'
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ── Rappels 24h ──────────────────────────────────────────
  -- Fenêtre : cours qui commence entre 23h30 et 24h30 de maintenant
  -- Condition : rappel 24h pas encore envoyé
  RETURN QUERY
  SELECT
    b.id,
    b.member_id,
    b.gym_id,
    b.slot_id,
    s.starts_at,
    a.name::text,
    COALESCE(c.name, '')::text,
    p.email,
    p.first_name,
    p.push_token,
    '24h'::text
  FROM bookings b
  JOIN time_slots s  ON s.id = b.slot_id
  JOIN activities  a ON a.id = s.activity_id
  LEFT JOIN coaches c ON c.id = s.coach_id
  JOIN profiles p    ON p.id = b.member_id
  WHERE b.status               = 'confirmed'
    AND b.reminder_24h_sent_at IS NULL
    AND s.starts_at BETWEEN NOW() + INTERVAL '23 hours 30 minutes'
                        AND NOW() + INTERVAL '24 hours 30 minutes'
    -- Respecter les préférences de notification du membre
    AND (
      p.notification_preferences IS NULL
      OR (p.notification_preferences->>'reminders')::boolean IS NOT FALSE
    );

  -- ── Rappels 2h ───────────────────────────────────────────
  -- Fenêtre : cours qui commence entre 1h30 et 2h30 de maintenant
  -- Condition : rappel 2h pas encore envoyé
  RETURN QUERY
  SELECT
    b.id,
    b.member_id,
    b.gym_id,
    b.slot_id,
    s.starts_at,
    a.name::text,
    COALESCE(c.name, '')::text,
    p.email,
    p.first_name,
    p.push_token,
    '2h'::text
  FROM bookings b
  JOIN time_slots s  ON s.id = b.slot_id
  JOIN activities  a ON a.id = s.activity_id
  LEFT JOIN coaches c ON c.id = s.coach_id
  JOIN profiles p    ON p.id = b.member_id
  WHERE b.status              = 'confirmed'
    AND b.reminder_2h_sent_at IS NULL
    AND s.starts_at BETWEEN NOW() + INTERVAL '1 hour 30 minutes'
                        AND NOW() + INTERVAL '2 hours 30 minutes'
    AND (
      p.notification_preferences IS NULL
      OR (p.notification_preferences->>'reminders')::boolean IS NOT FALSE
    );
END;
$$;

COMMENT ON FUNCTION get_pending_reminders() IS
  'GYM-32 — Retourne les bookings qui nécessitent un rappel (24h ou 2h avant le cours).
   Appelée par l''Edge Function send-reminders via pg_cron toutes les 15 minutes.
   Respecte les préférences de notification des membres.';

-- ============================================================
-- ÉTAPE 3 : Fonction de marquage (appelée par l'Edge Function
-- après envoi réussi pour éviter les doublons)
-- ============================================================

CREATE OR REPLACE FUNCTION mark_reminder_sent(
  p_booking_id   uuid,
  p_reminder_type text  -- '24h' ou '2h'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_reminder_type = '24h' THEN
    UPDATE bookings
    SET reminder_24h_sent_at = NOW(),
        updated_at           = NOW()
    WHERE id = p_booking_id;
  ELSIF p_reminder_type = '2h' THEN
    UPDATE bookings
    SET reminder_2h_sent_at = NOW(),
        updated_at          = NOW()
    WHERE id = p_booking_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION mark_reminder_sent(uuid, text) IS
  'GYM-32 — Marque un rappel comme envoyé pour éviter les doublons.
   Appelée par l''Edge Function send-reminders après chaque envoi réussi.';

-- ============================================================
-- ÉTAPE 4 : pg_cron toutes les 15 minutes
-- Appelle l'Edge Function send-reminders (à créer avec Claude Code)
-- Pour l'instant : appel direct à get_pending_reminders() pour log
-- ============================================================

SELECT cron.schedule(
  'send-booking-reminders',
  '*/15 * * * *',
  $$
    SELECT COUNT(*) FROM get_pending_reminders()
  $$
);

