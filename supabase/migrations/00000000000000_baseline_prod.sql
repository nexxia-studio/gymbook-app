-- ============================================================================
-- BASELINE PROD — GYM-59  (Model X : baseline unique = miroir schéma prod)
-- Source : fcjupgvmjkqztxtwymdb (gymbook-prod), pg_dump 18.4, schéma public
-- Généré le 2026-07-02. Postgres serveur : 17.6
--
-- ⚠️ NE PAS rejouer les 34 migrations Couche 2 par-dessus : elles sont DÉJÀ
--    incluses dans cette photo. Historique granulaire archivé (non rejoué) :
--    supabase/_history/
--
-- Contenu : 41 tables, RLS + policies, fonctions/triggers public,
--           + socle hors-public (event trigger RLS, trigger auth.users),
--           + extensions + cron jobs (secret masqué).
-- ============================================================================

-- ---- Extensions (idempotent ; déjà présentes sur un projet Supabase) -------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"          WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto             WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net               WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm              WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements   WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;   -- crée le schéma vault
CREATE EXTENSION IF NOT EXISTS pg_cron;          -- schéma pg_catalog (géré par Supabase)

-- ============================================================================
-- SCHÉMA PUBLIC (dump pg_dump nettoyé : sans \restrict, sans GRANT par défaut
--                sur TABLE/SEQUENCE/SCHEMA ; GRANT/REVOKE ON FUNCTION conservés)
-- ============================================================================
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: allocate_invoice_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.allocate_invoice_number(p_payment_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  existing TEXT;
  next_num BIGINT;
  invoice TEXT;
BEGIN
  SELECT invoice_number INTO existing FROM payments WHERE id = p_payment_id;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  next_num := nextval('invoice_seq');
  invoice := 'INV-' || EXTRACT(YEAR FROM now())::TEXT || '-' || LPAD(next_num::TEXT, 4, '0');

  UPDATE payments SET invoice_number = invoice, updated_at = now()
  WHERE id = p_payment_id AND invoice_number IS NULL;

  RETURN invoice;
END;
$$;


--
-- Name: check_rate_limit(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_rate_limit(p_identifier text, p_action text, p_max_attempts integer DEFAULT 5, p_window_minutes integer DEFAULT 15) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  current_attempts INTEGER;
  current_window TIMESTAMPTZ;
BEGIN
  current_window := now() - (p_window_minutes || ' minutes')::INTERVAL;
  SELECT COALESCE(SUM(attempts), 0) INTO current_attempts
  FROM rate_limits
  WHERE identifier = p_identifier
    AND action = p_action
    AND window_start > current_window;
  IF current_attempts >= p_max_attempts THEN RETURN false; END IF;
  INSERT INTO rate_limits (identifier, action, attempts)
  VALUES (p_identifier, p_action, 1)
  ON CONFLICT (identifier, action, window_start)
  DO UPDATE SET attempts = rate_limits.attempts + 1;
  RETURN true;
END;
$$;


--
-- Name: check_webhook_rate_limit(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_webhook_rate_limit(p_identifier text, p_action text, p_max_calls integer DEFAULT 10, p_window_seconds integer DEFAULT 60) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  v_window_start := NOW() - (p_window_seconds || ' seconds')::interval;

  -- Compter les appels dans la fenêtre
  SELECT attempts INTO v_count
  FROM rate_limits
  WHERE identifier    = p_identifier
    AND action        = p_action
    AND window_start  > v_window_start
  LIMIT 1;

  -- Nouveau : insérer ou mettre à jour
  INSERT INTO rate_limits (identifier, action, attempts, window_start)
  VALUES (p_identifier, p_action, 1, NOW())
  ON CONFLICT (identifier, action)
  DO UPDATE SET
    attempts     = CASE
      WHEN rate_limits.window_start > v_window_start
        THEN rate_limits.attempts + 1
      ELSE 1  -- reset si fenêtre expirée
    END,
    window_start = CASE
      WHEN rate_limits.window_start > v_window_start
        THEN rate_limits.window_start
      ELSE NOW()
    END;

  -- Bloquer si dépassement
  RETURN COALESCE(v_count, 0) < p_max_calls;
END;
$$;


--
-- Name: FUNCTION check_webhook_rate_limit(p_identifier text, p_action text, p_max_calls integer, p_window_seconds integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_webhook_rate_limit(p_identifier text, p_action text, p_max_calls integer, p_window_seconds integer) IS 'Sécurité #3 — Rate limiting pour les webhooks Mollie.
   Retourne true si autorisé, false si bloqué.
   Par défaut : 10 appels max par 60 secondes par identifier.';


--
-- Name: cleanup_expired_favorites(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_favorites() RETURNS void
    LANGUAGE sql
    AS $$
  DELETE FROM favorites
  WHERE slot_id IN (
    SELECT id FROM time_slots WHERE starts_at < now()
  );
$$;


--
-- Name: cleanup_oauth_states(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_oauth_states() RETURNS void
    LANGUAGE sql
    AS $$
  DELETE FROM oauth_states WHERE expires_at < now();
$$;


--
-- Name: create_mollie_vault_tokens(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_mollie_vault_tokens(p_gym_id uuid, p_access_token text, p_refresh_token text DEFAULT NULL::text) RETURNS TABLE(access_vault_id uuid, refresh_vault_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
DECLARE
  v_access_vault_id  uuid;
  v_refresh_vault_id uuid;
BEGIN
  -- Supprimer les anciens secrets Vault si ils existent déjà (reconnexion)
  DELETE FROM vault.secrets
  WHERE name = 'mollie_access_' || p_gym_id::text
     OR name = 'mollie_refresh_' || p_gym_id::text;

  -- Créer le secret access_token dans le Vault
  SELECT vault.create_secret(
    p_access_token,
    'mollie_access_' || p_gym_id::text,
    'Mollie OAuth access_token — gym ' || p_gym_id::text
  ) INTO v_access_vault_id;

  -- Créer le secret refresh_token dans le Vault (si fourni)
  IF p_refresh_token IS NOT NULL AND p_refresh_token != '' THEN
    SELECT vault.create_secret(
      p_refresh_token,
      'mollie_refresh_' || p_gym_id::text,
      'Mollie OAuth refresh_token — gym ' || p_gym_id::text
    ) INTO v_refresh_vault_id;
  END IF;

  RETURN QUERY SELECT v_access_vault_id, v_refresh_vault_id;
END;
$$;


--
-- Name: FUNCTION create_mollie_vault_tokens(p_gym_id uuid, p_access_token text, p_refresh_token text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_mollie_vault_tokens(p_gym_id uuid, p_access_token text, p_refresh_token text) IS 'Crée ou remplace les secrets Mollie OAuth dans Supabase Vault pour un gym.
   Retourne les UUIDs vault à stocker dans gym_mollie_connections.
   Accès service_role uniquement — ne jamais exposer côté client.';


--
-- Name: decrypt_medical(bytea, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrypt_medical(ciphertext bytea, secret_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  IF ciphertext IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO encryption_key
  FROM vault.decrypted_secrets WHERE id = secret_id;
  IF encryption_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found in Vault';
  END IF;
  RETURN convert_from(
    decrypt(ciphertext, encryption_key::BYTEA, 'aes-cbc/pad:pkcs'),
    'UTF8'
  );
END;
$$;


--
-- Name: encrypt_medical(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.encrypt_medical(plaintext text, secret_id uuid) RETURNS bytea
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  IF plaintext IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO encryption_key
  FROM vault.decrypted_secrets WHERE id = secret_id;
  IF encryption_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found in Vault';
  END IF;
  RETURN encrypt(plaintext::BYTEA, encryption_key::BYTEA, 'aes-cbc/pad:pkcs');
END;
$$;


--
-- Name: expire_waitlist_confirmations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_waitlist_confirmations() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  expired RECORD;
  next_id UUID;
  delay_minutes INTEGER;
  fn_url TEXT := 'https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/notify-waitlist';
BEGIN
  FOR expired IN
    SELECT id, slot_id, gym_id
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

    SELECT COALESCE(waitlist_confirmation_minutes, 30) INTO delay_minutes
    FROM nexxia_gyms
    WHERE id = expired.gym_id;

    SELECT id INTO next_id
    FROM bookings
    WHERE slot_id = expired.slot_id
      AND status = 'waitlisted'
      AND waitlist_notified_at IS NULL
    ORDER BY waitlist_position ASC NULLS LAST, booked_at ASC
    LIMIT 1;

    IF next_id IS NOT NULL THEN
      UPDATE bookings
      SET waitlist_notified_at = now(),
          waitlist_confirmation_deadline = now() + (delay_minutes * INTERVAL '1 minute')
      WHERE id = next_id;

      PERFORM net.http_post(
        url := fn_url,
        body := jsonb_build_object('booking_id', next_id),
        headers := jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 5000
      );
    END IF;
  END LOOP;
END;
$$;


--
-- Name: get_communication_recipients(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_communication_recipients(p_gym_id uuid, p_segment text DEFAULT 'all'::text) RETURNS TABLE(member_id uuid, first_name text, email text, push_token text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_is_service boolean := COALESCE(auth.role() = 'service_role', false);
  v_is_admin   boolean := COALESCE(is_gym_admin(), false);
  v_same_gym   boolean := COALESCE(p_gym_id = get_my_gym_id(), false);
  v_allowed    boolean;
BEGIN
  -- Autorisé si service_role, OU (admin ET même gym). Garanti non-NULL.
  v_allowed := v_is_service OR (v_is_admin AND v_same_gym);

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Accès refusé : réservé aux administrateurs du gym concerné';
  END IF;

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
    AND (
      p.notification_preferences IS NULL
      OR (p.notification_preferences->>'communications')::boolean IS NOT FALSE
    )
    AND CASE p_segment
      WHEN 'all' THEN true
      WHEN 'subscribers' THEN EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id AND ms.status = 'active'
      )
      WHEN 'drop_in' THEN NOT EXISTS (
        SELECT 1 FROM member_subscriptions ms
        WHERE ms.member_id = p.id AND ms.gym_id = p_gym_id AND ms.status = 'active'
      )
      WHEN 'present_today' THEN EXISTS (
        SELECT 1 FROM bookings b
        JOIN time_slots s ON s.id = b.slot_id
        WHERE b.member_id = p.id AND b.gym_id = p_gym_id
          AND b.status IN ('confirmed', 'no_show')
          AND (s.starts_at AT TIME ZONE 'Europe/Brussels')::date
              = (NOW() AT TIME ZONE 'Europe/Brussels')::date
      )
      ELSE true
    END;
END;
$$;


--
-- Name: FUNCTION get_communication_recipients(p_gym_id uuid, p_segment text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_communication_recipients(p_gym_id uuid, p_segment text) IS 'GYM-35 — Retourne les membres à notifier pour une communication gérant.
   Segments : all / subscribers / drop_in / present_today.
   Respecte les préférences de notification et exclut les suspendus.';


--
-- Name: get_gym_mollie_tokens(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_gym_mollie_tokens(p_gym_id uuid) RETURNS TABLE(access_token text, refresh_token text, expires_at timestamp with time zone, status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT ds.decrypted_secret
     FROM vault.decrypted_secrets ds
     WHERE ds.id = gmc.access_token_vault_id
     LIMIT 1)::text AS access_token,

    (SELECT ds.decrypted_secret
     FROM vault.decrypted_secrets ds
     WHERE ds.id = gmc.refresh_token_vault_id
     LIMIT 1)::text AS refresh_token,

    gmc.expires_at,
    gmc.status
  FROM gym_mollie_connections gmc
  WHERE gmc.gym_id = p_gym_id
  LIMIT 1;
END;
$$;


--
-- Name: FUNCTION get_gym_mollie_tokens(p_gym_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_gym_mollie_tokens(p_gym_id uuid) IS 'Déchiffre et retourne les tokens Mollie OAuth depuis Supabase Vault. Accès service_role uniquement.';


--
-- Name: get_my_gym_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_gym_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT gym_id FROM profiles
  WHERE id = auth.uid() AND deleted_at IS NULL;
$$;


--
-- Name: get_my_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT role FROM profiles
  WHERE id = auth.uid() AND deleted_at IS NULL;
$$;


--
-- Name: get_pending_reminders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_pending_reminders() RETURNS TABLE(booking_id uuid, member_id uuid, gym_id uuid, slot_id uuid, slot_starts_at timestamp with time zone, activity_name text, coach_name text, member_email text, member_first_name text, push_token text, reminder_type text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION get_pending_reminders(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_pending_reminders() IS 'GYM-32 — Retourne les bookings qui nécessitent un rappel (24h ou 2h avant le cours).
   Appelée par l''Edge Function send-reminders via pg_cron toutes les 15 minutes.
   Respecte les préférences de notification des membres.';


--
-- Name: gym_has_feature(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.gym_has_feature(p_gym_id uuid, p_feature text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT COALESCE(
    (SELECT enabled FROM nexxia_features
     WHERE gym_id = p_gym_id AND feature = p_feature),
    false
  );
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    role,
    gym_id,
    first_name,
    last_name,
    phone,
    preferred_language,
    privacy_policy_accepted_at,
    terms_accepted_at,
    marketing_consent,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'member'),
    CASE 
      WHEN NEW.raw_user_meta_data->>'gym_id' IS NOT NULL 
      THEN (NEW.raw_user_meta_data->>'gym_id')::UUID
      ELSE NULL
    END,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name',
    NEW.raw_user_meta_data->>'phone',
    COALESCE(NEW.raw_user_meta_data->>'preferred_language', 'fr'),
    CASE 
      WHEN NEW.raw_user_meta_data->>'privacy_policy_accepted' = 'true' 
      THEN now() ELSE NULL 
    END,
    CASE 
      WHEN NEW.raw_user_meta_data->>'terms_accepted' = 'true' 
      THEN now() ELSE NULL 
    END,
    COALESCE(
      (NEW.raw_user_meta_data->>'marketing_consent')::boolean, 
      false
    ),
    now(),
    now()
  );
  RETURN NEW;
END;
$$;


--
-- Name: is_gym_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_gym_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT role IN ('gym_admin', 'super_admin') FROM profiles
  WHERE id = auth.uid() AND deleted_at IS NULL;
$$;


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    AS $$
  SELECT role = 'super_admin' FROM profiles
  WHERE id = auth.uid() AND deleted_at IS NULL;
$$;


--
-- Name: mark_reminder_sent(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_reminder_sent(p_booking_id uuid, p_reminder_type text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION mark_reminder_sent(p_booking_id uuid, p_reminder_type text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.mark_reminder_sent(p_booking_id uuid, p_reminder_type text) IS 'GYM-32 — Marque un rappel comme envoyé pour éviter les doublons.
   Appelée par l''Edge Function send-reminders après chaque envoi réussi.';


--
-- Name: process_no_shows(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_no_shows() RETURNS TABLE(processed_booking_id uuid, member_id uuid, gym_id uuid, new_noshow_count integer, penalty_applied text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_booking         RECORD;
  v_new_count       integer;
  v_suspended_until timestamptz;
  v_penalty_type    text;
  v_notes           text;
BEGIN
  FOR v_booking IN
    SELECT b.id AS booking_id, b.member_id, b.gym_id, b.slot_id, s.ends_at
    FROM bookings b
    JOIN time_slots s ON s.id = b.slot_id
    WHERE b.status        = 'confirmed'
      AND b.checked_in_at IS NULL
      AND s.ends_at       < NOW() - INTERVAL '30 minutes'
      AND s.ends_at       > NOW() - INTERVAL '24 hours'
  LOOP
    UPDATE bookings SET status = 'no_show', updated_at = NOW()
    WHERE id = v_booking.booking_id;

    UPDATE profiles SET noshow_count = COALESCE(noshow_count, 0) + 1, updated_at = NOW()
    WHERE id = v_booking.member_id
    RETURNING noshow_count INTO v_new_count;

    v_suspended_until := NULL;

    IF v_new_count = 1 THEN
      v_penalty_type := 'warning';
      v_notes        := '1er no-show — avertissement. Au 2ème : suspension 48h.';
    ELSIF v_new_count = 2 THEN
      v_suspended_until := NOW() + INTERVAL '48 hours';
      v_penalty_type    := 'suspension_48h';
      v_notes           := '2ème no-show — suspension 48h.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;
    ELSE
      v_suspended_until := NOW() + INTERVAL '336 hours';
      v_penalty_type    := 'suspension_2w';
      v_notes           := v_new_count || 'ème no-show — suspension 2 semaines.';
      UPDATE profiles SET suspended_until = v_suspended_until WHERE id = v_booking.member_id;
    END IF;

    INSERT INTO penalties (gym_id, member_id, booking_id, type, applied_at, expires_at, notes)
    VALUES (v_booking.gym_id, v_booking.member_id, v_booking.booking_id,
            v_penalty_type, NOW(), v_suspended_until, v_notes);

    processed_booking_id := v_booking.booking_id;
    member_id            := v_booking.member_id;
    gym_id               := v_booking.gym_id;
    new_noshow_count     := v_new_count;
    penalty_applied      := v_penalty_type;
    RETURN NEXT;
  END LOOP;
END;
$$;


--
-- Name: FUNCTION process_no_shows(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.process_no_shows() IS 'GYM-33 — Détecte les no-shows 30 min après fin de cours et applique les pénalités.
   Règles Nico : 1er=avertissement / 2ème=48h / 3ème+=2 semaines.
   Appelée par pg_cron toutes les 30 minutes.
   Phase 2 (Claude Code) : brancher les notifications email + push.';


--
-- Name: protect_booking_immutable_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_booking_immutable_columns() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
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


--
-- Name: FUNCTION protect_booking_immutable_columns(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.protect_booking_immutable_columns() IS 'Sécurité : protège slot_id, gym_id, member_id, booked_at, subscription_id contre toute modification après création. Appliqué avant UPDATE sur bookings.';


--
-- Name: reorder_waitlist(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reorder_waitlist(p_slot_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE bookings b
  SET waitlist_position = sub.new_position
  FROM (
    SELECT id,
      ROW_NUMBER() OVER (ORDER BY booked_at ASC) AS new_position
    FROM bookings
    WHERE slot_id = p_slot_id
      AND status = 'waitlisted'
  ) sub
  WHERE b.id = sub.id
    AND b.waitlist_position IS DISTINCT FROM sub.new_position;
END;
$$;


--
-- Name: request_account_deletion(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_account_deletion(p_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE request_id UUID;
BEGIN
  INSERT INTO gdpr_requests (user_id, request_type, status)
  VALUES (p_user_id, 'deletion', 'pending')
  RETURNING id INTO request_id;
  UPDATE profiles SET deletion_requested_at = now() WHERE id = p_user_id;
  INSERT INTO audit_logs (actor_id, action, resource, resource_id)
  VALUES (p_user_id, 'gdpr.deletion_requested', 'profile', p_user_id);
  RETURN request_id;
END;
$$;


--
-- Name: resolve_plan_for_payment(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_plan_for_payment(p_gym_id uuid, p_plan_id uuid) RETURNS TABLE(plan_id uuid, gym_id uuid, name text, billing_type text, is_one_time boolean, price_cents integer, currency text, credit_count integer, duration_months integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select gp.id, gp.gym_id, gp.name, gp.billing_type, (gp.billing_type='one_time'),
         gp.price_cents, coalesce(gp.currency,'EUR'), gp.credit_count, gp.duration_months
  from public.gym_plans gp
  where gp.id=p_plan_id and gp.gym_id=p_gym_id and gp.active=true;
$$;


--
-- Name: rls_auto_enable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


--
-- Name: track_consent_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.track_consent_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.privacy_policy_version IS DISTINCT FROM NEW.privacy_policy_version) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'privacy_policy', NEW.privacy_policy_version, true);
  END IF;
  IF (TG_OP = 'UPDATE' AND OLD.marketing_consent IS DISTINCT FROM NEW.marketing_consent) THEN
    INSERT INTO consent_history (user_id, consent_type, version, granted)
    VALUES (NEW.id, 'marketing', '1.0', NEW.marketing_consent);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_mollie_vault_token(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_mollie_vault_token(p_vault_id uuid, p_new_secret text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'vault'
    AS $$
BEGIN
  IF p_vault_id IS NULL THEN
    RAISE EXCEPTION 'vault_id ne peut pas être NULL';
  END IF;

  IF p_new_secret IS NULL OR p_new_secret = '' THEN
    RAISE EXCEPTION 'Le nouveau secret ne peut pas être vide';
  END IF;

  -- Utiliser l'API officielle Supabase Vault (pas UPDATE direct sur vault.secrets)
  PERFORM vault.update_secret(p_vault_id, p_new_secret);
END;
$$;


--
-- Name: FUNCTION update_mollie_vault_token(p_vault_id uuid, p_new_secret text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_mollie_vault_token(p_vault_id uuid, p_new_secret text) IS 'Met à jour un secret Mollie existant dans Supabase Vault.
   Accès service_role uniquement.';


--
-- Name: update_slot_bookings_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_slot_bookings_count() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE time_slots SET
      bookings_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = NEW.slot_id AND status = 'confirmed'),
      waitlist_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = NEW.slot_id AND status = 'waitlisted')
    WHERE id = NEW.slot_id;
  ELSIF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    UPDATE time_slots SET
      bookings_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id) AND status = 'confirmed'),
      waitlist_count = (SELECT COUNT(*) FROM bookings WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id) AND status = 'waitlisted')
    WHERE id = COALESCE(NEW.slot_id, OLD.slot_id);
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: update_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    duration_min integer DEFAULT 60 NOT NULL,
    default_capacity integer DEFAULT 12 NOT NULL,
    default_level text DEFAULT 'all'::text,
    requires_medical_check boolean DEFAULT false,
    image_url text,
    color text,
    icon text,
    active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT activities_default_capacity_check CHECK ((default_capacity > 0)),
    CONSTRAINT activities_default_level_check CHECK ((default_level = ANY (ARRAY['all'::text, 'beginner'::text, 'intermediate'::text, 'advanced'::text]))),
    CONSTRAINT activities_duration_min_check CHECK ((duration_min > 0))
);


--
-- Name: activity_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_translations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    activity_id uuid NOT NULL,
    language text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT activity_translations_language_check CHECK ((language = ANY (ARRAY['fr'::text, 'nl'::text, 'en'::text, 'de'::text, 'lb'::text])))
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid,
    actor_id uuid,
    action text NOT NULL,
    resource text NOT NULL,
    resource_id uuid,
    old_data jsonb,
    new_data jsonb,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    member_id uuid NOT NULL,
    subscription_id uuid,
    status text DEFAULT 'confirmed'::text,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    is_late_cancel boolean DEFAULT false,
    checked_in_at timestamp with time zone,
    checked_in_method text,
    waitlist_position integer,
    promoted_from_waitlist_at timestamp with time zone,
    idempotency_key text,
    booked_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    waitlist_notified_at timestamp with time zone,
    waitlist_confirmation_deadline timestamp with time zone,
    reminder_24h_sent_at timestamp with time zone,
    reminder_2h_sent_at timestamp with time zone,
    CONSTRAINT bookings_checked_in_method_check CHECK ((checked_in_method = ANY (ARRAY['qr_code'::text, 'manual'::text, 'auto'::text]))),
    CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['confirmed'::text, 'cancelled'::text, 'no_show'::text, 'attended'::text, 'waitlisted'::text])))
);

ALTER TABLE ONLY public.bookings REPLICA IDENTITY FULL;


--
-- Name: COLUMN bookings.reminder_24h_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.reminder_24h_sent_at IS 'GYM-32 — Timestamp d''envoi du rappel 24h avant le cours. NULL = pas encore envoyé.';


--
-- Name: COLUMN bookings.reminder_2h_sent_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bookings.reminder_2h_sent_at IS 'GYM-32 — Timestamp d''envoi du rappel 2h avant le cours. NULL = pas encore envoyé.';


--
-- Name: coach_sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_sites (
    coach_id uuid NOT NULL,
    site_id uuid NOT NULL
);


--
-- Name: coaches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coaches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    profile_id uuid,
    name text NOT NULL,
    bio text,
    photo_url text,
    specialties text[],
    active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: consent_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consent_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    consent_type text NOT NULL,
    version text NOT NULL,
    granted boolean NOT NULL,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT consent_history_consent_type_check CHECK ((consent_type = ANY (ARRAY['privacy_policy'::text, 'terms'::text, 'marketing'::text, 'data_processing'::text, 'cookies'::text, 'medical_data'::text])))
);


--
-- Name: favorites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    slot_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now()
);


--
-- Name: gdpr_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gdpr_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    gym_id uuid,
    request_type text NOT NULL,
    status text DEFAULT 'pending'::text,
    reason text,
    rejection_reason text,
    must_complete_by timestamp with time zone DEFAULT (now() + '30 days'::interval),
    completed_at timestamp with time zone,
    export_url text,
    export_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gdpr_requests_request_type_check CHECK ((request_type = ANY (ARRAY['export'::text, 'deletion'::text, 'rectification'::text, 'restriction'::text, 'portability'::text]))),
    CONSTRAINT gdpr_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'rejected'::text])))
);


--
-- Name: gym_admin_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_admin_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    target_id uuid NOT NULL,
    action_type text NOT NULL,
    reason text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gym_admin_actions_action_type_check CHECK ((action_type = ANY (ARRAY['booking_create'::text, 'booking_cancel'::text, 'booking_checkin'::text, 'subscription_freeze'::text, 'subscription_credit_add'::text, 'subscription_cancel'::text, 'subscription_extend'::text, 'noshow_penalty_lift'::text, 'session_gift'::text, 'profile_update'::text, 'password_reset'::text, 'push_notification_send'::text])))
);


--
-- Name: gym_communication_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_communication_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    communication_id uuid NOT NULL,
    member_id uuid NOT NULL,
    push_sent boolean DEFAULT false,
    email_sent boolean DEFAULT false,
    sent_at timestamp with time zone DEFAULT now()
);


--
-- Name: gym_communications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_communications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    created_by uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    template text DEFAULT 'custom'::text NOT NULL,
    segment text DEFAULT 'all'::text NOT NULL,
    send_push boolean DEFAULT true NOT NULL,
    send_email boolean DEFAULT false NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    sent_at timestamp with time zone,
    recipient_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gym_communications_segment_check CHECK ((segment = ANY (ARRAY['all'::text, 'subscribers'::text, 'drop_in'::text, 'present_today'::text]))),
    CONSTRAINT gym_communications_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sending'::text, 'sent'::text, 'failed'::text]))),
    CONSTRAINT gym_communications_template_check CHECK ((template = ANY (ARRAY['info'::text, 'closure'::text, 'promo'::text, 'cancellation'::text, 'custom'::text])))
);


--
-- Name: COLUMN gym_communications.template; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gym_communications.template IS 'Templates : info (annonce générale), closure (fermeture exceptionnelle),
   promo (promotion), cancellation (annulation cours), custom (message libre)';


--
-- Name: COLUMN gym_communications.segment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.gym_communications.segment IS 'Ciblage : all (tous), subscribers (abonnés actifs),
   drop_in (sans abonnement), present_today (présents aujourd''hui)';


--
-- Name: gym_mollie_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_mollie_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    access_token_vault_id uuid,
    refresh_token_vault_id uuid,
    mollie_profile_id text,
    mollie_account_id text,
    mollie_account_name text,
    scope text[],
    expires_at timestamp with time zone,
    connected_at timestamp with time zone DEFAULT now(),
    last_refreshed_at timestamp with time zone,
    status text DEFAULT 'active'::text,
    CONSTRAINT gym_mollie_connections_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text, 'refresh_failed'::text])))
);


--
-- Name: gym_plan_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_plan_translations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_id uuid NOT NULL,
    language text NOT NULL,
    name text NOT NULL,
    description text,
    features text[],
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gym_plan_translations_language_check CHECK ((language = ANY (ARRAY['fr'::text, 'nl'::text, 'en'::text, 'de'::text, 'lb'::text])))
);


--
-- Name: gym_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    duration_months integer,
    credit_count integer,
    price_cents integer NOT NULL,
    currency text DEFAULT 'EUR'::text,
    billing_type text DEFAULT 'one_time'::text,
    site_access text DEFAULT 'single'::text,
    description text,
    features text[],
    is_popular boolean DEFAULT false,
    active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gym_plans_billing_type_check CHECK ((billing_type = ANY (ARRAY['one_time'::text, 'recurring_fixed'::text, 'recurring_infinite'::text]))),
    CONSTRAINT gym_plans_check CHECK ((((type = 'unlimited'::text) AND (duration_months IS NOT NULL)) OR ((type = 'credits'::text) AND (credit_count IS NOT NULL)))),
    CONSTRAINT gym_plans_credit_count_check CHECK (((credit_count IS NULL) OR (credit_count > 0))),
    CONSTRAINT gym_plans_duration_months_check CHECK (((duration_months IS NULL) OR (duration_months > 0))),
    CONSTRAINT gym_plans_price_cents_check CHECK ((price_cents >= 0)),
    CONSTRAINT gym_plans_site_access_check CHECK ((site_access = ANY (ARRAY['single'::text, 'all'::text]))),
    CONSTRAINT gym_plans_type_check CHECK ((type = ANY (ARRAY['unlimited'::text, 'credits'::text])))
);


--
-- Name: gym_sites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_sites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    address text NOT NULL,
    city text NOT NULL,
    postal_code text,
    country text DEFAULT 'BE'::text,
    phone text,
    email text,
    latitude numeric(10,8),
    longitude numeric(11,8),
    is_main_site boolean DEFAULT false,
    active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: gym_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid,
    subscription_id uuid,
    amount_cents integer NOT NULL,
    vat_cents integer DEFAULT 0,
    total_cents integer NOT NULL,
    currency text DEFAULT 'EUR'::text,
    status text DEFAULT 'pending'::text,
    payment_method text,
    mollie_payment_id text,
    mollie_order_id text,
    idempotency_key text,
    description text,
    invoice_number text,
    paid_at timestamp with time zone,
    refunded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT gym_transactions_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT gym_transactions_payment_method_check CHECK ((payment_method = ANY (ARRAY['card'::text, 'bancontact'::text, 'apple_pay'::text, 'google_pay'::text, 'sepa'::text, 'cash'::text]))),
    CONSTRAINT gym_transactions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text, 'partially_refunded'::text])))
);


