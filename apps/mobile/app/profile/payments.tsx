import { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, Receipt, FileText } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { useActiveGymId } from '../../lib/activeGym'
import { useTheme } from '../../lib/theme/ThemeProvider'

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
  // GYM-286 — A-2, EN ATTENTE : `green-600` #16A34A, `orange-600` #EA580C et
  // `red-600` #DC2626 ne valent aucun jeton sémantique. Les fonds (`*-50`) non plus.
  // La seule branche migrable est le gris — mais la migrer seule romprait l'unité de
  // cette fonction, qui doit rendre UNE classe. Elle attend donc avec les autres.
  if (status === 'paid') return 'text-green-600'
  if (status === 'pending') return 'text-orange-600'
  if (status === 'failed') return 'text-red-600'
  return 'text-move-text-muted'
}

export default function PaymentsScreen() {
  const { tokens } = useTheme()
  const gymId = useActiveGymId()
  const { t } = useTranslation()
  const router = useRouter()
  const [transactions, setTransactions] = useState<PaymentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingInvoice, setLoadingInvoice] = useState<string | null>(null)

  // 🔴 GYM-292 — FILTRÉ PAR SALLE, ET IL NE L'ÉTAIT PAS. `.eq('member_id', …)` seul rend
  // les paiements de TOUTES les salles du membre : un membre de trois salles voyait, sous
  // la marque d'une seule, l'historique des trois. La colonne `gym_id` existe et est NOT
  // NULL sur `payments` — c'est le filtre qui manquait, pas la donnée.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      // Salle non résolue : liste vide plutôt que l'historique d'une autre salle.
      if (!gymId) { setLoading(false); return }

      const { data } = await supabase
        .from('payments')
        .select('id, plan_id, plan_name, amount, status, paid_at, created_at')
        .eq('member_id', user.id)
        .eq('gym_id', gymId)
        .order('created_at', { ascending: false })
        .limit(50)

      setTransactions((data ?? []) as PaymentRow[])
      setLoading(false)
    })()
  }, [gymId])

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
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pb-6 pt-3" style={{ backgroundColor: tokens.background }}>
        <Pressable onPress={() => router.replace('/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={24} color={tokens.onBackground} />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}>
          {t('payments.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {loading ? (
        <View className="flex-1" style={{ backgroundColor: tokens.page }} />
      ) : transactions.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-4 px-8" style={{ backgroundColor: tokens.page }}>
          {/* GYM-286 (A-6) — RATTACHÉ. #E5E5E0 → `tokens.border` #E8E6E0, écart 3. */}
          <Receipt size={64} color={tokens.border} />
          <Text className="text-center font-dmsans-bold text-xl" style={{ color: tokens.onSurface }}>
            {t('payments.empty_title')}
          </Text>
          <Text className="text-center font-dmsans text-sm leading-6" style={{ color: tokens.onBackgroundMuted }}>
            {t('payments.empty_subtitle')}
          </Text>
          <Pressable
            onPress={() => router.push('/profile/subscription')}
            // 🔴 GYM-286 — A-3/A-4, EN ATTENTE : fond `bg-move-dark` sur un BOUTON.
            style={{ backgroundColor: tokens.actionBg }} className="mt-2 rounded-xl px-6 py-3.5"
          >
            <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#C8F000' }}>
              {t('payments.view_subscriptions')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView className="flex-1" style={{ backgroundColor: tokens.page }} contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 40 }}>
          {transactions.map((tx) => {
            const oneTime = isOneTime(tx.plan_id)
            const canDownload = oneTime && tx.status === 'paid'
            return (
              <View key={tx.id} className="rounded-xl p-4" style={{ backgroundColor: tokens.surface }}>
                <View className="flex-row items-center justify-between">
                  <View className="flex-1 flex-row items-center gap-3">
                    <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: tokens.page }}>
                      <Text style={{ fontSize: 18 }}>{oneTime ? '🎟️' : '📅'}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="font-dmsans-medium text-sm" style={{ color: tokens.onSurface }} numberOfLines={1}>
                        {tx.plan_name ?? '—'}
                      </Text>
                      <Text className="mt-0.5 font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
                        {formatDate(tx.paid_at ?? tx.created_at)}
                      </Text>
                    </View>
                  </View>
                  <View className="items-end gap-1">
                    <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: tokens.onSurface }}>
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
                    className={`mt-3 flex-row items-center justify-center gap-1.5 self-start rounded-md border px-3 py-1.5 ${loadingInvoice === tx.id ? 'opacity-50' : ''}`}
                    style={{ borderColor: tokens.border }}
                  >
                    {loadingInvoice === tx.id ? (
                      <ActivityIndicator size="small" color={tokens.onSurfaceSecondary} />
                    ) : (
                      <FileText size={12} color={tokens.onSurfaceSecondary} />
                    )}
                    <Text className="font-dmsans-medium text-xs" style={{ color: tokens.onSurfaceSecondary }}>
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
