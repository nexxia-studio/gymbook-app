-- GYM-224 — Numéro de badge d'accès du membre.
--
-- DEMANDE (Antoine, 07/08) : « Dans la fiche membre, il faut que Nico puisse ajouter le
-- numéro personnel du badge. Ce numéro doit être visible aussi dans l'app du membre, dans
-- /profile, idéalement dans la hero-section. »
--
-- Dopamine fonctionne avec un SYSTÈME DE BADGE pour l'entrée : chaque membre a un code
-- d'accès unique qui ouvre la porte et enregistre ses passages. Aucune colonne n'existait
-- (revérifié en PRODUCTION le 15/08 : les 41 colonnes de `profiles` ne comportent ni badge,
-- ni code, ni access_* — seul `postal_code` ressort d'une recherche sur « code »). Sans
-- elle, Nico tiendrait ses numéros dans un fichier à côté : exactement le tableur que Viniz
-- doit supprimer.

-- ─────────────────────────────────────────────────────────────────────────────────────
-- a) La colonne.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- NULLABLE : tous les membres n'auront pas de badge tout de suite, et certains n'en auront
-- jamais. L'absence de badge est un état normal, pas une donnée manquante.
--
-- `text` et non un type numérique : un « numéro » de badge est une RÉFÉRENCE, pas une
-- quantité. Les zéros de tête sont significatifs sur la plupart des lecteurs (0042 ≠ 42),
-- et rien ne garantit que le prochain système n'utilisera pas de lettres.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS access_badge_code text;

COMMENT ON COLUMN public.profiles.access_badge_code IS
  'GYM-224 — code du badge physique qui ouvre la porte de la salle. Saisi par le gérant
   (Edge admin-update-member, service_role), LU seulement par le membre dans /profile.
   ⚠️ VOLONTAIREMENT ABSENT du GRANT UPDATE de GYM-203 : un membre ne modifie pas son
   propre code d''accès. Unique par salle (idx_profiles_access_badge_code_gym).';

-- ─────────────────────────────────────────────────────────────────────────────────────
-- b) Unicité PAR SALLE.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- Deux membres ne peuvent pas partager un badge : le lecteur de porte n'attribuerait le
-- passage qu'à l'un des deux, au hasard.
--
-- ⚠️ L'INDEX EST PARTIEL, ET C'EST INDISPENSABLE. Sans la clause WHERE, tout dépendrait de
-- la façon dont Postgres traite NULL dans un index unique. Ici la sémantique par défaut
-- (NULL distinct de NULL) jouerait en notre faveur, mais s'y fier serait fragile : un
-- passage ultérieur en NULLS NOT DISTINCT (disponible depuis PG 15) suffirait à faire
-- entrer en collision TOUS les membres sans badge — c'est-à-dire la majorité d'entre eux,
-- et le deuxième INSERT échouerait. Le WHERE rend l'intention explicite et l'index
-- insensible à ce choix : les lignes sans badge ne sont tout simplement pas indexées.
--
-- Bénéfice secondaire : l'index ne porte que les membres réellement badgés, et sert la
-- recherche « quelqu'un badge, qui est-ce ? » au comptoir.
--
-- PORTÉE PAR SALLE (gym_id, code) et non globale : deux salles distinctes peuvent très bien
-- avoir chacune un badge « 0001 ». L'unicité globale interdirait à une seconde salle
-- d'utiliser sa propre numérotation — une contrainte que rien ne justifie dans un produit
-- multi-tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_access_badge_code_gym
  ON public.profiles (gym_id, access_badge_code)
  WHERE access_badge_code IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────────────
-- c) CE QUE CETTE MIGRATION NE FAIT PAS — et ce sont des décisions, pas des oublis.
-- ─────────────────────────────────────────────────────────────────────────────────────
--
-- 1. ⚠️ ELLE N'AJOUTE PAS LA COLONNE AU GRANT UPDATE DE GYM-203. C'est le point central de
--    ce lot. La liste blanche compte 24 colonnes (sur 41) ; `access_badge_code` est la 42e
--    et reste DEHORS : un membre ne modifie pas son propre code d'accès physique.
--
--    COROLLAIRE ASSUMÉ : `authenticated` ne peut pas écrire cette colonne — et le jeton du
--    GÉRANT est lui aussi `authenticated`. Le dashboard NE PEUT DONC PAS passer par
--    PostgREST pour la saisir. L'écriture passe par l'Edge admin-update-member, en
--    service_role, dont les GRANTs ne sont pas touchés par GYM-203 (sa propre migration le
--    dit explicitement). Ce n'est pas un contournement : c'est le chemin que le dépôt a
--    déjà retenu pour toute écriture du gérant sur le profil d'un tiers.
--
-- 2. Elle n'écrit AUCUNE donnée. Les numéros sont ceux de Nico ; il les saisira depuis la
--    fiche membre. Une migration n'invente pas des codes d'accès physiques.
--
-- 3. Elle ne touche pas trg_gym_id_immutable (GYM-203) : ce trigger ne se déclenche que
--    `WHEN (OLD.gym_id IS DISTINCT FROM NEW.gym_id)` et exempte service_role de toute
--    façon. Écrire un code de badge ne touche jamais gym_id — le trigger ne se déclenche
--    pas. Vérifié, aucune interaction.
