// GYM-285 — 🔴 PRÉDIRE CE QUE L'APP FERA DES DEUX COULEURS, PLUTÔT QUE DE JUGER LE GOÛT.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// CE MODULE NE VALIDE RIEN. IL ANNONCE.
// ═════════════════════════════════════════════════════════════════════════════════════
// Une salle ne fournit que deux couleurs et ne les voit jamais appliquées avant ses
// membres. L'app mobile a donc un garde-fou (apps/mobile/lib/theme/resolveTheme.ts) qui
// ÉCARTE une couleur inutilisable et retombe sur la palette Viniz. Le rendu est protégé —
// mais le gérant, lui, n'apprenait rien : il enregistrait deux pastels, et l'app les
// ignorait sans que personne ne le lui dise. Il croyait avoir choisi.
//
// Ce module rejoue les DEUX conditions du garde-fou pour l'annoncer AVANT l'enregistrement.
// On prévient, on n'interdit pas : le gérant reste libre d'enregistrer ce qu'il veut, et
// le garde-fou client protège le rendu quoi qu'il arrive.
//
// ⚠️ C'EST UNE COPIE, ET LES COPIES DIVERGENT. Les seuils et la palette de repli sont
// recopiés de resolveTheme.ts ; les deux dépôts ne partagent pas de code (apps distinctes,
// bundlers distincts). Le jour où le garde-fou mobile change de règle, cet avertissement
// mentira — en annonçant un repli qui n'a pas lieu, ou en n'annonçant pas celui qui a lieu.
// Un jeton partagé (paquet interne) serait la vraie réponse ; il est remonté au cockpit.

/** Palette Viniz de repli — recopiée de apps/mobile/lib/theme/resolveTheme.ts (VINIZ). */
const VINIZ_LIGHT = '#F3F0FF'
const VINIZ_INK = '#2D1B69'
const VINIZ_DARK = '#171310'

/** Seuil WCAG AA pour du texte courant. */
const AA_TEXT = 4.5
/** Seuil WCAG 2.1 § 1.4.11 pour les ÉLÉMENTS D'INTERFACE (bouton, bordure, indicateur). */
const AA_NON_TEXT = 3

interface Rgb { r: number; g: number; b: number }

/** `null` sur tout ce qui n'est pas un hex lisible — on ne devine jamais une couleur. */
export function parseHex(input: string | null | undefined): Rgb | null {
  if (typeof input !== 'string') return null
  const s = input.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]+$/.test(s)) return null
  if (s.length === 3) {
    return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) }
  }
  if (s.length === 6 || s.length === 8) {
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) }
  }
  return null
}

/**
 * Luminance relative, définition WCAG 2.1.
 *
 * ⚠️ CE N'EST PAS LA MOYENNE DES CANAUX : chaque canal est linéarisé puis pondéré selon la
 * sensibilité de l'œil (le vert compte pour 72 %, le bleu pour 7 %). C'est ce qui fait
 * qu'un bleu saturé est SOMBRE et un jaune saturé CLAIR.
 */
