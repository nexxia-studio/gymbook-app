import { useState, useEffect, useCallback } from 'react'
import { CreditCard, Check, AlertCircle, AlertTriangle, Loader2, Unlink, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Connection {
  connected: boolean
  fully_connected: boolean
  mollie_profile_id: string | null
  profile_name: string | null
  connected_at: string | null
  is_test_mode: boolean | null
  status: 'active' | 'revoked' | 'expired' | null
}

// GYM-85 : mapping des codes d'erreur backend → message FR visible.
const ERROR_MESSAGES: Record<string, string> = {
  CONFIG_MISSING: 'Configuration Mollie manquante côté serveur, contacte le support.',
  NO_GYM: 'Aucune salle rattachée à ce compte.',
  UNAUTHORIZED: 'Session expirée, reconnecte-toi.',
}
const FALLBACK_ERROR = 'Une erreur est survenue, réessaie.'

// Extrait le code d'erreur, que le body soit dans `data` (rare) ou dans
// l'erreur HTTP de supabase-js (FunctionsHttpError → error.context: Response).
async function resolveErrorMessage(error: unknown, data: unknown): Promise<string> {
  let code: string | undefined

  const d = data as { error?: boolean; code?: string } | null
  if (d?.error && d.code) code = d.code

  const ctx = (error as { context?: unknown } | null)?.context
  if (!code && ctx && typeof (ctx as Response).json === 'function') {
    try {
      const body = await (ctx as Response).json()
      code = body?.code
    } catch {
      // corps non-JSON → on retombe sur le fallback
    }
  }

  return (code && ERROR_MESSAGES[code]) || FALLBACK_ERROR
}

export function MollieConnectCard() {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const checkStatus = useCallback(async () => {
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const { data, error: fnError } = await supabase.functions.invoke('mollie-connect-oauth', {
      headers: { 'x-action': 'status', Authorization: `Bearer ${session?.access_token}` },
      body: {},
    })
    if (fnError || !data) {
      setConnection(null)
      setError(await resolveErrorMessage(fnError, data))
    } else {
      setConnection(data as Connection)
    }
    setIsLoading(false)
  }, [])

  useEffect(() => { checkStatus() }, [checkStatus])

  const handleConnect = async () => {
    setIsConnecting(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error: fnError } = await supabase.functions.invoke('mollie-connect-oauth', {
        headers: { 'x-action': 'authorize', Authorization: `Bearer ${session?.access_token}` },
        body: {},
      })

      if (fnError || !data || (data as { error?: boolean }).error) {
        setError(await resolveErrorMessage(fnError, data))
        return
      }

      const url = (data as { url?: string }).url
      if (!url) {
        // authorize a réussi mais sans lien → ne pas rester en loading muet.
        setError('Impossible d\'obtenir le lien Mollie, réessaie.')
        return
      }

      window.location.href = url
      return // redirection pleine page : on garde le loading le temps du redirect
    } catch {
      setError(FALLBACK_ERROR)
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Déconnecter Mollie ? Les paiements seront désactivés.')) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.functions.invoke('mollie-connect-oauth', {
      headers: { 'x-action': 'disconnect', Authorization: `Bearer ${session?.access_token}` },
      body: {},
    })
    setConnection(null)
    checkStatus()
  }

  if (isLoading) return <div className="animate-pulse h-32 bg-gray-100 rounded-2xl" />

  // GYM-85 : l'état « connecté » se dérive UNIQUEMENT de fully_connected.
  // Une ligne active mais sans mollie_profile_id (fully_connected === false)
  // est une connexion non finalisée → on doit pouvoir relancer le flow.
  const fullyConnected = connection?.fully_connected === true
  // Cas « relance » : connexion présente mais pas finalisée, ou token expiré.
  const needsReconnect = !fullyConnected && (connection?.connected === true || connection?.status === 'expired')

  return (
    <section className="rounded-2xl border border-[#E8E6E0] bg-card p-6">
      <div className="mb-6 flex items-center gap-3">
        <CreditCard size={20} className="text-dark" />
        <h2 className="font-display text-xl font-black uppercase tracking-tight text-dark">Paiements Mollie</h2>
        {connection?.is_test_mode && (
          <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">Mode test</span>
        )}
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3">
          <AlertCircle size={16} className="shrink-0 text-red-500" />
          <p className="font-body text-sm text-red-600">{error}</p>
        </div>
      )}

      {fullyConnected ? (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Check size={16} className="text-green-500" />
            <span className="font-body text-sm font-medium text-dark">{connection?.profile_name}</span>
          </div>
          {connection?.connected_at && (
            <p className="mb-4 font-body text-xs text-muted">
              Connecté le {new Date(connection.connected_at).toLocaleDateString('fr-BE')}
            </p>
          )}
          <div className="flex gap-2">
            <div className="flex-1 rounded-xl border border-green-200 bg-green-50 p-3 text-center">
              <p className="font-body text-xs font-medium text-green-600">✓ Paiements actifs</p>
            </div>
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2 font-body text-sm text-red-500 hover:bg-red-50"
            >
              <Unlink size={14} />
              Déconnecter
            </button>
          </div>
        </div>
      ) : needsReconnect ? (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-orange-500" />
            <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-medium text-orange-700">Connexion non finalisée</span>
          </div>
          <p className="mb-4 font-body text-xs text-muted">
            Votre compte Mollie n'est pas entièrement relié. Relancez la connexion pour activer les paiements.
          </p>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-6 py-3 font-body font-bold text-white disabled:opacity-60"
          >
            {isConnecting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {isConnecting ? 'Redirection vers Mollie...' : 'Reconnecter Mollie'}
          </button>
        </div>
      ) : (
        <div>
          <div className="mb-4 flex items-center gap-2">
            <AlertCircle size={16} className="text-orange-500" />
            <span className="font-body text-sm text-muted">Connectez votre compte Mollie pour encaisser les membres</span>
          </div>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-dark px-6 py-3 font-body font-bold text-accent disabled:opacity-60"
          >
            {isConnecting ? <Loader2 size={16} className="animate-spin" /> : <CreditCard size={16} />}
            {isConnecting ? 'Redirection vers Mollie...' : 'Connecter Mollie'}
          </button>
          <p className="mt-2 text-center font-body text-xs text-muted">
            Vous serez redirigé vers Mollie pour autoriser Viniz
          </p>
        </div>
      )}
    </section>
  )
}
