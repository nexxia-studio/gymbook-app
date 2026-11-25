import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './lib/i18n'
import './index.css'
import App from './App'
import { installPreloadErrorReload, isReloadedChunkError, recentReloadMarker } from './lib/lazyWithReload'

// GYM-153 — Monitoring erreurs dashboard (init minimale, symétrique du mobile).
// Tolérant à l'absence de DSN (no-op sans VITE_SENTRY_DSN — le build passe sans).
// tracesSampleRate 0 → pas de performance/tracing ; pas d'upload de sourcemaps.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 0,
    // GYM-315 — un fichier de page disparu après un déploiement n'est plus une erreur
    // quand la page est en train de se recharger pour le réparer. Le filtre ne joue que
    // dans ce cas : après la recharge, le même échec remonte (drapeau en mémoire retombé).
    beforeSend: (event, hint) => {
      const values = event.exception?.values?.map((value) => value.value) ?? []
      return isReloadedChunkError([hint.originalException, ...values]) ? null : event
    },
  })
}

// GYM-315 — la recharge automatique laisse sa trace ICI, au démarrage qui la suit : un
// breadcrumb posé avant `reload()` serait perdu avec la page. Sans DSN, sans effet.
const reloadMarker = recentReloadMarker()
if (reloadMarker) {
  Sentry.addBreadcrumb({
    category: 'chunk-reload',
    level: 'info',
    message: 'Page rechargée : fichier de page introuvable après un déploiement',
    data: { path: reloadMarker.path, reason: reloadMarker.reason },
  })
}

// Avant le rendu : aucun import de page ne doit pouvoir échouer sans écouteur.
installPreloadErrorReload()

const queryClient = new QueryClient()

// Fallback crash global brandé Viniz. Les error boundaries locaux (ex. Planning)
// interceptent d'abord leur sous-arbre ; celui-ci ne rattrape que ce qui remonte.
function ErrorFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <span className="rounded-xl bg-[#4827B4] px-4 py-2 font-display text-lg font-black tracking-[0.15em] text-[#C8FF3D]">
        VINIZ
      </span>
      <p className="font-body text-sm text-dark/60">Une erreur est survenue.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-xl bg-[#4827B4] px-5 py-2.5 font-ui text-sm font-bold text-[#C8FF3D] transition-opacity hover:opacity-90"
      >
        Recharger
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
