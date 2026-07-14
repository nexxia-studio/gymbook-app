// Métadonnées de version des textes légaux — module feuille (importé par les textes ET
// par index.ts, donc sans dépendance vers eux : pas de cycle).

export const LEGAL_VERSION = '1.0'

// Date de publication du texte légal (la « date de publication » des sources).
// PLACEHOLDER ISO à FIGER à la date réelle du déploiement prod : cette valeur s'affiche
// telle quelle dans le corps des textes ET dans le pied de page des écrans légaux. Une
// seule constante partagée (app + pages web). La valeur ci-dessous est la date
// d'ancrage/vérification des sources (14/07/2026), à remplacer au go-live.
// TODO: figer à la date de publication prod avant déploiement.
export const LEGAL_UPDATED_AT = '2026-07-14'
