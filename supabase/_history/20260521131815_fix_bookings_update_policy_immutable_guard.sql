-- ============================================================================
-- ARCHIVE GYM-59 — migration prod 20260521131815 : fix_bookings_update_policy_immutable_guard
-- Historique Couche 2. NON rejouee (deja incluse dans la baseline).
-- ============================================================================

-- ============================================================
-- SÉCURITÉ #2 — Bookings UPDATE : with_check + colonnes immuables
-- ============================================================

-- COUCHE 1 : Correction de la policy RLS UPDATE
-- Problème : pas de with_check → un membre pouvait modifier n'importe quel champ
-- ============================================================

DROP POLICY "Annuler ses propres réservations" ON bookings;

CREATE POLICY "Annuler ses propres réservations" ON bookings
  FOR UPDATE
  USING (
    member_id = auth.uid()
    AND status IN ('confirmed', 'waitlist')  -- on ne peut annuler que des réservations actives
  )
  WITH CHECK (
    member_id = auth.uid()          -- member_id ne change pas
    AND gym_id = get_my_gym_id()    -- gym_id ne change pas (isolation multi-tenant)
    AND status = 'cancelled'        -- seul changement de statut autorisé pour un membre
  );

-- COUCHE 2 : Trigger immuable sur les colonnes critiques
-- Protection complémentaire : même un gym_admin ou une Edge Function
-- ne peut pas modifier slot_id, gym_id, member_id, booked_at après création
-- ============================================================

CREATE OR REPLACE FUNCTION protect_booking_immutable_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- slot_id : jamais modifiable (annuler + recréer si besoin)
  IF NEW.slot_id IS DISTINCT FROM OLD.slot_id THEN
    RAISE EXCEPTION 'booking.slot_id est immuable après création';
  END IF;

  -- gym_id : jamais modifiable (isolation multi-tenant critique)
  IF NEW.gym_id IS DISTINCT FROM OLD.gym_id THEN
    RAISE EXCEPTION 'booking.gym_id est immuable après création';
  END IF;

  -- member_id : jamais modifiable
  IF NEW.member_id IS DISTINCT FROM OLD.member_id THEN
    RAISE EXCEPTION 'booking.member_id est immuable après création';
  END IF;

  -- booked_at : jamais modifiable
  IF NEW.booked_at IS DISTINCT FROM OLD.booked_at THEN
    RAISE EXCEPTION 'booking.booked_at est immuable après création';
  END IF;

  -- subscription_id : immuable une fois défini (pas si NULL → NULL ou NULL → valeur)
  IF OLD.subscription_id IS NOT NULL
     AND NEW.subscription_id IS DISTINCT FROM OLD.subscription_id THEN
    RAISE EXCEPTION 'booking.subscription_id est immuable une fois défini';
  END IF;

  RETURN NEW;
END;
$$;

-- Appliquer le trigger sur tous les UPDATE de bookings
DROP TRIGGER IF EXISTS booking_immutable_guard ON bookings;

CREATE TRIGGER booking_immutable_guard
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION protect_booking_immutable_columns();

-- Vérification : s'assurer que le trigger est bien enregistré
COMMENT ON FUNCTION protect_booking_immutable_columns() IS
  'Sécurité : protège slot_id, gym_id, member_id, booked_at, subscription_id contre toute modification après création. Appliqué avant UPDATE sur bookings.';

