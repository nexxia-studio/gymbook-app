// GYM-63 — Bottom sheet quand un membre tente de réserver sans abonnement ni crédit.
// L'auto-retry après paiement drop-in est géré par app/payment/success.tsx (GYM-63b)
// via le deep link dopamine://payment/success?slot_id=...&source=drop_in.
import { useState } from 'react'
import { View, Text, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import * as WebBrowser from 'expo-web-browser'
import { CreditCard, Calendar, Ticket } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'

interface PaymentRequiredSheetProps {
  visible: boolean
  slotId: string | null
  onClose: () => void
}

const DROP_IN_AMOUNT_EUR = 20

export function PaymentRequiredSheet({ visible, slotId, onClose }: PaymentRequiredSheetProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const gymId = useAuthStore((s) => s.gym_id)
  const [isLoadingDropIn, setIsLoadingDropIn] = useState(false)

  const goToPayments = () => {
    onClose()
    router.push('/profile/payments')
  }

  const handleDropIn = async () => {
    console.log('[PaymentRequiredSheet] drop-in clicked — gymId:', gymId, 'slotId:', slotId)
    if (!gymId || !slotId) {
      console.warn('[PaymentRequiredSheet] missing gymId or slotId — aborting drop-in')
      Alert.alert(t('common.error'), t('payment_required.errors.no_gym'))
      return
    }
    setIsLoadingDropIn(true)
    try {
      const payload = {
        gym_id: gymId,
        amount: DROP_IN_AMOUNT_EUR,
        payment_type: 'drop_in',
        redirect_url: `dopamine://payment/success?slot_id=${slotId}&source=drop_in`,
      }
      console.log('[PaymentRequiredSheet] drop-in payload:', payload)

      const { data, error } = await supabase.functions.invoke('create-payment', {
        body: payload,
      })
      console.log('[PaymentRequiredSheet] create-payment response — data:', data, 'error:', error)

      if (error || !data?.checkout_url) {
        // Tente d'extraire le code/message d'erreur depuis le body Edge
        let detail: unknown = null
        try {
          if ((error as { context?: Response })?.context) {
            detail = await (error as { context: Response }).context.json()
          }
        } catch { /* not JSON */ }
        console.warn('[PaymentRequiredSheet] checkout failed — detail:', detail, 'data:', data)
        Alert.alert(t('common.error'), t('payment_required.errors.checkout_failed'))
        return
      }

      onClose()
      await WebBrowser.openBrowserAsync(data.checkout_url as string)
    } catch (e) {
      console.error('[PaymentRequiredSheet] drop-in uncaught:', e)
      Alert.alert(t('common.error'), t('payment_required.errors.checkout_failed'))
    } finally {
      setIsLoadingDropIn(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/50">
        <View className="rounded-t-3xl bg-move-card px-6 pb-10 pt-8">
          <View className="items-center">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-move-accent/10">
              <CreditCard size={24} color="#9DB800" />
            </View>
            <Text className="mt-4 text-center font-barlow text-2xl uppercase text-move-dark">
              {t('payment_required.title')}
            </Text>
            <Text className="mt-2 text-center font-dmsans text-sm leading-relaxed text-move-text-secondary">
              {t('payment_required.subtitle')}
            </Text>
          </View>

          <View className="mt-6 gap-3">
            {/* Option 1 — Abonnement */}
            <TouchableOpacity
              onPress={goToPayments}
              activeOpacity={0.8}
              className="flex-row items-center gap-3 rounded-2xl border border-move-border bg-white px-4 py-4"
            >
              <Calendar size={20} color="#111111" />
              <View className="flex-1">
                <Text className="font-dmsans-bold text-sm text-move-dark">
                  {t('payment_required.option_subscribe.label')}
                </Text>
                <Text className="font-dmsans text-xs text-move-text-muted">
                  {t('payment_required.option_subscribe.sub')}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 2 — Carnet 10 séances */}
            <TouchableOpacity
              onPress={goToPayments}
              activeOpacity={0.8}
              className="flex-row items-center gap-3 rounded-2xl border border-move-border bg-white px-4 py-4"
            >
              <Ticket size={20} color="#111111" />
              <View className="flex-1">
                <Text className="font-dmsans-bold text-sm text-move-dark">
                  {t('payment_required.option_pack.label')}
                </Text>
                <Text className="font-dmsans text-xs text-move-text-muted">
                  {t('payment_required.option_pack.sub')}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 3 — Paiement à la séance */}
            <TouchableOpacity
              onPress={handleDropIn}
              activeOpacity={0.8}
              disabled={isLoadingDropIn}
              className="flex-row items-center gap-3 rounded-2xl bg-move-dark px-4 py-4"
            >
              {isLoadingDropIn ? (
                <ActivityIndicator color="#C8F000" />
              ) : (
                <CreditCard size={20} color="#C8F000" />
              )}
              <View className="flex-1">
                <Text className="font-dmsans-bold text-sm text-move-accent">
                  {t('payment_required.option_drop_in.label', { amount: DROP_IN_AMOUNT_EUR })}
                </Text>
                <Text className="font-dmsans text-xs text-white/60">
                  {t('payment_required.option_drop_in.sub')}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="mt-4 items-center py-3">
            <Text className="font-dmsans text-sm text-move-text-muted">
              {t('common.close')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}
