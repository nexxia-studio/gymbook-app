-- GYM-228 (lot 1) — Horaires d'ouverture de la salle.
--
-- Vérifié en PRODUCTION : `nexxia_gyms` compte 45 colonnes et AUCUNE ne porte d'horaire.
-- La seule proche est `timezone`, qui n'est pas un horaire mais le repère dans lequel les
-- horaires se lisent — elle est donc RÉUTILISÉE, pas dupliquée.
--
-- ⚠️ CONÇU COMME UNE DONNÉE DE SALLE, PAS COMME UN PARAMÈTRE DE L'OPEN GYM. C'est la
-- consigne, et elle est juste : ces heures serviront à afficher l'ouverture au membre et à
-- contrôler la cohérence des créneaux. Les enfermer dans une table « config open gym »
-- obligerait à les en extraire au premier de ces usages.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- JSONB PLUTÔT QUE DES COLONNES — arbitrage
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- Sept jours × (ouverture, fermeture, fermé) donneraient 14 à 21 colonnes plates sur une
-- table qui en compte déjà 45. Chaque lecture devrait les réassembler, et ajouter une
-- notion (une coupure méridienne, un horaire d'été) demanderait une migration par jour.
--
-- Le JSONB porte la structure entière en une valeur, se lit d'un bloc, et le dépôt l'emploie
-- déjà pour des données de même nature (profiles.notification_preferences,
-- gym_admin_actions.metadata).
--
-- FORME : une clé par jour, en anglais court — l'ordre ISO (lundi = premier) est celui de
-- toute l'application (getMonday, WEEKDAY_KEYS, RRule).
--
--   {"mon": {"open": "07:00", "close": "22:00"},
--    ...
--    "sun": null}
--
-- ⚠️ `null` = FERMÉ ce jour-là. Un objet aux heures vides serait ambigu : « 00:00–00:00 »
-- se lit aussi bien « fermé » que « ouvert la nuit ». `null` ne se lit que d'une façon.
--
-- ⚠️ HEURES LOCALES DE LA SALLE, jamais UTC — même discipline que GYM-230. « 07:00 »
-- signifie « 7 h à l'horloge de la salle », et se lit dans `nexxia_gyms.timezone`. Stocker
-- un instant absolu ferait dériver l'ouverture d'une heure au changement d'heure du 25/10.
ALTER TABLE public.nexxia_gyms
  ADD COLUMN IF NOT EXISTS opening_hours jsonb;

COMMENT ON COLUMN public.nexxia_gyms.opening_hours IS
  'GYM-228 — horaires d''ouverture, en HEURE LOCALE de la salle (à lire dans `timezone`).
   Une clé par jour (mon…sun) valant {"open":"HH:MM","close":"HH:MM"} ou NULL si fermé.
   NULL sur la colonne entière = horaires jamais renseignés, à distinguer d''une salle
   fermée tous les jours. Donnée de SALLE : elle sert la génération Open Gym, mais aussi
   l''affichage au membre et le contrôle de cohérence des créneaux.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- Garde-fou de FORME, volontairement minimal.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- Le CHECK vérifie que la valeur est un OBJET et que ses clés sont les sept jours attendus.
-- Il ne valide PAS le format des heures : un CHECK récursif sur le contenu d'un JSONB
-- deviendrait illisible et coûteux à chaque écriture, alors que l'écriture passe par un
-- seul chemin applicatif (/settings) qui contraint déjà la saisie à des sélecteurs d'heure.
--
-- Ce qu'il attrape en revanche : une clé mal orthographiée ('monday', 'lun'), qui rendrait
-- un jour silencieusement absent — l'erreur la plus probable, et la plus difficile à voir.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 🔴 NE PAS « SIMPLIFIER » CE PRÉDICAT VERS UNE FORME PLUS LISIBLE.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- POSTGRESQL INTERDIT TOUTE SOUS-REQUÊTE DANS UN CHECK. La première version de cette
-- migration écrivait :
--
--     AND (SELECT bool_and(k IN ('mon',…)) FROM jsonb_object_keys(opening_hours) AS k)
--
-- et a été REFUSÉE à l'application sur staging :
--
--     ERROR: 0A000: cannot use subquery in check constraint
--
-- Elle aurait fait échouer la migration EN PRODUCTION, et le lot entier avec elle.
-- ⚠️ La reformulation apparemment plus simple `ARRAY(SELECT jsonb_object_keys(...))`
-- échoue POUR LA MÊME RAISON : c'est encore une sous-requête, seulement déguisée.
--
-- La forme retenue est PUREMENT FONCTIONNELLE — un opérateur, pas de SELECT :
-- l'opérateur `-` retire d'un jsonb les clés listées ; s'il ne reste rien, c'est que
-- l'objet ne contenait QUE des jours attendus. Une clé 'monday' survivrait à la
-- soustraction et ferait échouer la contrainte (vérifié en staging).
--
-- ⚠️ Conséquence assumée : ce CHECK n'exige pas que les sept jours soient PRÉSENTS, il
-- interdit seulement les clés inconnues. Un objet partiel passe donc — c'est voulu, la
-- lecture applicative (parseOpeningHours) traite une clé absente comme « fermé », et
-- exiger les sept ici casserait toute écriture partielle future sans rien protéger.
ALTER TABLE public.nexxia_gyms
  DROP CONSTRAINT IF EXISTS nexxia_gyms_opening_hours_check;

ALTER TABLE public.nexxia_gyms
  ADD CONSTRAINT nexxia_gyms_opening_hours_check CHECK (
    opening_hours IS NULL
    OR (
      jsonb_typeof(opening_hours) = 'object'
      AND (opening_hours - ARRAY['mon','tue','wed','thu','fri','sat','sun']) = '{}'::jsonb
    )
  );

-- ⚠️ AUCUNE DONNÉE ÉCRITE. Les horaires de Dopamine sont ceux de Nico ; il les saisira
-- depuis /settings. Une migration ne décide pas des heures d'ouverture d'une salle — et un
-- défaut « 07:00–22:00 » posé ici deviendrait invisible, donc jamais relu ni corrigé.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- GRANT — sans lui, le gérant ne pourrait PAS enregistrer ses horaires.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ `nexxia_gyms` porte une liste blanche de colonnes depuis GYM-180 : la policy dit
-- QUELLE LIGNE, le GRANT dit QUELLES COLONNES. Une colonne absente de ce GRANT est en
-- lecture seule pour `authenticated` — et PostgREST rejette la requête ENTIÈRE si elle la
-- mentionne, même à valeur inchangée.
--
-- C'est le même piège qu'à GYM-224, avec la conclusion INVERSE. Là-bas, access_badge_code
-- devait rester DEHORS : un membre ne modifie pas son propre code d'accès, et l'écriture
-- passait par une Edge en service_role. Ici, les horaires d'ouverture sont un paramètre de
-- salle que le GÉRANT saisit lui-même depuis /settings — exactement comme `timezone`,
-- `phone` ou `email`, déjà dans la liste. Les en exclure imposerait une Edge Function pour
-- une donnée que personne n'a de raison de protéger du gérant.
--
-- GRANT CIBLÉ, pas réécriture de la liste : c'est ce qu'a fait GYM-196 pour
-- max_active_bookings (`GRANT UPDATE (max_active_bookings) …`). Un GRANT colonne s'ajoute
-- à ceux déjà accordés, il ne les remplace pas — réécrire la liste entière risquerait d'en
-- perdre une au passage.
--
-- La policy RLS de nexxia_gyms borne déjà la LIGNE au gym de l'appelant : ce GRANT
-- n'ouvre donc rien sur les autres salles.
GRANT UPDATE (opening_hours) ON public.nexxia_gyms TO authenticated;
