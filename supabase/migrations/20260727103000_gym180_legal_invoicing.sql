-- GYM-180 : identité légale de l'émetteur + régime TVA sur nexxia_gyms.
--
-- PROBLÈME : le bloc émetteur de generate-invoice était CODÉ EN DUR dans le HTML
-- (« Dopamine Performance Club », « Neupré, Belgique », « TVA non applicable — Art. 44 »).
-- Les factures émises ne sont donc pas conformes : pas de raison sociale, pas de n° TVA,
-- et une mention d'exonération très probablement FAUSSE (les clients visent un régime assujetti).
--
-- ─── DÉCISION PRODUIT : DEUX ADRESSES DISTINCTES ─────────────────────────────
-- Une salle n'est presque jamais domiciliée à son siège social. On sépare donc :
--
--   address / postal_code / city  = ADRESSE D'EXPLOITATION (LA SALLE).
--       C'est l'adresse « physique » : celle que le membre voit dans l'app, celle qu'on
--       envoie à Google Maps, celle de l'itinéraire. Colonnes EXISTANTES, on garde leur
--       sémantique côté usage membre.
--       ⚠️ Contenaient jusqu'ici l'adresse du SIÈGE (« Route du Condroz », 4120 Neupré) :
--       l'UPDATE ci-dessous corrige ce mélange pour Dopamine.
--
--   legal_address / legal_postal_code / legal_city = SIÈGE SOCIAL.
--       Adresse juridique de la société, celle qui DOIT figurer sur la facture.
--       Colonnes NOUVELLES.
--
-- ─── DÉCISION PRODUIT : LE RÉGIME TVA EST UNE DONNÉE, JAMAIS DU CODE ─────────
-- Le taux applicable dépend du régime réel de chaque exploitant (12 % visé chez Dopamine,
-- EN ATTENTE de confirmation du comptable). Il doit donc être modifiable depuis /settings
-- sans redéploiement : vat_rate + vat_exempt + vat_exempt_mention.
--
-- ─── Constats schéma (Règle Zéro, base live prod) ────────────────────────────
--   - address, city, postal_code, country, phone, email, vat_number, company_name EXISTENT
--     déjà → on ne les recrée pas. company_name est NULL partout et n'était lue nulle part :
--     elle est laissée en place (aucune donnée à migrer), superseded par legal_name /
--     commercial_name qui portent une sémantique explicite.
--   - nexxia_gyms a RLS ACTIVÉ mais AUCUNE policy UPDATE : seules 2 policies SELECT
--     (gym_admin, member) + 1 policy ALL super_admin. Un gym_admin ne peut donc RIEN
--     écrire — l'UPDATE part sur 0 ligne, sans erreur (cf. section d).
--   - Un seul gym en base (Dopamine, a0000000-…-0001). L'UPDATE est malgré tout scopé par id.

-- ─────────────────────────────────────────────────────────────────────────────
-- a) Identité légale de l'émetteur.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nexxia_gyms
  ADD COLUMN IF NOT EXISTS legal_name        text,
  ADD COLUMN IF NOT EXISTS legal_form        text,
  ADD COLUMN IF NOT EXISTS commercial_name   text,
  ADD COLUMN IF NOT EXISTS legal_address     text,
  ADD COLUMN IF NOT EXISTS legal_postal_code text,
  ADD COLUMN IF NOT EXISTS legal_city        text;

COMMENT ON COLUMN public.nexxia_gyms.legal_name IS
  'Raison sociale de la société exploitante (ex. « EMS 95 »). Figure sur la facture.';
COMMENT ON COLUMN public.nexxia_gyms.legal_form IS
  'Forme juridique (ex. « SRL », « SA », « ASBL »). Champ libre, peut rester NULL.';
COMMENT ON COLUMN public.nexxia_gyms.commercial_name IS
  'Dénomination commerciale / enseigne (ex. « Dopamine by EMS95 »). Repli sur name si NULL.';
COMMENT ON COLUMN public.nexxia_gyms.legal_address IS
  'SIÈGE SOCIAL — rue et numéro. Distinct de address qui est l''adresse de la salle.';
COMMENT ON COLUMN public.nexxia_gyms.legal_postal_code IS 'SIÈGE SOCIAL — code postal.';
COMMENT ON COLUMN public.nexxia_gyms.legal_city IS 'SIÈGE SOCIAL — commune.';

COMMENT ON COLUMN public.nexxia_gyms.address IS
  'ADRESSE D''EXPLOITATION (la salle) — rue et numéro. Usage membre / Google / app.';
