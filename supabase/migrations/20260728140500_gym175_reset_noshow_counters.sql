-- GYM-175 (volet 2) : remise à zéro du compteur de no-shows après une période sans incident.
--
-- PROBLÈME : profiles.noshow_count ne redescend JAMAIS. Il n'est décrémenté que lorsque le
-- gérant annule un no_show (bloc de symétrie de mark_attendance_atomic). Conséquence : un
-- membre ayant accumulé 3 absences réparties sur trois ans reste au palier aggravé À VIE —
-- le moindre oubli lui vaut deux semaines de suspension.
--
-- DÉCISION PRODUIT (Antoine) : après reset_after_days jours SANS nouvelle absence, le
-- compteur repart à zéro. La sanction reste ferme sur le moment ; c'est la MÉMOIRE qui
-- s'efface, pas l'historique.
--
-- ─── ANCRAGE : LA DERNIÈRE ABSENCE, PAS LA DERNIÈRE PÉNALITÉ ────────────────
-- Première version de cette fonction : ancrage sur MAX(penalties.applied_at). Faille —
-- une pénalité est une CONSÉQUENCE POSSIBLE de l'absence, pas l'absence elle-même. Une
-- salle réglant warning_1_at = 2 fait incrémenter noshow_count dès la 1re absence SANS
-- créer de pénalité : le membre n'avait alors aucune date d'ancrage et son compteur ne
-- repartait JAMAIS à zéro — exactement l'iniquité que ce lot corrige.
--
-- Toute incrémentation de noshow_count correspond en revanche à un booking passé en
-- 'no_show', et son créneau porte une date. C'est l'ancrage fiable dans TOUS les cas :
--     MAX(time_slots.starts_at) des bookings 'no_show' du membre
--
-- CAS PARTICULIER — compteur > 0 sans AUCUN booking 'no_show' (incohérence de données ou
-- historique purgé) : le compteur est remis à zéro lui aussi, car il ne correspond à rien
-- de constatable. Il serait sinon éternel. Le retour le signale (orphan_counter = true)
-- pour qu'on puisse repérer ces cas.
--
-- ─── Constats base live (Règle Zéro) ────────────────────────────────────────
--   - noshow_rules.reset_after_days = 90 chez Dopamine (DEFAULT 90 également).
--   - bookings_status_check contient bien 'no_show' : c'est le marqueur d'absence.
--   - penalties reste l'HISTORIQUE des sanctions : jamais supprimé, mais il ne sert
--     plus d'ancrage temporel.
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
--      - les lignes de `penalties` ne sont JAMAIS supprimées — c'est l'historique ;
--      - IDEMPOTENTE : après passage, noshow_count = 0 ne satisfait plus `> 0`.
-- ─────────────────────────────────────────────────────────────────────────────
-- Le RETURNS TABLE s'enrichit (last_absence_at, orphan_counter) : CREATE OR REPLACE ne
-- sait pas changer un type de retour, d'où le DROP préalable qui garde la migration
-- rejouable si une version antérieure avait déjà été appliquée.
DROP FUNCTION IF EXISTS public.reset_noshow_counters();

CREATE FUNCTION public.reset_noshow_counters()
RETURNS TABLE(
  member_id       uuid,
  gym_id          uuid,
  previous_count  integer,
  last_absence_at timestamptz,
  orphan_counter  boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH last_absence AS (
    -- Date de la DERNIÈRE absence constatée, par membre. Un booking 'no_show' existe
    -- pour chaque incrémentation de noshow_count, indépendamment de toute pénalité.
    SELECT b.member_id AS mid, MAX(s.starts_at) AS at
    FROM bookings b
    JOIN time_slots s ON s.id = b.slot_id
    WHERE b.status = 'no_show'
    GROUP BY b.member_id
  ), eligible AS (
    SELECT p.id,
           p.gym_id,
           p.noshow_count,
           la.at AS last_absence_at,
           (la.at IS NULL) AS orphan
    FROM profiles p
    LEFT JOIN last_absence la ON la.mid = p.id
    WHERE p.noshow_count > 0
      AND (p.suspended_until IS NULL OR p.suspended_until <= now())
      AND (
        -- Compteur sans aucune absence constatable : rien à « oublier », on remet à zéro
        -- et on le signale (orphan_counter).
        la.at IS NULL
        -- Sinon : délai écoulé depuis la dernière absence, lu sur SA salle.
        OR la.at < now() - make_interval(days => COALESCE(
             (SELECT nr.reset_after_days FROM noshow_rules nr WHERE nr.gym_id = p.gym_id),
             90
           ))
      )
  ), updated AS (
    UPDATE profiles p
    SET noshow_count = 0,
        updated_at   = now()
    FROM eligible e
    WHERE p.id = e.id
    RETURNING p.id
  )
  SELECT e.id, e.gym_id, e.noshow_count, e.last_absence_at, e.orphan
  FROM eligible e
  JOIN updated u ON u.id = e.id;
$$;

COMMENT ON FUNCTION public.reset_noshow_counters() IS
  'GYM-175 — Remet profiles.noshow_count à 0 pour les membres dont la DERNIÈRE ABSENCE '
  '(booking ''no_show'', via time_slots.starts_at) remonte à plus de '
  'noshow_rules.reset_after_days jours (repli 90). L''ancrage porte sur l''absence et non '
  'sur la pénalité : une absence ne produit pas toujours de pénalité selon les seuils de la '
  'salle. Un compteur > 0 sans aucun booking ''no_show'' est également remis à zéro et '
  'signalé (orphan_counter). N''efface JAMAIS les lignes de penalties (historique conservé) '
  'et ÉPARGNE les membres dont la suspension court encore. Idempotente. Planifiée une fois '
  'par jour (job pg_cron ''reset-noshow-counters''). Retourne les membres traités avec leur '
  'compteur d''avant (point d''accroche d''une future notification).';

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
