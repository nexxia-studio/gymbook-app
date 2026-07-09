-- 20260707215028_gym108_notify_next_in_waitlist.sql
-- GYM-108 — DÉCISION PRODUIT : modèle A (notify-and-wait) PARTOUT. L'auto-promotion (modèle B,
-- promote_next_in_waitlist) est abandonnée.
-- GYM-115 : le header X-Internal-Secret exigé par l'Edge Function notify-waitlist est LU DEPUIS LE
-- VAULT et envoyé. Fin du 401 silencieux qui empêchait toute notification de place libérée.
-- Migration modifiée EN PLACE (même version) — toutes les défs sont en CREATE OR REPLACE →
-- re-apply idempotent (staging re-synchronisé par le cockpit ; prod jamais appliquée).
--
-- On extrait la logique « notifier le suivant » du cron expire_waitlist_confirmations() dans une
-- fonction partagée notify_next_in_waitlist(p_slot_id), appelée par :
--   - le cron expire_waitlist_confirmations() (refactoré ci-dessous, MÊME comportement),
--   - la branche 410 de confirm-waitlist (remplace l'appel fantôme promote_next_in_waitlist).
--
-- ⚠️ Config par environnement via le VAULT (pas de hardcode → pas de fuite cross-env de l'audit
-- 06/07). L'URL de notify-waitlist est lue du Vault (entrée `notify_waitlist_url`) — le GUC custom
-- est IMPOSABLE sur Supabase managé (ALTER DATABASE/ROLE SET → 42501 : rôle postgres non-superuser,
-- PG15 exige un GRANT SET réservé au superuser). L'URL n'est PAS un secret ; le Vault sert ici de
-- config par environnement. Si l'URL OU le secret manque au Vault, l'appel HTTP est sauté (les flags
-- notified_at/deadline suffisent au parcours in-app) : le comportement membre observable est identique.

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
  v_fn_url  text;
  v_secret  text;
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

  -- Config env lue du Vault (schéma QUALIFIÉ : vault n'est pas dans le search_path public,extensions) :
  --   - internal_functions_secret : header X-Internal-Secret exigé par notify-waitlist (sans → 401).
  --   - notify_waitlist_url        : URL de la fonction par environnement (GUC imposable → 42501).
  -- Best-effort : toute erreur de lecture Vault → NULL + WARNING, le cron ne plante JAMAIS (les flags
  -- notified_at/deadline suffisent au parcours in-app). Lecture autorisée par SECURITY DEFINER ; ACL
  -- service_role only (cf. bas) → jamais exposé à anon/authenticated.
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'internal_functions_secret';

    SELECT decrypted_secret INTO v_fn_url
    FROM vault.decrypted_secrets
    WHERE name = 'notify_waitlist_url';
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
    v_fn_url := NULL;
    RAISE WARNING '[notify_next_in_waitlist] lecture Vault (secret/url) échouée: %', SQLERRM;
  END;

  -- Email/push délégués à notify-waitlist. On n'appelle QUE si URL ET secret présents (tous deux du
  -- Vault). Poster sans header X-Internal-Secret serait un 401 garanti → interdit.
  IF v_fn_url IS NOT NULL AND v_fn_url <> '' AND v_secret IS NOT NULL AND v_secret <> '' THEN
    PERFORM net.http_post(
      url := v_fn_url,
      body := jsonb_build_object('booking_id', v_next_id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Secret', v_secret
      ),
      timeout_milliseconds := 5000
    );
  ELSE
    RAISE WARNING '[notify_next_in_waitlist] notification sautée (booking %) — %', v_next_id,
      CASE
        WHEN (v_fn_url IS NULL OR v_fn_url = '') AND (v_secret IS NULL OR v_secret = '')
          THEN 'notify_waitlist_url ET internal_functions_secret absents du Vault'
        WHEN (v_fn_url IS NULL OR v_fn_url = '')
          THEN 'notify_waitlist_url absent du Vault'
        ELSE 'internal_functions_secret absent du Vault'
      END;
  END IF;

  RETURN jsonb_build_object('status', 'notified', 'booking_id', v_next_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.notify_next_in_waitlist(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_next_in_waitlist(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_next_in_waitlist(uuid) TO service_role;

-- 2) Refactor du cron : cancel des expirés + notify du suivant via la fonction partagée.
--    MÊME comportement (URL + secret lus du Vault dans la fonction partagée).
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
-- APPLY — PRÉREQUIS PAR ENVIRONNEMENT (hors de ce commit ; à remplir avant/pendant le déploiement)
--
-- 1) URL de notify-waitlist (config env, PAS un secret) dans le VAULT — le GUC custom est imposable
--    sur Supabase managé (ALTER DATABASE/ROLE SET → 42501), d'où le Vault :
--    staging : SELECT vault.create_secret(
--                'https://buovgpokubrkejunmauq.supabase.co/functions/v1/notify-waitlist',
--                'notify_waitlist_url', 'URL notify-waitlist (config env, non secret)');
--    prod    : SELECT vault.create_secret(
--                'https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/notify-waitlist',
--                'notify_waitlist_url', 'URL notify-waitlist (config env, non secret)');
--
-- 2) Secret interne 'internal_functions_secret' dans le VAULT (GYM-115) :
--    staging : DÉJÀ posé (06/07) — présent dans vault.secrets.
--    prod    : PRÉREQUIS PROD AVANT APPLY : injecter 'internal_functions_secret' dans le Vault prod
--              via vault.create_secret, avec la MÊME valeur que le secret d'Edge Function
--              INTERNAL_FUNCTIONS_SECRET déjà posé côté prod (sinon 401). Pattern shell+pbcopy —
--              la valeur ne transite JAMAIS par le chat ni le repo.
--    Tant que le Vault ne contient pas ces entrées, notify_next_in_waitlist saute l'appel HTTP
--    (WARNING) : le cron ne plante pas, mais les emails/push de place libérée ne partent pas.
-- ─────────────────────────────────────────────────────────────────────────────
