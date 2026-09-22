import { choisirCouple, dominantes, type PaletteProposee } from './logoColors'

/**
 * La moitié NAVIGATEUR de l'extraction de couleurs — lecture du logo dans un canvas.
 *
 * ⚠️ SÉPARÉE DE LA DÉCISION, ET C'EST STRUCTUREL. `src/tests` est compilé avec les types
 * NODE (GYM-350, trois projets) : un banc qui importerait `Image` ou `document` ferait
 * échouer `tsc --build`. La décision — `choisirCouple` — vit donc dans `logoColors.ts`,
 * pure et testable ; ce fichier-ci ne fait que lui apporter des pixels.
 *
 * ⚠️ AUCUN APPEL RÉSEAU, AUCUNE BIBLIOTHÈQUE : un canvas 64×64 et un comptage.
 */

/** Côté du canvas d'échantillonnage. 64 suffit : on cherche des dominantes, pas du détail. */
const TAILLE = 64

/** Charge l'image et rend ses pixels, ou `null` si quoi que ce soit s'y oppose. */
async function pixelsDe(url: string): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // Sans ceci, le canvas est « teinté » et `getImageData` lève, même sur une image
    // publique : le navigateur exige que la requête ait été faite en mode CORS.
    img.crossOrigin = 'anonymous'
    img.onerror = () => resolve(null)
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = TAILLE
        canvas.height = TAILLE
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) { resolve(null); return }
        ctx.drawImage(img, 0, 0, TAILLE, TAILLE)
        resolve(ctx.getImageData(0, 0, TAILLE, TAILLE).data)
      } catch {
        // Canvas teinté, ou image inexploitable. On ne propose rien — on n'échoue pas.
        resolve(null)
      }
    }
    img.src = url
  })
}

/**
 * Propose un couple (action, fond) tiré du logo, qui PASSE le garde-fou.
 *
 * `null` = rien de proposable. Trois cas, tous légitimes :
 *   · l'image n'a pas pu être lue ;
 *   · le logo est monochrome — aucune couleur d'action ne s'y trouve ;
 *   · aucun couple candidat ne passe `forecastBrand`.
 * Dans les trois cas, l'écran ne montre rien et la palette Viniz reste suggérée. Proposer
 * « à peu près » serait pire que ne rien proposer : le gérant accepterait, et son app
 * l'ignorerait.
 */
export async function proposerPaletteDepuisLogo(url: string): Promise<PaletteProposee | null> {
  const data = await pixelsDe(url)
  if (!data) return null
  return choisirCouple(dominantes(data).slice(0, 12))
}