--
-- Name: impersonation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impersonation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    super_admin_id uuid NOT NULL,
    target_user_id uuid NOT NULL,
    target_gym_id uuid,
    reason text NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone,
    ip_address inet
);


--
-- Name: invoice_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.invoice_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text,
    user_id uuid,
    ip_address inet,
    user_agent text,
    success boolean DEFAULT false,
    failure_reason text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: medical_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.medical_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    notes_encrypted bytea,
    conditions_encrypted bytea,
    has_medical_certificate boolean DEFAULT false,
    certificate_url text,
    certificate_expires_at date,
    restricted_activities text[],
    encrypted_at timestamp with time zone,
    encrypted_by uuid,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: member_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    plan_id text,
    credits_total integer DEFAULT 0 NOT NULL,
    credits_used integer DEFAULT 0 NOT NULL,
    credits_remaining integer GENERATED ALWAYS AS ((credits_total - credits_used)) STORED,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: member_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    plan_id uuid,
    site_id uuid,
    status text DEFAULT 'active'::text,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone,
    credits_remaining integer,
    credits_total integer,
    paused_at timestamp with time zone,
    pause_resumes_at timestamp with time zone,
    suspended_until timestamp with time zone,
    mollie_subscription_id text,
    mollie_customer_id text,
    auto_renew boolean DEFAULT true,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    plan_code text,
    plan_name text,
    amount numeric(10,2),
    next_payment_at timestamp with time zone,
    payments_count integer DEFAULT 0,
    max_payments integer,
    CONSTRAINT member_subscriptions_credits_remaining_check CHECK (((credits_remaining IS NULL) OR (credits_remaining >= 0))),
    CONSTRAINT member_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'expired'::text, 'cancelled'::text, 'paused'::text])))
);


