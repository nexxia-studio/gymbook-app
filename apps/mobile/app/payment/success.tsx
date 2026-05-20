import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../../lib/supabase'

interface Payment {
  id: string
  status: string
  plan_name: string
  amount: number | string
  credits_granted: number
}

export default function PaymentSuccess() {
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const router = useRouter()
  const [payment, setPayment] = useState<Payment | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!id) {
      setIsLoading(false)
      return
    }
    const fetchPayment = async () => {
      const { data } = await supabase
        .from('payments')
        .select('id, status, plan_name, amount, credits_granted')
        .eq('id', id)
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
  }, [id])

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
