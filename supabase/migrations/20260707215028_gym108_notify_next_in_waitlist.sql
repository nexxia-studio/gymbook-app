-- 20260707215028_gym108_notify_next_in_waitlist.sql
-- GYM-108 — DÉCISION PRODUIT : modèle A (notify-and-wait) PARTOUT. L'auto-promotion (modèle B,
-- promote_next_in_waitlist) est abandonnée.
--
-- On extrait la logique « notifier le suivant » du cron expire_waitlist_confirmations() dans une
-- fonction partagée notify_next_in_waitlist(p_slot_id), appelée par :
--   - le cron expire_waitlist_confirmations() (refactoré ci-dessous, MÊME comportement),
--   - la branche 410 de confirm-waitlist (remplace l'appel fantôme promote_next_in_waitlist).
--
-- FICHIER SEULEMENT — non appliquée (train n°2, staging gelé pour la QA du train n°1).
--
-- ⚠️ URL cross-env : l'ancienne def hardcodait l'URL de notify-waitlist (source de la fuite
-- cross-env de l'audit 06/07). Cette migration étant PARTAGÉE staging+prod, on ne hardcode PLUS :
-- l'URL est lue via un GUC par environnement `app.notify_waitlist_url`. À poser UNE fois par env
-- à l'apply (URLs publiques, non secrètes — voir bloc APPLY en fin de fichier). Si le GUC n'est
-- pas posé, l'appel HTTP est sauté (les flags notified_at/deadline suffisent au parcours in-app) :
-- le comportement membre observable (bouton « confirmer ma place » + compte à rebours) est
-- identique.

-- 1) Fonction partagée : notifie le PROCHAIN de la file (non encore notifié).
CREATE OR REPLACE FUNCTION public.notify_next_in_waitlist(p_slot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_next_id uuid;
  v_gym_id  uuid;
  v_delay   integer;
  v_fn_url  text := current_setting('app.notify_waitlist_url', true);
BEGIN
  -- Modèle A : un seul notifié à la fois → le prochain NON notifié, par position puis booked_at.
  SELECT id, gym_id INTO v_next_id, v_gym_id
  FROM bookings
  WHERE slot_id = p_slot_id
    AND status = 'waitlisted'
    AND waitlist_notified_at IS NULL
  ORDER BY waitlist_position ASC NULLS LAST, booked_at ASC
  LIMIT 1;

  IF v_next_id IS NULL THEN
    RETURN jsonb_build_object('status', 'empty');
  END IF;

  SELECT COALESCE(waitlist_confirmation_minutes, 30) INTO v_delay
  FROM nexxia_gyms
  WHERE id = v_gym_id;
  v_delay := COALESCE(v_delay, 30);

  UPDATE bookings
  SET waitlist_notified_at = now(),
      waitlist_confirmation_deadline = now() + (v_delay * INTERVAL '1 minute')
  WHERE id = v_next_id;

  -- Email/push délégués à notify-waitlist. URL via GUC (cf. en-tête) ; sautée si non posée.
  IF v_fn_url IS NOT NULL AND v_fn_url <> '' THEN
    PERFORM net.http_post(
      url := v_fn_url,
      body := jsonb_build_object('booking_id', v_next_id),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 5000
    );
  END IF;

  RETURN jsonb_build_object('status', 'notified', 'booking_id', v_next_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_next_in_waitlist(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_next_in_waitlist(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_next_in_waitlist(uuid) TO service_role;

-- 2) Refactor du cron : cancel des expirés + notify du suivant via la fonction partagée.
--    MÊME comportement (seule l'URL passe du hardcode au GUC).
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

    PERFORM public.notify_next_in_waitlist(expired.slot_id);
  END LOOP;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- APPLY (par environnement, une fois — URL publique, PAS un secret) :
--   staging : ALTER DATABASE postgres SET app.notify_waitlist_url =
--             'https://buovgpokubrkejunmauq.supabase.co/functions/v1/notify-waitlist';
--   prod    : ALTER DATABASE postgres SET app.notify_waitlist_url =
--             'https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/notify-waitlist';
-- (pg_cron ouvre une nouvelle session à chaque run → prend le GUC en compte.)
--
-- ⚠️ DETTE PRÉ-EXISTANTE À REMONTER : l'appel à notify-waitlist n'envoie PAS de header
-- X-Internal-Secret, or notify-waitlist l'exige (→ 401). Le push/email n'était donc DÉJÀ pas
-- délivré par le cron (seuls notified_at/deadline étaient posés). Comportement conservé ici ;
-- corriger le secret est un chantier séparé (lecture Vault internal_functions_secret).
-- ─────────────────────────────────────────────────────────────────────────────