--
-- Name: mollie_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mollie_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    gym_admin_id uuid NOT NULL,
    mollie_profile_id text,
    mollie_profile_name text,
    access_token text NOT NULL,
    refresh_token text,
    expires_at timestamp with time zone,
    is_test_mode boolean DEFAULT true,
    connected_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: mollie_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mollie_customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    mollie_customer_id text NOT NULL,
    has_valid_mandate boolean DEFAULT false,
    mollie_mandate_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: mollie_oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mollie_oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    state text NOT NULL,
    gym_admin_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: nexxia_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nexxia_features (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    feature text NOT NULL,
    enabled boolean DEFAULT false,
    config jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT nexxia_features_feature_check CHECK ((feature = ANY (ARRAY['ios_app'::text, 'android_app'::text, 'web_app'::text, 'analytics'::text, 'multi_site'::text, 'marketing_emails'::text, 'sms_notifications'::text, 'custom_branding'::text, 'api_access'::text, 'qr_code_checkin'::text, 'waitlist_priority'::text, 'gift_cards'::text, 'payments_enabled'::text, 'export_enabled'::text, 'medical_notes'::text])))
);


--
-- Name: nexxia_gyms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nexxia_gyms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    subdomain text,
    address text,
    city text,
    postal_code text,
    country text DEFAULT 'BE'::text,
    phone text,
    email text,
    vat_number text,
    company_name text,
    logo_url text,
    primary_color text DEFAULT '#C8F000'::text,
    secondary_color text DEFAULT '#111111'::text,
    mollie_vault_secret_id uuid,
    mollie_profile_id text,
    status text DEFAULT 'trialing'::text,
    plan text DEFAULT 'free'::text,
    trial_started_at timestamp with time zone DEFAULT now(),
    trial_ends_at timestamp with time zone DEFAULT (now() + '14 days'::interval),
    onboarding_completed boolean DEFAULT false,
    onboarding_step integer DEFAULT 1,
    timezone text DEFAULT 'Europe/Brussels'::text,
    currency text DEFAULT 'EUR'::text,
    default_language text DEFAULT 'fr'::text,
    supported_languages text[] DEFAULT ARRAY['fr'::text],
    dpo_name text,
    dpo_email text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    waitlist_confirmation_minutes integer DEFAULT 30 NOT NULL,
    commission_cb_rate_override numeric(6,4) DEFAULT NULL::numeric,
    commission_sepa_rate_override numeric(6,4) DEFAULT NULL::numeric,
    CONSTRAINT nexxia_gyms_default_language_check CHECK ((default_language = ANY (ARRAY['fr'::text, 'nl'::text, 'en'::text, 'de'::text, 'lb'::text]))),
    CONSTRAINT nexxia_gyms_onboarding_step_check CHECK (((onboarding_step >= 1) AND (onboarding_step <= 5))),
    CONSTRAINT nexxia_gyms_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'starter'::text, 'studio'::text, 'pro'::text]))),
    CONSTRAINT nexxia_gyms_status_check CHECK ((status = ANY (ARRAY['active'::text, 'trialing'::text, 'suspended'::text, 'cancelled'::text]))),
    CONSTRAINT waitlist_confirmation_minutes_range CHECK (((waitlist_confirmation_minutes >= 10) AND (waitlist_confirmation_minutes <= 120)))
);


