import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable, ActivityIndicator } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'

interface Payment {
  id: string
  status: string
  plan_name: string
  amount: number | string
  credits_granted: number
}

type DropInStatus = 'polling' | 'booking' | 'success' | 'error'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export default function PaymentSuccess() {
  const { t } = useTranslation()
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string; slot_id?: string; source?: string }>()
  const isDropInRetry = params.source === 'drop_in' && !!params.slot_id

  // ============================================================
  // GYM-63b — Mode drop-in auto-retry
  // ============================================================
  if (isDropInRetry) {
    return <DropInRetryScreen slotId={params.slot_id!} />
  }

  // ============================================================
  // Mode classique — poll du paiement par payment.id
  // ============================================================
  return <ClassicPaymentScreen paymentId={params.id} router={router} t={t} />
}

function DropInRetryScreen({ slotId }: { slotId: string }) {
  const { t } = useTranslation()
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const gymId = useAuthStore((s) => s.gym_id)
  const [status, setStatus] = useState<DropInStatus>('polling')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true

    const run = async () => {
      if (!user || !gymId) {
        setStatus('error')
        return
      }

      const maxAttempts = 15
      for (let i = 0; i < maxAttempts; i++) {
        await sleep(1000)
        const { data: credits } = await supabase
          .from('member_credits')
          .select('credits_total, credits_used')
          .eq('member_id', user.id)
          .eq('gym_id', gymId)
          .maybeSingle()

        const hasCredits = credits && (credits.credits_total - credits.credits_used) > 0
        if (!hasCredits) continue

        setStatus('booking')
        const { data, error } = await supabase.functions.invoke('create-booking', {
          body: { slot_id: slotId },
        })

        if (error || data?.error) {
          setStatus('error')
          return
        }

        setStatus('success')
        await sleep(2000)
        router.replace('/(tabs)/bookings')
        return
      }

      // Timeout — webhook trop lent, fallback manuel
      setStatus('error')
    }

    run()
  }, [user, gymId, slotId, router])

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center gap-4 px-8">
        {status === 'polling' && (
          <>
            <ActivityIndicator size="large" color="#C8F000" />
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#FFFFFF', textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.polling_title')}
            </Text>
            <Text className="font-dmsans text-sm text-white/60 text-center">
              {t('payment_drop_in_retry.polling_sub')}
            </Text>
          </>
        )}

        {status === 'booking' && (
          <>
            <ActivityIndicator size="large" color="#C8F000" />
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#FFFFFF', textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.booking_title')}
            </Text>
          </>
        )}

        {status === 'success' && (
          <>
            <Text style={{ fontSize: 64 }}>✅</Text>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#C8F000', textAlign: 'center', letterSpacing: 2 }}>
              {t('payment_drop_in_retry.success_title')}
            </Text>
            <Text className="font-dmsans text-sm text-white/60 text-center">
              {t('payment_drop_in_retry.success_sub')}
            </Text>
          </>
        )}

        {status === 'error' && (
          <>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#FFFFFF', textAlign: 'center', letterSpacing: 1 }}>
              {t('payment_drop_in_retry.error_title')}
            </Text>
            <Text className="font-dmsans text-sm text-white/60 text-center">
              {t('payment_drop_in_retry.error_sub')}
            </Text>
            <Pressable
              onPress={() => router.replace('/(tabs)/schedule')}
              className="mt-4 w-full items-center rounded-xl bg-move-accent py-4"
            >
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#111111' }}>
                {t('payment_drop_in_retry.back_to_schedule')}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

function ClassicPaymentScreen({
  paymentId,
  router,
  t,
}: {
  paymentId: string | undefined
  router: ReturnType<typeof useRouter>
  t: (key: string, opts?: Record<string, unknown>) => string
}) {
  const [payment, setPayment] = useState<Payment | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
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
  }, [paymentId])

  const isPaid = payment?.status === 'paid'

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center px-8">
        <Text style={{ fontSize: 64, marginBottom: 16 }}>
          {isLoading || !isPaid ? '⏳' : '✅'}
        </Text>

        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#111111', textAlign: 'center', letterSpacing: 2 }}>
          {isPaid ? t('payment.success_title') : t('payment.verifying')}
        </Text>

        {isPaid && payment && (
          <>
            <Text className="mt-3 font-dmsans text-base text-move-text-secondary text-center">
              {payment.plan_name} — {payment.amount}€
            </Text>
            <Text className="mt-1 font-dmsans-bold text-sm text-green-600 text-center">
              {t('payment.credits_added', { count: payment.credits_granted })}
            </Text>
          </>
        )}

        {!isPaid && (
          <Text className="mt-3 font-dmsans text-sm text-move-text-muted text-center">
            {t('payment.waiting_confirmation')}
          </Text>
        )}

        <Pressable
          onPress={() => router.replace('/(tabs)/profile')}
          className="mt-10 w-full items-center rounded-xl bg-move-dark py-4"
        >
          <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#C8F000' }}>
            {t('payment.go_to_profile')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
