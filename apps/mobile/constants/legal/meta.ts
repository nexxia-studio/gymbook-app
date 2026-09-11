// Métadonnées de version des textes légaux — module feuille (importé par les textes ET
// par index.ts, donc sans dépendance vers eux : pas de cycle).

// 🔴 GYM-330 — 1.0 → 2.0. LE PASSAGE SE FAIT ICI, UNE SEULE FOIS, ET C'EST CE LOT.
//
// POURQUOI UN SAUT MAJEUR ET NON 1.1. « 1.0 » désigne aujourd'hui DEUX textes différents :
// celui accepté avant le 09/09 et celui d'aujourd'hui. Entre les deux, GYM-333a et GYM-333b
// ont changé la liste des sous-traitants, la durée de conservation comptable (7 → 10 ans),
// la clause de juridiction, l'article 4 sur les données de santé, le régime de rétractation
// — et surtout RESTRUCTURÉ les CGV en deux parties et un bloc commun (A/B/C), au point
// qu'aucun numéro d'article ne survit. Un membre qui a accepté « 1.0 » n'a pas lu ce
// document. Un incrément mineur laisserait croire à une retouche.
//
// ⚠️ CONSÉQUENCE ASSUMÉE, ET C'EST L'OBJET DU LOT : TOUS les membres revoient l'écran
// d'acceptation une fois. `LegalAcceptanceGate` compare `profiles.terms_version` à cette
// constante — tout ce qui n'est pas '2.0' bloque l'app jusqu'à acceptation.
//
// ⚠️ NE PAS LA TOUCHER SANS ÉCRAN. Incrémenter cette valeur REBLOQUE l'app pour la totalité
// du parc, à la seconde du déploiement. C'est voulu ici ; ce serait un incident ailleurs.
export const LEGAL_VERSION = '2.0'

// Date de publication du texte légal (la « date de publication » des sources).
// Elle s'affiche telle quelle dans le corps des textes ET dans le pied de page des écrans
// légaux. Une seule constante partagée (app + pages web).
//
// 🔴 GYM-330 — 2026-07-14 → 2026-09-11. L'ancienne valeur était la date d'ANCRAGE des
// sources, posée en placeholder avec un TODO « figer au déploiement ». La laisser aurait
// publié une version 2.0 datée de juillet, soit deux mois AVANT les corrections qu'elle
// porte : le membre aurait lu « dernière mise à jour : 14/07 » sur un texte réécrit les 09
// et 10/09. Une date antérieure au contenu est pire qu'une date approximative.
//
// La valeur retenue est celle de la dernière modification RÉELLE des textes (lot GYM-330),
// et non une date de déploiement prévisionnelle — c'est le sens de « dernière mise à jour »,
// et c'est la seule que l'on connaisse avec certitude au moment d'écrire.
//
// ⚠️ Si le déploiement glissait de plusieurs semaines, la question se reposerait : le texte
// serait publié bien après sa date. À revoir alors, pas avant.
export const LEGAL_UPDATED_AT = '2026-09-11'
