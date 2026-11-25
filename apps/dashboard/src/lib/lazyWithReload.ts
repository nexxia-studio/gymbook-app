// GYM-315 — recharge après déploiement : le BRANCHEMENT navigateur.
//
// La décision (quelle erreur, quelle fenêtre, quel marqueur) vit dans `chunkReload.ts`,
// éprouvée hors navigateur. Ici : une seule instance du « reloader », et ses deux points
// d'entrée — l'événement `vite:preloadError` et le rejet d'un `lazy()`. Vite émet l'un ET
// fait rejeter l'autre pour le même échec : l'instance partagée ne recharge qu'une fois.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import {
  RELOAD_WINDOW_MS,
  createReloader,
  isChunkLoadError,
  readMarker,
  type ReloadMarker,
} from '@/lib/chunkReload'

const reloader = createReloader({
  getStorage: () => window.sessionStorage,
  now: () => Date.now(),
  getPath: () => window.location.pathname,
  // Même URL : chemin, paramètres et ancre conservés.
  reload: () => window.location.reload(),
})

/** Reste en attente jusqu'au rechargement : le fallback du Suspense tient l'écran. */
function untilReload(): Promise<never> {
  return new Promise<never>(() => {})
}

/**
 * À poser AVANT le rendu. Recharge permise → `preventDefault()` (Vite ne relance alors
 * pas l'erreur) ; refusée → on n'empêche rien, l'erreur va à l'ErrorBoundary.
 */
export function installPreloadErrorReload(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloader.attempt('preload')) event.preventDefault()
  })
}

/**
 * `lazy()` qui recharge la page si le fichier de la page a disparu.
 * Toute autre erreur, ou une recharge refusée par l'anti-boucle, est relancée telle quelle.
 */
// Même contrainte que `React.lazy` (`ComponentType<any>`), seule forme qui conserve les
// props du composant importé : `ComponentType<never>` est refusé par tsc (TS2344).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithReload<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(async () => {
    try {
      const loaded: { default: T } | undefined = await load()
      // Quand `vite:preloadError` a été annulé, Vite avale l'erreur et l'import se résout
      // à `undefined` : sans cette garde, React lèverait sur `undefined.default`.
      if (loaded === undefined && reloader.hasTriggered()) return untilReload()
      return loaded
    } catch (error) {
      if (isChunkLoadError(error) && reloader.attempt('lazy')) return untilReload()
      throw error
    }
  })
}

/**
 * Pour le `beforeSend` de Sentry : vrai UNIQUEMENT pour un échec de chargement de fichier
 * alors que cette page vient de déclencher sa recharge. Après la recharge le drapeau est
 * retombé : le second échec, celui qui affiche l'ErrorBoundary, remonte toujours.
 */
export function isReloadedChunkError(candidates: readonly unknown[]): boolean {
  return reloader.hasTriggered() && candidates.some(isChunkLoadError)
}

/** Le marqueur laissé par une recharge de moins de 30 s, sinon null. Ne l'efface pas : il sert d'anti-boucle. */
export function recentReloadMarker(): ReloadMarker | null {
  try {
    const marker = readMarker(window.sessionStorage)
    if (marker === null) return null
    const age = Date.now() - marker.at
    return age >= 0 && age < RELOAD_WINDOW_MS ? marker : null
  } catch {
    return null
  }
}
