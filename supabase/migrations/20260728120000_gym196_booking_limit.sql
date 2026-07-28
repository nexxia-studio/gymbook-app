-- GYM-196 : limite de réservations simultanées configurable par salle, et fermeture du
-- contournement par la liste d'attente.
--
-- LA RÈGLE EXISTE DÉJÀ : create-booking refuse une réservation au-delà de 2 confirmées à
-- venir (400 MAX_BOOKINGS_REACHED). Ce lot ne la recrée pas — il la rend paramétrable
-- (Nico : 3), et surtout il ferme le trou décrit ci-dessous.
--
-- ─── LE CONTOURNEMENT FERMÉ ICI ──────────────────────────────────────────────
-- Se mettre en liste d'attente est autorisé même à la limite (décision Antoine : c'est
-- la PROMOTION qui doit être contrôlée, pas l'inscription en attente). D'où la faille :
--   1. le membre est à la limite (3 réservations confirmées à venir)
--   2. il s'inscrit en liste d'attente sur un 4e cours — autorisé
--   3. une place se libère → promote_waitlist_atomic le promeut sans rien vérifier
--   4. il se retrouve à 4 réservations : la limite est franchie SANS INTENTION de sa part
-- Le contrôle manquait au seul endroit qui compte : la promotion.
--
-- ─── Constats base live (Règle Zéro) ─────────────────────────────────────────
--   - promote_waitlist_atomic recopiée de sa définition LIVE, postérieure aux
--     déploiements GYM-191 (ceinture ends_at) et GYM-195 (statut 'canceling').
--   - ⚠️ GYM-180 a REVOQUÉ l'UPDATE global de nexxia_gyms pour `authenticated` au profit
--     d'une liste blanche de 27 colonnes. Une colonne nouvelle n'y est PAS : sans le
--     GRANT ci-dessous, /settings ne pourrait pas l'écrire.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) La limite, portée par la salle.
--
--    NULLABLE volontairement : NULL = AUCUNE limite (salle qui ne veut rien plafonner).
--    C'est pourquoi la colonne n'est pas NOT NULL — l'absence de valeur est une valeur.
--
--    ⚠️ Les lignes EXISTANTES prennent le DEFAULT : depuis PostgreSQL 11, ADD COLUMN avec
--    DEFAULT ne réécrit pas la table mais expose la valeur par défaut aux lignes déjà
--    présentes. Dopamine hérite donc de 3 sans UPDATE explicite — c'est l'effet voulu,
--    et c'est pour cela qu'aucun UPDATE ciblé n'est écrit ici.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nexxia_gyms
  ADD COLUMN IF NOT EXISTS max_active_bookings integer DEFAULT 3;

COMMENT ON COLUMN public.nexxia_gyms.max_active_bookings IS
  'GYM-196 — nombre maximum de réservations CONFIRMÉES à venir par membre (Open Gym compris). '
  'NULL = aucune limite. Un cours passé sort du décompte automatiquement (le prédicat porte '
  'sur time_slots.starts_at). La liste d''attente N''ENTRE PAS dans le décompte : s''inscrire '
  'en attente reste toujours possible, c''est la PROMOTION qui est contrôlée '
  '(promote_waitlist_atomic → skipped/BOOKING_LIMIT_REACHED). Le walk-in et l''inscription '
  'par le gérant y dérogent volontairement.';

