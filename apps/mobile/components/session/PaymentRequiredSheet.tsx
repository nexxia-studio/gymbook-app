// GYM-63 — Bottom sheet quand un membre tente de réserver sans abonnement ni crédit.
// GYM-76 — Migré sur gym_plans : plus de prix/codes en dur, create-payment v24 (plan_id UUID).
// L'auto-retry après paiement drop-in est géré par app/payment/success.tsx (GYM-63b)
// via le deep link dopamine://payment/success?slot_id=...&source=drop_in.
import { useState, useEffect, useRef } from 'react'
import { View, Text, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { CreditCard, Calendar, Ticket } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'
import { useBookingStore } from '../../stores/useBookingStore'
import { useGymPlans } from '../../hooks/useGymPlans'
import {
  formatPrice,
  mapPaymentError,
  openCheckout,
  startOneTimeCheckout,
  buildRedirectUrl,
} from '../../lib/payments'

interface PaymentRequiredSheetProps {
  visible: boolean
  slotId: string | null
  onClose: () => void
}

export function PaymentRequiredSheet({ visible, slotId, onClose }: PaymentRequiredSheetProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const gymId = useAuthStore((s) => s.gym_id)
  const memberId = useAuthStore((s) => s.user?.id)
  const { createBooking } = useBookingStore()
  const { oneTime, recurring, refetch } = useGymPlans()
  const [isLoadingDropIn, setIsLoadingDropIn] = useState(false)
  const [dropInError, setDropInError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Plans dérivés de gym_plans (fini les prix en dur)
  const dropInPlan = oneTime
    .filter((p) => p.creditCount === 1)
    .sort((a, b) => a.priceCents - b.priceCents)[0] ?? null
  const packPlan = oneTime
    .filter((p) => (p.creditCount ?? 0) > 1)
    .sort((a, b) => a.priceCents - b.priceCents)[0] ?? null
  const cheapestRecurring = recurring.length
    ? [...recurring].sort((a, b) => a.priceCents - b.priceCents)[0]
    : null

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const goToPayments = () => {
    onClose()
    router.push('/profile/payments')
  }

  const handleDropIn = async () => {
    if (!gymId || !slotId || !memberId) {
      Alert.alert(t('common.error'), t('payment_required.errors.no_gym'))
      return
    }
    if (!dropInPlan) {
      Alert.alert(t('common.error'), t('payment_required.errors.no_plan'))
      return
    }
    setIsLoadingDropIn(true)
    setDropInError(null)
    try {
      const result = await startOneTimeCheckout(dropInPlan.id, {
        gymId,
        redirectUrl: buildRedirectUrl('drop_in'),
      })

      if (!result.ok) {
        const info = mapPaymentError(result.code)
        if (info.refetch) refetch()
        setIsLoadingDropIn(false)
        Alert.alert(t('common.error'), t(info.messageKey))
        return
      }

      let pollAttempts = 0
      pollRef.current = setInterval(async () => {
        pollAttempts++
        const { data: credit } = await supabase
          .from('member_credits')
          .select('credits_remaining')
          .eq('member_id', memberId)
          .eq('gym_id', gymId)
          .maybeSingle()

        if (credit && credit.credits_remaining > 0) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setIsLoadingDropIn(false)
          await createBooking(slotId)
          onClose()
          return
        }
        if (pollAttempts >= 30) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setIsLoadingDropIn(false)
          setDropInError(t('payment_required.errors.not_confirmed'))
        }
      }, 2000)

      openCheckout(result.checkoutUrl)
    } catch (e) {
      console.error('[PaymentRequiredSheet] drop-in uncaught:', e)
      Alert.alert(t('common.error'), t('payments.errors.FALLBACK'))
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
                  {cheapestRecurring
                    ? t('payment_required.option_subscribe.sub_from', {
                        price: formatPrice(cheapestRecurring.priceCents, cheapestRecurring.currency),
                      })
                    : t('payment_required.option_subscribe.sub_generic')}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 2 — Carnet de séances */}
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
                  {packPlan
                    ? t('payment_required.option_pack.sub_priced', {
                        price: formatPrice(packPlan.priceCents, packPlan.currency),
                        count: packPlan.creditCount ?? 0,
                      })
                    : t('payment_required.option_pack.sub_generic')}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 3 — Paiement à la séance (drop-in) */}
            <TouchableOpacity
              onPress={handleDropIn}
              activeOpacity={0.8}
              disabled={isLoadingDropIn || !dropInPlan}
              className={`flex-row items-center gap-3 rounded-2xl bg-move-dark px-4 py-4 ${isLoadingDropIn || !dropInPlan ? 'opacity-60' : ''}`}
            >
              {isLoadingDropIn ? (
                <ActivityIndicator color="#C8F000" />
              ) : (
                <CreditCard size={20} color="#C8F000" />
              )}
              <View className="flex-1">
                <Text className="font-dmsans-bold text-sm text-move-accent">
                  {dropInPlan
                    ? t('payment_required.option_drop_in.label_priced', {
                        price: formatPrice(dropInPlan.priceCents, dropInPlan.currency),
                      })
                    : t('payment_required.option_drop_in.label_generic')}
                </Text>
                <Text className="font-dmsans text-xs text-white/60">
                  {t('payment_required.option_drop_in.sub')}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {dropInError && (
            <Text className="mt-3 text-center font-dmsans text-sm text-red-500">{dropInError}</Text>
          )}

          <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="mt-4 items-center py-3">
            <Text className="font-dmsans text-sm text-move-text-muted">{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}
