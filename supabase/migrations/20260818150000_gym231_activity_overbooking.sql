-- GYM-231 — Dépassement de capacité autorisé, ACTIVITÉ PAR ACTIVITÉ.
--
-- DEMANDE (Antoine, 12/08) : « Que penses-tu de laisser Nico forcer l'ajout de 1-2-3
-- membres supplémentaires à un cours ou à l'Open Gym ? Le but est qu'ils soient autonomes
-- depuis leur app, mais la possibilité d'ajout forcé doit être faisable. »
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- POURQUOI UNE COLONNE SUR `activities`, ET PAS UN POUVOIR GLOBAL DU GÉRANT
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Forcer sur un COURS COLLECTIF et forcer sur l'OPEN GYM ne sont pas le même geste. Le
-- premier engage la place au sol, la sécurité et la qualité d'encadrement — un coach pour
-- 15 au lieu de 12 dégrade la prestation de TOUS les inscrits, y compris ceux qui avaient
-- leur place. Le second, en accès libre et sans encadrement (GYM-229), n'a pratiquement
-- que la contrainte du nombre de machines. Un pouvoir global du gérant confondrait les
-- deux ; la salle doit pouvoir dire OÙ elle accepte de la souplesse.
--
-- ⚠️ DEFAULT 0 — LE COMPORTEMENT ACTUEL EST STRICTEMENT PRÉSERVÉ. Toutes les activités
-- existantes, et toutes les futures, restent à capacité DURE tant que le gérant n'a pas
-- posé un geste explicite. Cette migration n'autorise rien : elle rend autorisable.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. ELLE N'ÉCRIT AUCUNE DONNÉE. Ouvrir une marge sur l'Open Gym de Dopamine est un geste
--    de cockpit, pas de migration : une migration ne décide pas du paramétrage d'une salle.
--
-- 2. ELLE N'AJOUTE AUCUN GRANT. `activities` porte des droits au NIVEAU TABLE — une
--    nouvelle colonne y est donc automatiquement écrivable, bornée par la policy
--    « Gym admins gèrent les activités » (gym_id = get_my_gym_id() AND is_gym_admin()).
--    Même constat qu'à GYM-229, et à NE PAS confondre avec la liste blanche de GYM-180 /
--    GYM-203, qui ne porte que sur `nexxia_gyms` et `profiles`.
--
-- 3. ELLE NE TOUCHE NI AU VERROU, NI AU DÉBIT DE CRÉDIT, NI À LA LISTE D'ATTENTE.
--    Voir le bloc create_booking_atomic ci-dessous, qui détaille l'unique ajout.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- a) La marge, portée par l'activité.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- NOT NULL + DEFAULT 0 : trois états (0 / n / NULL) pour une question qui n'en a que deux
-- obligeraient chaque lecture à choisir un repli, et ces replis divergeraient — c'est le
-- raisonnement de GYM-229, repris tel quel. Depuis PostgreSQL 11, ADD COLUMN avec DEFAULT
-- ne réécrit pas la table : les lignes existantes prennent 0 sans UPDATE.
--
-- Nommage aligné sur `nexxia_gyms.max_active_bookings` (GYM-196) : même préfixe, même
-- nature — un plafond entier, lu par le chemin de réservation.
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS max_overbook integer NOT NULL DEFAULT 0;

-- ⚠️ LA BORNE BASSE N'EST PAS COSMÉTIQUE. Une valeur NÉGATIVE ne serait pas « pas de
-- dépassement » : elle RÉDUIRAIT la capacité effective sous celle du créneau, et le ferait
-- silencieusement, depuis un écran de paramétrage d'activité. Le contrôle de capacité
-- deviendrait plus strict que `time_slots.capacity` sans que rien ne le dise.
--
-- La borne haute (20) est un garde-fou de saisie, pas une règle métier : la demande porte
-- sur « 1-2-3 » places. Elle empêche qu'un 3 devienne 30 par une frappe malheureuse. À
-- relever si une salle a un vrai besoin au-delà — c'est un ALTER d'une ligne.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activities_max_overbook_check'
  ) THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_max_overbook_check
      CHECK (max_overbook >= 0 AND max_overbook <= 20);
  END IF;
END $$;

