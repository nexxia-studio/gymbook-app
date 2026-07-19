import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './lib/i18n'
import './index.css'
import App from './App'

// GYM-153 — Monitoring erreurs dashboard (init minimale, symétrique du mobile).
// Tolérant à l'absence de DSN (no-op sans VITE_SENTRY_DSN — le build passe sans).
// tracesSampleRate 0 → pas de performance/tracing ; pas d'upload de sourcemaps.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0 })
}

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
