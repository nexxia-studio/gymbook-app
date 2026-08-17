-- GYM-228 (lot 1) — Masquer une activité par défaut dans /planning.
--
-- BESOIN : « Open Gym masqué par défaut, Nico coche pour voir ». Avec 14 créneaux par jour,
-- l'Open Gym remplirait la grille et noierait les cours collectifs — ceux dont le gérant a
-- réellement besoin au quotidien.
--
-- ⚠️ LE FILTRE DE GYM-128 NE SUFFISAIT PAS, vérifié avant d'écrire cette migration. Il est
-- INCLUSIF : liste vide = tout afficher, sinon on ne garde que les activités cochées. Pour
-- masquer l'Open Gym par un état initial, il faudrait pré-cocher TOUTES LES AUTRES — le
-- filtre apparaîtrait actif (compteur à N-1, ce qui est faux), et toute activité créée
-- ensuite serait automatiquement masquée sans que personne l'ait décidé. Il fallait donc
-- une EXCLUSION, qui est une notion différente de l'inclusion, pas son inverse.
--
-- ⚠️ COLONNE GÉNÉRIQUE, PAS UN CAS PARTICULIER « OPEN GYM ». Coder le nom en dur aurait
-- cassé au premier renommage, et n'aurait servi qu'une salle. Ici c'est une propriété de
-- l'activité — « celle-ci encombre le planning, masque-la sauf demande » — que le gérant
-- règle lui-même, et qui servira à toute activité à forte volumétrie.
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS hidden_in_planning boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.activities.hidden_in_planning IS
  'GYM-228 — true = activité masquée PAR DÉFAUT dans /planning (le gérant peut l''afficher
   d''un clic). Ne masque rien côté membre, et n''empêche aucune réservation : c''est un
   confort de lecture du planning gérant, pas une règle métier. false par défaut, donc
   aucune activité existante ne change de comportement.';

-- Aucune donnée écrite : c'est à Nico de désigner son activité Open Gym depuis /settings.
-- Une migration qui devinerait « l'activité nommée Open Gym » se tromperait le jour d'un
-- renommage, et silencieusement.
--
-- GRANT : `activities` porte des droits au NIVEAU TABLE (aucun GRANT colonne, vérifié en
-- GYM-229) — une nouvelle colonne y est donc automatiquement écrivable, bornée par la
-- policy « Gym admins gèrent les activités ». Rien à ajouter, contrairement à
-- nexxia_gyms qui porte une liste blanche depuis GYM-180.