function luminance({ r, g, b }: Rgb): number {
  const chan = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Le meilleur ratio obtenu par l'une des encres proposées. */
function bestInkRatio(background: Rgb, inks: readonly string[]): number {
  let best = 0
  for (const ink of inks) {
    const rgb = parseHex(ink)
    if (!rgb) continue
    best = Math.max(best, contrastRatio(background, rgb))
  }
  return best
}

/** Ce que l'app fera des deux couleurs. Chaque champ dit un REPLI, pas une faute. */
export interface BrandForecast {
  /** La secondaire ne peut porter aucun texte : le fond retombera sur la palette Viniz. */
  backgroundFallsBack: boolean
  /** La primaire ne portera aucun libellé lisible : l'action retombera sur Viniz. */
  accentCarriesNoText: boolean
  /** La primaire ne se détache pas du fond : l'action retombera sur Viniz. */
  accentInvisibleOnBackground: boolean
  /** Vrai dès qu'au moins un repli est annoncé — pour n'afficher qu'un seul bloc. */
  hasWarning: boolean
}

/**
 * Rejoue le garde-fou mobile sur les deux couleurs saisies.
 *
 * ⚠️ UNE COULEUR ABSENTE N'EST PAS UN DÉFAUT. `null` veut dire « pas choisi » : la salle
 * prendra la palette Viniz, ce qui est un choix valide et non un repli subi. On n'avertit
 * donc que sur ce qui EST saisi — avertir sur un champ vide reviendrait à réclamer une
 * valeur, exactement ce que `null` existe pour éviter.
 */
export function forecastBrand(primary: string | null, secondary: string | null): BrandForecast {
  const p = parseHex(primary)
  const s = parseHex(secondary)

  // ── LE FOND ────────────────────────────────────────────────────────────────────────
  // Un fond n'est retenu que s'il peut porter du texte. Un gris moyen ne passe 4,5:1 NI
  // avec l'encre claire NI avec l'encre sombre : le garder condamnerait tout le texte.
  const backgroundFallsBack = s !== null && bestInkRatio(s, [VINIZ_LIGHT, VINIZ_INK]) < AA_TEXT

  // Le fond RÉELLEMENT utilisé par l'app — c'est contre lui que la primaire est jugée.
  const effectiveBackground = (backgroundFallsBack || !s) ? parseHex(VINIZ_DARK)! : s

  // ── L'ACTION ───────────────────────────────────────────────────────────────────────
  // Deux conditions, et il faut LES DEUX : porter un libellé (4,5:1 avec l'une des trois
  // encres) ET se voir sur le fond (3:1, WCAG § 1.4.11). La seconde est ce qui écarte
  // « deux tons identiques » et « deux pastels voisins » — un bouton parfaitement lisible
  // mais invisible sur sa page reste un bouton que personne ne trouve.
  const accentCarriesNoText = p !== null && bestInkRatio(p, [VINIZ_LIGHT, VINIZ_INK, VINIZ_DARK]) < AA_TEXT
  const accentInvisibleOnBackground = p !== null && contrastRatio(p, effectiveBackground) < AA_NON_TEXT

  return {
    backgroundFallsBack,
    accentCarriesNoText,
    accentInvisibleOnBackground,
    hasWarning: backgroundFallsBack || accentCarriesNoText || accentInvisibleOnBackground,
  }
}

/** Ce que l'app rendra vraiment — replis compris. */
export interface BrandPreview {
  background: string
  onBackground: string
  accent: string
  onAccent: string
}

function bestInk(background: Rgb, inks: readonly string[]): string {
  let best = { ink: inks[0], ratio: 0 }
  for (const ink of inks) {
    const rgb = parseHex(ink)
    if (!rgb) continue
    const ratio = contrastRatio(background, rgb)
    if (ratio > best.ratio) best = { ink, ratio }
  }
  return best.ink
}

/**
 * 🔴 L'APERÇU MONTRE LE RÉSULTAT, PAS LE CHOIX.
 *
 * Un aperçu qui peindrait bêtement les deux couleurs saisies mentirait exactement là où il
 * sert : sur les cas où l'app va les ÉCARTER. Le gérant verrait ses deux pastels côte à
 * côte, les enregistrerait satisfait, et découvrirait autre chose sur le téléphone de ses
 * membres — sans jamais faire le lien.
 *
 * Cette fonction rejoue donc les replis du garde-fou : ce qu'on affiche est ce que les
 * membres verront. L'avertissement dit POURQUOI ; l'aperçu montre QUOI.
 *
 * ⚠️ Mêmes réserves que `forecastBrand` : c'est une copie de la règle mobile, et les copies
 * divergent. Voir l'en-tête du module.
 */
/**
 * ⚠️ NORMALISE — `#abc` et `#AABBCC` DÉSIGNENT LA MÊME COULEUR, et le mobile rend la
 * seconde forme. Renvoyer la saisie telle quelle ferait diverger l'aperçu du rendu réel
 * sur la seule chose qu'il promet : montrer le résultat. Même fonction que côté mobile.
 */
function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

export function previewBrand(primary: string | null, secondary: string | null): BrandPreview {
  const p = parseHex(primary)
  const s = parseHex(secondary)
  const f = forecastBrand(primary, secondary)

  const bgHex = (!s || f.backgroundFallsBack) ? VINIZ_DARK : (secondary as string)
  const bg = parseHex(bgHex)!
  const onBackground = bestInk(bg, [VINIZ_LIGHT, VINIZ_INK])

  // 🔴 LE LIME NE VA QUE SUR FOND SOMBRE — règle de l'écran 09 de la maquette, reprise
  // telle quelle : sur un fond clair il ne porte aucun texte et ne se distingue d'aucune
  // surface. L'action retombe alors sur le Violet Ink.
  const clair = luminanceHsl(bg) > 80
  const accentRetenu = p !== null && !f.accentCarriesNoText && !f.accentInvisibleOnBackground
  const accent = accentRetenu ? (primary as string) : (clair ? VINIZ_INK : VINIZ_PRIMARY_VINIZ)
  const onAccent = bestInk(parseHex(accent)!, [VINIZ_LIGHT, VINIZ_INK, VINIZ_DARK])

  return { background: toHex(bg), onBackground, accent: toHex(parseHex(accent)!), onAccent }
}

/** Le lime Viniz — repli de l'action sur fond sombre. Recopié de resolveTheme (VINIZ.lime). */
const VINIZ_PRIMARY_VINIZ = '#C8FF3D'

/**
 * Clarté perçue en pourcentage, composante L de HSL.
 *
 * ⚠️ VOLONTAIREMENT HSL ET NON LA LUMINANCE — c'est la valeur qu'un gérant lit dans
 * n'importe quel sélecteur de couleur, et la règle « L > 80 % » de la maquette s'y réfère.
 */
function luminanceHsl({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  return ((max + min) / 2) * 100
}
