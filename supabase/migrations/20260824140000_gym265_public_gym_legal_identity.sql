-- GYM-265 : lecture PUBLIQUE de l'identité légale d'une salle, pour ses CGV.
--
-- ⚠️⚠️ MIGRATION NON DÉPLOYÉE. Elle est livrée dans le dépôt pour relecture ; GYM-265
-- interdit tout déploiement. Tant qu'elle n'est pas appliquée, /legal/terms?gym=<slug>
-- affiche sa version générique — repli VOULU, câblé dans lib/gymLegalIdentity.ts.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LE PROBLÈME
-- ─────────────────────────────────────────────────────────────────────────────
-- Les CGV sont le contrat entre LA SALLE et SON MEMBRE. Le vendeur, son numéro
-- d'entreprise et son siège social doivent y figurer — et la page est PUBLIQUE :
-- rendue sans session (Apple vérifie les URLs légales hors connexion, et un futur
-- membre doit pouvoir lire les conditions avant de créer un compte).
--
-- Constat base LIVE (staging, 24/08/2026, pg_policy) : nexxia_gyms a RLS activé et
-- TROIS policies SELECT — gym_admin de la salle, membre de la salle, super_admin.
-- AUCUNE pour `anon`. Un visiteur non connecté ne peut donc rien lire.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POURQUOI PAS UNE POLICY SELECT POUR anon
-- ─────────────────────────────────────────────────────────────────────────────
-- Parce que le GRANT SELECT d'`anon` sur nexxia_gyms porte sur les 47 COLONNES,
-- dont commission_cb_rate_override, commission_sepa_rate_override,
-- mollie_profile_id, mollie_vault_secret_id, plan, status et trial_ends_at. Une
-- policy RLS ne filtre pas par colonne (leçon GYM-203). On exposerait la grille
-- commerciale et l'état d'abonnement de chaque salle au premier venu pour
-- afficher une adresse de siège.
--
-- Cette fonction est la version étroite : elle ne rend QUE ce qui figure déjà sur
-- les factures que la salle envoie à ses membres et dans ses propres conditions
-- de vente. Rien de confidentiel n'en sort.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- GARDE-FOUS
-- ─────────────────────────────────────────────────────────────────────────────
--   · SECURITY DEFINER + search_path figé : pas de résolution de nom détournable.
--   · STABLE : lecture pure, aucun effet de bord.
--   · deleted_at IS NULL : une salle supprimée n'a plus de conditions à publier.
--   · Liste de colonnes EXPLICITE. ⚠️ Ne JAMAIS y ajouter `plan`, `status`,
--     `trial_*`, `commission_*` ni `mollie_*` : ce sont des données commerciales.
--   · REVOKE FROM PUBLIC avant le GRANT — Postgres accorde EXECUTE à PUBLIC par
--     défaut sur toute fonction nouvelle, ce qui rendrait le GRANT explicite
--     décoratif et masquerait l'intention.
--
-- Rejouable : CREATE OR REPLACE + REVOKE/GRANT idempotents.

CREATE OR REPLACE FUNCTION public.public_gym_legal_identity(p_slug text)
RETURNS TABLE (
  name              text,
  commercial_name   text,
  legal_name        text,
  legal_form        text,
  vat_number        text,
  legal_address     text,
  legal_postal_code text,
  legal_city        text,
  address           text,
  postal_code       text,
  city              text,
  email             text,
  phone             text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
  SELECT
    g.name,
    g.commercial_name,
    g.legal_name,
    g.legal_form,
    g.vat_number,
    g.legal_address,
    g.legal_postal_code,
    g.legal_city,
    g.address,
    g.postal_code,
    g.city,
    g.email,
    g.phone
  FROM public.nexxia_gyms g
  -- `slug` d'abord, `subdomain` en second choix : les deux valent 'dopamine' en
  -- base, mais slug est la colonne qui porte l'identité d'URL (cf. gym-branding.ts).
  WHERE (g.slug = lower(p_slug) OR g.subdomain = lower(p_slug))
    AND g.deleted_at IS NULL
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.public_gym_legal_identity(text) IS
  'GYM-265 — Identité légale publique d''une salle, par slug. Alimente /legal/terms?gym=<slug>. '
  'Ne rend QUE des informations déjà publiques (facture, conditions de vente) : ne jamais y '
  'ajouter plan, status, trial_*, commission_* ni mollie_*.';

REVOKE ALL ON FUNCTION public.public_gym_legal_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_gym_legal_identity(text) TO anon, authenticated;
