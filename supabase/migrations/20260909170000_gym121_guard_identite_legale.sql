-- ╔═══════════════════════════════════════════════════════════════════════════════════════╗
-- ║  GYM-121 (VOLET GUARD) — UNE SALLE NE PEUT PAS ENCAISSER SANS IDENTITÉ LÉGALE         ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════╝
--
-- 🔴 CE FICHIER N'EST PAS APPLIQUÉ PAR CE LOT. Le cockpit l'exécute, staging puis prod.
-- Les volets schéma, dashboard et interpolation sont déjà livrés — celui-ci ne pose que
-- la règle et sa garde.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LE FAIT
-- ─────────────────────────────────────────────────────────────────────────────────────
-- Dopamine porte son identité légale parce qu'elle a été saisie À LA MAIN. Pace, née par
-- le wizard self-serve comme le seront toutes les futures salles, a ses colonnes légales
-- à NULL — et `create-payment` ne les vérifie pas (gardes lues sur le déployé : profil,
-- appartenance, plan `payments_enabled`, résolution du tarif). Une salle peut donc vendre
-- avec des CGV au nom de personne et des factures sans mention de TVA.
--
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 LA RÈGLE — UNE SEULE, ET ELLE NE PART PAS DE ZÉRO
-- ═════════════════════════════════════════════════════════════════════════════════════
-- `apps/dashboard/src/lib/gymLegalIdentity.ts` porte DÉJÀ, depuis GYM-265, la liste des
-- champs sans lesquels des CGV ne valent rien :
--
--     REQUIRED_LEGAL_FIELDS = [legalName, vatNumber, legalAddress, legalPostalCode,
--                              legalCity, email]
--
-- Cette migration ne définit donc pas une SECONDE règle : elle porte la MÊME en SQL, et y
-- ajoute le seul cas que la première ne couvrait pas — la franchise TVA. Deux prédicats
-- pour la même question, c'est l'erreur que GYM-191 puis GYM-252 ont dû rattraper à
-- quatre endroits ; on ne la refait pas ici.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- CE QUI EST EXIGÉ, ET POURQUOI
-- ─────────────────────────────────────────────────────────────────────────────────────
--  · legal_name .......... le VENDEUR. Sans lui le contrat n'a pas de partie.
--  · legal_address ....... \
--  · legal_postal_code ... | le siège. Une facture belge doit porter l'adresse du vendeur,
--  · legal_city .......... /  et une adresse à trous n'est pas une adresse à moitié valable.
--  · vat_number .......... le numéro d'entreprise / TVA (BE0…). Mention obligatoire sur
--                          toute facture, et seul identifiant qui rattache la salle à une
--                          personne juridique réelle.
--  · email ............... le canal de contact du vendeur. Il est déjà dans la règle
--                          GYM-265 pour une raison précise : la clause de rétractation
--                          des CGV doit désigner une adresse à laquelle le membre écrit.
--                          Sans elle, la clause la plus protectrice pointe dans le vide.
--
-- ─────────────────────────────────────────────────────────────────────────────────────
-- LES TROIS POINTS TRANCHÉS
-- ─────────────────────────────────────────────────────────────────────────────────────
-- 1. `vat_number` EST EXIGÉ MÊME SI `vat_exempt = true`. La franchise (art. 56bis du Code
--    de la TVA) dispense de FACTURER la taxe ; elle ne dispense pas d'EXISTER. Une salle
--    sous le seuil est immatriculée à la BCE et porte son numéro d'entreprise sur ses
--    documents — c'est ce que cette colonne stocke (« Numéro d'entreprise / TVA », note
--    BCE ≠ TVA de GYM-265). L'exonérer reviendrait à émettre des factures anonymes.
--
--    🔴 EN REVANCHE, `vat_exempt = true` EXIGE `vat_exempt_mention`. Une facture sans TVA
--    et sans mention explicative est irrégulière : le client ne peut pas savoir pourquoi
--    la taxe manque. La colonne existe précisément pour porter cette phrase — la laisser
--    vide pendant qu'on n'affiche aucune TVA, c'est le pire des deux mondes. C'est la
--    SEULE règle conditionnelle de cette fonction.
--
-- 2. `commercial_name` N'EST PAS EXIGÉ. C'est une ENSEIGNE, pas une identité : le code le
--    traite déjà comme tel — `sellerName()` rend `commercialName ?? legalName ?? name`.
--    Une salle qui vend sous sa raison sociale est parfaitement en règle. L'exiger
--    bloquerait une salle conforme pour une préférence d'affichage.
--
-- 3. `phone` N'EST PAS EXIGÉ. Un moyen de contact rapide est nécessaire ; `email` en est
--    un, et c'est celui que la règle GYM-265 avait déjà retenu. Mesuré : Dopamine, qui
--    vend en production depuis des mois, n'a PAS de téléphone renseigné — l'exiger
--    bloquerait la seule salle actuellement conforme. Un critère qui recale le cas
--    nominal est un mauvais critère.
--
-- 4. `legal_form` N'EST PAS EXIGÉ non plus, et pour la même mesure : Dopamine ne l'a pas.
--    Le champ est utile (il complète la dénomination sur la facture, cf.
--    `generate-invoice` qui joint `legal_name` et `legal_form`) mais une personne physique
--    n'en a pas. En faire un bloquant exclurait les indépendants.

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 1. LES CHAMPS MANQUANTS — la fonction de base, celle qui porte la règle
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ ELLE REND LA LISTE, PAS UN BOOLÉEN, et c'est le sens de la construction. Un booléen
-- suffirait à bloquer, mais pas à DIRE QUOI FAIRE — et c'est précisément la leçon de
-- GYM-259, où « échec côté prestataire » a masqué deux semaines durant une absence de
-- connexion Mollie. Le prédicat booléen se dérive de cette liste (voir plus bas) ; jamais
-- l'inverse, sinon les deux divergent.
--
-- ⚠️ `btrim(...) <> ''` ET PAS SEULEMENT `IS NOT NULL`. Les colonnes sont alimentées par
-- un formulaire : une chaîne vide ou trois espaces y arrivent aussi facilement qu'un NULL,
-- et rendraient la salle « complète » avec une facture blanche.
CREATE OR REPLACE FUNCTION public.gym_legal_identity_missing(p_gym_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(champ ORDER BY ordre), ARRAY[]::text[])
  FROM (
    SELECT 1 AS ordre, 'legal_name'        AS champ FROM nexxia_gyms g WHERE g.id = p_gym_id AND coalesce(btrim(g.legal_name), '') = ''
    UNION ALL
    SELECT 2, 'vat_number'                 FROM nexxia_gyms g WHERE g.id = p_gym_id AND coalesce(btrim(g.vat_number), '') = ''
    UNION ALL
    SELECT 3, 'legal_address'              FROM nexxia_gyms g WHERE g.id = p_gym_id AND coalesce(btrim(g.legal_address), '') = ''
    UNION ALL
    SELECT 4, 'legal_postal_code'          FROM nexxia_gyms g WHERE g.id = p_gym_id AND coalesce(btrim(g.legal_postal_code), '') = ''
    UNION ALL
    SELECT 5, 'legal_city'                 FROM nexxia_gyms g WHERE g.id = p_gym_id AND coalesce(btrim(g.legal_city), '') = ''
    UNION ALL
    SELECT 6, 'email'                      FROM nexxia_gyms g WHERE g.id = p_gym_id AND coalesce(btrim(g.email), '') = ''
    UNION ALL
    -- La seule règle conditionnelle : voir le point 1 en tête de fichier.
    SELECT 7, 'vat_exempt_mention'         FROM nexxia_gyms g WHERE g.id = p_gym_id AND g.vat_exempt IS TRUE AND coalesce(btrim(g.vat_exempt_mention), '') = ''
  ) manquants;
