-- ═══════════════════════════════════════════════════════════════════════════════════════
-- GYM-284 — Les couleurs de Dopamine cessent d'être le défaut de toutes les salles.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- CE QUI ÉTAIT EN BASE, ET CE QUE ÇA PRODUISAIT :
--     primary_color   DEFAULT '#C8F000'::text     ← le lime de Dopamine
--     secondary_color DEFAULT '#111111'::text
-- Toute salle créée naissait donc habillée aux couleurs d'UN client. Relevé en production :
-- `pace-pilates-coffee-club` porte exactement ces deux valeurs, que personne n'a choisies.
--
-- 🔴 ET LE PIRE N'EST PAS L'APPARENCE : c'est qu'une valeur par défaut est INDISCERNABLE
-- d'un choix. Le jour où une salle décide vraiment du lime, rien ne la distingue de celle
-- qui n'a jamais ouvert l'écran. Aucun code ne peut alors décider s'il doit proposer la
-- palette Viniz ou respecter une volonté. NULL rétablit cette distinction : « pas encore
-- choisi » redevient une information.
--
-- ⚠️ AUCUNE VALEUR EXISTANTE N'EST TOUCHÉE. Cette migration ne change QUE le défaut, pour
-- les salles à venir. Dopamine a choisi ses couleurs (#C8F000 / #000000 en production —
-- et son secondaire DIFFÈRE du défaut, ce qui prouve qu'elles ont été posées volontairement) :
-- elles restent. Un UPDATE ici effacerait la marque d'un client en production pour corriger
-- un défaut de schéma — le remède serait pire.
--
-- ⚠️ IDEMPOTENTE : `DROP DEFAULT` sur une colonne qui n'en a plus est un no-op silencieux.

alter table public.nexxia_gyms alter column primary_color   drop default;
alter table public.nexxia_gyms alter column secondary_color drop default;

-- ── LA RAISON, ÉCRITE LÀ OÙ ON LA CHERCHERA ───────────────────────────────────────────
-- Sans ces commentaires, quelqu'un remettra un défaut — de bonne foi, en voyant des NULL
-- et en croyant à un oubli.
comment on column public.nexxia_gyms.primary_color is
  'Couleur PRIMAIRE de la salle (actions, accents). NULL = PAS ENCORE CHOISIE, et c''est '
  'une information, pas un oubli : elle distingue « la salle n''a rien décidé » de « la '
  'salle a choisi cette couleur ». ⚠️ NE PAS REMETTRE DE DEFAULT — un défaut rend les deux '
  'cas indiscernables (GYM-284). Le repli visuel est CÔTÉ CLIENT, sur la palette Viniz : '
  'apps/mobile/lib/theme/resolveTheme.ts pour l''app, _shared/gym-branding.ts pour les '
  'emails. Le client sait résoudre le contraste ; la base, non.';

comment on column public.nexxia_gyms.secondary_color is
  'Couleur SECONDAIRE de la salle (fonds, en-têtes). NULL = pas encore choisie. Mêmes '
  'règles et mêmes replis que primary_color — voir son commentaire (GYM-284).';
