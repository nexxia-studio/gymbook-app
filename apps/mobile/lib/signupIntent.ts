// GYM-293 — LA MARQUE « CE CHOIX VIENT D'UNE INSCRIPTION ».
//
// ═════════════════════════════════════════════════════════════════════════════════════
// POURQUOI CETTE MARQUE EXISTE, ET POURQUOI ELLE EST À PART DU SLUG
// ═════════════════════════════════════════════════════════════════════════════════════
// À l'ouverture de session, la réconciliation rencontre deux fois le MÊME état apparent :
// un slug choisi, et aucune adhésion. Les deux intentions sont pourtant opposées.
//
//   · choix de CONNEXION sans adhésion → « tu n'es pas membre de cette salle ». C'est le
//     refus de GYM-301, et il est JUSTE : le membre s'est trompé de salle.
//   · choix de SIGNUP sans adhésion    → « tu viens de créer ton compte ». Le rattachement
//     n'a pas encore eu lieu, et c'est précisément ce qu'on doit faire.
//
// Sans cette marque, la réconciliation ne peut pas les distinguer — et afficherait « tu
// n'es pas membre » à quelqu'un qui vient de s'inscrire chez cette salle-là.
//
// ⚠️ ELLE NE REMPLACE PAS LE SLUG, ELLE LE QUALIFIE. Le slug reste la seule source de la
// salle choisie ; ceci ne dit que d'où vient le choix. Les mêler — un « slug de signup »
// séparé — créerait une seconde source de vérité pour la salle, ce que trois lots ont servi
// à supprimer.
//
// ⚠️ ET ELLE SE CONSOMME UNE FOIS. Une marque qui survivrait à la réconciliation ferait
// retenter un rattachement à chaque ouverture de session, longtemps après l'inscription.
import AsyncStorage from '@react-native-async-storage/async-storage'

const CLE = 'viniz.signup_intent'

/** Pose la marque, juste avant de naviguer vers l'inscription. */
export async function markSignupIntent(): Promise<void> {
  try { await AsyncStorage.setItem(CLE, '1') } catch { /* best-effort */ }
}

/**
 * `true` si le choix courant vient d'une inscription — ET EFFACE LA MARQUE.
 *
 * La lecture est destructrice à dessein : voir la note ci-dessus. Un échec de lecture rend
 * `false`, c'est-à-dire le parcours de CONNEXION — le plus prudent des deux, puisqu'il ne
 * rattache personne à rien.
 */
export async function takeSignupIntent(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(CLE)
    if (v) await AsyncStorage.removeItem(CLE)
    return v === '1'
  } catch {
    return false
  }
}

/** Remise à zéro — tests uniquement. */
export async function __resetSignupIntent(): Promise<void> {
  try { await AsyncStorage.removeItem(CLE) } catch { /* best-effort */ }
}