$function$;

COMMENT ON FUNCTION public.gym_legal_identity_missing(uuid) IS
  'GYM-121 — champs d''identité légale manquants pour vendre. Liste ordonnée, vide si '
  'complet. Porte la MÊME règle que REQUIRED_LEGAL_FIELDS (dashboard, GYM-265), plus la '
  'mention de franchise TVA quand vat_exempt est vrai. Rend la liste et non un booléen : '
  'un refus doit pouvoir dire quoi faire.';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 2. LE PRÉDICAT — dérivé, jamais réécrit
-- ═════════════════════════════════════════════════════════════════════════════════════
-- ⚠️ UNE SALLE INEXISTANTE N'EST PAS COMPLÈTE. `gym_legal_identity_missing` rend un
-- tableau VIDE pour un `p_gym_id` inconnu — aucune ligne ne satisfait les WHERE — ce qui
-- se lirait comme « rien ne manque ». D'où le test d'existence explicite : le repli d'un
-- identifiant inconnu doit être le refus, jamais l'autorisation.
CREATE OR REPLACE FUNCTION public.gym_legal_identity_complete(p_gym_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM nexxia_gyms g WHERE g.id = p_gym_id AND g.deleted_at IS NULL)
     AND cardinality(public.gym_legal_identity_missing(p_gym_id)) = 0;
