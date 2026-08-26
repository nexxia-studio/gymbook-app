-- GYM-281 + GYM-280 : liste d'attente — notifier autant de membres qu'il y a de places,
-- dans le bon ordre.
--
-- ⚠️ NON DÉPLOYÉE. Idempotente et rejouable (CREATE OR REPLACE uniquement — AUCUN DROP).
--
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 CE QUE LA LECTURE DU DÉPLOYÉ A CHANGÉ AU PLAN
-- ═════════════════════════════════════════════════════════════════════════════════════
-- L'arbitrage du ticket était : « calcule la position DANS create_booking_atomic, donc la
-- RPC insère elle-même la ligne waitlisted plutôt que de rendre `full` ». Appliqué à la
-- lettre, il CASSE deux choses :
--
--   1. `admin-book-member` appelle la MÊME RPC, et son `full` porte une UX délibérée
--      (GYM-231) : premier appel → 409 avec la position que le membre OCCUPERAIT ;
--      second appel, si le gérant confirme, `allow_waitlist: true` → inscription. Si la
--      RPC inscrivait d'office, le gérant inscrirait quelqu'un en liste d'attente SANS
--      l'avoir voulu — précisément ce que GYM-231 a écrit pour éviter (« inscrire
--      d'office quelqu'un qui croit avoir sa place serait lui promettre un cours qu'il
--      n'a pas »).
--
--   2. Ajouter un paramètre à `create_booking_atomic` n'est PAS un CREATE OR REPLACE :
--      une signature différente crée une SURCHARGE. Il faudrait DROP puis recréer la
--      fonction — celle-là même que le test de charge a validée 12/12, et dont le ticket
--      interdit de modifier le comportement.
--
-- LA VARIANTE RETENUE, qui donne la même garantie sans aucun des deux effets :
-- `create_booking_atomic` n'est PAS TOUCHÉE — elle continue de rendre `full`. Une
-- fonction dédiée, `waitlist_join_atomic`, prend LE MÊME VERROU sur la ligne du créneau
-- et calcule la position dessous. La garantie recherchée — « la position est attribuée
-- sous le verrou » — est identique ; le périmètre est strictement plus petit.
--
-- ⚠️ CONSÉQUENCE À CONNAÎTRE : entre le `full` rendu par create_booking_atomic et l'appel
-- à waitlist_join_atomic, le verrou est relâché. Une place peut donc se libérer dans cet
-- intervalle et le membre partir en liste d'attente alors qu'un siège existait. Ce n'est
-- pas une régression — c'est exactement le comportement actuel — et le balayage de
-- places libres ci-dessous notifie ce membre dans la foulée.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- a) GYM-280 — LA POSITION, ATTRIBUÉE SOUS LE VERROU
-- ═════════════════════════════════════════════════════════════════════════════════════
-- LE DÉFAUT : `create-booking` et `admin-book-member` calculent tous deux
--     const position = (count of waitlisted) + 1
-- HORS de tout verrou — le commentaire du code l'annonçait lui-même. Sous charge, huit
-- requêtes lisent le compteur avant qu'aucune n'ait inséré : mesuré à 8 membres pour
-- 4 positions distinctes, dont 5 en position 2, et les positions 3 à 6 jamais attribuées.
--
-- ⚠️ `MAX(waitlist_position) + 1` ET NON `count(*) + 1`, ET LA NUANCE COMPTE. Avec des
-- trous — une ligne promue passe `waitlist_position` à NULL, une ligne expirée est
-- annulée — `count + 1` retombe sur une position DÉJÀ OCCUPÉE. Exemple : positions
-- 1, 2, 4 → count = 3 → nouvelle position 4, en doublon. `MAX + 1` est monotone et ne
-- collisionne jamais, quel que soit l'état de la file. La CONTIGUÏTÉ, elle, est rétablie
-- par `reorder_waitlist`, appelée après chaque retrait (section c).
CREATE OR REPLACE FUNCTION public.waitlist_join_atomic(
  p_member_id           uuid,
  p_slot_id             uuid,
  p_gym_id              uuid,
  p_existing_booking_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_position   integer;
  v_booking_id uuid;
  v_key        text;
BEGIN
  -- ⚠️ LE MÊME VERROU QUE create_booking_atomic, SUR LA MÊME LIGNE. C'est lui, et lui
  -- seul, qui sérialise les candidats : deux inscriptions simultanées sur le même
  -- créneau ne peuvent plus lire le même compteur.
  PERFORM 1 FROM time_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND';
  END IF;

  SELECT COALESCE(MAX(waitlist_position), 0) + 1
    INTO v_position
  FROM bookings
  WHERE slot_id = p_slot_id
    AND status  = 'waitlisted';

  -- Clé d'idempotence identique à celle de create_booking_atomic : même membre, même
  -- créneau, une seule ligne — quel que soit le chemin emprunté.
  v_key := p_member_id::text || '-' || p_slot_id::text;

  IF p_existing_booking_id IS NOT NULL THEN
    UPDATE bookings
    SET status         = 'waitlisted',
        waitlist_position = v_position,
        cancelled_at   = NULL,
        cancel_reason  = NULL,
        is_late_cancel = false,
        -- ⚠️ AJOUT PAR RAPPORT AU CODE ACTUEL, ET C'EST UN CORRECTIF : la réactivation
        -- côté TypeScript ne remettait PAS ces deux colonnes à NULL. Une réservation
        -- annulée après avoir été notifiée conservait son `waitlist_notified_at` ; en se
        -- réinscrivant, le membre redevenait invisible pour `notify_next_in_waitlist`
        -- (qui ne retient que `waitlist_notified_at IS NULL`) — il n'aurait plus JAMAIS
        -- été notifié sur ce créneau.
        waitlist_notified_at = NULL,
        waitlist_confirmation_deadline = NULL
    WHERE id = p_existing_booking_id
    RETURNING id INTO v_booking_id;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;
  ELSE
    INSERT INTO bookings (member_id, slot_id, gym_id, status, waitlist_position, idempotency_key)
    VALUES (p_member_id, p_slot_id, p_gym_id, 'waitlisted', v_position, v_key)
    RETURNING id INTO v_booking_id;
  END IF;

  RETURN jsonb_build_object(
    'status',     'waitlisted',
    'booking_id', v_booking_id,
    'position',   v_position
  );
END;
$function$;

COMMENT ON FUNCTION public.waitlist_join_atomic(uuid, uuid, uuid, uuid) IS
  'GYM-280 — Inscrit un membre en liste d''attente en attribuant sa position SOUS LE VERROU '
  'de la ligne time_slots (le même que create_booking_atomic). Corrige le calcul '
  '(count+1) fait hors verrou par create-booking et admin-book-member, qui produisait des '
  'positions dupliquées sous charge. Utilise MAX+1 : count+1 collisionne dès qu''il y a un '
  'trou dans la file. Ne débite aucun crédit — la liste d''attente ne coûte rien.';

REVOKE ALL     ON FUNCTION public.waitlist_join_atomic(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.waitlist_join_atomic(uuid, uuid, uuid, uuid) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- b) GYM-281 — NOTIFIER AUTANT DE MEMBRES QU'IL Y A DE PLACES
-- ═════════════════════════════════════════════════════════════════════════════════════
-- LE DÉFAUT, dans cancel-booking étape 8 :
--     .eq('status','waitlisted').order('waitlist_position').limit(1)
-- sans AUCUN filtre sur `waitlist_notified_at`. Le premier de la file est donc re-notifié
-- à CHAQUE annulation, sa fenêtre de confirmation repoussée à chaque fois, et le curseur
-- n'avance jamais. Mesuré : 7 places libérées, 8 membres en attente, 1 seul notifié.
--
-- ⚠️ LA BRIQUE EXISTAIT DÉJÀ, ET ELLE EST CORRECTE : `notify_next_in_waitlist(slot_id)`
-- filtre bien `waitlist_notified_at IS NULL`, trie par position puis par booked_at, pose
-- la fenêtre et déclenche l'envoi. Elle est appelée par `expire_waitlist_confirmations`
-- (le relais à l'expiration fonctionne donc déjà) et par `confirm-waitlist` (GYM-108).
-- Seul `cancel-booking` avait sa propre logique, en TypeScript, et fausse.
--
-- On ne réécrit donc RIEN de la notification : on l'appelle le bon nombre de fois.
--
-- ⚠️ LE NOMBRE DE PLACES SE CALCULE, IL NE SE SUPPOSE PAS :
--     libres = capacité − confirmés − fenêtres de confirmation ENCORE OUVERTES
-- Le troisième terme est celui qu'on oublie : un membre notifié dont le délai court
-- occupe une place qui ne lui est pas encore attribuée. L'ignorer notifierait deux
-- personnes pour un seul siège, et l'une des deux se verrait refuser sa confirmation.
--
-- ⚠️ ON NE TOUCHE JAMAIS À UNE FENÊTRE OUVERTE — ni pour la raccourcir, ni pour la
-- repousser. C'est une promesse faite au membre, et c'est aussi ce que le défaut faisait :
-- il repoussait indéfiniment celle du premier de la file.
CREATE OR REPLACE FUNCTION public.notify_waitlist_for_free_seats(p_slot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_capacity  integer;
  v_status    text;
  v_confirmed integer;
  v_pending   integer;
  v_free      integer;
  v_notified  integer := 0;
  v_result    jsonb;
BEGIN
  -- Même verrou que partout ailleurs : deux libérations simultanées ne peuvent pas
  -- calculer le même nombre de places libres et notifier deux fois les mêmes personnes.
  SELECT capacity, status INTO v_capacity, v_status
  FROM time_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND';
  END IF;

  -- Un cours annulé n'a plus de places à offrir. cancel_slot_atomic annule d'ailleurs
  -- TOUTES les lignes, waitlisted comprises : il n'y a personne à notifier.
  IF v_status = 'cancelled' THEN
    RETURN jsonb_build_object('status', 'slot_cancelled', 'free', 0, 'notified', 0);
  END IF;

  SELECT count(*) INTO v_confirmed
  FROM bookings
  WHERE slot_id = p_slot_id AND status = 'confirmed';

  SELECT count(*) INTO v_pending
  FROM bookings
  WHERE slot_id = p_slot_id
    AND status = 'waitlisted'
    AND waitlist_notified_at IS NOT NULL
    AND waitlist_confirmation_deadline IS NOT NULL
    AND waitlist_confirmation_deadline > now();

  -- GREATEST(0, …) : en dépassement autorisé (GYM-231), `confirmed` peut excéder la
  -- capacité. Sans cette borne, le calcul rendrait un nombre négatif et la boucle ne
  -- tournerait pas — mais un négatif qui traîne finit toujours par être additionné
  -- quelque part.
  v_free := GREATEST(v_capacity - v_confirmed - v_pending, 0);

  FOR i IN 1..v_free LOOP
    v_result := public.notify_next_in_waitlist(p_slot_id);
    -- Plus personne à notifier : inutile de tourner pour les places restantes.
    EXIT WHEN v_result->>'status' <> 'notified';
    v_notified := v_notified + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status',    'ok',
    'capacity',  v_capacity,
    'confirmed', v_confirmed,
    'pending',   v_pending,
    'free',      v_free,
    'notified',  v_notified
  );
END;
$function$;

COMMENT ON FUNCTION public.notify_waitlist_for_free_seats(uuid) IS
  'GYM-281 — Notifie autant de membres en liste d''attente qu''il y a de places réellement '
  'libres : capacité − confirmés − fenêtres de confirmation encore ouvertes. Réutilise '
  'notify_next_in_waitlist (qui filtre déjà waitlist_notified_at IS NULL) plutôt que de '
  'refaire sa logique. Ne raccourcit ni ne repousse JAMAIS une fenêtre ouverte. Prend le '
  'verrou de la ligne time_slots : deux libérations simultanées ne notifient pas deux fois '
  'les mêmes membres.';

REVOKE ALL     ON FUNCTION public.notify_waitlist_for_free_seats(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.notify_waitlist_for_free_seats(uuid) TO service_role;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- c) CONTIGUÏTÉ — resserrer la file après CHAQUE retrait
-- ═════════════════════════════════════════════════════════════════════════════════════
-- `reorder_waitlist(slot_id)` existe et renumérote 1..n par `booked_at ASC` — l'ordre
-- réel d'arrivée. Elle est déjà appelée par cancel-booking quand un membre EN ATTENTE se
-- désiste. Elle ne l'est PAS sur les deux autres retraits, qui laissent donc des trous :
--   · une promotion (`promote_waitlist_atomic`) passe waitlist_position à NULL ;
--   · une expiration (`expire_waitlist_confirmations`) annule la ligne.
--
-- ⚠️ ANTI-DRIFT : les deux fonctions ci-dessous sont RECOPIÉES depuis leur définition
-- LIVE (pg_get_functiondef, staging, 26/08/2026). Le SEUL ajout est l'appel à
-- reorder_waitlist. Aucune garde, aucun verrou, aucun débit de crédit n'est modifié —
-- c'est la méthode imposée par GYM-195, et ici l'interdit du ticket la rend obligatoire.

-- c.1) promote_waitlist_atomic — resserrer après avoir retiré le promu de la file.
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
  v_limit        integer;
  v_future_count integer;
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

  SELECT g.max_active_bookings INTO v_limit
  FROM nexxia_gyms g
  WHERE g.id = v_gym_id;

  IF v_limit IS NOT NULL THEN
    SELECT count(*) INTO v_future_count
    FROM bookings b
    JOIN time_slots s ON s.id = b.slot_id
    WHERE b.member_id = v_member_id
      AND b.status = 'confirmed'
      AND s.starts_at > now();

    IF v_future_count >= v_limit THEN
      RETURN jsonb_build_object(
        'status', 'skipped',
        'reason', 'BOOKING_LIMIT_REACHED',
        'limit', v_limit
      );
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM member_subscriptions
    WHERE member_id = v_member_id AND gym_id = v_gym_id
      AND status IN ('active', 'canceling', 'past_due')
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

  -- GYM-280 : SEUL AJOUT. Le promu vient de quitter la file en laissant sa position à
  -- NULL ; sans ce resserrage, les suivants gardent des numéros troués et l'app affiche
  -- « position 5 » à quelqu'un qui est troisième.
  PERFORM public.reorder_waitlist(v_slot_id);

  RETURN jsonb_build_object(
    'status', 'promoted',
    'booking_id', p_booking_id,
    'credit_debited', (NOT v_has_sub),
    'credit_id', v_credit_id
  );
END;
$function$;

-- c.2) expire_waitlist_confirmations — resserrer avant de passer au suivant.
CREATE OR REPLACE FUNCTION public.expire_waitlist_confirmations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  expired RECORD;
BEGIN
  FOR expired IN
    SELECT id, slot_id
    FROM bookings
    WHERE status = 'waitlisted'
      AND waitlist_notified_at IS NOT NULL
      AND waitlist_confirmation_deadline IS NOT NULL
      AND waitlist_confirmation_deadline < now()
    ORDER BY waitlist_confirmation_deadline ASC
  LOOP
    UPDATE bookings
    SET status = 'cancelled',
        cancelled_at = now(),
        cancel_reason = 'waitlist_expired'
    WHERE id = expired.id
      AND status = 'waitlisted';

    -- GYM-280 : SEUL AJOUT, et il précède la notification. La ligne expirée vient de
    -- quitter la file ; resserrer AVANT garantit que `notify_next_in_waitlist`, qui trie
    -- par `waitlist_position`, désigne bien le suivant réel.
    PERFORM public.reorder_waitlist(expired.slot_id);

    PERFORM public.notify_next_in_waitlist(expired.slot_id);
  END LOOP;