-- Sans ce GRANT, /settings ne pourrait pas écrire la colonne (liste blanche GYM-180).
GRANT UPDATE (max_active_bookings) ON public.nexxia_gyms TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- b) promote_waitlist_atomic — refuser la promotion qui ferait dépasser la limite.
--
--    ⚠️ ANTI-DRIFT : fonction recopiée depuis sa définition LIVE ; SEUL le bloc GYM-196
--    est ajouté. Conservés à l'identique : garde SLOT_CANCELLED, verrou FOR UPDATE,
--    contrôle de capacité, prédicat d'abonnement ('active','canceling') + ceinture
--    ends_at, débit FIFO, et toutes les valeurs de retour existantes.
--
--    Placement : APRÈS le contrôle de capacité, AVANT le débit de crédit — un membre
--    refusé ne doit rien payer et rester exactement dans l'état où il était.
--    Le bloc ne modifie RIEN : le booking reste 'waitlisted', son tour n'est pas perdu.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.promote_waitlist_atomic(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_slot_id      uuid;
  v_member_id    uuid;
  v_gym_id       uuid;
  v_status       text;
  v_slot_status  text;
  v_capacity     integer;
  v_confirmed    integer;
  v_has_sub      boolean;
  v_credit_id    uuid;
  v_limit        integer;   -- GYM-196
  v_future_count integer;   -- GYM-196
BEGIN
  SELECT slot_id, member_id, gym_id, status
    INTO v_slot_id, v_member_id, v_gym_id, v_status
  FROM bookings
  WHERE id = p_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'BOOKING_NOT_FOUND');
  END IF;
  IF v_status <> 'waitlisted' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'NOT_WAITLISTED');
  END IF;

  SELECT capacity, status INTO v_capacity, v_slot_status
  FROM time_slots
  WHERE id = v_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'SLOT_NOT_FOUND');
  END IF;

  IF v_slot_status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'SLOT_CANCELLED');
  END IF;

  SELECT count(*) INTO v_confirmed
  FROM bookings
  WHERE slot_id = v_slot_id
    AND status = 'confirmed';

  IF v_confirmed >= v_capacity THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'FULL');
  END IF;

  -- ── GYM-196 — SEUL AJOUT : limite de réservations simultanées ───────────────
  -- Sous le verrou créneau déjà pris, donc sérialisé avec les autres promotions.
  -- NULL = aucune limite → aucun contrôle.
  SELECT g.max_active_bookings INTO v_limit
  FROM nexxia_gyms g
  WHERE g.id = v_gym_id;

  IF v_limit IS NOT NULL THEN
    -- MÊME prédicat que create-booking : 'confirmed' + créneau à venir. Les deux
    -- décomptes DOIVENT rester alignés, sinon l'app et la promotion divergeraient.
    SELECT count(*) INTO v_future_count
    FROM bookings b
    JOIN time_slots s ON s.id = b.slot_id
    WHERE b.member_id = v_member_id
      AND b.status = 'confirmed'
      AND s.starts_at > now();

    IF v_future_count >= v_limit THEN
      -- On ne touche à RIEN : pas de débit, pas de changement de statut. Le membre
      -- reste 'waitlisted' et garde son tour jusqu'à l'expiration de son délai.
      RETURN jsonb_build_object(
        'status', 'skipped',
        'reason', 'BOOKING_LIMIT_REACHED',
        'limit', v_limit
      );
    END IF;
  END IF;
  -- ── fin GYM-196 ────────────────────────────────────────────────────────────

  SELECT EXISTS (
    SELECT 1 FROM member_subscriptions
    WHERE member_id = v_member_id AND gym_id = v_gym_id
      AND status IN ('active', 'canceling')
      AND (ends_at IS NULL OR ends_at > now())
  ) INTO v_has_sub;

  IF NOT v_has_sub THEN
    BEGIN
      v_credit_id := public.debit_credit_fifo(v_member_id, v_gym_id, p_booking_id);
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM = 'NO_CREDIT' THEN
        RETURN jsonb_build_object('status', 'skipped', 'reason', 'NO_CREDIT');
      ELSE
        RAISE;
      END IF;
    END;
  END IF;

  UPDATE bookings
  SET status = 'confirmed',
      waitlist_position = NULL,
      waitlist_notified_at = NULL,
      waitlist_confirmation_deadline = NULL,
      promoted_from_waitlist_at = now()
  WHERE id = p_booking_id;

  RETURN jsonb_build_object(
    'status', 'promoted',
    'booking_id', p_booking_id,
    'credit_debited', (NOT v_has_sub),
    'credit_id', v_credit_id
  );
END;
$function$;
