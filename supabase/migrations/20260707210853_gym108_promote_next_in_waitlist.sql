-- 20260707210853_gym108_promote_next_in_waitlist.sql
-- GYM-108 — Crée la RPC promote_next_in_waitlist, appelée (jusqu'ici en fantôme) par
-- confirm-waitlist sur le chemin « deadline expirée → promouvoir le suivant ». La fonction
-- n'existait NI en staging NI en prod → échec silencieux (retour rpc non vérifié).
--
-- FICHIER SEULEMENT — non appliquée (train n°2, staging gelé pour la QA du train n°1).
--
-- Règle produit validée : à la promotion, un membre sans crédit ni abonnement est SAUTÉ +
-- NOTIFIÉ (notification côté confirm-waitlist), puis on tente le suivant.
--
-- Décision « membre sauté » (cohérence avec l'existant) : reorder_waitlist(p_slot_id) renumérote
-- STRICTEMENT par booked_at ASC (FIFO pur) — il n'existe aucune notion de « fin de file »
-- manipulable. Laisser le booten NO_CREDIT en 'waitlisted' le ferait re-sélectionner en boucle
-- (même booked_at). On CANCELLE donc le sauté (status='cancelled',
-- cancel_reason='no_credit_at_promotion') : il sort de la file, reorder le compacte naturellement.
--
-- Promotion unitaire déléguée à promote_waitlist_atomic(booking) (verrou créneau FOR UPDATE +
-- débit FIFO si pas d'abonnement + confirmation) : on NE réécrit pas cette logique.

CREATE OR REPLACE FUNCTION public.promote_next_in_waitlist(
  p_slot_id uuid,
  p_exclude_booking_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_next_id   uuid;
  v_result    jsonb;
  v_reason    text;
  v_skipped   jsonb := '[]'::jsonb;
  v_member_id uuid;
  v_gym_id    uuid;
  v_max_iter  integer;
  v_iter      integer := 0;
BEGIN
  -- Garde-fou anti-boucle : borne = taille actuelle de la file (hors booking exclu).
  SELECT count(*) INTO v_max_iter
  FROM bookings
  WHERE slot_id = p_slot_id
    AND status = 'waitlisted'
    AND (p_exclude_booking_id IS NULL OR id <> p_exclude_booking_id);

  IF v_max_iter = 0 THEN
    RETURN jsonb_build_object('status', 'skipped', 'reason', 'EMPTY', 'skipped_members', v_skipped);
  END IF;

  LOOP
    v_iter := v_iter + 1;
    EXIT WHEN v_iter > v_max_iter;

    -- Prochain de la file (waitlist_position ASC, fallback booked_at), hors booking exclu.
    SELECT id INTO v_next_id
    FROM bookings
    WHERE slot_id = p_slot_id
      AND status = 'waitlisted'
      AND (p_exclude_booking_id IS NULL OR id <> p_exclude_booking_id)
    ORDER BY waitlist_position ASC NULLS LAST, booked_at ASC
    LIMIT 1;

    IF v_next_id IS NULL THEN
      RETURN jsonb_build_object('status', 'skipped', 'reason', 'EMPTY', 'skipped_members', v_skipped);
    END IF;

    v_result := public.promote_waitlist_atomic(v_next_id);
    v_reason := v_result ->> 'reason';

    IF v_result ->> 'status' = 'promoted' THEN
      RETURN jsonb_build_object(
        'status', 'promoted',
        'booking_id', v_next_id,
        'skipped_members', v_skipped
      );

    ELSIF v_reason = 'NO_CREDIT' THEN
      -- Sauté : sort de la file (cf. en-tête) + accumulé pour notification.
      SELECT member_id, gym_id INTO v_member_id, v_gym_id FROM bookings WHERE id = v_next_id;
      UPDATE bookings
      SET status = 'cancelled',
          cancelled_at = now(),
          cancel_reason = 'no_credit_at_promotion',
          waitlist_position = NULL,
          waitlist_notified_at = NULL,
          waitlist_confirmation_deadline = NULL
      WHERE id = v_next_id AND status = 'waitlisted';
      v_skipped := v_skipped || jsonb_build_object('booking_id', v_next_id, 'member_id', v_member_id, 'gym_id', v_gym_id);
      -- continuer au suivant

    ELSIF v_reason = 'FULL' THEN
      -- La place a été reprise entre-temps → plus rien à promouvoir.
      RETURN jsonb_build_object('status', 'skipped', 'reason', 'FULL', 'skipped_members', v_skipped);

    ELSIF v_reason = 'SLOT_NOT_FOUND' THEN
      RETURN jsonb_build_object('status', 'skipped', 'reason', 'SLOT_NOT_FOUND', 'skipped_members', v_skipped);

    ELSE
      -- NOT_WAITLISTED / BOOKING_NOT_FOUND (course transitoire) : le booking n'est plus éligible,
      -- il ne sera pas re-sélectionné (filtre status='waitlisted') → on tente le suivant.
      NULL;
    END IF;
  END LOOP;

  -- Borne atteinte (tous sautés) → file épuisée.
  RETURN jsonb_build_object('status', 'skipped', 'reason', 'EMPTY', 'skipped_members', v_skipped);
END;
$function$;

-- ACL : service_role uniquement (appelée par les Edge Functions en service role).
REVOKE ALL ON FUNCTION public.promote_next_in_waitlist(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_next_in_waitlist(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_next_in_waitlist(uuid, uuid) TO service_role;