COMMENT ON COLUMN public.activities.max_overbook IS
  'GYM-231 — nombre de places que le GÉRANT peut ajouter AU-DELÀ de time_slots.capacity sur '
  'un créneau de cette activité. 0 (défaut) = capacité dure, comportement historique. '
  'N''est JAMAIS lu par le chemin membre : create-booking n''envoie pas p_allow_overbook, '
  'donc un cours complet reste complet dans l''app et la liste d''attente reste sa seule '
  'issue. Le dépassement est un pouvoir du gérant (admin-book-member), à motif obligatoire '
  'et tracé dans gym_admin_actions.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- b) create_booking_atomic — L'UNIQUE AJOUT.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ ANTI-DRIFT. Corps recopié depuis la DÉFINITION LIVE lue en PRODUCTION
-- (fcjupgvmjkqztxtwymdb) le 18/08 — identique, au caractère près, à
-- 20260703230658_gym70b_credit_symmetry.sql : la fonction n'a pas bougé depuis juillet, et
-- le dépôt ne présente aucune dérive sur elle. SEUL le bloc marqué GYM-231 est ajouté.
--
-- Conservés à l'identique et VOLONTAIREMENT NON TOUCHÉS :
--   · le SELECT … FOR UPDATE sur time_slots — c'est LUI qui sérialise les réservations
--     concurrentes, et tout ce qui suit s'exécute sous sa protection ;
--   · le COUNT live des confirmées (jamais time_slots.bookings_count, cf. GYM-179) ;
--   · l'insertion / réactivation et sa clé d'idempotence ;
--   · le débit FIFO via debit_credit_fifo, APRÈS l'insertion et seulement sans abonnement
--     — un membre inscrit en dépassement paie sa séance EXACTEMENT comme les autres ;
--   · le retour 'full', qui n'est pas une exception mais un statut normal que les appelants
--     interprètent (bascule en liste d'attente). Son contrat est inchangé.
--
-- ⚠️ POURQUOI UN DROP PUIS UN CREATE, ET NON UN SIMPLE CREATE OR REPLACE.
-- Ajouter un paramètre CHANGE la signature : `CREATE OR REPLACE` ne remplacerait pas la
-- fonction, il créerait une SECONDE surcharge à 6 arguments à côté de celle à 5. Les
-- appels existants (5 arguments nommés) deviendraient alors AMBIGUS — le 6e ayant un
-- DEFAULT, les deux candidates matchent — et PostgreSQL les rejetterait tous avec
-- « function is not unique ». Autrement dit : le chemin membre tomberait en production.
-- Le DROP est donc obligatoire, et il est ici dans la MÊME transaction que le CREATE : à
-- aucun instant une autre session ne voit la fonction absente.
DROP FUNCTION IF EXISTS public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid);