$function$;

COMMENT ON FUNCTION public.gym_legal_identity_complete(uuid) IS
  'GYM-121 — la salle peut-elle encaisser ? Dérivé de gym_legal_identity_missing : une '
  'seule règle, deux formes. Faux pour une salle inconnue ou supprimée.';

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 3. LES DROITS
-- ═════════════════════════════════════════════════════════════════════════════════════
-- `service_role` pour les Edge Functions (la garde de create-payment / create-subscription).
-- `authenticated` pour le dashboard : un gérant doit pouvoir afficher SA liste de champs
-- manquants avant de connecter Mollie.
--
-- ⚠️ CE QUE CES FONCTIONS EXPOSENT — et pourquoi c'est acceptable. Elles ne rendent que
-- des NOMS DE COLONNES, jamais leur contenu : savoir qu'une salle n'a pas renseigné son
-- numéro de TVA n'apprend rien de confidentiel, et cette identité figure de toute façon
-- sur chaque facture qu'elle émet. Aucune donnée commerciale (plan, commissions, Mollie)
-- n'est atteignable par ce chemin, contrairement à un GRANT SELECT sur la table — c'est
-- le raisonnement déjà tenu en GYM-265 pour `public_gym_legal_identity`.
REVOKE ALL     ON FUNCTION public.gym_legal_identity_missing(uuid)  FROM PUBLIC;
REVOKE ALL     ON FUNCTION public.gym_legal_identity_complete(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.gym_legal_identity_missing(uuid)  TO service_role, authenticated;
GRANT  EXECUTE ON FUNCTION public.gym_legal_identity_complete(uuid) TO service_role, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════
-- 4. CE QUE CE LOT NE FAIT PAS
-- ═════════════════════════════════════════════════════════════════════════════════════
-- 🔴 AUCUNE COLONNE NE DEVIENT `NOT NULL`. Deux salles de production et trois de staging
-- seraient rejetées à l'écriture — dont Pace, la salle de démo Apple. La garde se pose au
-- MOMENT DE VENDRE, pas au moment d'exister : une salle a le droit d'être créée
-- incomplète, elle n'a pas le droit d'encaisser dans cet état.
--
-- 🔴 AUCUNE ÉTAPE N'EST AJOUTÉE AU WIZARD SELF-SERVE. Les six étapes sont : ta salle, ta
-- première activité, ton premier coach, ton premier créneau, ta politique d'annulation,
-- invite tes membres. AUCUNE ne recueille l'identité légale — vérifié, ce n'est pas une
-- étape à « rendre obligatoire », c'est une étape qui n'existe pas. Où l'ajouter est un
-- arbitrage produit : la recommandation est en PR, la décision au cockpit.