--
-- Name: nexxia_invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nexxia_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    subscription_id uuid,
    invoice_number text NOT NULL,
    amount_cents integer NOT NULL,
    vat_cents integer DEFAULT 0,
    total_cents integer NOT NULL,
    currency text DEFAULT 'EUR'::text,
    status text DEFAULT 'pending'::text,
    mollie_payment_id text,
    pdf_url text,
    due_at timestamp with time zone,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT nexxia_invoices_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text])))
);


--
-- Name: nexxia_plan_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nexxia_plan_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan text NOT NULL,
    max_members integer,
    max_slots_per_month integer,
    max_admins integer DEFAULT 1,
    max_sites integer DEFAULT 1,
    trial_days integer DEFAULT 14,
    custom_domain boolean DEFAULT false,
    payments_enabled boolean DEFAULT false,
    notifications_enabled boolean DEFAULT false,
    analytics_enabled boolean DEFAULT false,
    multi_site_enabled boolean DEFAULT false,
    ios_app_enabled boolean DEFAULT false,
    android_app_enabled boolean DEFAULT false,
    qr_checkin_enabled boolean DEFAULT false,
    export_enabled boolean DEFAULT false,
    api_access_enabled boolean DEFAULT false,
    price_cents integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    commission_sepa_rate numeric(5,4) DEFAULT 0 NOT NULL,
    commission_cb_rate numeric(5,4) DEFAULT 0 NOT NULL,
    CONSTRAINT nexxia_plan_limits_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'starter'::text, 'studio'::text, 'pro'::text])))
);


--
-- Name: COLUMN nexxia_plan_limits.commission_sepa_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nexxia_plan_limits.commission_sepa_rate IS 'Commission Nexxia sur paiements SEPA récurrents. Ex: 0.015 = 1,5%';


--
-- Name: COLUMN nexxia_plan_limits.commission_cb_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.nexxia_plan_limits.commission_cb_rate IS 'Commission Nexxia sur paiements CB one-time (drop-in, carnets). Ex: 0.020 = 2,0%';


--
-- Name: nexxia_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nexxia_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    plan text NOT NULL,
    status text DEFAULT 'active'::text,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'EUR'::text,
    billing_cycle text DEFAULT 'monthly'::text,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    commitment_months integer DEFAULT 24,
    commitment_ends_at timestamp with time zone,
    mollie_subscription_id text,
    mollie_customer_id text,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT nexxia_subscriptions_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT nexxia_subscriptions_billing_cycle_check CHECK ((billing_cycle = ANY (ARRAY['monthly'::text, 'yearly'::text]))),
    CONSTRAINT nexxia_subscriptions_plan_check CHECK ((plan = ANY (ARRAY['free'::text, 'starter'::text, 'pro'::text, 'pro_plus'::text]))),
    CONSTRAINT nexxia_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'past_due'::text, 'cancelled'::text, 'trialing'::text])))
);


--
-- Name: noshow_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.noshow_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    late_cancel_hours integer DEFAULT 2,
    warning_1_at integer DEFAULT 1,
    warning_2_at integer DEFAULT 2,
    suspension_at integer DEFAULT 3,
    suspension_hours integer DEFAULT 48,
    reset_after_days integer DEFAULT 90,
    max_active_bookings integer DEFAULT 2,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    escalated_suspension_hours integer DEFAULT 336,
    CONSTRAINT noshow_rules_late_cancel_hours_check CHECK ((late_cancel_hours >= 0)),
    CONSTRAINT noshow_rules_max_active_bookings_check CHECK ((max_active_bookings > 0)),
    CONSTRAINT noshow_rules_reset_after_days_check CHECK ((reset_after_days > 0)),
    CONSTRAINT noshow_rules_suspension_at_check CHECK ((suspension_at > 0)),
    CONSTRAINT noshow_rules_suspension_hours_check CHECK ((suspension_hours > 0)),
    CONSTRAINT noshow_rules_warning_1_at_check CHECK ((warning_1_at > 0)),
    CONSTRAINT noshow_rules_warning_2_at_check CHECK ((warning_2_at > 0))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb,
    read boolean DEFAULT false,
    sent_at timestamp with time zone,
    read_at timestamp with time zone,
    push_sent boolean DEFAULT false,
    email_sent boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['booking_confirmed'::text, 'booking_cancelled'::text, 'booking_reminder'::text, 'waitlist_promoted'::text, 'session_cancelled_by_gym'::text, 'no_show_warning_1'::text, 'no_show_warning_2'::text, 'no_show_suspension'::text, 'subscription_expiring'::text, 'subscription_renewed'::text, 'subscription_payment_failed'::text, 'subscription_activated'::text, 'profile_completion_reward'::text, 'medical_certificate_expiring'::text, 'security_new_login'::text, 'security_password_changed'::text, 'site_new_available'::text, 'plan_upgraded'::text, 'trial_ending'::text])))
);


--
-- Name: oauth_states; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_states (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    state text NOT NULL,
    gym_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE oauth_states; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.oauth_states IS 'Tokens CSRF pour le flow OAuth Mollie. Accès service_role uniquement via Edge Functions. Aucun accès client autorisé.';


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    mollie_payment_id text,
    plan_id text NOT NULL,
    plan_name text NOT NULL,
    amount numeric(10,2) NOT NULL,
    currency text DEFAULT 'EUR'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    payment_method text,
    checkout_url text,
    credits_granted integer DEFAULT 0,
    nexxia_fee numeric(10,2),
    paid_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    invoice_number text,
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'failed'::text, 'expired'::text, 'canceled'::text])))
);


--
-- Name: penalties; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.penalties (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    booking_id uuid,
    type text NOT NULL,
    applied_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    notes text,
    CONSTRAINT penalties_type_check CHECK ((type = ANY (ARRAY['warning_1'::text, 'warning_2'::text, 'suspension'::text, 'reset'::text])))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    gym_id uuid,
    role text NOT NULL,
    first_name text,
    last_name text,
    email text NOT NULL,
    phone text,
    date_of_birth date,
    gender text,
    avatar_url text,
    address_line text,
    city text,
    postal_code text,
    country text DEFAULT 'BE'::text,
    emergency_contact_name text,
    emergency_contact_phone text,
    preferred_language text DEFAULT 'fr'::text,
    profile_completion integer DEFAULT 0,
    reward_unlocked boolean DEFAULT false,
    noshow_count integer DEFAULT 0,
    suspended_until timestamp with time zone,
    two_factor_enabled boolean DEFAULT false,
    two_factor_required boolean DEFAULT false,
    privacy_policy_accepted_at timestamp with time zone,
    privacy_policy_version text,
    terms_accepted_at timestamp with time zone,
    terms_version text,
    marketing_consent boolean DEFAULT false,
    marketing_consent_at timestamp with time zone,
    data_processing_consent boolean DEFAULT false,
    data_processing_consent_at timestamp with time zone,
    member_since timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    deleted_at timestamp with time zone,
    deletion_requested_at timestamp with time zone,
    push_token text,
    street_name text,
    street_number text,
    notification_preferences jsonb DEFAULT '{"push_noshow": true, "email_noshow": true, "push_booking": true, "email_booking": true, "push_reminder": true, "push_waitlist": true, "email_reminder": true, "email_waitlist": true}'::jsonb,
    CONSTRAINT profiles_gender_check CHECK ((gender = ANY (ARRAY['male'::text, 'female'::text, 'other'::text, 'prefer_not_say'::text]))),
    CONSTRAINT profiles_preferred_language_check CHECK ((preferred_language = ANY (ARRAY['fr'::text, 'nl'::text, 'en'::text, 'de'::text, 'lb'::text]))),
    CONSTRAINT profiles_profile_completion_check CHECK (((profile_completion >= 0) AND (profile_completion <= 100))),
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['super_admin'::text, 'gym_admin'::text, 'coach'::text, 'member'::text])))
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    action text NOT NULL,
    attempts integer DEFAULT 1,
    window_start timestamp with time zone DEFAULT now(),
    blocked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE rate_limits; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.rate_limits IS 'Rate limiting des actions sensibles (login, paiements). Accès service_role uniquement via Edge Functions. Aucun accès client autorisé.';


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    member_id uuid NOT NULL,
    plan_id text NOT NULL,
    plan_name text NOT NULL,
    price numeric(10,2) NOT NULL,
    price_unit text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now(),
    ends_at timestamp with time zone,
    next_billing_date timestamp with time zone,
    mollie_subscription_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: super_admin_proxy_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.super_admin_proxy_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    super_admin_id uuid NOT NULL,
    target_gym_id uuid NOT NULL,
    target_admin_id uuid,
    action_type text NOT NULL,
    reason text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT super_admin_proxy_actions_action_type_check CHECK ((action_type = ANY (ARRAY['gym_config_update'::text, 'activity_create'::text, 'activity_update'::text, 'activity_delete'::text, 'coach_create'::text, 'coach_update'::text, 'coach_delete'::text, 'slot_create'::text, 'slot_update'::text, 'slot_delete'::text, 'plan_create'::text, 'plan_update'::text, 'plan_delete'::text, 'noshow_rules_update'::text, 'member_create'::text, 'member_import'::text, 'subscription_modify'::text, 'subscription_refund'::text, 'mollie_reset'::text, 'data_sync_force'::text, 'free_period_grant'::text])))
);


--
-- Name: time_slots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_slots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gym_id uuid NOT NULL,
    site_id uuid,
    activity_id uuid NOT NULL,
    coach_id uuid,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    capacity integer NOT NULL,
    level text DEFAULT 'all'::text,
    bookings_count integer DEFAULT 0,
    waitlist_count integer DEFAULT 0,
    status text DEFAULT 'scheduled'::text,
    cancellation_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT time_slots_capacity_check CHECK ((capacity > 0)),
    CONSTRAINT time_slots_check CHECK ((ends_at > starts_at)),
    CONSTRAINT time_slots_level_check CHECK ((level = ANY (ARRAY['all'::text, 'beginner'::text, 'intermediate'::text, 'advanced'::text]))),
    CONSTRAINT time_slots_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'cancelled'::text, 'completed'::text])))
);

ALTER TABLE ONLY public.time_slots REPLICA IDENTITY FULL;


--
-- Name: user_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    device_type text,
    device_name text,
    push_token text NOT NULL,
    push_provider text DEFAULT 'expo'::text,
    app_version text,
    os_version text,
    active boolean DEFAULT true,
    last_used_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT user_devices_device_type_check CHECK ((device_type = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text]))),
    CONSTRAINT user_devices_push_provider_check CHECK ((push_provider = ANY (ARRAY['expo'::text, 'fcm'::text, 'apns'::text])))
);


--
-- Name: activities activities_gym_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_gym_id_slug_key UNIQUE (gym_id, slug);


--
-- Name: activities activities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_pkey PRIMARY KEY (id);


--
-- Name: activity_translations activity_translations_activity_id_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_translations
    ADD CONSTRAINT activity_translations_activity_id_language_key UNIQUE (activity_id, language);


--
-- Name: activity_translations activity_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_translations
    ADD CONSTRAINT activity_translations_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_slot_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_slot_id_member_id_key UNIQUE (slot_id, member_id);


--
-- Name: coach_sites coach_sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_sites
    ADD CONSTRAINT coach_sites_pkey PRIMARY KEY (coach_id, site_id);


--
-- Name: coaches coaches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaches
    ADD CONSTRAINT coaches_pkey PRIMARY KEY (id);


--
-- Name: consent_history consent_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_history
    ADD CONSTRAINT consent_history_pkey PRIMARY KEY (id);


--
-- Name: favorites favorites_member_id_slot_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_member_id_slot_id_key UNIQUE (member_id, slot_id);


--
-- Name: favorites favorites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_pkey PRIMARY KEY (id);


--
-- Name: gdpr_requests gdpr_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gdpr_requests
    ADD CONSTRAINT gdpr_requests_pkey PRIMARY KEY (id);


