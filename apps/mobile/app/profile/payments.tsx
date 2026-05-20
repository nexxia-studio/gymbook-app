import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, Receipt, FileText } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'

type PaymentStatus = 'paid' | 'pending' | 'failed' | 'expired' | 'canceled'

interface PaymentRow {
  id: string
  plan_id: string | null
  plan_name: string | null
  amount: number | string
  status: PaymentStatus
  paid_at: string | null
  created_at: string | null
}

const ONE_TIME_PLAN_IDS = new Set(['drop_in', 'pack_10'])

function isOneTime(planId: string | null): boolean {
  return !!planId && ONE_TIME_PLAN_IDS.has(planId)
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: 'short', year: 'numeric' })
}

function statusKey(status: PaymentStatus): string {
  return `payments.status_${status}`
}

function statusBg(status: PaymentStatus): string {
  if (status === 'paid') return 'bg-green-50'
  if (status === 'pending') return 'bg-orange-50'
  if (status === 'failed') return 'bg-red-50'
  return 'bg-gray-100'
}

function statusText(status: PaymentStatus): string {
  if (status === 'paid') return 'text-green-600'
  if (status === 'pending') return 'text-orange-600'
  if (status === 'failed') return 'text-red-600'
  return 'text-move-text-muted'
}

export default function PaymentsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const [transactions, setTransactions] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingInvoice, setLoadingInvoice] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data } = await supabase
        .from('payments')
        .select('id, plan_id, plan_name, amount, status, paid_at, created_at')
        .eq('member_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)

      setTransactions((data ?? []) as PaymentRow[])
      setLoading(false)
    })()
  }, [])

  const handleDownloadInvoice = useCallback(async (paymentId: string) => {
    setLoadingInvoice(paymentId)
    try {
      const { data, error } = await supabase.functions.invoke('generate-invoice', {
        body: { payment_id: paymentId },
      })
      if (error || !data?.success) {
        console.error('[invoice] error:', error, data)
        Alert.alert(t('payments.invoice_error_title'), t('payments.invoice_error_message'))
        return
      }
      Alert.alert(
        t('payments.invoice_sent_title'),
        t('payments.invoice_sent_message', { invoice: data.invoice_number ?? '', email: data.email ?? '' }),
      )
    } catch (err) {
      console.error('[invoice] threw:', err)
      Alert.alert(t('payments.invoice_error_title'), t('payments.invoice_error_message'))
    } finally {
      setLoadingInvoice(null)
    }
  }, [t])

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

      {loading ? (
        <View className="flex-1 bg-move-bg" />
      ) : transactions.length === 0 ? (
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
          {transactions.map((tx) => {
            const oneTime = isOneTime(tx.plan_id)
            const canDownload = oneTime && tx.status === 'paid'
            return (
              <View key={tx.id} className="rounded-xl bg-move-card p-4">
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 flex-row items-center gap-3">
                    <View className="h-10 w-10 items-center justify-center rounded-full bg-move-bg">
                      <Text style={{ fontSize: 18 }}>{oneTime ? '🎟️' : '📅'}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="font-dmsans-medium text-sm text-move-dark" numberOfLines={1}>
                        {tx.plan_name ?? '—'}
                      </Text>
                      <Text className="mt-0.5 font-dmsans text-xs text-move-text-muted">
                        {formatDate(tx.paid_at ?? tx.created_at)}
                      </Text>
                    </View>
                  </View>
                  <View className="items-end gap-1">
                    <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#111111' }}>
                      {Number(tx.amount).toFixed(2)}€
                    </Text>
                    <View className={`rounded-full px-2 py-0.5 ${statusBg(tx.status)}`}>
                      <Text className={`font-dmsans text-[11px] ${statusText(tx.status)}`}>
                        {t(statusKey(tx.status))}
                      </Text>
                    </View>
                  </View>
                </View>

                {canDownload && (
                  <Pressable
                    onPress={() => handleDownloadInvoice(tx.id)}
                    disabled={loadingInvoice === tx.id}
                    className={`mt-3 flex-row items-center justify-center gap-1.5 self-start rounded-md border border-move-border px-3 py-1.5 ${loadingInvoice === tx.id ? 'opacity-50' : ''}`}
                  >
                    {loadingInvoice === tx.id ? (
                      <ActivityIndicator size="small" color="#6B6861" />
                    ) : (
                      <FileText size={12} color="#6B6861" />
                    )}
                    <Text className="font-dmsans-medium text-xs text-move-text-secondary">
                      {loadingInvoice === tx.id ? t('payments.sending_invoice') : t('payments.email_invoice')}
                    </Text>
                  </Pressable>
                )}
              </View>
            )
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}
