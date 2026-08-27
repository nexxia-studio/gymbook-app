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
 * 🔴 GYM-290 (0b) — LES DEUX SEUILS, SOUS LEURS NOMS DE MÉTIER.
 *
 * `AA_TEXT` et `AA_NON_TEXT` disent la NORME ; `SEUIL_TEXTE` et `SEUIL_SURFACE` disent
 * l'USAGE. Ce sont les mêmes nombres, et c'est volontaire : deux valeurs distinctes
 * finiraient par diverger. Ce que ces alias ajoutent, c'est qu'on ne peut plus écrire
 * « AA_NON_TEXT » devant une encre de texte sans que la phrase sonne faux à la relecture.
 *
 * La règle du lot tient en une ligne : TOUTE encre posée comme texte se valide à
 * `SEUIL_TEXTE`. Une surface — piste, pastille, fond d'action — se contente de
 * `SEUIL_SURFACE`.
 */
export const SEUIL_TEXTE = AA_TEXT
export const SEUIL_SURFACE = AA_NON_TEXT

/**
 * Mélange `encre` vers `fond` d'un facteur `a` (0 = le fond, 1 = l'encre pure).
 * Sert à DÉRIVER une encre atténuée sans quitter la famille du fond.
 */
export function melange(encre: Rgb, fond: Rgb, a: number): Rgb {
  return {
    r: Math.round(encre.r * a + fond.r * (1 - a)),
    g: Math.round(encre.g * a + fond.g * (1 - a)),
    b: Math.round(encre.b * a + fond.b * (1 - a)),
  }
}

/**
 * 🔴 UNE ENCRE ATTÉNUÉE QUI RESTE LISIBLE — la brique qui manquait.
 *
 * ⚠️ LE DÉFAUT N'ÉTAIT PAS « LA LAVANDE EST TROP PÂLE », C'ÉTAIT « L'ATTÉNUATION ÉTAIT UNE
 * COULEUR FIXE ». Deux teintes constantes (lavande sur sombre, mauve sur clair) ne peuvent
 * pas être à la fois atténuées ET lisibles sur un fond quelconque : sur plus d'une salle
 * sur deux, elles n'étaient plus que pâles.
 *
 * On part donc de l'encre PRINCIPALE — celle dont on sait déjà qu'elle passe le seuil — et
 * on la fond vers le fond aussi loin que le seuil l'autorise. La hiérarchie visuelle est
 * préservée (le secondaire reste plus discret que le principal) et la lisibilité est
 * garantie par construction, pas par chance.
 *
 * Le pas descendant s'arrête au premier facteur qui tient : on obtient l'encre la PLUS
 * atténuée encore conforme, pas une valeur arbitraire au milieu.
 */
/**
 * 🔴 GYM-290 (décision B) — DÉCALER UNE COULEUR D'UN PAS DE CONTRASTE DONNÉ.
 *
 * Rend la couleur obtenue en fondant `base` vers `cible` jusqu'à atteindre `ratio` — le
 * plus petit décalage qui l'atteint, pas un mélange arbitraire. Sert à fabriquer la PAGE à
 * partir de la BANDE : deux surfaces qui doivent se distinguer sans que l'une devienne un
 * accent.
 *
 * ⚠️ REND `null` PLUTÔT QUE DE S'APPROCHER. Si même `cible` pure n'atteint pas le ratio —
 * un fond déjà quasi noir qu'on essaie d'assombrir — l'appelant doit essayer l'autre sens,
 * pas se contenter d'un pas trop petit qui ne se verrait pas.
 */
export function decalerDe(base: Rgb, cible: Rgb, ratio: number): Rgb | null {
  if (contrastRatio(base, cible) < ratio) return null
  let bas = 0
  let haut = 1
  for (let i = 0; i < 24; i++) {
    const mid = (bas + haut) / 2
    if (contrastRatio(melange(cible, base, mid), base) >= ratio) haut = mid
    else bas = mid
  }
  return melange(cible, base, haut)
}