--
-- Name: gym_admin_actions gym_admin_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_admin_actions
    ADD CONSTRAINT gym_admin_actions_pkey PRIMARY KEY (id);


--
-- Name: gym_communication_recipients gym_communication_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_communication_recipients
    ADD CONSTRAINT gym_communication_recipients_pkey PRIMARY KEY (id);


--
-- Name: gym_communications gym_communications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_communications
    ADD CONSTRAINT gym_communications_pkey PRIMARY KEY (id);


--
-- Name: gym_mollie_connections gym_mollie_connections_gym_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_mollie_connections
    ADD CONSTRAINT gym_mollie_connections_gym_id_key UNIQUE (gym_id);


--
-- Name: gym_mollie_connections gym_mollie_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_mollie_connections
    ADD CONSTRAINT gym_mollie_connections_pkey PRIMARY KEY (id);


--
-- Name: gym_plan_translations gym_plan_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_plan_translations
    ADD CONSTRAINT gym_plan_translations_pkey PRIMARY KEY (id);


--
-- Name: gym_plan_translations gym_plan_translations_plan_id_language_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_plan_translations
    ADD CONSTRAINT gym_plan_translations_plan_id_language_key UNIQUE (plan_id, language);


--
-- Name: gym_plans gym_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_plans
    ADD CONSTRAINT gym_plans_pkey PRIMARY KEY (id);


--
-- Name: gym_sites gym_sites_gym_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_sites
    ADD CONSTRAINT gym_sites_gym_id_slug_key UNIQUE (gym_id, slug);


--
-- Name: gym_sites gym_sites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_sites
    ADD CONSTRAINT gym_sites_pkey PRIMARY KEY (id);


--
-- Name: gym_transactions gym_transactions_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_transactions
    ADD CONSTRAINT gym_transactions_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: gym_transactions gym_transactions_mollie_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_transactions
    ADD CONSTRAINT gym_transactions_mollie_payment_id_key UNIQUE (mollie_payment_id);


--
-- Name: gym_transactions gym_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_transactions
    ADD CONSTRAINT gym_transactions_pkey PRIMARY KEY (id);


--
-- Name: impersonation_logs impersonation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_logs
    ADD CONSTRAINT impersonation_logs_pkey PRIMARY KEY (id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (id);


--
-- Name: medical_notes medical_notes_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_notes
    ADD CONSTRAINT medical_notes_member_id_key UNIQUE (member_id);


--
-- Name: medical_notes medical_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_notes
    ADD CONSTRAINT medical_notes_pkey PRIMARY KEY (id);


--
-- Name: member_credits member_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_credits
    ADD CONSTRAINT member_credits_pkey PRIMARY KEY (id);


--
-- Name: member_subscriptions member_subscriptions_mollie_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_subscriptions
    ADD CONSTRAINT member_subscriptions_mollie_subscription_id_key UNIQUE (mollie_subscription_id);


--
-- Name: member_subscriptions member_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_subscriptions
    ADD CONSTRAINT member_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: mollie_connections mollie_connections_gym_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_connections
    ADD CONSTRAINT mollie_connections_gym_id_key UNIQUE (gym_id);


--
-- Name: mollie_connections mollie_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_connections
    ADD CONSTRAINT mollie_connections_pkey PRIMARY KEY (id);


--
-- Name: mollie_customers mollie_customers_gym_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_customers
    ADD CONSTRAINT mollie_customers_gym_id_member_id_key UNIQUE (gym_id, member_id);


--
-- Name: mollie_customers mollie_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_customers
    ADD CONSTRAINT mollie_customers_pkey PRIMARY KEY (id);


--
-- Name: mollie_oauth_states mollie_oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_oauth_states
    ADD CONSTRAINT mollie_oauth_states_pkey PRIMARY KEY (id);


--
-- Name: mollie_oauth_states mollie_oauth_states_state_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_oauth_states
    ADD CONSTRAINT mollie_oauth_states_state_key UNIQUE (state);


--
-- Name: nexxia_features nexxia_features_gym_id_feature_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_features
    ADD CONSTRAINT nexxia_features_gym_id_feature_key UNIQUE (gym_id, feature);


--
-- Name: nexxia_features nexxia_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_features
    ADD CONSTRAINT nexxia_features_pkey PRIMARY KEY (id);


--
-- Name: nexxia_gyms nexxia_gyms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_gyms
    ADD CONSTRAINT nexxia_gyms_pkey PRIMARY KEY (id);


--
-- Name: nexxia_gyms nexxia_gyms_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_gyms
    ADD CONSTRAINT nexxia_gyms_slug_key UNIQUE (slug);


--
-- Name: nexxia_gyms nexxia_gyms_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_gyms
    ADD CONSTRAINT nexxia_gyms_subdomain_key UNIQUE (subdomain);


--
-- Name: nexxia_invoices nexxia_invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_invoices
    ADD CONSTRAINT nexxia_invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: nexxia_invoices nexxia_invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_invoices
    ADD CONSTRAINT nexxia_invoices_pkey PRIMARY KEY (id);


--
-- Name: nexxia_plan_limits nexxia_plan_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_plan_limits
    ADD CONSTRAINT nexxia_plan_limits_pkey PRIMARY KEY (id);


--
-- Name: nexxia_plan_limits nexxia_plan_limits_plan_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_plan_limits
    ADD CONSTRAINT nexxia_plan_limits_plan_key UNIQUE (plan);


--
-- Name: nexxia_subscriptions nexxia_subscriptions_mollie_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_subscriptions
    ADD CONSTRAINT nexxia_subscriptions_mollie_subscription_id_key UNIQUE (mollie_subscription_id);


--
-- Name: nexxia_subscriptions nexxia_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_subscriptions
    ADD CONSTRAINT nexxia_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: noshow_rules noshow_rules_gym_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noshow_rules
    ADD CONSTRAINT noshow_rules_gym_id_key UNIQUE (gym_id);


--
-- Name: noshow_rules noshow_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noshow_rules
    ADD CONSTRAINT noshow_rules_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: oauth_states oauth_states_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_states oauth_states_state_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_state_key UNIQUE (state);


--
-- Name: payments payments_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_number_key UNIQUE (invoice_number);


--
-- Name: payments payments_mollie_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_mollie_payment_id_key UNIQUE (mollie_payment_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: penalties penalties_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalties
    ADD CONSTRAINT penalties_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: rate_limits rate_limits_identifier_action_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_identifier_action_key UNIQUE (identifier, action);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: super_admin_proxy_actions super_admin_proxy_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.super_admin_proxy_actions
    ADD CONSTRAINT super_admin_proxy_actions_pkey PRIMARY KEY (id);


--
-- Name: time_slots time_slots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_slots
    ADD CONSTRAINT time_slots_pkey PRIMARY KEY (id);


--
-- Name: user_devices user_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_pkey PRIMARY KEY (id);


--
-- Name: user_devices user_devices_user_id_push_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_user_id_push_token_key UNIQUE (user_id, push_token);


--
-- Name: idx_activities_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activities_gym ON public.activities USING btree (gym_id) WHERE (active = true);


--
-- Name: idx_activity_translations; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_activity_translations ON public.activity_translations USING btree (activity_id, language);


--
-- Name: idx_admin_actions_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_gym ON public.gym_admin_actions USING btree (gym_id, created_at DESC);


--
-- Name: idx_admin_actions_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_actions_target ON public.gym_admin_actions USING btree (target_id, created_at DESC);


--
-- Name: idx_audit_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_actor ON public.audit_logs USING btree (actor_id, created_at DESC);


--
-- Name: idx_audit_gym_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_gym_action ON public.audit_logs USING btree (gym_id, action, created_at DESC);


--
-- Name: idx_bookings_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_active ON public.bookings USING btree (member_id) WHERE (status = 'confirmed'::text);


--
-- Name: idx_bookings_gym_booked; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_gym_booked ON public.bookings USING btree (gym_id, booked_at);


--
-- Name: idx_bookings_member_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_member_status ON public.bookings USING btree (member_id, status);


--
-- Name: idx_bookings_reminders; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_reminders ON public.bookings USING btree (status, reminder_24h_sent_at, reminder_2h_sent_at) WHERE (status = 'confirmed'::text);


--
-- Name: idx_bookings_slot_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_slot_status ON public.bookings USING btree (slot_id, status);


--
-- Name: idx_coaches_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaches_gym ON public.coaches USING btree (gym_id) WHERE (active = true);


--
-- Name: idx_consent_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_consent_user ON public.consent_history USING btree (user_id, consent_type, created_at DESC);


--
-- Name: idx_devices_user_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_devices_user_active ON public.user_devices USING btree (user_id) WHERE (active = true);


--
-- Name: idx_favorites_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_favorites_member ON public.favorites USING btree (member_id);


--
-- Name: idx_features_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_features_gym ON public.nexxia_features USING btree (gym_id);


--
-- Name: idx_gdpr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gdpr_status ON public.gdpr_requests USING btree (status, must_complete_by);


--
-- Name: idx_gym_communication_recipients_comm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_communication_recipients_comm ON public.gym_communication_recipients USING btree (communication_id);


--
-- Name: idx_gym_communications_gym_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_communications_gym_id ON public.gym_communications USING btree (gym_id, created_at DESC);


--
-- Name: idx_gyms_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gyms_plan ON public.nexxia_gyms USING btree (plan) WHERE (deleted_at IS NULL);


--
-- Name: idx_gyms_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gyms_slug ON public.nexxia_gyms USING btree (slug) WHERE (deleted_at IS NULL);


--
-- Name: idx_gyms_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gyms_status ON public.nexxia_gyms USING btree (status) WHERE (deleted_at IS NULL);


--
-- Name: idx_impersonation_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impersonation_admin ON public.impersonation_logs USING btree (super_admin_id, started_at DESC);


--
-- Name: idx_impersonation_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impersonation_target ON public.impersonation_logs USING btree (target_user_id, started_at DESC);


--
-- Name: idx_invoices_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_gym ON public.nexxia_invoices USING btree (gym_id);


--
-- Name: idx_invoices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_status ON public.nexxia_invoices USING btree (status);


--
-- Name: idx_login_attempts_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_email ON public.login_attempts USING btree (email, created_at DESC);


--
-- Name: idx_login_attempts_ip; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_attempts_ip ON public.login_attempts USING btree (ip_address, created_at DESC);


--
-- Name: idx_medical_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_medical_member ON public.medical_notes USING btree (member_id);


--
-- Name: idx_member_credits_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_credits_member ON public.member_credits USING btree (member_id);


--
-- Name: idx_member_subs_ends_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_subs_ends_at ON public.member_subscriptions USING btree (ends_at) WHERE (status = 'active'::text);


--
-- Name: idx_member_subs_gym_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_subs_gym_status ON public.member_subscriptions USING btree (gym_id, status);


--
-- Name: idx_member_subs_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_subs_member ON public.member_subscriptions USING btree (member_id, status);


--
-- Name: idx_member_subscriptions_member_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_subscriptions_member_status ON public.member_subscriptions USING btree (member_id, status);


--
-- Name: idx_member_subscriptions_mollie; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_subscriptions_mollie ON public.member_subscriptions USING btree (mollie_subscription_id);


--
-- Name: idx_mollie_connections_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mollie_connections_gym ON public.gym_mollie_connections USING btree (gym_id);


--
-- Name: idx_mollie_connections_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mollie_connections_status ON public.gym_mollie_connections USING btree (status);


--
-- Name: idx_mollie_customers_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mollie_customers_member ON public.mollie_customers USING btree (member_id);


--
-- Name: idx_mollie_oauth_states_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mollie_oauth_states_expires ON public.mollie_oauth_states USING btree (expires_at);


--
-- Name: idx_mollie_oauth_states_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mollie_oauth_states_state ON public.mollie_oauth_states USING btree (state);


--
-- Name: idx_nexxia_subs_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nexxia_subs_gym ON public.nexxia_subscriptions USING btree (gym_id);


--
-- Name: idx_nexxia_subs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nexxia_subs_status ON public.nexxia_subscriptions USING btree (status);


--
-- Name: idx_notifs_member_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifs_member_unread ON public.notifications USING btree (member_id, read, created_at DESC);


--
-- Name: idx_oauth_states_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oauth_states_expires ON public.oauth_states USING btree (expires_at);


--
-- Name: idx_payments_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_gym ON public.payments USING btree (gym_id, created_at);


--
-- Name: idx_payments_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_member ON public.payments USING btree (member_id, status);


--
-- Name: idx_payments_mollie; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_mollie ON public.payments USING btree (mollie_payment_id);


--
-- Name: idx_penalties_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_penalties_member ON public.penalties USING btree (member_id, applied_at);


--
-- Name: idx_plans_gym_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plans_gym_active ON public.gym_plans USING btree (gym_id) WHERE (active = true);


--
-- Name: idx_profiles_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_email ON public.profiles USING btree (email) WHERE (deleted_at IS NULL);


--
-- Name: idx_profiles_gym_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_gym_role ON public.profiles USING btree (gym_id, role) WHERE (deleted_at IS NULL);


--
-- Name: idx_profiles_push_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_push_token ON public.profiles USING btree (push_token) WHERE (push_token IS NOT NULL);


--
-- Name: idx_rate_limits_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rate_limits_lookup ON public.rate_limits USING btree (identifier, action, window_start);


--
-- Name: idx_sites_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sites_gym ON public.gym_sites USING btree (gym_id) WHERE (active = true);


--
-- Name: idx_slots_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slots_activity ON public.time_slots USING btree (activity_id);


--
-- Name: idx_slots_coach; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slots_coach ON public.time_slots USING btree (coach_id);


--
-- Name: idx_slots_gym_starts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slots_gym_starts ON public.time_slots USING btree (gym_id, starts_at) WHERE (status = 'scheduled'::text);


--
-- Name: idx_slots_site; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slots_site ON public.time_slots USING btree (site_id);


--
-- Name: idx_slots_upcoming; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_slots_upcoming ON public.time_slots USING btree (gym_id, starts_at) WHERE (status = 'scheduled'::text);


--
-- Name: idx_super_proxy_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_super_proxy_admin ON public.super_admin_proxy_actions USING btree (super_admin_id, created_at DESC);


--
-- Name: idx_super_proxy_gym; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_super_proxy_gym ON public.super_admin_proxy_actions USING btree (target_gym_id, created_at DESC);


--
-- Name: idx_transactions_gym_paid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_gym_paid ON public.gym_transactions USING btree (gym_id, paid_at);


--
-- Name: idx_transactions_idempotency; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_idempotency ON public.gym_transactions USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: idx_transactions_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_member ON public.gym_transactions USING btree (member_id);


--
-- Name: idx_transactions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_status ON public.gym_transactions USING btree (status);


--
-- Name: bookings booking_immutable_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER booking_immutable_guard BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.protect_booking_immutable_columns();


--
-- Name: activities trg_activities_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_activities_updated BEFORE UPDATE ON public.activities FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: bookings trg_bookings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: coaches trg_coaches_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_coaches_updated BEFORE UPDATE ON public.coaches FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: nexxia_gyms trg_gyms_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gyms_updated BEFORE UPDATE ON public.nexxia_gyms FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: medical_notes trg_medical_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_medical_updated BEFORE UPDATE ON public.medical_notes FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: nexxia_subscriptions trg_nexxia_subs_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_nexxia_subs_updated BEFORE UPDATE ON public.nexxia_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: noshow_rules trg_noshow_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_noshow_updated BEFORE UPDATE ON public.noshow_rules FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: gym_plans trg_plans_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.gym_plans FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: profiles trg_profiles_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: gym_sites trg_sites_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sites_updated BEFORE UPDATE ON public.gym_sites FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: time_slots trg_slots_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_slots_updated BEFORE UPDATE ON public.time_slots FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: member_subscriptions trg_subs_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_subs_updated BEFORE UPDATE ON public.member_subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: profiles trg_track_consent; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_track_consent AFTER UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.track_consent_changes();


--
-- Name: bookings trg_update_bookings_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_bookings_count AFTER INSERT OR DELETE OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_slot_bookings_count();


--
-- Name: activities activities_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activities
    ADD CONSTRAINT activities_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: activity_translations activity_translations_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_translations
    ADD CONSTRAINT activity_translations_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);


--
-- Name: audit_logs audit_logs_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id);


