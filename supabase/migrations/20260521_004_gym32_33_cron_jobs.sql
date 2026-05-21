-- GYM-32 + GYM-33 — Mise à jour des jobs pg_cron pour invoquer les Edge Functions de notification
--
-- ⚠️  AVANT D'APPLIQUER : remplacer REPLACE_WITH_SECRET
-- par la valeur de INTERNAL_FUNCTIONS_SECRET
-- (disponible dans Supabase Dashboard > Edge Functions > Secrets)
-- Ne jamais committer la vraie valeur dans Git.
-- Les cron jobs prod ont déjà été appliqués manuellement avec la vraie valeur.
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