END;
$function$;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- CE QUI N'EST PAS TOUCHÉ, ET POURQUOI
-- ═════════════════════════════════════════════════════════════════════════════════════
--   · create_booking_atomic  — INCHANGÉE. Le test de charge l'a validée (12/12 confirmés,
--     12 crédits, 0 débit indu) ; la meilleure façon de préserver ce comportement à
--     l'identique est de ne pas y toucher.
--   · notify_next_in_waitlist — INCHANGÉE. Elle est correcte ; on l'appelle simplement le
--     bon nombre de fois.
--   · reorder_waitlist        — INCHANGÉE. Elle renumérote déjà par booked_at ASC.
--   · cancel_slot_atomic      — INCHANGÉE, et le ticket la soupçonnait à tort d'être le
--     pire cas : elle n'ouvre AUCUNE place. Elle annule le créneau ET toutes les lignes,
--     waitlisted comprises (waitlist_cleared dans son retour). Il n'y a personne à
--     notifier — c'est une annulation de masse, pas une libération de masse.
--   · debit_credit_fifo, les gardes de capacité, la limite max_active_bookings — hors
--     périmètre, aucune ligne modifiée.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- SCÉNARIO DE VÉRIFICATION SQL (le harnais de charge du cockpit couvre le reste)
-- ═════════════════════════════════════════════════════════════════════════════════════
-- -- Positions contiguës et distinctes après un tir groupé :
-- SELECT waitlist_position, count(*)
-- FROM bookings WHERE slot_id = '<SLOT>' AND status = 'waitlisted'
-- GROUP BY 1 ORDER BY 1;
-- -- attendu : une ligne par position, 1..n sans trou, count = 1 partout
--
-- -- Places libres et notifications, après une libération :
-- SELECT public.notify_waitlist_for_free_seats('<SLOT>');
-- -- attendu : {"free": N, "notified": N} tant qu'il reste des candidats
--
-- -- Aucune fenêtre ouverte n'a été repoussée :
-- SELECT id, waitlist_position, waitlist_notified_at, waitlist_confirmation_deadline
-- FROM bookings WHERE slot_id = '<SLOT>' AND status = 'waitlisted'
-- ORDER BY waitlist_position;
-- -- attendu : les deadlines déjà posées sont INCHANGÉES d'un appel à l'autre