--
-- Name: bookings bookings_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.time_slots(id) ON DELETE CASCADE;


--
-- Name: bookings bookings_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.member_subscriptions(id);


--
-- Name: coach_sites coach_sites_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_sites
    ADD CONSTRAINT coach_sites_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.coaches(id) ON DELETE CASCADE;


--
-- Name: coach_sites coach_sites_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_sites
    ADD CONSTRAINT coach_sites_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.gym_sites(id) ON DELETE CASCADE;


--
-- Name: coaches coaches_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaches
    ADD CONSTRAINT coaches_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: coaches coaches_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaches
    ADD CONSTRAINT coaches_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id);


--
-- Name: consent_history consent_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consent_history
    ADD CONSTRAINT consent_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: favorites favorites_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorites
    ADD CONSTRAINT favorites_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.time_slots(id) ON DELETE CASCADE;


--
-- Name: gdpr_requests gdpr_requests_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gdpr_requests
    ADD CONSTRAINT gdpr_requests_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id);


--
-- Name: gdpr_requests gdpr_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gdpr_requests
    ADD CONSTRAINT gdpr_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: gym_admin_actions gym_admin_actions_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_admin_actions
    ADD CONSTRAINT gym_admin_actions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.profiles(id);


--
-- Name: gym_admin_actions gym_admin_actions_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_admin_actions
    ADD CONSTRAINT gym_admin_actions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id);


--
-- Name: gym_admin_actions gym_admin_actions_target_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_admin_actions
    ADD CONSTRAINT gym_admin_actions_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.profiles(id);


--
-- Name: gym_communication_recipients gym_communication_recipients_communication_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_communication_recipients
    ADD CONSTRAINT gym_communication_recipients_communication_id_fkey FOREIGN KEY (communication_id) REFERENCES public.gym_communications(id) ON DELETE CASCADE;


--
-- Name: gym_communication_recipients gym_communication_recipients_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_communication_recipients
    ADD CONSTRAINT gym_communication_recipients_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id);


--
-- Name: gym_communications gym_communications_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_communications
    ADD CONSTRAINT gym_communications_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: gym_communications gym_communications_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_communications
    ADD CONSTRAINT gym_communications_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: gym_mollie_connections gym_mollie_connections_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_mollie_connections
    ADD CONSTRAINT gym_mollie_connections_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: gym_plan_translations gym_plan_translations_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_plan_translations
    ADD CONSTRAINT gym_plan_translations_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.gym_plans(id) ON DELETE CASCADE;


--
-- Name: gym_plans gym_plans_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_plans
    ADD CONSTRAINT gym_plans_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: gym_sites gym_sites_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_sites
    ADD CONSTRAINT gym_sites_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: gym_transactions gym_transactions_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_transactions
    ADD CONSTRAINT gym_transactions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: gym_transactions gym_transactions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_transactions
    ADD CONSTRAINT gym_transactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id);


--
-- Name: gym_transactions gym_transactions_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_transactions
    ADD CONSTRAINT gym_transactions_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.member_subscriptions(id);


--
-- Name: impersonation_logs impersonation_logs_super_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_logs
    ADD CONSTRAINT impersonation_logs_super_admin_id_fkey FOREIGN KEY (super_admin_id) REFERENCES public.profiles(id);


--
-- Name: impersonation_logs impersonation_logs_target_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_logs
    ADD CONSTRAINT impersonation_logs_target_gym_id_fkey FOREIGN KEY (target_gym_id) REFERENCES public.nexxia_gyms(id);


--
-- Name: impersonation_logs impersonation_logs_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_logs
    ADD CONSTRAINT impersonation_logs_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.profiles(id);


--
-- Name: login_attempts login_attempts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: medical_notes medical_notes_encrypted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_notes
    ADD CONSTRAINT medical_notes_encrypted_by_fkey FOREIGN KEY (encrypted_by) REFERENCES public.profiles(id);


--
-- Name: medical_notes medical_notes_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_notes
    ADD CONSTRAINT medical_notes_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: medical_notes medical_notes_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_notes
    ADD CONSTRAINT medical_notes_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: medical_notes medical_notes_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.medical_notes
    ADD CONSTRAINT medical_notes_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);


--
-- Name: member_credits member_credits_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_credits
    ADD CONSTRAINT member_credits_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: member_credits member_credits_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_credits
    ADD CONSTRAINT member_credits_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: member_subscriptions member_subscriptions_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_subscriptions
    ADD CONSTRAINT member_subscriptions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: member_subscriptions member_subscriptions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_subscriptions
    ADD CONSTRAINT member_subscriptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: member_subscriptions member_subscriptions_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_subscriptions
    ADD CONSTRAINT member_subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.gym_plans(id);


--
-- Name: member_subscriptions member_subscriptions_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_subscriptions
    ADD CONSTRAINT member_subscriptions_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.gym_sites(id);


--
-- Name: mollie_connections mollie_connections_gym_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_connections
    ADD CONSTRAINT mollie_connections_gym_admin_id_fkey FOREIGN KEY (gym_admin_id) REFERENCES public.profiles(id);


--
-- Name: mollie_connections mollie_connections_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_connections
    ADD CONSTRAINT mollie_connections_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: mollie_customers mollie_customers_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_customers
    ADD CONSTRAINT mollie_customers_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: mollie_customers mollie_customers_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_customers
    ADD CONSTRAINT mollie_customers_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: mollie_oauth_states mollie_oauth_states_gym_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mollie_oauth_states
    ADD CONSTRAINT mollie_oauth_states_gym_admin_id_fkey FOREIGN KEY (gym_admin_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: nexxia_features nexxia_features_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_features
    ADD CONSTRAINT nexxia_features_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: nexxia_invoices nexxia_invoices_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_invoices
    ADD CONSTRAINT nexxia_invoices_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id);


--
-- Name: nexxia_invoices nexxia_invoices_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_invoices
    ADD CONSTRAINT nexxia_invoices_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.nexxia_subscriptions(id);


--
-- Name: nexxia_subscriptions nexxia_subscriptions_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nexxia_subscriptions
    ADD CONSTRAINT nexxia_subscriptions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: noshow_rules noshow_rules_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.noshow_rules
    ADD CONSTRAINT noshow_rules_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: oauth_states oauth_states_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_states
    ADD CONSTRAINT oauth_states_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: payments payments_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: payments payments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: penalties penalties_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalties
    ADD CONSTRAINT penalties_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: penalties penalties_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalties
    ADD CONSTRAINT penalties_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: penalties penalties_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.penalties
    ADD CONSTRAINT penalties_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id);


--
-- Name: subscriptions subscriptions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.profiles(id);


--
-- Name: super_admin_proxy_actions super_admin_proxy_actions_super_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.super_admin_proxy_actions
    ADD CONSTRAINT super_admin_proxy_actions_super_admin_id_fkey FOREIGN KEY (super_admin_id) REFERENCES public.profiles(id);


--
-- Name: super_admin_proxy_actions super_admin_proxy_actions_target_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.super_admin_proxy_actions
    ADD CONSTRAINT super_admin_proxy_actions_target_admin_id_fkey FOREIGN KEY (target_admin_id) REFERENCES public.profiles(id);


--
-- Name: super_admin_proxy_actions super_admin_proxy_actions_target_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.super_admin_proxy_actions
    ADD CONSTRAINT super_admin_proxy_actions_target_gym_id_fkey FOREIGN KEY (target_gym_id) REFERENCES public.nexxia_gyms(id);


