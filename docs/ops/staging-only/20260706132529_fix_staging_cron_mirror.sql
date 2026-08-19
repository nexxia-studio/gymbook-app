-- 20260706132529_fix_staging_cron_mirror.sql
-- INFRA STAGING (buovgpokubrkejunmauq) — aligne les crons sur PROD (fcjupgvmjkqztxtwymdb)
-- et corrige la fuite cross-env de expire_waitlist_confirmations().
--
-- Contexte : staging n'avait que 2 crons (cleanup-oauth-states, expire-waitlist-confirmations)
-- sur les 4 de prod, et sa fonction expire_waitlist_confirmations() postait vers l'URL PROD
-- (fcjupgvmjkqztxtwymdb…/notify-waitlist) → requête cross-env chaque minute.
--
-- Secret : le pattern PROD embarque X-Internal-Secret EN CLAIR dans la commande cron. Ici on
-- l'évite : les crons lisent le secret depuis Supabase Vault
-- (vault.decrypted_secrets, name = 'internal_functions_secret'). Ce fichier ne contient donc
-- AUCUN secret. Le secret staging n'est PAS récupérable en SQL (function secret write-only) et
-- diffère de prod (digests distincts) → il doit être injecté UNE fois dans le Vault à l'apply
-- (voir bloc « DETTE / APPLY » en fin de fichier). Tant que le Vault n'est pas peuplé, les 2
-- crons ci-dessous s'exécutent avec un header nul → fonctions répondent 401 (inerte, sans effet).

-- 1) expire_waitlist_confirmations : corps IDENTIQUE à prod, fn_url → STAGING.
CREATE OR REPLACE FUNCTION public.expire_waitlist_confirmations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  expired RECORD;
  next_id UUID;
  delay_minutes INTEGER;
  fn_url TEXT := 'https://buovgpokubrkejunmauq.supabase.co/functions/v1/notify-waitlist';
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
$function$;

-- 2) Crons manquants — miroir des schedules/commandes prod (jobs 8 & 9), URLs → STAGING,
--    secret lu depuis Vault (jamais en clair ici). cron.schedule upsert par nom.
SELECT cron.schedule(
  'send-booking-reminders',
  '*/15 * * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://buovgpokubrkejunmauq.supabase.co/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_functions_secret')
      ),
      body := '{}'::jsonb
    );
  $cmd$
);

SELECT cron.schedule(
  'process-no-shows',
  '*/30 * * * *',
  $cmd$
    SELECT net.http_post(
      url := 'https://buovgpokubrkejunmauq.supabase.co/functions/v1/send-noshow-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_functions_secret')
      ),
      body := '{}'::jsonb
    );
  $cmd$
);

-- ─────────────────────────────────────────────────────────────────────────────
-- DETTE / APPLY (hors fichier versionné — à exécuter UNE fois par un opérateur qui
-- détient le secret staging ; ne PAS committer la valeur) :
--
--   SELECT vault.create_secret(
--     '<STAGING_INTERNAL_FUNCTIONS_SECRET>',   -- valeur du function-secret staging (write-only)
--     'internal_functions_secret',
--     'Secret interne partagé par les crons -> Edge Functions (send-reminders, send-noshow-notification)'
--   );
--
-- Tant que ce secret Vault n'existe pas, send-booking-reminders et process-no-shows
-- tournent mais reçoivent 401 (aucun rappel / aucune passe no-show ne s'exécute).
-- ─────────────────────────────────────────────────────────────────────────────
