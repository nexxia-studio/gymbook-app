// GYM-302 (1) — L'ENCRE DU WORDMARK VINIZ, ISOLÉE POUR ÊTRE ÉPROUVÉE.
//
// ⚠️ POURQUOI UNE FONCTION À PART, ET PAS TROIS LIGNES DANS LE COMPOSANT. La règle dépend
// du fond que le garde-fou a retenu pour la salle, lequel dépend des deux couleurs que le
// gérant a choisies. Cet espace ne se relit pas — il se balaie. Une règle enfermée dans un
// composant React n'est atteignable que par un rendu ; sortie ici, elle s'exerce sur des
// centaines de salles en une seconde (`scripts/verify-wordmark-lime.mjs`).
//
// ⚠️ ET ELLE VIT DANS `components/viniz/`, PAS DANS `lib/theme/`. C'est une règle de
// MARQUE — « où le nom de Viniz a le droit d'être lime » — pas un jeton du thème, et la
// consigne « le chantier couleurs est clos » n'a pas été levée. À remonter si un second
// élément de marque devait suivre la même règle : sa place serait alors dans le thème.
import { VINIZ, type ThemeTokens } from '../../lib/theme/resolveTheme'
import { parseHex, contrastRatio, SEUIL_SURFACE } from '../../lib/theme/contrast'

/**
 * L'encre du wordmark « ViNiZ » sur le fond décrit par `tokens`.
 *
 * DEUX CONDITIONS, ET IL FAUT LES DEUX :
 *   (a) `limeAllowed` — le fond est SOMBRE. Règle de l'écran 09, déjà tranchée par
 *       `resolveTheme` : sur un fond clair le lime ne porte rien et ne se détache de rien.
 *       Une salle claire ne reçoit donc jamais de lime.
 *   (b) le lime atteint 3:1 SUR CE FOND précis — `SEUIL_SURFACE`, le seuil des éléments
 *       d'interface, celui que le garde-fou applique déjà à l'action.
 *
 * ⚠️ APRÈS GYM-290, (a) FAIT PRESQUE TOUT LE TRAVAIL. `limeAllowed` se décide désormais par
 * la LUMINANCE et non plus par la clarté HSL : les fonds « sombres selon HSL mais vifs à
 * l'œil » — une menthe, un ambre — sont maintenant classés CLAIRS, et (a) les écarte seule.
 * (b) reste : elle ne protège plus contre le cas d'hier, mais contre un changement futur de
 * `VINIZ.lime` ou du critère de mode. Voir `scripts/verify-wordmark-lime.mjs`, qui mesure
 * laquelle des deux travaille.
 *
 * ⚠️ (b) N'EST PAS REDONDANT AVEC (a), ET C'EST TOUT SON INTÉRÊT. « Sombre » ne veut pas
 * dire « contrasté avec le lime » : une salle au vert profond passe (a) et échoue (b) —
 * son fond est sombre, et le wordmark lime y serait quand même invisible. Sans cette
 * seconde condition, le seul écran qui porte le nom de Viniz serait celui où il disparaît.
 *
 * Quand l'une des deux manque, on retombe sur l'encre atténuée du fond : le rendu d'avant
 * GYM-302, celui qui a toujours été lisible partout.
 */
export function wordmarkInk(tokens: ThemeTokens): string {
  const fond = parseHex(tokens.background)
  const lime = parseHex(VINIZ.lime)!
  const lisible = tokens.limeAllowed && fond !== null && contrastRatio(lime, fond) >= SEUIL_SURFACE
  return lisible ? VINIZ.lime : tokens.onBackgroundMuted
}