--
-- Name: time_slots time_slots_activity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_slots
    ADD CONSTRAINT time_slots_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.activities(id) ON DELETE CASCADE;


--
-- Name: time_slots time_slots_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_slots
    ADD CONSTRAINT time_slots_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.coaches(id);


--
-- Name: time_slots time_slots_gym_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_slots
    ADD CONSTRAINT time_slots_gym_id_fkey FOREIGN KEY (gym_id) REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE;


--
-- Name: time_slots time_slots_site_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_slots
    ADD CONSTRAINT time_slots_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.gym_sites(id);


--
-- Name: user_devices user_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: oauth_states Accès interdit — service_role uniquement; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Accès interdit — service_role uniquement" ON public.oauth_states AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: rate_limits Accès interdit — service_role uniquement; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Accès interdit — service_role uniquement" ON public.rate_limits AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: activities Activités visibles par les membres du gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Activités visibles par les membres du gym" ON public.activities FOR SELECT USING ((gym_id = public.get_my_gym_id()));


--
-- Name: mollie_customers Admin voit les customers de sa gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin voit les customers de sa gym" ON public.mollie_customers USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin())) WITH CHECK (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: bookings Annuler ses propres réservations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Annuler ses propres réservations" ON public.bookings FOR UPDATE USING (((member_id = auth.uid()) AND (status = ANY (ARRAY['confirmed'::text, 'waitlist'::text])))) WITH CHECK (((member_id = auth.uid()) AND (gym_id = public.get_my_gym_id()) AND (status = 'cancelled'::text)));


--
-- Name: coach_sites Coach sites visibles par les membres; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coach sites visibles par les membres" ON public.coach_sites FOR SELECT USING ((site_id IN ( SELECT gym_sites.id
   FROM public.gym_sites
  WHERE (gym_sites.gym_id = public.get_my_gym_id()))));


--
-- Name: coaches Coaches visibles par les membres du gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Coaches visibles par les membres du gym" ON public.coaches FOR SELECT USING ((gym_id = public.get_my_gym_id()));


--
-- Name: medical_notes Créer ses propres notes médicales; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Créer ses propres notes médicales" ON public.medical_notes FOR INSERT WITH CHECK ((member_id = auth.uid()));


--
-- Name: bookings Créer ses propres réservations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Créer ses propres réservations" ON public.bookings FOR INSERT WITH CHECK (((member_id = auth.uid()) AND (gym_id = public.get_my_gym_id())));


--
-- Name: gdpr_requests Créer une demande RGPD pour soi-même; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Créer une demande RGPD pour soi-même" ON public.gdpr_requests FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: nexxia_features Features visibles par les membres du gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Features visibles par les membres du gym" ON public.nexxia_features FOR SELECT USING ((gym_id = public.get_my_gym_id()));


--
-- Name: member_credits Gym admin gere les credits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admin gere les credits" ON public.member_credits USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin())) WITH CHECK (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: payments Gym admin gere les paiements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admin gere les paiements" ON public.payments USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin())) WITH CHECK (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: mollie_connections Gym admin voit sa connexion Mollie; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admin voit sa connexion Mollie" ON public.mollie_connections USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin())) WITH CHECK (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: subscriptions Gym admin voit tous les abonnements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admin voit tous les abonnements" ON public.subscriptions USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: member_subscriptions Gym admins gèrent les abonnements du gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent les abonnements du gym" ON public.member_subscriptions USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: activities Gym admins gèrent les activités; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent les activités" ON public.activities USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: coach_sites Gym admins gèrent les assignations coaches/sites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent les assignations coaches/sites" ON public.coach_sites USING (public.is_gym_admin());


--
-- Name: coaches Gym admins gèrent les coaches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent les coaches" ON public.coaches USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: penalties Gym admins gèrent les pénalités du gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent les pénalités du gym" ON public.penalties USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: noshow_rules Gym admins gèrent les règles no-show; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent les règles no-show" ON public.noshow_rules USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: time_slots Gym admins gèrent les slots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent les slots" ON public.time_slots USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: activity_translations Gym admins gèrent les traductions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent les traductions" ON public.activity_translations USING (public.is_gym_admin());


--
-- Name: gym_plan_translations Gym admins gèrent les traductions plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent les traductions plans" ON public.gym_plan_translations USING (public.is_gym_admin());


--
-- Name: gym_plans Gym admins gèrent leurs formules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent leurs formules" ON public.gym_plans USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: gym_sites Gym admins gèrent leurs sites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins gèrent leurs sites" ON public.gym_sites USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: audit_logs Gym admins voient les logs de leur gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins voient les logs de leur gym" ON public.audit_logs FOR SELECT USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: profiles Gym admins voient les profils du gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins voient les profils du gym" ON public.profiles FOR SELECT USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: gym_transactions Gym admins voient les transactions du gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins voient les transactions du gym" ON public.gym_transactions FOR SELECT USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: nexxia_subscriptions Gym admins voient leur abonnement Nexxia; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins voient leur abonnement Nexxia" ON public.nexxia_subscriptions FOR SELECT USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: gym_mollie_connections Gym admins voient leur connexion Mollie; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins voient leur connexion Mollie" ON public.gym_mollie_connections FOR SELECT USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: nexxia_gyms Gym admins voient leur salle; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins voient leur salle" ON public.nexxia_gyms FOR SELECT USING ((id = public.get_my_gym_id()));


--
-- Name: gym_admin_actions Gym admins voient leurs actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins voient leurs actions" ON public.gym_admin_actions USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: nexxia_invoices Gym admins voient leurs factures Nexxia; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins voient leurs factures Nexxia" ON public.nexxia_invoices FOR SELECT USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: bookings Gym admins voient toutes les réservations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gym admins voient toutes les réservations" ON public.bookings USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: gym_communications Gérant gère ses communications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gérant gère ses communications" ON public.gym_communications USING (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin())) WITH CHECK (((gym_id = public.get_my_gym_id()) AND public.is_gym_admin()));


--
-- Name: user_devices Gérer ses propres devices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gérer ses propres devices" ON public.user_devices USING ((user_id = auth.uid()));


--
-- Name: favorites Gérer ses propres favoris; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Gérer ses propres favoris" ON public.favorites USING ((member_id = auth.uid()));


--
-- Name: notifications Marquer ses notifications comme lues; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Marquer ses notifications comme lues" ON public.notifications FOR UPDATE USING ((member_id = auth.uid()));


--
-- Name: nexxia_gyms Members voient leur salle; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members voient leur salle" ON public.nexxia_gyms FOR SELECT USING ((id = public.get_my_gym_id()));


--
-- Name: mollie_customers Membre voit son customer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Membre voit son customer" ON public.mollie_customers FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: subscriptions Membres voient leurs abonnements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Membres voient leurs abonnements" ON public.subscriptions FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: member_credits Membres voient leurs credits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Membres voient leurs credits" ON public.member_credits FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: payments Membres voient leurs paiements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Membres voient leurs paiements" ON public.payments FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: medical_notes Modifier ses propres notes médicales; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Modifier ses propres notes médicales" ON public.medical_notes FOR UPDATE USING ((member_id = auth.uid()));


--
-- Name: profiles Modifier son propre profil; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Modifier son propre profil" ON public.profiles FOR UPDATE USING ((id = auth.uid()));


--
-- Name: nexxia_plan_limits Plan limits visibles par tous; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Plan limits visibles par tous" ON public.nexxia_plan_limits FOR SELECT USING (true);


--
-- Name: gym_plans Plans visibles par les membres (actifs); Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Plans visibles par les membres (actifs)" ON public.gym_plans FOR SELECT USING (((gym_id = public.get_my_gym_id()) AND (active = true)));


--
-- Name: noshow_rules Règles no-show visibles par les membres; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Règles no-show visibles par les membres" ON public.noshow_rules FOR SELECT USING ((gym_id = public.get_my_gym_id()));


--
-- Name: mollie_oauth_states Service role manages oauth states; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages oauth states" ON public.mollie_oauth_states TO service_role USING (true) WITH CHECK (true);


--
-- Name: gym_communication_recipients Service role uniquement; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role uniquement" ON public.gym_communication_recipients AS RESTRICTIVE TO authenticated, anon USING (false) WITH CHECK (false);


--
-- Name: gym_sites Sites visibles par les membres du gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Sites visibles par les membres du gym" ON public.gym_sites FOR SELECT USING ((gym_id = public.get_my_gym_id()));


--
-- Name: time_slots Slots visibles par les membres du gym; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Slots visibles par les membres du gym" ON public.time_slots FOR SELECT USING ((gym_id = public.get_my_gym_id()));


--
-- Name: gym_communications Super admin voit tout; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin voit tout" ON public.gym_communications USING (public.is_super_admin());


--
-- Name: nexxia_subscriptions Super admins gèrent les abonnements Nexxia; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins gèrent les abonnements Nexxia" ON public.nexxia_subscriptions USING (public.is_super_admin());


--
-- Name: gdpr_requests Super admins gèrent les demandes RGPD; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins gèrent les demandes RGPD" ON public.gdpr_requests USING (public.is_super_admin());


--
-- Name: nexxia_invoices Super admins gèrent les factures Nexxia; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins gèrent les factures Nexxia" ON public.nexxia_invoices USING (public.is_super_admin());


--
-- Name: nexxia_features Super admins gèrent les features; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins gèrent les features" ON public.nexxia_features USING (public.is_super_admin());


--
-- Name: impersonation_logs Super admins gèrent les impersonations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins gèrent les impersonations" ON public.impersonation_logs USING (public.is_super_admin());


--
-- Name: nexxia_plan_limits Super admins gèrent les plans; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins gèrent les plans" ON public.nexxia_plan_limits USING (public.is_super_admin());


--
-- Name: super_admin_proxy_actions Super admins gèrent leurs actions proxy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins gèrent leurs actions proxy" ON public.super_admin_proxy_actions USING (public.is_super_admin());


--
-- Name: gym_mollie_connections Super admins gèrent toutes les connexions Mollie; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins gèrent toutes les connexions Mollie" ON public.gym_mollie_connections USING (public.is_super_admin());


--
-- Name: medical_notes Super admins voient les notes médicales; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins voient les notes médicales" ON public.medical_notes USING (public.is_super_admin());


--
-- Name: login_attempts Super admins voient les tentatives de connexion; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins voient les tentatives de connexion" ON public.login_attempts USING (public.is_super_admin());


--
-- Name: audit_logs Super admins voient tous les logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins voient tous les logs" ON public.audit_logs USING (public.is_super_admin());


--
-- Name: consent_history Super admins voient tout; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins voient tout" ON public.consent_history USING (public.is_super_admin());


--
-- Name: gym_admin_actions Super admins voient tout; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins voient tout" ON public.gym_admin_actions USING (public.is_super_admin());


--
-- Name: nexxia_gyms Super admins voient tout; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins voient tout" ON public.nexxia_gyms USING (public.is_super_admin());


--
-- Name: profiles Super admins voient tout; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins voient tout" ON public.profiles USING (public.is_super_admin());


--
-- Name: activity_translations Traductions activités visibles par les membres; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Traductions activités visibles par les membres" ON public.activity_translations FOR SELECT USING ((activity_id IN ( SELECT activities.id
   FROM public.activities
  WHERE (activities.gym_id = public.get_my_gym_id()))));


--
-- Name: gym_plan_translations Traductions plans visibles par les membres; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Traductions plans visibles par les membres" ON public.gym_plan_translations FOR SELECT USING ((plan_id IN ( SELECT gym_plans.id
   FROM public.gym_plans
  WHERE (gym_plans.gym_id = public.get_my_gym_id()))));