COMMENT ON COLUMN public.nexxia_gyms.postal_code IS 'ADRESSE D''EXPLOITATION (la salle) — code postal.';
COMMENT ON COLUMN public.nexxia_gyms.city IS 'ADRESSE D''EXPLOITATION (la salle) — commune.';

-- ─────────────────────────────────────────────────────────────────────────────
-- b) Régime TVA — paramétrable, jamais codé en dur.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.nexxia_gyms
  ADD COLUMN IF NOT EXISTS vat_rate           numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_exempt         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vat_exempt_mention text;

COMMENT ON COLUMN public.nexxia_gyms.vat_rate IS
  'Taux de TVA applicable, en POURCENT (ex. 12.00 = 12 %). Ignoré si vat_exempt = true.';
COMMENT ON COLUMN public.nexxia_gyms.vat_exempt IS
  'true = exonéré de TVA : la facture n''affiche aucune ligne TVA mais la mention légale.';
COMMENT ON COLUMN public.nexxia_gyms.vat_exempt_mention IS
  'Mention légale d''exonération à imprimer (ex. « TVA non applicable — Art. 44 du Code TVA »). NULL si assujetti.';

-- Garde-fou : un taux hors [0,100] est forcément une saisie erronée.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.nexxia_gyms'::regclass
      AND conname  = 'nexxia_gyms_vat_rate_range'
  ) THEN
    ALTER TABLE public.nexxia_gyms
      ADD CONSTRAINT nexxia_gyms_vat_rate_range CHECK (vat_rate >= 0 AND vat_rate <= 100);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- c) Données légales réelles de Dopamine.
--    ⚠️ Scopé par id : aucun autre gym n'est touché.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.nexxia_gyms SET
  commercial_name   = 'Dopamine by EMS95',
  legal_name        = 'EMS 95',
  vat_number        = 'BE 1020.241.644',

  -- Siège social (reprend l'adresse qui était stockée à tort dans address/*, corrigée : 4121).
  legal_address     = 'Route du Condroz 95 A',
  legal_postal_code = '4121',
  legal_city        = 'Neupré',

  -- Adresse d'exploitation : LA SALLE.
  address           = 'Avenue du Centenaire 313',
  postal_code       = '4102',
  city              = 'Ougrée',
  country           = 'BE',

  -- Régime assujetti 12 % (hypothèse gérant, à confirmer par le comptable → modifiable dans /settings).
  vat_rate           = 12.00,
  vat_exempt         = false,
  vat_exempt_mention = NULL
WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- ─────────────────────────────────────────────────────────────────────────────
-- d) RLS : rendre /settings réellement écrivable par le gérant.
--
--    CONSTAT : nexxia_gyms n'avait AUCUNE policy UPDATE. Le seul écrivain applicatif
--    (useGymSettings.updateWaitlistDelay, client authenticated) partait donc sur 0 ligne
--    et rendait { error: null } — un enregistrement qui « réussit » sans rien écrire.
--    Sans cette section, la nouvelle section « Informations légales » serait tout aussi muette.
--
--    Le gérant ne doit pouvoir toucher QUE les champs d'exploitation. Les champs
--    commerciaux et techniques (plan, status, trial_*, commission_*_override, mollie_*,
--    id, slug, subdomain, onboarding_*, deleted_at) restent hors de sa portée : une policy
--    RLS ne sait pas filtrer par colonne, on s'appuie donc sur les GRANTs colonne par colonne.
-- ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Gym admins modifient leur salle" ON public.nexxia_gyms;
CREATE POLICY "Gym admins modifient leur salle" ON public.nexxia_gyms
  FOR UPDATE
  USING      ((id = get_my_gym_id()) AND is_gym_admin())
  WITH CHECK ((id = get_my_gym_id()) AND is_gym_admin());

-- anon n'a jamais rien à écrire ici ; authenticated est ramené à la liste blanche.
REVOKE UPDATE ON public.nexxia_gyms FROM anon;
REVOKE UPDATE ON public.nexxia_gyms FROM authenticated;

GRANT UPDATE (
  -- Identité affichée
  name, commercial_name, legal_name, legal_form,
  -- Siège social
  legal_address, legal_postal_code, legal_city,
  -- Établissement (la salle)
  address, postal_code, city, country,
  -- Contact
  phone, email,
  -- Fiscalité
  vat_number, vat_rate, vat_exempt, vat_exempt_mention,
  -- Marque et préférences déjà exposées au gérant
  logo_url, primary_color, secondary_color,
  timezone, currency, default_language, supported_languages,
  dpo_name, dpo_email,
  waitlist_confirmation_minutes
) ON public.nexxia_gyms TO authenticated;
