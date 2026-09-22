// ⚠️ IMPORT RELATIF, PAS L'ALIAS `@/` : le banc tourne sous `tsx`, qui ne résout pas
// l'alias de Vite depuis un module de `lib`. Un voisin de dossier n'a de toute façon pas
// besoin d'un alias pour être trouvé.
import { forecastBrand } from './brandContrast'

/**
 * ╔═══════════════════════════════════════════════════════════════════════════════════════╗
 * ║  LES COULEURS SE DÉDUISENT DU LOGO — PROPOSÉES, JAMAIS POSÉES                        ║
 * ╚═══════════════════════════════════════════════════════════════════════════════════════╝
 *
 * 🔴 `NULL` VEUT DIRE « PAS ENCORE CHOISI », ET CE MODULE NE L'ÉCRIT JAMAIS. Décision
 * GYM-102, à ne jamais défaire : une couleur ne part en base que si le gérant a fait un
 * geste. Ce module RETOURNE une proposition ; c'est l'écran qui la montre, et le gérant qui
 * l'accepte. Sans clic, la salle reste sur la palette Viniz — ce qui est un choix valide,
 * pas un repli subi.
 *
 * ⚠️ ET LA PROPOSITION DOIT PASSER LE GARDE-FOU. `forecastBrand` (GYM-285) rejoue les deux
 * conditions du garde-fou mobile : un fond qui ne porte aucun texte, et une action
 * invisible sur son fond, retombent sur Viniz. Proposer un couple qui déclencherait
 * l'avertissement serait proposer au gérant de se faire ignorer par sa propre app — on
 * cherche donc un couple QUI PASSE, et on ne propose rien si on n'en trouve pas.
 *
 * ⚠️ TOUT SE PASSE DANS LE NAVIGATEUR. Aucun appel réseau, aucune bibliothèque : un canvas
 * 64×64 et un comptage. Le logo vient d'être téléversé dans un bucket public dont Supabase
 * sert les en-têtes CORS ; si malgré tout le canvas se retrouvait « teinté » (URL externe
 * posée à la main, en-tête manquant), `getImageData` lève — et on rend `null` plutôt que
 * d'imposer un échec au gérant.
 */

export interface PaletteProposee {
  /** La couleur d'action. */
  primary: string
  /** Le fond. */
  secondary: string
}

export interface Rgb { r: number; g: number; b: number }

function versHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

/** Luminance perçue, grossière — sert à trier clair/sombre, pas à juger un contraste. */
function clarte({ r, g, b }: Rgb): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Saturation HSV. Un logo noir et blanc en manque : c'est ce qui le fait reconnaître. */
function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

function assombrir(c: Rgb, facteur: number): Rgb {
  return { r: c.r * facteur, g: c.g * facteur, b: c.b * facteur }
}

/**
 * Lit les pixels du logo et rend les couleurs dominantes, de la plus fréquente à la moins.
 *
 * ⚠️ LES PIXELS TRANSPARENTS SONT IGNORÉS, et c'est indispensable : un logo PNG à fond
 * transparent est majoritairement composé de vide. Les compter donnerait « la couleur
 * dominante est le noir » (RGB 0,0,0 sous alpha 0) sur à peu près tous les logos.
 *
 * ⚠️ LES COULEURS SONT REGROUPÉES PAR PAQUETS DE 24. Sans ce regroupement, un dégradé ou
 * une compression JPEG éparpille une même teinte sur des centaines de valeurs voisines, et
 * aucune ne ressort.
 */
export function dominantes(data: Uint8ClampedArray): Rgb[] {
  const paquets = new Map<string, { somme: Rgb; n: number }>()
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 128) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const cle = `${Math.round(r / 24)}-${Math.round(g / 24)}-${Math.round(b / 24)}`
    const p = paquets.get(cle)
    if (p) { p.somme.r += r; p.somme.g += g; p.somme.b += b; p.n++ }
    else paquets.set(cle, { somme: { r, g, b }, n: 1 })
  }
  return [...paquets.values()]
    .sort((x, y) => y.n - x.n)
    .map(({ somme, n }) => ({ r: somme.r / n, g: somme.g / n, b: somme.b / n }))
}

/**
 * La DÉCISION, isolée du canvas — c'est elle que le banc éprouve
 * (`src/tests/logo-colors.test.ts`). Rendre le choix testable valait bien une fonction :
 * tout ce qui compte ici est « quel couple, et passe-t-il le garde-fou », pas « comment
 * lire une image ».
 */
export function choisirCouple(couleurs: Rgb[]): PaletteProposee | null {
  if (couleurs.length === 0) return null

  // ── L'ACTION : la couleur la plus fréquente qui soit réellement une COULEUR ──────────
  // ⚠️ Le seuil de saturation écarte les gris, les noirs et les blancs. Un logo monochrome
  // n'a donc aucun candidat — et c'est le bon résultat : il n'y a pas de couleur de marque
  // à en tirer, seulement un contraste. On n'en invente pas.
  const candidatsAction = couleurs.filter((c) => saturation(c) >= 0.25)
  if (candidatsAction.length === 0) return null

  // ── LE FOND : sombre, parce que c'est ce que l'app rend ──────────────────────────────
  // Les fonds clairs sont écartés d'emblée : `forecastBrand` les refuserait presque tous
  // (l'app pose du texte clair dessus), et les proposer ferait perdre un aller-retour au
  // gérant. On garde les sombres du logo, puis — en dernier recours — une version
  // assombrie de l'action elle-même, qui s'accorde toujours avec elle.
  const candidatsFond: Rgb[] = [
    ...couleurs.filter((c) => clarte(c) <= 0.35),
    ...candidatsAction.map((c) => assombrir(c, 0.18)),
  ]

  for (const action of candidatsAction) {
    for (const fond of candidatsFond) {
      const p = versHex(action)
      const s = versHex(fond)
      // 🔴 LE GARDE-FOU DÉCIDE, PAS LE GOÛT. On ne propose qu'un couple dont
      // `forecastBrand` n'annonce AUCUN repli.
      if (!forecastBrand(p, s).hasWarning) return { primary: p, secondary: s }
    }
  }

  return null
}
