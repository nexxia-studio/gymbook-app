-- GYM-242 — Horizon de réservation, réglable par la salle.
--
-- DEMANDE (Nico via Antoine, 19/08) : « il souhaite une plage plus large de visibilité des
-- cours dans l'app. On est le 19 août, j'ai une visibilité jusqu'au 1er septembre. Il
-- faudrait un mois. »
--
-- CAUSE EXACTE : apps/mobile/hooks/useSchedule.ts portait `end.setDate(end.getDate() + 14)`.
-- Quatorze jours, écrits en dur. Le 19 août + 14 = le 2 septembre : très exactement ce que
-- Nico observe.
--
-- ⚠️ ON NE REMPLACE PAS 14 PAR 30. Ce serait reproduire le défaut d'un cran plus loin, et
-- il faudrait une livraison à chaque fois qu'une salle veut autre chose. La valeur devient
-- un RÉGLAGE DE SALLE, au même titre que max_active_bookings (GYM-196) et
-- late_cancel_hours (GYM-218) — deux colonnes que ce lot prend pour modèle.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- a) La colonne.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- DEFAULT 30 : c'est la demande de Nico, et elle devient le comportement de toutes les
-- salles, existantes comme futures. Depuis PostgreSQL 11, ADD COLUMN avec DEFAULT ne
-- réécrit pas la table — Dopamine hérite de 30 sans UPDATE explicite.
--
-- NOT NULL : trois états (n / 0 / NULL) pour une question qui n'en a que deux obligeraient
-- chaque lecture à choisir un repli, et ces replis divergeraient. C'est le raisonnement de
-- GYM-229, repris tel quel.
--
-- ⚠️ CONTRAIREMENT À max_active_bookings, PAS DE « NULL = ILLIMITÉ » ICI. Un horizon sans
-- borne n'a pas de sens : la requête mobile a besoin d'une date de fin, et « tous les
-- créneaux jamais créés » n'est pas une intention de gérant, c'est une requête non bornée.
ALTER TABLE public.nexxia_gyms
  ADD COLUMN IF NOT EXISTS booking_horizon_days integer NOT NULL DEFAULT 30;

-- BORNES. La haute est le vrai sujet : une salle qui publie son planning à six mois est
-- plausible (stages, cycles trimestriels), dix ans ne l'est pas — et une valeur absurde ne
-- produirait pas une erreur mais une requête mobile lourde, sur un écran que le membre
-- ouvre à chaque lancement. 366 couvre l'année complète, année bissextile comprise.
--
-- La basse à 1 : un horizon de 0 jour afficherait un planning VIDE en permanence, sans
-- qu'aucun message ne l'explique. Ce n'est pas un réglage, c'est une panne silencieuse.
--
-- ⚠️ AUCUNE SOUS-REQUÊTE DANS CE CHECK. PostgreSQL les refuse (0A000) — constaté au lot
-- GYM-228, où la migration aurait échoué en production. Le prédicat ne porte que sur la
-- colonne elle-même.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nexxia_gyms_booking_horizon_days_check'
  ) THEN
    ALTER TABLE public.nexxia_gyms
      ADD CONSTRAINT nexxia_gyms_booking_horizon_days_check
      CHECK (booking_horizon_days >= 1 AND booking_horizon_days <= 366);
  END IF;
END $$;

COMMENT ON COLUMN public.nexxia_gyms.booking_horizon_days IS
  'GYM-242 — nombre de jours de planning visibles par le MEMBRE dans l''app, à partir '
  'd''aujourd''hui. 30 par défaut (demande de Nico, 19/08). Remplace le 14 écrit en dur '
  'dans useSchedule.ts. Borné 1..366 : 0 afficherait un planning vide en permanence, et '
  'une valeur absurde alourdirait la requête d''un écran ouvert à chaque lancement. '
  'N''affecte PAS ce que le gérant voit dans /planning, qui n''est pas borné par cette '
  'colonne.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- b) GRANT — sans lui, le gérant ne pourrait PAS enregistrer son horizon.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ `nexxia_gyms` porte une liste blanche de colonnes depuis GYM-180 : la policy dit
-- QUELLE LIGNE, le GRANT dit QUELLES COLONNES. Une colonne absente de ce GRANT est en
-- lecture seule pour `authenticated` — et PostgREST rejette la requête ENTIÈRE si elle la
-- mentionne, même à valeur inchangée. L'enregistrement de la salle échouerait EN BLOC,
-- pas seulement sur ce champ.
--
-- C'est le piège de GYM-224, avec la conclusion INVERSE : access_badge_code devait rester
-- dehors (un membre ne modifie pas son code d'accès, l'écriture passe par une Edge en
-- service_role). Ici, l'horizon est un paramètre que le GÉRANT saisit lui-même dans
-- /settings — comme opening_hours (GYM-228), timezone ou max_active_bookings. L'en exclure
-- imposerait une Edge Function pour une donnée que personne n'a de raison de lui protéger.
--
-- GRANT CIBLÉ, pas réécriture de la liste : un GRANT colonne s'ajoute à ceux déjà
-- accordés. Réécrire la liste entière risquerait d'en perdre une au passage.
--
-- La policy RLS borne déjà la LIGNE au gym de l'appelant : ce GRANT n'ouvre rien sur les
-- autres salles.
GRANT UPDATE (booking_horizon_days) ON public.nexxia_gyms TO authenticated;
