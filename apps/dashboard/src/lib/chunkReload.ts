// GYM-315 — recharge après déploiement : la DÉCISION.
//
// Un onglet ouvert avant un déploiement demande un fichier de page dont le nom a changé :
// Vercel renvoie index.html, le navigateur refuse de l'exécuter. Recharger répare tout.
//
// Ce module est PUR : ni window, ni sessionStorage, ni Sentry. Tout est injecté, ce qui
// le rend éprouvable par `src/tests/chunk-reload.test.ts` (tsconfig.tests.json n'a pas la
// lib DOM). Le branchement navigateur est dans `lazyWithReload.ts`.

export const RELOAD_WINDOW_MS = 30_000
const MARKER_KEY = 'viniz.chunkReload'

// Chrome, Safari (deux formes), Firefox. Volontairement PAS « Failed to fetch » seul :
// c'est l'erreur réseau de n'importe quel fetch, elle doit suivre son chemin actuel.
const CHUNK_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'is not a valid javascript mime type',
  'importing a module script failed',
  'error loading dynamically imported module',
]

function readStringField(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null) return ''
  const found = (value as Record<string, unknown>)[field]
  return typeof found === 'string' ? found : ''
}

export function isChunkLoadError(error: unknown): boolean {
  if (readStringField(error, 'name') === 'ChunkLoadError') return true
  const message = (typeof error === 'string' ? error : readStringField(error, 'message')).toLowerCase()
  return message !== '' && CHUNK_ERROR_PATTERNS.some((pattern) => message.includes(pattern))
}

/**
 * `lastReloadAt` : null = jamais rechargé ; NaN = marqueur illisible.
 * Illisible ou dans le futur → refus : mieux vaut l'écran d'erreur qu'une boucle.
 */
export function shouldReload(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null) return true
  if (!Number.isFinite(lastReloadAt) || lastReloadAt > now) return false
  return now - lastReloadAt >= RELOAD_WINDOW_MS
}

export type ReloadReason = 'preload' | 'lazy'

export interface ReloadMarker {
  at: number
  /** Chemin seul (ni paramètres ni ancre) : il finit dans un breadcrumb Sentry. */
  path: string
  reason: string
}

export interface MarkerStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const UNREADABLE: ReloadMarker = { at: Number.NaN, path: '', reason: '' }

/** null = aucun marqueur. Lecture qui lève ou contenu incompréhensible → `at` vaut NaN. */
export function readMarker(storage: MarkerStorage): ReloadMarker | null {
  try {
    const raw = storage.getItem(MARKER_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return UNREADABLE
    const at = (parsed as Record<string, unknown>).at
    if (typeof at !== 'number') return UNREADABLE
    return { at, path: readStringField(parsed, 'path'), reason: readStringField(parsed, 'reason') }
  } catch {
    return UNREADABLE
  }
}

export function writeMarker(storage: MarkerStorage, marker: ReloadMarker): boolean {
  try {
    storage.setItem(MARKER_KEY, JSON.stringify(marker))
    return true
  } catch {
    return false
  }
}

export interface ReloaderDeps {
  /** Appelé sous try/catch : le simple accès à `window.sessionStorage` peut lever. */
  getStorage: () => MarkerStorage
  now: () => number
  getPath: () => string
  reload: () => void
}

export interface Reloader {
  /** true = une recharge est en route (déclenchée ici ou juste avant) ; false = l'erreur suit son chemin. */
  attempt: (reason: ReloadReason) => boolean
  /** Une recharge a été déclenchée par CETTE page (drapeau en mémoire, perdu au rechargement). */
  hasTriggered: () => boolean
}

/**
 * La seule fonction « tenter la recharge », partagée par `vite:preloadError` et `lazy()`.
 * Les deux se déclenchent pour le même échec : le drapeau garantit une seule recharge.
 */
export function createReloader(deps: ReloaderDeps): Reloader {
  let triggered = false
  return {
    hasTriggered: () => triggered,
    attempt: (reason) => {
      if (triggered) return true
      let storage: MarkerStorage
      try {
        storage = deps.getStorage()
      } catch {
        return false
      }
      const marker = readMarker(storage)
      const now = deps.now()
      if (!shouldReload(marker === null ? null : marker.at, now)) return false
      // Marqueur non écrit = anti-boucle aveugle au prochain démarrage → on ne recharge pas.
      if (!writeMarker(storage, { at: now, path: deps.getPath(), reason })) return false
      triggered = true
      deps.reload()
      return true
    },
  }
}
