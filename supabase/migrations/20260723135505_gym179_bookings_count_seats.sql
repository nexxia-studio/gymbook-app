-- GYM-179 (fix 1) : bookings_count doit compter les sièges OCCUPÉS, pas seulement 'confirmed'.
--
-- CONSTAT (QA staging GYM-174) : un cours à 3/8 tombe à 0/8 dès que les présences sont
-- pointées, et n'y revient jamais. Cause : le trigger update_slot_bookings_count comptait
-- bookings_count = COUNT(*) WHERE status='confirmed'. Avant l'inversion GYM-174 un booking
-- restait 'confirmed' à vie ; désormais le pointage le transforme en attended/no_show/excused
-- → le COUNT sur 'confirmed' tombe à 0.
--
-- FIX : un SIÈGE est occupé par 'confirmed', 'attended', 'no_show' ET 'excused' (le membre a
-- pris la place du cours, qu'il soit venu ou non). Seuls 'cancelled' et 'waitlisted' n'occupent
-- pas de place. waitlist_count est INCHANGÉ.
--
-- ─── Sécurité du changement de sémantique (Règle Zéro) ──────────────────────────
--   Aucun CONTRÔLE DE CAPACITÉ ne lit la colonne bookings_count : le verrouillage de la
--   dernière place se fait par COUNT LIVE sous verrou dans create_booking_atomic et
--   promote_waitlist_atomic (SELECT count(*) ... WHERE status='confirmed' FOR UPDATE du slot).
--   bookings_count est une colonne d'AFFICHAGE (dashboard /planning, dashboard stats, écrans
--   mobiles) + un hint d'UX mobile (session/[id] : bookings_count < capacity) qui ne concerne
--   que des créneaux FUTURS — or un créneau futur n'a que des bookings confirmed/waitlisted
--   (le pointage et le cron ne touchent que les créneaux du jour / passés). Donc pour tout
--   créneau réservable la nouvelle définition == l'ancienne. Aucune place n'est libérée ni
--   bloquée à tort. Le changement ne fait que corriger l'affichage des créneaux déjà pointés.
--
-- Recréation À L'IDENTIQUE de la fonction (SET search_path, RETURN NULL, INSERT + UPDATE/DELETE),
-- seul le filtre de bookings_count change. NE PAS appliquer manuellement (cockpit staging→prod).

-- Statuts qui occupent un siège (partagé entre le trigger et le recalcul ci-dessous).
CREATE OR REPLACE FUNCTION public.update_slot_bookings_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE time_slots SET
      bookings_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = NEW.slot_id AND status IN ('confirmed', 'attended', 'no_show', 'excused')),
      waitlist_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = NEW.slot_id AND status = 'waitlisted')
    WHERE id = NEW.slot_id;
  ELSIF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    UPDATE time_slots SET
      bookings_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id) AND status IN ('confirmed', 'attended', 'no_show', 'excused')),
      waitlist_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id) AND status = 'waitlisted')
    WHERE id = COALESCE(NEW.slot_id, OLD.slot_id);
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.update_slot_bookings_count() IS
  'GYM-179 — bookings_count = COUNT des sièges occupés (confirmed/attended/no_show/excused).
   Corrige la chute à 0 après pointage (inversion GYM-174). waitlist_count inchangé. Le
   contrôle de capacité reste un COUNT live sous verrou (create_booking_atomic), pas cette colonne.';

-- Recalcul des compteurs existants : réparer les créneaux déjà pointés en staging (restés à 0).
-- On recalcule bookings_count pour TOUS les créneaux (idempotent) ; waitlist_count aussi pour
-- rester cohérent en une passe.
UPDATE time_slots ts SET
  bookings_count = (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = ts.id AND b.status IN ('confirmed', 'attended', 'no_show', 'excused')),
  waitlist_count = (SELECT COUNT(*) FROM bookings b WHERE b.slot_id = ts.id AND b.status = 'waitlisted');
