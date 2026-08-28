// GYM-312b — LA RÈGLE DES TROIS ÉTATS DE L'ÉCRAN DE CONNEXION, SEULE ET SANS DÉPENDANCE.
//
// ⚠️ ELLE VIT DANS SON PROPRE FICHIER POUR POUVOIR ÊTRE ÉPROUVÉE. Restée dans
// `MultiLogin.tsx`, la charger depuis un banc supposait de résoudre `react`,
// `react-native` et `expo-router` hors bundler — c'est-à-dire de ne jamais l'éprouver, et
// de se contenter de la relire. Le module n'importe RIEN : le banc le charge tel quel.

export type DestinationConnexion = 'attente' | 'recherche' | 'brandee'

/**
 * La règle des trois états, isolée pour être ÉPROUVÉE plutôt que relue.
 *
 * ⚠️ TROIS ÉTATS, PAS DEUX. `undefined` (« pas encore lu ») n'est pas `null` (« aucune
 * salle ») : les confondre ferait clignoter l'écran de recherche devant CHAQUE membre, le
 * temps d'une lecture de stockage, à chaque affichage de la connexion. C'est le genre de
 * défaut qu'on ne voit pas sur un simulateur rapide et que tout le monde voit sur un
 * téléphone lent.
 */
export function destinationConnexion(slug: string | null | undefined): DestinationConnexion {
  if (slug === undefined) return 'attente'
  return slug === null ? 'recherche' : 'brandee'
}
