-- GYM-32 + GYM-33 — Mise à jour des jobs pg_cron pour invoquer les Edge Functions de notification
-- Migration déjà appliquée sur prod le 21 mai 2026 via Supabase MCP — fichier versionné pour traçabilité.
--
-- Prérequis (configuration manuelle, non versionnée — secrets) :
--   ALTER DATABASE postgres SET app.supabase_url = 'https://fcjupgvmjkqztxtwymdb.supabase.co';
--   ALTER DATABASE postgres SET app.internal_secret = '<INTERNAL_FUNCTIONS_SECRET>';
--   Extensions requises : pg_cron, pg_net.

-- GYM-32 : send-booking-reminders (toutes les 15 min) → POST send-reminders
SELECT cron.unschedule('send-booking-reminders');
SELECT cron.schedule(
  'send-booking-reminders',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/send-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Secret', current_setting('app.internal_secret')
      ),
      body := '{}'::jsonb
    )
  $$
);

-- GYM-33 : process-no-shows (toutes les 30 min) → POST send-noshow-notification
SELECT cron.unschedule('process-no-shows');
SELECT cron.schedule(
  'process-no-shows',
  '*/30 * * * *',
  $$
    SELECT net.http_post(
      url := current_setting('app.supabase_url') || '/functions/v1/send-noshow-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Secret', current_setting('app.internal_secret')
      ),
      body := '{}'::jsonb
    )
  $$
);
