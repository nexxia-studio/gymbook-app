-- ═══════════════════════════════════════════════════════════════════════════════════════
-- GYM-285 — `nexxia_gyms.short_name` : la colonne, ET le droit de l'écrire.
-- ═══════════════════════════════════════════════════════════════════════════════════════
--
-- 🔴 CE FICHIER EXISTE PARCE QU'UNE COLONNE NE SUFFIT PAS.
--
-- La colonne a été posée directement en staging par le cockpit. Elle n'était donc dans
-- AUCUNE migration du dépôt — et surtout, elle ne pouvait pas être écrite : depuis
-- GYM-180, `authenticated` n'a plus l'UPDATE sur toute la table mais une LISTE BLANCHE
-- colonne par colonne. Une colonne absente de cette liste fait échouer PostgREST avec
-- « permission denied for column short_name » — au moment de l'enregistrement, chez le
-- gérant, sans que rien côté code ne l'ait laissé prévoir.
--
-- ⚠️ CE N'EST PAS UN NOUVEAU CHEMIN D'ÉCRITURE. C'est la MÊME policy (« Gym admins
-- modifient leur salle », `id = get_my_gym_id() AND is_gym_admin()`), étendue d'une
-- colonne. Aucune policy n'est créée, aucun RPC n'est ajouté, aucun droit n'est élargi
-- au-delà de la salle du gérant.
--
-- ⚠️ IDEMPOTENTE DES DEUX CÔTÉS, PARCE QUE LES ENVIRONNEMENTS ONT DÉJÀ DIVERGÉ. Staging a
-- la colonne (posée à la main), le dépôt ne l'a pas, la production ne l'a pas. `IF NOT
-- EXISTS` ne touche pas une colonne existante — le type et la nullabilité posés en staging
-- sont conservés tels quels — et le GRANT est cumulatif par nature.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LA COLONNE
--
-- NULLABLE ET SANS DÉFAUT, délibérément. `NULL` veut dire « le gérant n'a pas choisi de
-- nom court » — et le mobile doit alors afficher le nom COMPLET. Un défaut (chaîne vide,
-- ou une copie de `name`) rendrait ces deux cas indiscernables : on ne saurait plus si le
-- gérant a voulu ce nom court ou si personne n'a rien demandé. C'est la même règle que
-- `primary_color` / `secondary_color` depuis GYM-284.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nexxia_gyms
  ADD COLUMN IF NOT EXISTS short_name text;

COMMENT ON COLUMN public.nexxia_gyms.short_name IS
  'GYM-285 — Nom court affiché dans l''en-tête de l''app mobile. NULL = pas choisi : le '
  'mobile retombe alors sur `name`. Jamais de défaut : NULL et une valeur vide ne veulent '
  'pas dire la même chose.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LE DROIT D'ÉCRITURE — la pièce qui manquait
--
-- Le GRANT est ADDITIF : ce fichier n'énumère pas les 30 colonnes déjà accordées par
-- GYM-180 / 196 / 228 / 242, il en ajoute une. Réécrire la liste entière ici serait la
-- recopier — et le jour où elle divergerait, personne ne saurait laquelle fait foi.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT UPDATE (short_name) ON public.nexxia_gyms TO authenticated;

-- ⚠️ `anon` N'EST PAS CONCERNÉ, et il ne doit pas l'être : GYM-180 lui a retiré l'UPDATE
-- sur cette table. Un visiteur non connecté n'a aucune raison de renommer une salle.
