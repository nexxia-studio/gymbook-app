-- GYM-230 — Séries de créneaux récurrents (RFC 5545).
--
-- DEMANDE (Nico via Antoine, 12/08) : « Quand on modifie un cours de la semaine 1, il ne
-- modifie pas les récurrences des semaines 2-3-4. Il faut s'inspirer d'Apple Calendar :
-- proposer de modifier soit cet événement, soit tous les futurs. Pareil pour la suppression. »
--
-- ÉTAT AVANT CE LOT : la récurrence GÉNÉRAIT des créneaux totalement indépendants
-- (usePlanning.createSlot, boucle de N semaines), sans aucun lien entre eux. Changer
-- l'heure d'un cours récurrent coûtait huit manipulations ; l'annuler pour les vacances,
-- huit aussi. C'est le geste le plus fréquent d'un gérant, et c'était le plus coûteux.
--
-- ═════════════════════════════════════════════════════════════════════════════════════
-- TABLE DÉDIÉE, PAS UNE COLONNE DE GROUPE — arbitrage
-- ═════════════════════════════════════════════════════════════════════════════════════
--
-- L'alternative était un simple `series_id uuid` sur time_slots, la règle étant recopiée
-- sur chaque occurrence. Écartée pour trois raisons :
--
--   1. LA RÈGLE EST UNE PROPRIÉTÉ DE LA SÉRIE, PAS DE L'OCCURRENCE. Recopier
--      « chaque lundi à 9 h jusqu'au 31/12 » sur 52 lignes, c'est 52 endroits où elle peut
--      diverger — et la modifier deviendrait un UPDATE de masse dont un échec partiel
--      laisserait la série incohérente avec elle-même.
--   2. GYM-235 (flux .ics) lit UNE règle par série pour émettre un VEVENT récurrent.
--      Avec une colonne de groupe il faudrait la déduire des occurrences — c'est-à-dire
--      ré-inférer ce qu'on avait déjà.
--   3. Les bornes de génération (`generated_until`) n'ont de sens qu'au niveau série :
--      posées sur chaque ligne, elles n'auraient aucun porteur naturel.
--
-- Le coût est une jointure de plus, sur une table qui comptera quelques dizaines de lignes
-- par salle.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- a) La série.
-- ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.slot_series (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  gym_id uuid NOT NULL,

  -- Gabarit de l'occurrence. Ces valeurs sont celles avec lesquelles les créneaux FUTURS
  -- sont (re)générés ; les créneaux déjà posés portent les leurs, et une modification de
  -- série les met à jour explicitement.
  activity_id uuid NOT NULL,
  coach_id uuid,                       -- nullable : activité en accès libre (GYM-229)
  capacity integer NOT NULL,
  level text DEFAULT 'all',
  notes text,

  -- ═══════════════════════════════════════════════════════════════════════════════════
  -- LE FUSEAU — le point le plus délicat de ce lot.
  -- ═══════════════════════════════════════════════════════════════════════════════════
  --
  -- ⚠️ L'HEURE EST STOCKÉE EN LOCAL, JAMAIS EN UTC. `starts_local_time` vaut '09:00' et
  -- signifie « 9 h à l'horloge de la salle », pas un instant absolu.
  --
  -- POURQUOI C'EST INDISPENSABLE : le 25 octobre 2026, l'Europe repasse à l'heure d'hiver
  -- (GYM-93). Une série stockée en UTC — « 07:00Z », qui vaut 9 h locales en été — se
  -- mettrait à produire des cours à 8 h locales après cette date. Tous les cours d'une
  -- salle décalés d'une heure, sans que personne n'ait rien changé.
  --
  -- En stockant l'heure LOCALE et le fuseau, chaque occurrence est convertie
  -- individuellement au moment de sa génération : le 18/10 → 07:00Z, le 01/11 → 08:00Z,
  -- et les deux valent 9 h à l'horloge. C'est déjà ce que faisait createSlot
  -- (fromZonedTime par occurrence) ; ce lot le formalise au lieu de le laisser implicite.
  --
  -- ⚠️ `timezone` est CAPTURÉ à la création et ne suit pas nexxia_gyms.timezone : une salle
  -- qui changerait de fuseau ne doit pas voir ses séries existantes se décaler
  -- rétroactivement. C'est aussi le TZID qu'exportera le .ics de GYM-235
  -- (DTSTART;TZID=Europe/Brussels).
  starts_local_time time NOT NULL,
  duration_min integer NOT NULL,
  timezone text NOT NULL,

  -- ═══════════════════════════════════════════════════════════════════════════════════
  -- LA RÈGLE — chaîne RRULE standard (RFC 5545), pas un modèle maison.
  -- ═══════════════════════════════════════════════════════════════════════════════════
  --
  -- Exemples : 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE'
  --            'FREQ=MONTHLY;BYMONTHDAY=15'
  --            'FREQ=MONTHLY;BYDAY=2TU'        (le 2e mardi)
  --
  -- DÉCISION PRODUIT (Antoine) : format standard précisément parce que GYM-235 le reprendra
  -- TEL QUEL dans les flux .ics. Un modèle maison imposerait une migration le jour venu.
  --
  -- ⚠️ La règle ne porte NI la date de début (c'est `starts_on`), NI le fuseau (c'est
  -- `timezone`) : dans un VEVENT ces informations vivent sur DTSTART, pas sur RRULE.
  -- Le COUNT/UNTIL éventuel y figure en revanche, comme le veut la norme.
  rrule text NOT NULL,

  -- Première occurrence, en date LOCALE. Point d'ancrage de la règle.
  starts_on date NOT NULL,

  -- ═══════════════════════════════════════════════════════════════════════════════════
  -- LA BORNE — pas de récurrence infinie (décision produit 3).
  -- ═══════════════════════════════════════════════════════════════════════════════════
  --
  -- `generated_until` = dernière date locale POUR LAQUELLE des créneaux existent. Elle
  -- rend la génération reprenable : prolonger une série revient à générer de
  -- generated_until+1 jusqu'à la nouvelle borne, sans risque de doublon.
  --
  -- ⚠️ PLAFOND D'UN AN IMPOSÉ EN BASE, pas seulement dans le formulaire. Une contrainte
  -- côté client se contourne avec un appel direct à PostgREST ; celle-ci ne se contourne
  -- pas. 52 occurrences hebdomadaires est déjà beaucoup à annuler si le gérant se trompe.
  generated_until date NOT NULL,

  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),

  CONSTRAINT slot_series_pkey PRIMARY KEY (id),
  CONSTRAINT slot_series_gym_id_fkey FOREIGN KEY (gym_id)
    REFERENCES public.nexxia_gyms(id) ON DELETE CASCADE,
  CONSTRAINT slot_series_activity_id_fkey FOREIGN KEY (activity_id)
    REFERENCES public.activities(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL, comme time_slots.coach_id : retirer un coach ne doit pas
  -- supprimer la série qu'il animait (symétrie GYM-200 §4, l'historique se conserve).
  CONSTRAINT slot_series_coach_id_fkey FOREIGN KEY (coach_id)
    REFERENCES public.coaches(id) ON DELETE SET NULL,
  CONSTRAINT slot_series_capacity_check CHECK (capacity > 0),
  CONSTRAINT slot_series_duration_check CHECK (duration_min > 0),
  CONSTRAINT slot_series_level_check
    CHECK (level = ANY (ARRAY['all'::text, 'beginner'::text, 'intermediate'::text, 'advanced'::text])),
  -- Le plafond, en base. `starts_on` incluse → 366 jours couvrent une année bissextile.
  CONSTRAINT slot_series_horizon_check
    CHECK (generated_until >= starts_on AND generated_until <= starts_on + INTERVAL '366 days'),
  -- Garde-fou de format : une chaîne RRULE commence toujours par sa fréquence.
  CONSTRAINT slot_series_rrule_check CHECK (rrule LIKE 'FREQ=%')
);

