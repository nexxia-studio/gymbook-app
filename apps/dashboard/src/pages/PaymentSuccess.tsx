import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface Payment {
  id: string
  status: string
  plan_name: string
  amount: number | string
  credits_granted: number
}

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
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

    // Try to re-open the mobile app via deep link. The browser will silently
    // ignore the navigation if the app isn't installed, leaving us on the web fallback.
    window.location.href = `dopamine://payment/success?id=${paymentId}`

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
                {payment.credits_granted} séance(s) ajoutée(s) à votre compte
              </p>
            )}
          </>
        )}
        {!isPaid && (
          <p className="text-gray-500 text-sm mb-4">
            Nous attendons la confirmation de Mollie. Vous pouvez fermer cette page.
          </p>
        )}
        {paymentId && (
          <a
            href={`dopamine://payment/success?id=${paymentId}`}
            className="block w-full text-center bg-gray-900 text-lime-400 font-bold py-3 px-6 rounded-xl mb-2"
          >
            Retourner dans l&apos;app
          </a>
        )}
        <button
          onClick={() => navigate('/')}
          className="bg-white border border-gray-200 text-gray-900 px-6 py-3 rounded-xl font-bold w-full"
        >
          Retour à l&apos;accueil
        </button>
      </div>
    </div>
  )
}
