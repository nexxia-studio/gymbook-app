import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { resolveGymSlug, fetchGymLegalIdentity } from '@/lib/gymLegalIdentity'

interface Payment {
  id: string
  status: string
  plan_name: string
  amount: number | string
  credits_granted: number
}


/**
 * GYM-105 — LE NOM DE LA SALLE SUR UNE PAGE PUBLIQUE, RÉSOLU COMME AILLEURS.
 *
 * ⚠️ `useGymStore` NE CONVIENT PAS ICI, et c'est la nuance qui décide du mécanisme. Le
 * menu latéral (GYM-104) lit `useGymStore((s) => s.gym?.name)` — parfait pour un GÉRANT
 * connecté, dont la session porte la salle. Ces deux pages-ci sont PUBLIQUES (routées hors
 * `ProtectedRoute`, cf. App.tsx) et servies à un MEMBRE qui revient de Mollie, sans aucune
 * session dashboard : le store y serait vide, et le nom retomberait sur le repli.
 *
 * On reprend donc le mécanisme des pages LÉGALES publiques, qui résolvent exactement la
 * même question : `resolveGymSlug` (query `?gym=` ou sous-domaine) puis
 * `fetchGymLegalIdentity`. Rien de neuf n'est inventé.
 *
 * ⚠️ NE LÈVE JAMAIS, et le repli ne nomme PERSONNE : sans salle résolue, la page dit
 * « l'application » plutôt que le nom d'un client. C'est la règle de GYM-293b — un écran
 * qui nomme la mauvaise salle est pire qu'un écran qui n'en nomme aucune.
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

export default function PaymentSuccess() {
  const { t } = useTranslation()
  const gymName = useGymName()
  const [searchParams] = useSearchParams()
  const [payment, setPayment] = useState<Payment | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const paymentId = searchParams.get('id')
    if (!paymentId) {
      setIsLoading(false)
      return
    }

    const fetchPayment = async () => {
      const { data } = await supabase
        .from('payments')
        .select('id, status, plan_name, amount, credits_granted')
        .eq('id', paymentId)
        .single()
      if (data) {
        setPayment(data as Payment)
        if (data.status === 'paid' && intervalRef.current) {
          clearInterval(intervalRef.current)
        }
      }
      setIsLoading(false)
    }

    fetchPayment()
    intervalRef.current = setInterval(fetchPayment, 2000)
    timeoutRef.current = setTimeout(() => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }, 30000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [searchParams])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin w-12 h-12 border-4 border-lime-400 border-t-transparent rounded-full" />
      </div>
    )
  }

  const isPaid = payment?.status === 'paid'
  const paymentId = searchParams.get('id')

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white rounded-2xl p-8 shadow-lg max-w-md w-full text-center">
        <div className="text-6xl mb-4">{isPaid ? '✅' : '⏳'}</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          {isPaid ? 'Paiement confirmé !' : 'Paiement en cours...'}
        </h2>
        {payment && (
          <>
            <p className="text-gray-600 mb-2">
              <strong>{payment.plan_name}</strong> — {payment.amount}€
            </p>
            {isPaid && (
              <p className="text-green-600 font-medium mb-4">
                {t('payment_return.credits_added', { count: payment.credits_granted })}
              </p>
            )}
          </>
        )}
        {!isPaid && (
          <p className="text-gray-500 text-sm mb-4">
            {t('payment_return.pending_body')}
          </p>
        )}
        {paymentId && (
          <a
            href={`dopamine://payment/success?id=${paymentId}`}
            className="block w-full text-center bg-gray-900 text-lime-400 font-bold py-3 px-6 rounded-xl mb-2"
          >
            {gymName
              ? t('payment_return.back_to_app_named', { gym: gymName })
              : t('payment_return.back_to_app')}
          </a>
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
