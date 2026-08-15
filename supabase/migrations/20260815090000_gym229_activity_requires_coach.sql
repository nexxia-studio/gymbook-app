-- GYM-229 — Une activité peut se passer de coach.
--
-- DEMANDE (Nico via Antoine, 12/08) : « Pour l'Open Gym, on oblige à placer un coach. Mais
-- comme la salle est libre d'accès via le badge et que les coachs ne sont pas là de 7 h à
-- 22 h, on devrait pouvoir configurer si un cours doit être donné par un coach ou non. »
--
-- Chez Dopamine, TOUS les cours ont un coach SAUF l'Open Gym — accès libre aux machines,
-- sans encadrement. Aujourd'hui, poser un créneau Open Gym oblige à désigner un coach qui
-- ne sera pas là : une donnée fausse, et elle est affichée au membre dans l'app.
--
-- ⚠️ PRÉREQUIS DE GYM-228 (génération automatique des créneaux Open Gym de 7 h à 22 h).
-- Sans cette option, chacun de ces créneaux exigerait un coach fictif.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS, ET POURQUOI
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- 1. ELLE NE TOUCHE PAS time_slots.coach_id. Vérifié sur la base de PRODUCTION : la
--    colonne est DÉJÀ NULLABLE (`coach_id uuid`, sans NOT NULL). L'obligation de désigner
--    un coach n'a jamais existé qu'en INTERFACE — c'est le formulaire de créneau qui la
--    posait, pas le schéma. Il n'y a donc aucun ALTER à faire ici, et aucun risque pour
--    les fonctions SQL : create_booking_atomic, cancel_slot_atomic, mark_attendance_atomic
--    et get_communication_recipients ne référencent pas le coach (vérifié), et
--    get_pending_reminders le joint DÉJÀ en LEFT JOIN.
--
-- 2. ELLE N'ÉCRIT AUCUNE DONNÉE. Basculer l'Open Gym de Dopamine à `false` est un geste de
--    cockpit, pas de migration : une migration ne doit pas décider du paramétrage d'une
--    salle. DEFAULT true garantit que rien ne change pour personne tant que ce geste n'est
--    pas posé.
--
-- 3. ELLE N'AJOUTE AUCUN GRANT. `activities` porte des droits au NIVEAU TABLE — une
--    nouvelle colonne y est donc automatiquement écrivable, et l'écriture reste bornée par
--    la policy « Gym admins gèrent les activités »
--    (gym_id = get_my_gym_id() AND is_gym_admin()). C'est le chemin qui gère déjà les
--    activités depuis le dashboard (hooks/useActivities.ts, PostgREST direct).
--
--    ⚠️ À NE PAS CONFONDRE AVEC GYM-203. La liste blanche de colonnes introduite alors ne
--    porte QUE sur `profiles`, et pour la raison inverse de celle-ci : y protéger des
--    colonnes sensibles (role, gym_id, suspended_until, noshow_count) d'un GRANT trop
--    large côté MEMBRE. `requires_coach` est un paramètre de salle, écrit par le gérant,
--    sur une table que le membre ne peut que lire. Rien à ajouter à cette liste blanche —
--    l'y faire figurer serait précisément l'erreur que GYM-203 a corrigée.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- La colonne.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- DEFAULT true : le comportement actuel est préservé pour toutes les activités
-- EXISTANTES comme FUTURES. Aucune salle ne voit son fonctionnement changer du fait de
-- cette migration ; il faut une décision explicite du gérant pour qu'une activité s'en
-- écarte.
--
-- NOT NULL : trois états (true / false / NULL) pour une question binaire obligeraient
-- chaque lecture à choisir un repli, et ces replis divergeraient. Le DEFAULT rend le
-- NOT NULL applicable immédiatement, sans backfill.
--
-- Nommage aligné sur requires_medical_check, déjà présent sur cette table : même préfixe,
-- même forme, même nature (une exigence portée par l'activité).
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS requires_coach boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.activities.requires_coach IS
  'GYM-229 — false = créneaux en accès libre, sans encadrement (Open Gym). Le sélecteur de
   coach devient alors facultatif et masqué à la création/modification de créneau, et
   aucune ligne « coach » n''est affichée au membre. true par défaut : le comportement
   historique (coach obligatoire) reste celui de toutes les activités existantes.
   time_slots.coach_id était déjà nullable — cette colonne pilote l''INTERFACE, elle
   n''ajoute aucune contrainte de schéma.';
