-- GYM-32 + GYM-33 — Mise à jour des jobs pg_cron pour invoquer les Edge Functions de notification
-- Migration déjà appliquée sur prod le 21 mai 2026 via Supabase MCP — fichier versionné pour traçabilité.
--
-- ⚠️ AVANT TOUTE RE-APPLICATION : remplacer 'REPLACE_WITH_SECRET' par la valeur réelle
-- de INTERNAL_FUNCTIONS_SECRET (disponible dans Supabase Dashboard → Edge Functions → Secrets).
-- Le secret n'est PAS versionné ici pour ne pas l'exposer dans l'historique Git.
--
-- Extensions requises : pg_cron, pg_net (déjà activées sur prod).

-- GYM-32 : send-booking-reminders (toutes les 15 min) → POST send-reminders
SELECT cron.unschedule('send-booking-reminders');
SELECT cron.schedule(
  'send-booking-reminders',
  '*/15 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/send-reminders',
      headers := '{"Content-Type":"application/json","X-Internal-Secret":"REPLACE_WITH_SECRET"}'::jsonb,
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
      url := 'https://fcjupgvmjkqztxtwymdb.supabase.co/functions/v1/send-noshow-notification',
      headers := '{"Content-Type":"application/json","X-Internal-Secret":"REPLACE_WITH_SECRET"}'::jsonb,
      body := '{}'::jsonb
    )
  $$
);
