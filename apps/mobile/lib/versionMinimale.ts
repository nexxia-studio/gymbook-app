// GYM-389 — MISE À JOUR OBLIGATOIRE. Fonctions pures.
//
// 🔴 LA RÈGLE QUI COMPTE : ON NE BLOQUE JAMAIS SUR UN DOUTE. L'écran « Mise à jour
// requise » n'a ni « Plus tard » ni sortie : le montrer à tort enferme un membre hors de
// son app. Il ne sort donc que si la politique a été LUE (pas d'erreur, pas de délai
// dépassé), qu'une ligne EXISTE pour ce bundle et cette plateforme, et que les deux
// versions sont lisibles et que celle de l'app est strictement inférieure. Tout le reste
// — hors ligne, table absente, ligne absente, version malformée — vaut « pas de blocage ».
// Même famille que GYM-385 / GYM-387 : une lecture en échec n'est pas une réponse.
//
// ⚠️ CE FICHIER NE DOIT RIEN IMPORTER de l'app : il est chargé seul par ses tests.

export type EtatLecturePolitique = 'non_charge' | 'charge' | 'erreur'

export interface PolitiqueVersion {
  /** `app_version_policy.min_version`, au format x.y.z. */
  minVersion: string
  /** `app_version_policy.store_url`, ou `null` : l'URL est alors construite du bundle. */
  storeUrl: string | null
}

/** Délai au-delà duquel la lecture est abandonnée en silence. */
export const DELAI_LECTURE_MS = 4_000
/** Intervalle minimal entre deux lectures déclenchées par un retour au premier plan. */
export const INTERVALLE_RELECTURE_MS = 10 * 60 * 1000

const FORMAT = /^(\d+)\.(\d+)\.(\d+)$/

function lire(version: string | null | undefined): [number, number, number] | null {
  const m = FORMAT.exec((version ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * Compare deux versions x.y.z NUMÉRIQUEMENT (1.10.0 > 1.9.0) : -1, 0 ou 1.
 * `null` si l'une des deux n'est pas au format — une version illisible ne se compare pas.
 */
export function comparerVersions(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null {
  const va = lire(a)
  const vb = lire(b)
  if (!va || !vb) return null
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return va[i] < vb[i] ? -1 : 1
  }
  return 0
}

export function doitForcerMiseAJour(
  versionApp: string | null | undefined,
  politique: Pick<PolitiqueVersion, 'minVersion'> | null | undefined,
  etatLecture: EtatLecturePolitique,
): boolean {
  if (etatLecture !== 'charge' || !politique) return false
  return comparerVersions(versionApp, politique.minVersion) === -1
}

/**
 * Faut-il relire au retour au premier plan ? Au plus une fois par intervalle.
 *
 * ⚠️ SAUF QUAND L'ÉCRAN EST AFFICHÉ : un membre bloqué qui revient du store — ou dont la
 * salle vient de baisser `min_version` — doit être libéré tout de suite, pas dix minutes
 * plus tard. Le plafond protège l'usage normal, pas l'écran de blocage.
 */
export function doitRelirePolitique(
  derniereLecture: number | null,
  maintenant: number,
  bloque: boolean,
): boolean {
  if (bloque || derniereLecture === null) return true
  return maintenant - derniereLecture >= INTERVALLE_RELECTURE_MS
}

/**
 * Fiches App Store connues, par bundle. iOS n'a AUCUNE URL de store dérivable d'un
 * identifiant de bundle : il faut l'identifiant numérique de la fiche.
 * `app.viniz.staging` n'a pas de fiche (distribution TestFlight) : voir `urlsStore`.
 */
const FICHES_APP_STORE: Record<string, string> = {
  'be.dopamineclub.app': '6781670485',
  'app.viniz': '6809463633',
}

/** `store_url` vient de la base : on n'ouvre qu'un lien de store ou un lien https. */
function estUrlStoreAcceptable(url: string): boolean {
  return /^(https:\/\/|market:\/\/|itms-apps:\/\/|itms-beta:\/\/)\S+$/i.test(url)
}

/**
 * Les URL à essayer, DANS L'ORDRE, pour le bouton « Mettre à jour ».
 *
 * · `store_url` de la politique d'abord, s'il est présent et acceptable ;
 * · iOS : la fiche App Store du bundle ; sans fiche connue (staging), TestFlight ;
 * · Android : `market://details?id=…`, puis le repli https (appareil sans Play Store).
 */
export function urlsStore(
  plateforme: string,
  bundle: string | null | undefined,
  storeUrl?: string | null,
): string[] {
  const urls: string[] = []
  const fournie = (storeUrl ?? '').trim()
  if (fournie && estUrlStoreAcceptable(fournie)) urls.push(fournie)
  const id = (bundle ?? '').trim()
  if (plateforme === 'ios') {
    const fiche = FICHES_APP_STORE[id]
    if (fiche) urls.push(`https://apps.apple.com/app/id${fiche}`)
    else urls.push('itms-beta://', 'https://testflight.apple.com/')
  } else if (plateforme === 'android' && id) {
    urls.push(`market://details?id=${id}`, `https://play.google.com/store/apps/details?id=${id}`)
  }
  return [...new Set(urls)]
}
