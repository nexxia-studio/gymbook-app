import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { resolveGymSlug, fetchGymLegalIdentity } from '@/lib/gymLegalIdentity'

/**
 * GYM-105 — même résolution que sur PaymentSuccess, et pour la même raison : ces deux
 * pages sont PUBLIQUES et servies à un membre sans session dashboard, donc `useGymStore`
 * (le mécanisme du menu latéral, GYM-104) y serait vide. On reprend celui des pages
 * légales publiques. Sans salle résolue, on ne nomme personne.
 */
function useGymName(): string | null {
  const [name, setName] = useState<string | null>(null)
  useEffect(() => {
    const slug = resolveGymSlug(window.location.search, window.location.hostname)
    if (!slug) return
    let annule = false
    fetchGymLegalIdentity(slug).then((g) => {
      if (!annule) setName(g?.commercialName ?? g?.name ?? null)
    })
    return () => { annule = true }
  }, [])
  return name
}

export default function PaymentCancel() {
  const { t } = useTranslation()
  const gymName = useGymName()
  const [searchParams] = useSearchParams()
  const paymentId = searchParams.get('id')

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white rounded-2xl p-8 shadow-lg max-w-md w-full text-center">
        <div className="text-6xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">{t('payment_return.cancel_title')}</h2>
        <p className="text-gray-600 mb-6">
          {t('payment_return.cancel_body')}
        </p>
        {paymentId && (
          <>
            <p className="text-xs text-gray-400 mb-4">
              {t('payment_return.reference', { ref: paymentId.slice(0, 8) })}
            </p>
            <a
              href={`dopamine://payment/cancel?id=${paymentId}`}
              className="block w-full text-center bg-gray-900 text-lime-400 font-bold py-3 px-6 rounded-xl mb-2"
            >
              {gymName
                ? t('payment_return.back_to_app_named', { gym: gymName })
                : t('payment_return.back_to_app')}
            </a>
          </>
        )}
        <button
          onClick={() => window.close()}
          className="bg-white border border-gray-200 text-gray-900 px-6 py-3 rounded-xl font-bold w-full"
        >
          {t('payment_return.close_window')}
        </button>
        <p className="text-xs text-gray-400 mt-3">
          {t('payment_return.close_hint')}
        </p>
      </div>
    </div>
  )
}