export function mutedInkOn(fond: Rgb, encre: Rgb, seuil: number, second?: Rgb): Rgb {
  // ⚠️ `second` N'EST PAS UN RAFFINEMENT, C'EST UNE NÉCESSITÉ DEPUIS LA DÉCISION B.
  // L'encre atténuée est posée indifféremment sur la BANDE et sur la PAGE, deux fonds
  // désormais distincts. La dériver sur un seul revient à la garantir sur un seul :
  // mesuré, 980 salles sur 19 600 avaient un texte secondaire conforme sur la bande et
  // sous le seuil sur la page. On exige donc le seuil sur les DEUX, et l'atténuation
  // s'arrête au premier facteur qui tient partout.
  for (let a = 0.60; a <= 1.0001; a += 0.05) {
    const essai = melange(encre, fond, a)
    const tient = contrastRatio(essai, fond) >= seuil
      && (!second || contrastRatio(essai, second) >= seuil)
    if (tient) return essai
  }
  // Aucun mélange ne tient : l'encre pleine est le mieux qu'on puisse faire, et elle passe
  // le seuil (c'est la condition qui a fait accepter ce fond).
  return encre
}

/**
 * Clarté perçue, en pourcentage, au sens de la composante L de HSL.
 *
 * ⚠️ VOLONTAIREMENT HSL ET NON LA LUMINANCE. La maquette énonce sa règle ainsi : « les
 * deux couleurs de la salle sont claires (L > 80 %) ». C'est la valeur qu'un gérant lit
 * dans n'importe quel sélecteur de couleur ; s'en écarter pour une grandeur plus juste
 * mais invisible rendrait la règle inexplicable à celui qui la subit.
 */
/**
 * 🔴 GYM-290 (0a) — LE MODE SE DÉCIDE PAR LE CONTRASTE RÉEL, PLUS JAMAIS PAR LA TEINTE.
 *
 * ═════════════════════════════════════════════════════════════════════════════════════
 * LA CAUSE QUE CETTE FONCTION CORRIGE
 * ═════════════════════════════════════════════════════════════════════════════════════
 * Le mode se décidait sur `hslLightness > 80`. Or la clarté HSL est une mesure de TEINTE :
 * elle ne prend que le canal max et le min, et ignore complètement que l'œil voit le vert
 * six fois plus que le bleu. Un lime #C8FF3D y vaut 62 % — donc « sombre » — alors qu'il
 * est presque aussi lumineux qu'un blanc. Il recevait donc les encres du mode SOMBRE, et
 * la lavande #C8C2E6 posée dessus tombait à 1,15:1.
 *
 * Mesuré avant correction, sur 19 600 salles : `onBackgroundMuted` sous 4,5:1 dans
 * **10 920** cas, `onSurfaceSecondary` dans **11 480**. Ce n'était pas une poignée de
 * couleurs exotiques — c'était plus d'une salle sur deux.
 *
 * ⚠️ LA QUESTION N'EST PAS « CE FOND EST-IL CLAIR ? » MAIS « QUELLE ENCRE S'Y LIT LE
 * MIEUX ? ». On compare donc le contraste du fond avec le blanc et avec le noir : celui
 * des deux qui gagne dit le mode. C'est la même grandeur que celle qui décidera ensuite de
 * chaque encre — une seule mesure gouverne toute la chaîne, au lieu de deux qui se
 * contredisent.
 */
export function prefersDarkInk(background: Rgb): boolean {
  const surBlanc = contrastRatio(background, { r: 255, g: 255, b: 255 })
  const surNoir = contrastRatio(background, { r: 0, g: 0, b: 0 })
  return surNoir > surBlanc
}

/**
 * ⚠️ CONSERVÉE POUR MÉMOIRE, ET PLUS APPELÉE PAR LE GARDE-FOU (GYM-290).
 *
 * Elle décrit une TEINTE, pas une luminosité perçue. Elle reste exportée parce qu'un jour
 * quelqu'un voudra une mesure de teinte — mais aucune décision de lisibilité ne doit s'y
 * appuyer, et `resolveTheme` ne l'utilise plus. Voir `prefersDarkInk`.
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