CREATE OR REPLACE FUNCTION public.create_booking_atomic(
  p_member_id uuid,
  p_slot_id uuid,
  p_gym_id uuid,
  p_has_subscription boolean,
  p_existing_booking_id uuid DEFAULT NULL,
  -- ⚠️ GYM-231 — LE DÉFAUT EST `false`, ET C'EST LA GARANTIE DU CHEMIN MEMBRE.
  -- create-booking (app membre) et mark-attendance (walk-in) n'envoient pas ce paramètre :
  -- ils obtiennent donc, à l'octet près, le comportement d'avant ce lot. Seul
  -- admin-book-member le passe à `true`, et seulement quand le gérant l'a explicitement
  -- décidé avec un motif.
  p_allow_overbook boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_capacity        integer;
  v_confirmed       integer;
  v_booking_id      uuid;
  v_credit_id       uuid;
  v_idempotency_key text;
  v_activity_id     uuid;              -- GYM-231
  v_max_overbook    integer;           -- GYM-231
  v_overbooked      boolean := false;  -- GYM-231
BEGIN
  -- ⚠️ LE VERROU. Inchangé, y compris dans sa forme : c'est la ligne du CRÉNEAU qui est
  -- verrouillée, et tout le reste de la fonction s'exécute dessous.
  -- GYM-231 ajoute `activity_id` à la liste des colonnes lues — une colonne de plus sur une
  -- ligne déjà verrouillée, sans jointure ajoutée au SELECT verrouillant (une jointure
  -- externe y poserait la question du verrou sur le côté nullable, pour rien : la marge ne
  -- sert que dans un seul cas, traité plus bas).
  SELECT capacity, activity_id INTO v_capacity, v_activity_id
  FROM time_slots
  WHERE id = p_slot_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_NOT_FOUND';
  END IF;

  SELECT count(*) INTO v_confirmed
  FROM bookings
  WHERE slot_id = p_slot_id
    AND status = 'confirmed';

  IF v_confirmed >= v_capacity THEN
    -- ── GYM-231 — SEUL AJOUT DE CE LOT ────────────────────────────────────────
    -- Placement : DANS la branche « complet » et DEVANT son unique `RETURN 'full'`.
    -- Rien de ce qui précède n'est modifié, rien de ce qui suit n'est atteint autrement
    -- qu'avant. Un appelant qui ne demande pas le dépassement ressort ici, exactement
    -- comme avant ce lot — c'est la première ligne du bloc, et c'est voulu.
    IF NOT p_allow_overbook THEN
      RETURN jsonb_build_object('status', 'full');
    END IF;

    -- La marge est lue SOUS LE VERROU déjà pris, et seulement quand elle sert : sur un
    -- créneau non complet (le cas de très loin le plus fréquent), cette lecture n'a pas
    -- lieu. `activities.id` est la cible d'une clé étrangère NOT NULL depuis
    -- time_slots.activity_id : la ligne existe toujours.
    SELECT max_overbook INTO v_max_overbook
    FROM activities
    WHERE id = v_activity_id;

    -- La marge s'ajoute à la capacité, elle ne la remplace pas. Épuisée, on retombe sur le
    -- MÊME retour 'full' qu'au-dessus : l'appelant n'a pas deux façons d'apprendre qu'il
    -- n'y a plus de place, et la liste d'attente reste l'issue.
    IF v_confirmed >= v_capacity + COALESCE(v_max_overbook, 0) THEN
      RETURN jsonb_build_object('status', 'full');
    END IF;

    v_overbooked := true;
    -- ── FIN DE L'AJOUT GYM-231 ────────────────────────────────────────────────
  END IF;

  v_idempotency_key := p_member_id::text || '-' || p_slot_id::text;

  IF p_existing_booking_id IS NOT NULL THEN
    UPDATE bookings
    SET status         = 'confirmed',
        cancelled_at   = NULL,
        cancel_reason  = NULL,
        is_late_cancel = false,
        waitlist_position = NULL
    WHERE id = p_existing_booking_id
    RETURNING id INTO v_booking_id;

    IF v_booking_id IS NULL THEN
      RAISE EXCEPTION 'BOOKING_NOT_FOUND';
    END IF;
  ELSE
    INSERT INTO bookings (member_id, slot_id, gym_id, status, idempotency_key)
    VALUES (p_member_id, p_slot_id, p_gym_id, 'confirmed', v_idempotency_key)
    RETURNING id INTO v_booking_id;
  END IF;

  -- Débit FIFO partagé (trace debited_credit_id). NO_CREDIT annule toute la transaction.
  -- ⚠️ INCHANGÉ, Y COMPRIS EN DÉPASSEMENT : une place forcée est une place payée. Rien ici
  -- ne teste v_overbooked, et c'est le point.
  IF NOT p_has_subscription THEN
    v_credit_id := public.debit_credit_fifo(p_member_id, p_gym_id, v_booking_id);
  END IF;

  RETURN jsonb_build_object(
    'status', 'confirmed',
    'booking_id', v_booking_id,
    'credit_debited', (NOT p_has_subscription),
    'credit_id', v_credit_id,
    -- GYM-231 — champ AJOUTÉ, jamais retiré : les appelants existants ignorent les clés
    -- qu'ils ne lisent pas. `false` sur tout le chemin membre. Il sert à admin-book-member
    -- pour journaliser une inscription forcée SANS avoir à refaire le calcul de capacité
    -- hors du verrou, où il serait déjà faux.
    'overbooked', v_overbooked
  );
END;
$$;

-- Droits recopiés de GYM-70 à l'identique : le DROP les a emportés avec la fonction, les
-- omettre rendrait la RPC appelable par `authenticated` — c'est-à-dire par n'importe quel
-- membre connecté, en contournant toutes les gardes des Edge Functions.
REVOKE ALL ON FUNCTION public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.create_booking_atomic(uuid, uuid, uuid, boolean, uuid, boolean) IS
  'GYM-70 / GYM-231 — réservation atomique sous verrou FOR UPDATE du créneau : contrôle de '
  'capacité par COUNT live des confirmées, insertion ou réactivation, débit FIFO du crédit '
  'dans la même transaction. p_allow_overbook (défaut false) autorise le dépassement dans '
  'la limite de activities.max_overbook ; seul admin-book-member le passe à true, sur '
  'décision motivée du gérant. Retour ''full'' inchangé quand la place manque, marge '
  'comprise.';
