-- GYM-175 (volet 2) : remise à zéro du compteur de no-shows après une période sans incident.
--
-- PROBLÈME : profiles.noshow_count ne redescend JAMAIS. Il n'est décrémenté que lorsque le
-- gérant annule un no_show (bloc de symétrie de mark_attendance_atomic). Conséquence : un
-- membre ayant accumulé 3 absences réparties sur trois ans reste au palier aggravé À VIE —
-- le moindre oubli lui vaut deux semaines de suspension.
--
-- DÉCISION PRODUIT (Antoine) : après reset_after_days jours SANS nouvelle pénalité, le
-- compteur repart à zéro. La sanction reste ferme sur le moment ; c'est la MÉMOIRE qui
-- s'efface, pas l'historique.
--
-- ─── Constats base live (Règle Zéro) ────────────────────────────────────────
--   - noshow_rules.reset_after_days = 90 chez Dopamine (DEFAULT 90 également).
--   - penalties(applied_at) est la trace horodatée de chaque sanction ; elle n'est
--     supprimée que par l'annulation d'un no_show (par booking_id).
--   - Pattern des jobs pg_cron « SQL pur » existants :
--     SELECT cron.schedule(nom, planif, $$SELECT fn()$$).

-- ─────────────────────────────────────────────────────────────────────────────
-- a) La fonction de remise à zéro.
--
--    Écrite en CTE et non en simple UPDATE ... RETURNING : dans un UPDATE, RETURNING
--    expose la NOUVELLE valeur d'une colonne assignée, donc `noshow_count` y vaudrait
--    toujours 0. La CTE `eligible` capture le compteur AVANT modification, ce qui rend
--    `previous_count` réellement informatif pour une future notification.
--
--    GARDE-FOUS :
--      - un membre dont la suspension COURT ENCORE est épargné : on n'efface pas la
--        mémoire de quelqu'un qui purge sa sanction ;
--      - les lignes de `penalties` ne sont JAMAIS supprimées — c'est l'historique, et
--        c'est lui qui sert de base au calcul du délai ;
--      - MAX(applied_at) vaut NULL si le membre n'a aucune pénalité tracée ; `NULL <
--        interval` est NULL donc faux → un compteur > 0 sans pénalité n'est jamais remis
--        à zéro. Volontaire : on ne devine pas une date d'incident qu'on n'a pas ;
--      - IDEMPOTENTE : après passage, noshow_count = 0 ne satisfait plus `> 0`.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reset_noshow_counters()
RETURNS TABLE(
  member_id      uuid,
  gym_id         uuid,
  previous_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH eligible AS (
    SELECT p.id, p.gym_id, p.noshow_count
    FROM profiles p
    WHERE p.noshow_count > 0
      AND (p.suspended_until IS NULL OR p.suspended_until <= now())
      AND (
        SELECT MAX(pen.applied_at)
        FROM penalties pen
        WHERE pen.member_id = p.id
      ) < now() - make_interval(days => COALESCE(
        (SELECT nr.reset_after_days FROM noshow_rules nr WHERE nr.gym_id = p.gym_id),
        90
      ))
  ), updated AS (
    UPDATE profiles p
    SET noshow_count = 0,
        updated_at   = now()
    FROM eligible e
    WHERE p.id = e.id
    RETURNING p.id
  )
  SELECT e.id, e.gym_id, e.noshow_count
  FROM eligible e
  JOIN updated u ON u.id = e.id;
$$;

COMMENT ON FUNCTION public.reset_noshow_counters() IS
  'GYM-175 — Remet profiles.noshow_count à 0 pour les membres sans nouvelle pénalité depuis '
  'noshow_rules.reset_after_days jours (repli 90). N''efface JAMAIS les lignes de penalties '
  '(historique conservé) et ÉPARGNE les membres dont la suspension court encore. '
  'Idempotente. Planifiée une fois par jour (job pg_cron ''reset-noshow-counters''). '
  'Retourne les membres remis à zéro avec leur compteur d''avant (point d''accroche d''une '
  'future notification).';

-- Sécurité (posture GYM-98) : exécutable uniquement par le service_role.
-- Le job pg_cron tourne sous le rôle propriétaire (postgres), qui conserve EXECUTE.
REVOKE ALL ON FUNCTION public.reset_noshow_counters() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_noshow_counters() FROM anon;
REVOKE ALL ON FUNCTION public.reset_noshow_counters() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_noshow_counters() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- b) Planification quotidienne (pattern des jobs SQL purs existants).
--
--    Une fois par jour suffit : le délai se compte en dizaines de jours, être en retard
--    de quelques heures est sans conséquence. 03h20, à l'écart des autres jobs
--    (cleanup-oauth-states à :00, expire-subscriptions à :05).
--    Rejouable : unschedule conditionnel préalable, sinon cron.schedule lèverait sur un
--    nom en double.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT cron.unschedule('reset-noshow-counters')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reset-noshow-counters');

SELECT cron.schedule('reset-noshow-counters', '20 3 * * *', $$SELECT reset_noshow_counters()$$);
