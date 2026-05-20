import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

export default function MollieCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    if (error || !code || !state) {
      setStatus('error')
      setMessage(error === 'access_denied' ? 'Connexion Mollie annulée.' : 'Erreur lors de la connexion Mollie.')
      return
    }

    supabase.functions.invoke('mollie-connect-oauth', {
      body: { code, state },
      headers: { 'x-action': 'callback' },
    }).then(({ data, error: fnError }) => {
      if (fnError || !data?.success) {
        setStatus('error')
        setMessage('Échec de la connexion. Réessayez.')
        return
      }
      setStatus('success')
      setMessage(`Compte Mollie "${data.profile}" connecté avec succès !`)
      setTimeout(() => navigate('/settings?tab=gym'), 2000)
    })
  }, [searchParams, navigate])

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white rounded-2xl p-8 shadow-lg max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <div className="animate-spin w-12 h-12 border-4 border-lime-400 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-600">Connexion à Mollie en cours...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="text-5xl mb-4">✅</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Connexion réussie !</h2>
            <p className="text-gray-600">{message}</p>
            <p className="text-sm text-gray-400 mt-2">Redirection en cours...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="text-5xl mb-4">❌</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Erreur</h2>
            <p className="text-gray-600">{message}</p>
            <button
              onClick={() => navigate('/settings?tab=gym')}
              className="mt-4 bg-gray-900 text-lime-400 px-6 py-2 rounded-lg font-bold"
            >
              Retour aux paramètres
            </button>
          </>
        )}
      </div>
    </div>
  )
}
