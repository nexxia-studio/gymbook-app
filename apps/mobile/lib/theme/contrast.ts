// GYM-102 (3/5) — LE CALCUL DE CONTRASTE. Aucune dépendance, aucun rendu, rien d'React :
// des couleurs entrent, des nombres sortent. C'est ce qui rend le garde-fou testable.
//
// ⚠️ POURQUOI CE MODULE EXISTE PLUTÔT QU'UN « À VUE D'ŒIL ». Une salle ne fournit que deux
// couleurs et ne les voit jamais appliquées avant ses membres. Deux tons pastel, deux fois
// la même valeur, un blanc cassé sur blanc : rien ne l'en empêche au moment où elle
// remplit le formulaire. Sans mesure, l'app devient illisible chez ce client-là, et
// personne chez nous ne le saura.

/** Couleur décomposée. Les composantes sont dans [0, 255]. */
export interface Rgb { r: number; g: number; b: number }

/**
 * Lit `#RGB`, `#RRGGBB` ou `#RRGGBBAA`. Rend `null` sur tout le reste.
 *
 * ⚠️ RENDRE `null` PLUTÔT QUE DE DEVINER EST LE POINT IMPORTANT : une couleur qu'on ne
 * comprend pas doit faire retomber la salle sur la palette Viniz, pas produire un noir
 * silencieux qui passerait tous les tests de contraste tout en étant faux.
 */
export function parseHex(input: string | null | undefined): Rgb | null {
  if (typeof input !== 'string') return null
  const s = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(s)) return null
  if (s.length === 3) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16),
    }
  }
  // Le canal alpha est LU puis IGNORÉ : une couleur de marque semi-transparente n'a pas de
  // sens sur une surface dont on ignore le fond, et la garder fausserait tout le calcul.
  if (s.length === 6 || s.length === 8) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    }
  }
  return null
}

/** Forme canonique `#RRGGBB`, pour que deux écritures de la même couleur se comparent. */
export function toHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase()
}

/**
 * Luminance relative, définition WCAG 2.1 (§ relative luminance).
 *
 * ⚠️ CE N'EST PAS LA MOYENNE DES CANAUX. Chaque canal est d'abord linéarisé (la correction
 * gamma de sRGB), puis pondéré selon la sensibilité de l'œil : le vert compte pour 72 %,
 * le bleu pour 7 %. C'est ce qui fait qu'un bleu saturé est SOMBRE et un jaune saturé
 * CLAIR, alors que les deux ont la même « intensité » en apparence.
 */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const chan = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

/** Rapport de contraste WCAG, de 1 (identiques) à 21 (noir sur blanc). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Seuil WCAG AA pour du texte de taille courante. */
export const AA_TEXT = 4.5
/**
 * Seuil WCAG 2.1 § 1.4.11 pour les ÉLÉMENTS D'INTERFACE (bouton, bordure, indicateur).
 * Plus bas que le texte parce qu'une forme se distingue plus facilement qu'une lettre —
 * mais il existe, et c'est lui qui écarte une couleur d'action invisible sur son fond.
 */
export const AA_NON_TEXT = 3

/**
 * Clarté perçue, en pourcentage, au sens de la composante L de HSL.
 *
 * ⚠️ VOLONTAIREMENT HSL ET NON LA LUMINANCE. La maquette énonce sa règle ainsi : « les
 * deux couleurs de la salle sont claires (L > 80 %) ». C'est la valeur qu'un gérant lit
 * dans n'importe quel sélecteur de couleur ; s'en écarter pour une grandeur plus juste
 * mais invisible rendrait la règle inexplicable à celui qui la subit.
 */
export function hslLightness({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  return ((max + min) / 2) * 100
}

/**
 * Des deux encres proposées, celle qui se lit le mieux sur `background`.
 * Rend aussi le ratio obtenu — l'appelant a besoin de savoir s'il atteint le seuil, pas
 * seulement laquelle est la moins mauvaise.
 */
export function bestInkOn(
  background: Rgb,
  inks: readonly string[],
): { ink: string; ratio: number } {
  let best = { ink: inks[0], ratio: 0 }
  for (const ink of inks) {
    const rgb = parseHex(ink)
    if (!rgb) continue
    const ratio = contrastRatio(background, rgb)
    if (ratio > best.ratio) best = { ink, ratio }
  }
  return best
}
