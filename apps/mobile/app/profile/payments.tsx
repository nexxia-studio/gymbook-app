import { useState } from 'react'
import { View, Text, ScrollView, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, Receipt } from 'lucide-react-native'

type PaymentStatus = 'paid' | 'pending' | 'failed'

interface PaymentTransaction {
  id: string
  date: string
  amount: number
  planName: string
  status: PaymentStatus
  mollieId?: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })
}

function statusBg(status: PaymentStatus): string {
  if (status === 'paid') return 'bg-green-100'
  if (status === 'pending') return 'bg-orange-100'
  return 'bg-red-100'
}

function statusText(status: PaymentStatus): string {
  if (status === 'paid') return 'text-green-600'
  if (status === 'pending') return 'text-orange-600'
  return 'text-red-600'
}

export default function PaymentsScreen() {
  const { t } = useTranslation()
  const router = useRouter()

  // Sprint 6: query Mollie-backed payment_transactions table here
  const [transactions] = useState<PaymentTransaction[]>([])

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-6 pt-3">
        <Pressable onPress={() => router.replace('/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#FFFFFF', letterSpacing: 2 }}>
          {t('payments.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {transactions.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-4 bg-move-bg px-8">
          <Receipt size={64} color="#E5E5E0" />
          <Text className="text-center font-dmsans-bold text-xl text-move-dark">
            {t('payments.empty_title')}
          </Text>
          <Text className="text-center font-dmsans text-sm leading-6 text-move-text-muted">
            {t('payments.empty_subtitle')}
          </Text>
          <Pressable
            onPress={() => router.push('/profile/subscription')}
            className="mt-2 rounded-xl bg-move-dark px-6 py-3.5"
          >
            <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#C8F000' }}>
              {t('payments.view_subscriptions')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView className="flex-1 bg-move-bg" contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
          {transactions.map((tx) => (
            <View key={tx.id} className="flex-row items-center justify-between rounded-xl bg-move-card p-4">
              <View>
                <Text className="font-dmsans text-xs text-move-text-muted">
                  {formatDate(tx.date)}
                </Text>
                <Text className="mt-0.5 font-dmsans-medium text-sm text-move-dark">
                  {tx.planName}
                </Text>
              </View>
              <View className="items-end">
                <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#111111' }}>
                  {tx.amount}€
                </Text>
                <View className={`mt-1 self-end rounded-full px-2 py-0.5 ${statusBg(tx.status)}`}>
                  <Text className={`font-dmsans text-[11px] ${statusText(tx.status)}`}>
                    {t(`payments.status_${tx.status}`)}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}