CREATE INDEX IF NOT EXISTS idx_slot_series_gym ON public.slot_series (gym_id);

COMMENT ON TABLE public.slot_series IS
  'GYM-230 — série de créneaux récurrents. Porte la règle RRULE (RFC 5545) UNE fois, et
   l''heure en LOCAL + le fuseau pour que le passage à l''heure d''hiver ne décale rien.
   Les créneaux restent des lignes réelles de time_slots : la règle sert à les PRODUIRE et
   à savoir lesquels forment la série, elle ne les remplace pas.';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- b) Le lien depuis les créneaux.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ NULLABLE, et ce n'est pas une commodité : les 126 créneaux existants n'appartiennent
-- à aucune série (décision produit 7 — Nico les refera) et doivent continuer de fonctionner
-- EXACTEMENT comme aujourd'hui. `series_id IS NULL` est l'état normal d'un créneau ponctuel,
-- pas une donnée manquante.
--
-- ON DELETE SET NULL : supprimer une série ne doit JAMAIS supprimer les créneaux passés.
-- Présences, pénalités et paiements y sont attachés (décision produit 6) — on détache, on
-- n'efface pas.
ALTER TABLE public.time_slots
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES public.slot_series(id) ON DELETE SET NULL;

-- Un créneau modifié INDIVIDUELLEMENT devient une exception : les modifications de série
-- ultérieures l'épargnent (décision produit 5, comportement d'Apple Calendar).
--
-- Colonne booléenne plutôt qu'une table d'exceptions : l'exception n'est pas une absence
-- d'occurrence (EXDATE) mais une occurrence DIVERGENTE, qui existe bel et bien et se
-- réserve normalement. L'information tient donc sur la ligne concernée.
ALTER TABLE public.time_slots
  ADD COLUMN IF NOT EXISTS is_series_exception boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.time_slots.series_id IS
  'GYM-230 — série d''appartenance. NULL = créneau ponctuel (cas des 126 créneaux
   antérieurs au lot, et de toute création simple). ON DELETE SET NULL : supprimer une
   série détache ses créneaux, elle ne les efface pas.';

COMMENT ON COLUMN public.time_slots.is_series_exception IS
  'GYM-230 — ce créneau a été modifié SEUL : une modification portant sur « cet événement
   et tous les suivants » l''épargne. Sans ce marqueur, la modification de série écraserait
   silencieusement une décision que le gérant avait prise sur une date précise.';

-- Sert les deux gestes du lot : lister les créneaux FUTURS d'une série (modification /
-- suppression « et tous les suivants ») et compter les occurrences déjà générées.
CREATE INDEX IF NOT EXISTS idx_time_slots_series
  ON public.time_slots (series_id, starts_at)
  WHERE series_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- c) RLS — même modèle que time_slots et activities.
-- ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.slot_series ENABLE ROW LEVEL SECURITY;

-- Le gérant gère les séries de SA salle. Prédicat identique à
-- « Gym admins gèrent les activités » (get_my_gym_id() + is_gym_admin()).
CREATE POLICY "Gym admins gèrent les séries" ON public.slot_series
  USING      ((gym_id = public.get_my_gym_id()) AND public.is_gym_admin())
  WITH CHECK ((gym_id = public.get_my_gym_id()) AND public.is_gym_admin());

-- Le MEMBRE n'a aucune raison de lire les séries : il consulte des créneaux, pas des
-- règles. Aucune policy de lecture pour lui — le silence est le refus par défaut sous RLS.

CREATE TRIGGER trg_slot_series_updated
  BEFORE UPDATE ON public.slot_series
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();
