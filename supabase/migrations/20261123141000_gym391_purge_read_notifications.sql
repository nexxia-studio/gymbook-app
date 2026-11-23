-- GYM-391 — purge quotidienne des messages LUS de plus de 90 jours.
--
-- La boîte de réception reçoit maintenant une ligne par réservation, annulation, achat et
-- communication. Sans ménage, elle grossit sans fin.
--
-- Ce qui est supprimé : `read = true` ET créé il y a plus de 90 jours.
-- ⚠️ UN MESSAGE NON LU N'EST JAMAIS PURGÉ, quel que soit son âge : le membre ne l'a pas vu.
-- L'âge se compte depuis `created_at`, pas depuis `read_at` : un vieux message ouvert hier
-- est un vieux message.
--
-- Pattern des jobs « SQL pur » (GYM-191, GYM-175) : SELECT cron.schedule(nom, planif,
-- $$SELECT fn()$$).

CREATE OR REPLACE FUNCTION public.purge_read_notifications()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.notifications
   WHERE read = true
     AND created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_read_notifications() IS
  'GYM-391 : supprime les notifications lues créées il y a plus de 90 jours. Rend le nombre '
  'de lignes supprimées. Appelée chaque nuit par le job pg_cron purge-read-notifications.';

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role.
-- Le job pg_cron tourne sous le rôle propriétaire (postgres), qui conserve EXECUTE et
-- contourne les règles RLS de la table.
REVOKE ALL ON FUNCTION public.purge_read_notifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_read_notifications() FROM anon;
REVOKE ALL ON FUNCTION public.purge_read_notifications() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_read_notifications() TO service_role;

-- Planification : chaque nuit à 03:45 UTC. 02:00 est pris par cleanup-expired-favorites,
-- 03:20 par reset-noshow-counters, et la minute 40 de chaque heure par close-expired-trials.
-- Rejouable : on déprogramme d'abord si le job existe déjà, sinon cron.schedule lèverait
-- sur un nom en double.
SELECT cron.unschedule('purge-read-notifications')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-read-notifications');

SELECT cron.schedule('purge-read-notifications', '45 3 * * *', $$SELECT purge_read_notifications()$$);
