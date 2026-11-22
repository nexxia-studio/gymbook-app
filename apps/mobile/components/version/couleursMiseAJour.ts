// GYM-389 (suite) — LES COULEURS DE L'ÉCRAN « MISE À JOUR REQUISE » (design B).
//
// L'écran est aux couleurs BRUTES de la salle : secondaire en fond, primaire sur la tuile,
// le nom et le bouton. Il ne passe donc pas par les jetons dérivés de `resolveTheme`, mais
// il emploie le même garde-fou (`lib/theme/contrast.ts`) : une paire illisible retombe sur
// la paire Viniz. Sortie du composant pour être éprouvée sans rendu, comme `wordmarkInk`.
import { parseHex, toHex, contrastRatio, SEUIL_TEXTE } from '../../lib/theme/contrast'

/** La paire de repli : lime Viniz sur fond sombre Viniz. */
export const PAIRE_VINIZ = { fond: '#17102E', accent: '#C8FF3D' } as const

/** Encres fixes de la maquette, posées sur le fond. */
export const ENCRE_TITRE = '#FFFFFF'
export const ENCRE_TEXTE = '#D6D2CC'
export const ENCRE_PIED = '#A8A39C'

export interface CouleursMiseAJour {
  /** Fond plein écran, et encre du bouton et de l'initiale. */
  fond: string
  /** Tuile du logo, nom de la salle, fond du bouton. */
  accent: string
  /** false quand le garde-fou a écarté les couleurs de la salle. */
  deLaSalle: boolean
}

/**
 * Chaque couleur inconnue ou illisible est d'abord remplacée par celle de Viniz, puis la
 * paire obtenue est mesurée. Trois contrôles, tous au seuil du TEXTE (4,5:1) :
 *   - accent / fond : c'est à la fois le libellé du bouton et le nom de la salle ;
 *   - titre blanc sur le fond ;
 *   - texte #D6D2CC sur le fond.
 * Les deux derniers écartent une secondaire CLAIRE : la maquette suppose un fond sombre, et
 * un titre blanc sur fond blanc passerait le premier contrôle sans être lisible.
 */
export function couleursMiseAJour(
  primaire: string | null | undefined,
  secondaire: string | null | undefined,
): CouleursMiseAJour {
  const p = parseHex(primaire)
  const s = parseHex(secondaire)
  if (!p && !s) return { ...PAIRE_VINIZ, deLaSalle: false }

  const accent = p ?? parseHex(PAIRE_VINIZ.accent)!
  const fond = s ?? parseHex(PAIRE_VINIZ.fond)!
  const lisible =
    contrastRatio(accent, fond) >= SEUIL_TEXTE &&
    contrastRatio(parseHex(ENCRE_TITRE)!, fond) >= SEUIL_TEXTE &&
    contrastRatio(parseHex(ENCRE_TEXTE)!, fond) >= SEUIL_TEXTE
  if (!lisible) return { ...PAIRE_VINIZ, deLaSalle: false }
  return { fond: toHex(fond), accent: toHex(accent), deLaSalle: true }
}

/** L'initiale affichée dans la tuile quand la salle n'a pas de logo. */
export function initialeSalle(nom: string | null | undefined): string {
  const premier = Array.from((nom ?? '').trim())[0]
  return premier ? premier.toLocaleUpperCase() : 'V'
}