--
-- Name: gdpr_requests Voir ses propres demandes RGPD; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Voir ses propres demandes RGPD" ON public.gdpr_requests FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: medical_notes Voir ses propres notes médicales; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Voir ses propres notes médicales" ON public.medical_notes FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: notifications Voir ses propres notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Voir ses propres notifications" ON public.notifications FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: penalties Voir ses propres pénalités; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Voir ses propres pénalités" ON public.penalties FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: bookings Voir ses propres réservations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Voir ses propres réservations" ON public.bookings FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: gym_transactions Voir ses propres transactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Voir ses propres transactions" ON public.gym_transactions FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: consent_history Voir son historique de consentements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Voir son historique de consentements" ON public.consent_history FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: member_subscriptions Voir son propre abonnement; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Voir son propre abonnement" ON public.member_subscriptions FOR SELECT USING ((member_id = auth.uid()));


--
-- Name: profiles Voir son propre profil; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Voir son propre profil" ON public.profiles FOR SELECT USING ((id = auth.uid()));


--
-- Name: activities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

--
-- Name: activity_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: coach_sites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coach_sites ENABLE ROW LEVEL SECURITY;

--
-- Name: coaches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

--
-- Name: consent_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consent_history ENABLE ROW LEVEL SECURITY;

--
-- Name: favorites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

--
-- Name: gdpr_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gdpr_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_admin_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_admin_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_communication_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_communication_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_communications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_communications ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_mollie_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_mollie_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_plan_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_plan_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_sites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_sites ENABLE ROW LEVEL SECURITY;

--
-- Name: gym_transactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gym_transactions ENABLE ROW LEVEL SECURITY;

--
-- Name: impersonation_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.impersonation_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: login_attempts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

--
-- Name: medical_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.medical_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: member_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: member_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: mollie_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mollie_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: mollie_customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mollie_customers ENABLE ROW LEVEL SECURITY;

--
-- Name: mollie_oauth_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mollie_oauth_states ENABLE ROW LEVEL SECURITY;

--
-- Name: nexxia_features; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nexxia_features ENABLE ROW LEVEL SECURITY;

--
-- Name: nexxia_gyms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nexxia_gyms ENABLE ROW LEVEL SECURITY;

--
-- Name: nexxia_invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nexxia_invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: nexxia_plan_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nexxia_plan_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: nexxia_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nexxia_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: noshow_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.noshow_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: oauth_states; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: penalties; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.penalties ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: super_admin_proxy_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.super_admin_proxy_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: time_slots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.time_slots ENABLE ROW LEVEL SECURITY;

--
-- Name: user_devices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--



--
-- Name: FUNCTION allocate_invoice_number(p_payment_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.allocate_invoice_number(p_payment_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.allocate_invoice_number(p_payment_id uuid) TO service_role;


--
-- Name: FUNCTION check_rate_limit(p_identifier text, p_action text, p_max_attempts integer, p_window_minutes integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_rate_limit(p_identifier text, p_action text, p_max_attempts integer, p_window_minutes integer) TO anon;
GRANT ALL ON FUNCTION public.check_rate_limit(p_identifier text, p_action text, p_max_attempts integer, p_window_minutes integer) TO authenticated;
GRANT ALL ON FUNCTION public.check_rate_limit(p_identifier text, p_action text, p_max_attempts integer, p_window_minutes integer) TO service_role;


--
-- Name: FUNCTION check_webhook_rate_limit(p_identifier text, p_action text, p_max_calls integer, p_window_seconds integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_webhook_rate_limit(p_identifier text, p_action text, p_max_calls integer, p_window_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_webhook_rate_limit(p_identifier text, p_action text, p_max_calls integer, p_window_seconds integer) TO service_role;


--
-- Name: FUNCTION cleanup_expired_favorites(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleanup_expired_favorites() TO anon;
GRANT ALL ON FUNCTION public.cleanup_expired_favorites() TO authenticated;
GRANT ALL ON FUNCTION public.cleanup_expired_favorites() TO service_role;


--
-- Name: FUNCTION cleanup_oauth_states(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleanup_oauth_states() TO anon;
GRANT ALL ON FUNCTION public.cleanup_oauth_states() TO authenticated;
GRANT ALL ON FUNCTION public.cleanup_oauth_states() TO service_role;


--
-- Name: FUNCTION create_mollie_vault_tokens(p_gym_id uuid, p_access_token text, p_refresh_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_mollie_vault_tokens(p_gym_id uuid, p_access_token text, p_refresh_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_mollie_vault_tokens(p_gym_id uuid, p_access_token text, p_refresh_token text) TO service_role;


--
-- Name: FUNCTION decrypt_medical(ciphertext bytea, secret_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.decrypt_medical(ciphertext bytea, secret_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decrypt_medical(ciphertext bytea, secret_id uuid) TO service_role;


--
-- Name: FUNCTION encrypt_medical(plaintext text, secret_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.encrypt_medical(plaintext text, secret_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.encrypt_medical(plaintext text, secret_id uuid) TO service_role;


--
-- Name: FUNCTION expire_waitlist_confirmations(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expire_waitlist_confirmations() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_waitlist_confirmations() TO service_role;


--
-- Name: FUNCTION get_communication_recipients(p_gym_id uuid, p_segment text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_communication_recipients(p_gym_id uuid, p_segment text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_communication_recipients(p_gym_id uuid, p_segment text) TO authenticated;
GRANT ALL ON FUNCTION public.get_communication_recipients(p_gym_id uuid, p_segment text) TO service_role;


--
-- Name: FUNCTION get_gym_mollie_tokens(p_gym_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_gym_mollie_tokens(p_gym_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_gym_mollie_tokens(p_gym_id uuid) TO service_role;


--
-- Name: FUNCTION get_my_gym_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_gym_id() TO anon;
GRANT ALL ON FUNCTION public.get_my_gym_id() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_gym_id() TO service_role;


--
-- Name: FUNCTION get_my_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_my_role() TO anon;
GRANT ALL ON FUNCTION public.get_my_role() TO authenticated;
GRANT ALL ON FUNCTION public.get_my_role() TO service_role;


--
-- Name: FUNCTION get_pending_reminders(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_pending_reminders() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_pending_reminders() TO service_role;


--
-- Name: FUNCTION gym_has_feature(p_gym_id uuid, p_feature text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.gym_has_feature(p_gym_id uuid, p_feature text) TO anon;
GRANT ALL ON FUNCTION public.gym_has_feature(p_gym_id uuid, p_feature text) TO authenticated;
GRANT ALL ON FUNCTION public.gym_has_feature(p_gym_id uuid, p_feature text) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION is_gym_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_gym_admin() TO anon;
GRANT ALL ON FUNCTION public.is_gym_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_gym_admin() TO service_role;


--
-- Name: FUNCTION is_super_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_super_admin() TO anon;
GRANT ALL ON FUNCTION public.is_super_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_super_admin() TO service_role;


--
-- Name: FUNCTION mark_reminder_sent(p_booking_id uuid, p_reminder_type text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.mark_reminder_sent(p_booking_id uuid, p_reminder_type text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.mark_reminder_sent(p_booking_id uuid, p_reminder_type text) TO service_role;


--
-- Name: FUNCTION process_no_shows(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.process_no_shows() FROM PUBLIC;
GRANT ALL ON FUNCTION public.process_no_shows() TO service_role;


--
-- Name: FUNCTION protect_booking_immutable_columns(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.protect_booking_immutable_columns() TO anon;
GRANT ALL ON FUNCTION public.protect_booking_immutable_columns() TO authenticated;
GRANT ALL ON FUNCTION public.protect_booking_immutable_columns() TO service_role;


--
-- Name: FUNCTION reorder_waitlist(p_slot_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reorder_waitlist(p_slot_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reorder_waitlist(p_slot_id uuid) TO service_role;


--
-- Name: FUNCTION request_account_deletion(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_account_deletion(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_account_deletion(p_user_id uuid) TO service_role;


--
-- Name: FUNCTION resolve_plan_for_payment(p_gym_id uuid, p_plan_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resolve_plan_for_payment(p_gym_id uuid, p_plan_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resolve_plan_for_payment(p_gym_id uuid, p_plan_id uuid) TO service_role;


--
-- Name: FUNCTION rls_auto_enable(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;


--
-- Name: FUNCTION track_consent_changes(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.track_consent_changes() TO anon;
GRANT ALL ON FUNCTION public.track_consent_changes() TO authenticated;
GRANT ALL ON FUNCTION public.track_consent_changes() TO service_role;


--
-- Name: FUNCTION update_mollie_vault_token(p_vault_id uuid, p_new_secret text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_mollie_vault_token(p_vault_id uuid, p_new_secret text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_mollie_vault_token(p_vault_id uuid, p_new_secret text) TO service_role;


--
-- Name: FUNCTION update_slot_bookings_count(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_slot_bookings_count() TO anon;
GRANT ALL ON FUNCTION public.update_slot_bookings_count() TO authenticated;
GRANT ALL ON FUNCTION public.update_slot_bookings_count() TO service_role;


--
-- Name: FUNCTION update_timestamp(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_timestamp() TO anon;
GRANT ALL ON FUNCTION public.update_timestamp() TO authenticated;
GRANT ALL ON FUNCTION public.update_timestamp() TO service_role;


--
-- Name: TABLE activities; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE activity_translations; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE bookings; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE coach_sites; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE coaches; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE consent_history; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE favorites; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE gdpr_requests; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE gym_admin_actions; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE gym_communication_recipients; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE gym_communications; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE gym_mollie_connections; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE gym_plan_translations; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE gym_plans; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE gym_sites; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE gym_transactions; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE impersonation_logs; Type: ACL; Schema: public; Owner: -
--



--
-- Name: SEQUENCE invoice_seq; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE login_attempts; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE medical_notes; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE member_credits; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE member_subscriptions; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE mollie_connections; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE mollie_customers; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE mollie_oauth_states; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE nexxia_features; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE nexxia_gyms; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE nexxia_invoices; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE nexxia_plan_limits; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE nexxia_subscriptions; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE noshow_rules; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE oauth_states; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE penalties; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE rate_limits; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE super_admin_proxy_actions; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE time_slots; Type: ACL; Schema: public; Owner: -
--



--
-- Name: TABLE user_devices; Type: ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



-- ============================================================================
-- SOCLE HORS-PUBLIC (non capturé par un dump -s public)
-- ============================================================================

-- Event trigger DDL : active automatiquement la RLS sur toute nouvelle table public
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

-- Création automatique du profil à l'inscription (auth.users)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- CRON JOBS (pg_cron)  —  ⚠️ URLs pointent vers la PROD ; à adapter pour staging.
-- Le X-Internal-Secret est masqué : injecter la vraie valeur via
-- ${INTERNAL_FUNCTIONS_SECRET} au déploiement (ne JAMAIS committer le secret réel).
-- ============================================================================
SELECT cron.schedule('cleanup-oauth-states',          '0 * * * *',    $$SELECT cleanup_oauth_states()$$);
SELECT cron.schedule('cleanup-expired-favorites',     '0 2 * * *',    $$SELECT cleanup_expired_favorites()$$);
SELECT cron.schedule('expire-waitlist-confirmations', '* * * * *',    $$SELECT expire_waitlist_confirmations()$$);

SELECT cron.schedule('send-booking-reminders', '*/15 * * * *', $CRON$
  SELECT net.http_post(
    url := 'https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/send-reminders',
    headers := '{"Content-Type":"application/json","X-Internal-Secret":"${INTERNAL_FUNCTIONS_SECRET}"}'::jsonb,
    body := '{}'::jsonb
  )
$CRON$);

SELECT cron.schedule('process-no-shows', '*/30 * * * *', $CRON$
  SELECT net.http_post(
    url := 'https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/send-noshow-notification',
    headers := '{"Content-Type":"application/json","X-Internal-Secret":"${INTERNAL_FUNCTIONS_SECRET}"}'::jsonb,
    body := '{}'::jsonb
  )
$CRON$);
