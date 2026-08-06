-- GYM-218 (volet 2) : la remise à zéro du compteur intègre les annulations tardives.
--
-- INÉGALITÉ CORRIGÉE — reset_noshow_counters() (GYM-175) ancre le délai sur la DERNIÈRE
-- ABSENCE, repérée par `bookings.status = 'no_show'`. Or une annulation tardive laisse le
-- booking en 'cancelled' : elle incrémente bien noshow_count, mais ne laisse AUCUN booking
-- 'no_show'. Conséquence, pour un membre n'ayant que des annulations tardives :
--     la CTE last_absence ne trouve rien  →  la.at IS NULL  →  branche « orphan »
--     →  compteur remis à zéro DÈS LE PASSAGE SUIVANT DU CRON (le lendemain 03h20).
-- Un membre qui ne se présente pas attend 90 jours ; un membre qui annule 10 minutes
-- avant voyait sa sanction effacée en une nuit. Deux places bloquées, deux traitements.
--
-- DÉCISION PRODUIT (Antoine, 06/08) : une annulation tardive vaut une absence. Elle doit
-- donc peser aussi longtemps qu'une absence dans la mémoire du compteur.
--
-- ─── LE DISCRIMINANT ────────────────────────────────────────────────────────
-- `bookings.is_late_cancel` (booléen posé par cancel-booking au moment de l'annulation),
-- et NON le type de la pénalité : depuis le volet 1, cancel-booking émet 'warning_1',
-- 'warning_2' et 'suspension' — exactement les mêmes types que mark_attendance_atomic.
-- S'y fier confondrait les deux moteurs. C'est le constat établi au lot GYM-214.
--
-- Ancrage temporel identique dans les deux cas : `time_slots.starts_at`, l'heure du cours
-- dont la place a été bloquée. Prendre `cancelled_at` pour les annulations les ferait
-- vieillir plus vite (l'annulation précède le cours) — même incident, même horloge.
--
-- ─── CE QUI NE CHANGE PAS ───────────────────────────────────────────────────
--   - membres dont la suspension COURT ENCORE : toujours épargnés ;
--   - lignes de `penalties` : JAMAIS supprimées, c'est l'historique ;
--   - idempotence : après passage, noshow_count = 0 ne satisfait plus `> 0` ;
--   - ACL service_role (posture GYM-98) et job pg_cron : inchangés, donc non redéfinis ici ;
--   - signature et RETURNS TABLE : inchangés → CREATE OR REPLACE suffit, pas de DROP.
--
-- ─── orphan_counter RETROUVE SON SENS ───────────────────────────────────────
-- Le drapeau signalait jusqu'ici deux choses très différentes : une vraie incohérence de
-- données, ET le cas parfaitement légitime « le compteur ne vient que d'annulations
-- tardives ». Ce second cas disparaît : il a désormais un ancrage. `orphan_counter` ne se
-- déclenche plus que sur un compteur qui ne correspond à AUCUN incident constatable —
-- historique purgé ou incohérence réelle, ce qu'il était censé signaler.

CREATE OR REPLACE FUNCTION public.reset_noshow_counters()
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
  WITH last_incident AS (
    -- Date du DERNIER incident ayant bloqué une place, par membre. Deux sources, une
    -- seule horloge (time_slots.starts_at) :
    --   · absence constatée      → bookings.status = 'no_show'
    --   · annulation tardive     → bookings.is_late_cancel (statut 'cancelled')
    -- Toute incrémentation de noshow_count passe par l'une des deux.
    SELECT b.member_id AS mid, MAX(s.starts_at) AS at
    FROM bookings b
    JOIN time_slots s ON s.id = b.slot_id
    WHERE b.status = 'no_show'
       OR b.is_late_cancel IS TRUE
    GROUP BY b.member_id
  ), eligible AS (
    SELECT p.id,
           p.gym_id,
           p.noshow_count,
           li.at AS last_absence_at,
           (li.at IS NULL) AS orphan
    FROM profiles p
    LEFT JOIN last_incident li ON li.mid = p.id
    WHERE p.noshow_count > 0
      AND (p.suspended_until IS NULL OR p.suspended_until <= now())
      AND (
        -- Compteur sans aucun incident constatable : rien à « oublier », on remet à zéro
        -- et on le signale (orphan_counter). Ne couvre plus les annulations tardives,
        -- qui ont désormais un ancrage.
        li.at IS NULL
        -- Sinon : délai écoulé depuis le dernier incident, lu sur SA salle.
        OR li.at < now() - make_interval(days => COALESCE(
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
  'GYM-175 / GYM-218 — Remet profiles.noshow_count à 0 pour les membres dont le DERNIER '
  'INCIDENT remonte à plus de noshow_rules.reset_after_days jours (repli 90). Un incident '
  'est une absence constatée (booking ''no_show'') OU une annulation tardive '
  '(bookings.is_late_cancel) : les deux bloquent une place, les deux pèsent aussi '
  'longtemps. L''ancrage porte sur time_slots.starts_at, jamais sur la pénalité — une '
  'absence ne produit pas toujours de pénalité selon les seuils de la salle. Le '
  'discriminant est is_late_cancel et NON le type de pénalité : depuis GYM-218 les deux '
  'moteurs émettent les mêmes types. Un compteur > 0 sans aucun incident constatable est '
  'remis à zéro et signalé (orphan_counter = vraie incohérence de données). N''efface '
  'JAMAIS les lignes de penalties et ÉPARGNE les membres dont la suspension court encore. '
  'Idempotente. Planifiée une fois par jour (job pg_cron ''reset-noshow-counters'').';

-- ACL et planification inchangées : REVOKE/GRANT de GYM-175 et le job pg_cron
-- 'reset-noshow-counters' survivent à CREATE OR REPLACE (mêmes nom et signature).
