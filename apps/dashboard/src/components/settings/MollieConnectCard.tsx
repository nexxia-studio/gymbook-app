import { useState, useEffect, useCallback } from 'react'
import { CreditCard, Check, AlertCircle, Loader2, Unlink } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Connection {
  connected: boolean
  profile_name: string | null
  connected_at: string | null
  is_test_mode: boolean | null
}

export function MollieConnectCard() {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConnecting, setIsConnecting] = useState(false)

  const checkStatus = useCallback(async () => {
    const { data } = await supabase.functions.invoke('mollie-connect-oauth', {
      headers: { 'x-action': 'status' },
      body: {},
    })
    setConnection(data as Connection)
    setIsLoading(false)
  }, [])

  useEffect(() => { checkStatus() }, [checkStatus])

  const handleConnect = async () => {
    setIsConnecting(true)
    const { data } = await supabase.functions.invoke('mollie-connect-oauth', {
      headers: { 'x-action': 'authorize' },
      body: {},
    })
    if (data?.url) window.location.href = data.url
    setIsConnecting(false)
  }

  const handleDisconnect = async () => {
    if (!confirm('Déconnecter Mollie ? Les paiements seront désactivés.')) return
    await supabase.functions.invoke('mollie-connect-oauth', {
      headers: { 'x-action': 'disconnect' },
      body: {},
    })
    setConnection(null)
    checkStatus()
  }

  if (isLoading) return <div className="animate-pulse h-32 bg-gray-100 rounded-2xl" />

  return (
    <section className="rounded-2xl border border-[#E8E6E0] bg-card p-6">
      <div className="mb-6 flex items-center gap-3">
        <CreditCard size={20} className="text-dark" />
        <h2 className="font-display text-xl font-black uppercase tracking-tight text-dark">Paiements Mollie</h2>
        {connection?.is_test_mode && (
          <span className="rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-700">Mode test</span>
        )}
      </div>

      {connection?.connected ? (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Check size={16} className="text-green-500" />
            <span className="font-body text-sm font-medium text-dark">{connection.profile_name}</span>
          </div>
          {connection.connected_at && (
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
            Vous serez redirigé vers Mollie pour autoriser GymBook
          </p>
        </div>
      )}
    </section>
  )
}
