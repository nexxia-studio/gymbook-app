import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, CreditCard, Calendar, Star } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores/useAuthStore'
import { useGymPlans, type GymPlan } from '../../hooks/useGymPlans'
import {
  formatPrice,
  mapPaymentError,
  openCheckout,
  startOneTimeCheckout,
  startSubscriptionCheckout,
} from '../../lib/payments'

interface ActiveSub {
  id: string
  status: string
  startsAt: string | null
  endsAt: string | null
  nextPaymentAt: string | null
  planName: string
  amount: number
}

interface ActiveCredits {
  planId: string
  creditsTotal: number
  creditsUsed: number
  creditsRemaining: number
  expiresAt: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })
}

function PlanCard({
  plan,
  onSelect,
  paying,
  disabled,
}: {
  plan: GymPlan
  onSelect: (plan: GymPlan) => void
  paying: boolean
  disabled: boolean
}) {
  const { t } = useTranslation()
  const isRecurring = plan.billingType !== 'one_time'

  return (
    <View
      className={`overflow-hidden rounded-2xl bg-move-card ${plan.isPopular ? 'border-2 border-orange-500' : 'border border-move-border'}`}
    >
      {plan.isPopular && (
        <View className="flex-row items-center justify-center gap-1.5 bg-orange-50 py-1.5">
          <Star size={12} color="#F97316" fill="#F97316" />
          <Text className="font-dmsans-bold text-[11px] text-orange-600">{t('subscription.popular')}</Text>
        </View>
      )}

      <View className="flex-row items-center justify-between bg-move-dark p-4">
        <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#FFFFFF' }}>{plan.name}</Text>
        <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 20, color: '#FFFFFF' }}>
          {formatPrice(plan.priceCents, plan.currency)}
          {isRecurring && <Text style={{ fontSize: 13 }}>{t('subscription.per_month')}</Text>}
        </Text>
      </View>

      <View className="gap-2 p-4">
        {plan.description ? (
          <Text className="font-dmsans text-sm text-move-text-secondary">{plan.description}</Text>
        ) : null}

        {!isRecurring && plan.creditCount ? (
          <Text className="font-dmsans text-xs text-move-text-muted">
            {t('subscription.sessions_count', { count: plan.creditCount })}
          </Text>
        ) : null}

        {isRecurring && plan.durationMonths ? (
          <Text className="font-dmsans text-xs text-move-text-muted">
            {t('subscription.commitment', { count: plan.durationMonths })}
          </Text>
        ) : null}

        <Pressable
          onPress={() => onSelect(plan)}
          disabled={disabled}
          className={`mt-2 flex-row items-center justify-center gap-2 rounded-xl bg-move-dark py-3 ${disabled ? 'opacity-60' : ''}`}
        >
          {paying ? (
            <ActivityIndicator color="#C8F000" />
          ) : (
            <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#C8F000' }}>
              {t('subscription.select')}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  )
}

export default function SubscriptionScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const gymId = useAuthStore((s) => s.gym_id)
  const userId = useAuthStore((s) => s.user?.id)
  const { oneTime, recurring, loading: plansLoading, error: plansError, refetch } = useGymPlans()

  const [activeSub, setActiveSub] = useState<ActiveSub | null>(null)
  const [activeCredits, setActiveCredits] = useState<ActiveCredits | null>(null)
  const [loading, setLoading] = useState(true)
  const [payingId, setPayingId] = useState<string | null>(null)

  const loadSubscription = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // 1. Abonnement récurrent (member_subscriptions)
    const { data: sub } = await supabase
      .from('member_subscriptions')
      .select('id, status, starts_at, ends_at, next_payment_at, plan_name, amount')
      .eq('member_id', user.id)
      .in('status', ['active', 'canceling'])
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (sub) {
      setActiveSub({
        id: sub.id,
        status: sub.status ?? 'active',
        startsAt: sub.starts_at,
        endsAt: sub.ends_at,
        nextPaymentAt: sub.next_payment_at,
        planName: sub.plan_name ?? '—',
        amount: typeof sub.amount === 'number' ? sub.amount : parseFloat(sub.amount ?? '0'),
      })
    } else {
      setActiveSub(null)
    }

    // 2. Crédits à l'unité (member_credits)
    const { data: credits } = await supabase
      .from('member_credits')
      .select('plan_id, credits_total, credits_used, credits_remaining, expires_at')
      .eq('member_id', user.id)
      .gt('credits_remaining', 0)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (credits && credits.plan_id) {
      setActiveCredits({
        planId: credits.plan_id,
        creditsTotal: credits.credits_total,
        creditsUsed: credits.credits_used,
        creditsRemaining: credits.credits_remaining,
        expiresAt: credits.expires_at,
      })
    } else {
      setActiveCredits(null)
    }

    setLoading(false)
  }, [])

  useEffect(() => { loadSubscription() }, [loadSubscription])

  const handleCancelSubscription = useCallback(() => {
    if (!activeSub) return
    Alert.alert(
      t('subscription.cancel_title'),
      t('subscription.cancel_message', { plan: activeSub.planName, date: formatDate(activeSub.endsAt) }),
      [
        { text: t('subscription.cancel_keep'), style: 'cancel' },
        {
          text: t('subscription.cancel_confirm'),
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.functions.invoke('cancel-subscription', {
              body: { subscription_id: activeSub.id },
            })
            if (error) {
              console.error('[cancel-subscription] error:', error)
              Alert.alert(t('subscription.cancel_error_title'), t('subscription.cancel_error_message'))
              return
            }
            Alert.alert(
              t('subscription.canceled_title'),
              t('subscription.canceled_message', { date: formatDate(activeSub.endsAt) }),
            )
            loadSubscription()
          },
        },
      ],
    )
  }, [activeSub, loadSubscription, t])

  const handleSelectPlan = useCallback(async (plan: GymPlan) => {
    if (payingId) return // anti double-tap global
    if (!gymId) {
      Alert.alert(t('payments.error_title'), t('payments.errors.MISSING_FIELDS'))
      return
    }
    setPayingId(plan.id)
    try {
      const result = plan.billingType === 'one_time'
        ? await startOneTimeCheckout(plan.id, { gymId })
        : userId
          ? await startSubscriptionCheckout(plan.id, { gymId, memberId: userId })
          : ({ ok: false, code: 'UNAUTHORIZED' } as const)

      if (result.ok) {
        await openCheckout(result.checkoutUrl)
        return
      }
      const info = mapPaymentError(result.code)
      if (info.refetch) refetch()
      Alert.alert(t('payments.error_title'), t(info.messageKey))
    } catch (err) {
      console.error('[Payment] threw:', err)
      Alert.alert(t('payments.error_title'), t('payments.errors.FALLBACK'))
    } finally {
      setPayingId(null)
    }
  }, [payingId, gymId, userId, refetch, t])

  // Règle d'exclusivité :
  //  - abonnement actif → upsell abonnements
  //  - crédits actifs   → upsell abonnements
  //  - rien d'actif     → tout (à l'unité + abonnements)
  const hasActiveSub = activeSub?.status === 'active' || activeSub?.status === 'canceling'
  const hasActiveCredits = (activeCredits?.creditsRemaining ?? 0) > 0
  const showFullPlans = !hasActiveSub && !hasActiveCredits

  const activeCreditsName = activeCredits
    ? (oneTime.find((p) => p.id === activeCredits.planId)?.name ?? t('subscription.credits_generic_name'))
    : ''

  const renderPlans = (plans: GymPlan[]) =>
    plans.map((plan) => (
      <PlanCard
        key={plan.id}
        plan={plan}
        onSelect={handleSelectPlan}
        paying={payingId === plan.id}
        disabled={payingId !== null}
      />
    ))

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-6 pt-3">
        <Pressable onPress={() => router.replace('/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#FFFFFF', letterSpacing: 2 }}>
          {t('subscription.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView className="flex-1 bg-move-bg" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        {/* Carte crédits à l'unité */}
        {!loading && activeCredits && (
          <View className="rounded-2xl border-2 border-move-accent bg-move-card p-5">
            <View className="mb-3 flex-row items-center justify-between">
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#111111' }}>
                {activeCreditsName.toUpperCase()}
              </Text>
              <View className="rounded-full bg-green-100 px-3 py-1">
                <Text className="font-dmsans-bold text-[11px] text-green-600">{t('subscription.active_badge')}</Text>
              </View>
            </View>
            <Text className="font-dmsans-bold text-base text-move-dark">
              {t('subscription.credits_remaining', { count: activeCredits.creditsRemaining })}
            </Text>
            <Text className="mt-1 font-dmsans text-sm text-move-text-secondary">
              {t('subscription.credits_usage', { used: activeCredits.creditsUsed, total: activeCredits.creditsTotal })}
            </Text>
            {activeCredits.expiresAt && (
              <View className="mt-3 flex-row items-center gap-1.5">
                <Calendar size={14} color="#6B6861" />
                <Text className="font-dmsans text-xs text-move-text-secondary">
                  {t('subscription.valid_until', { date: formatDate(activeCredits.expiresAt) })}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Carte abonnement récurrent */}
        {loading ? null : activeSub ? (
          <View className={`rounded-2xl border-2 ${activeSub.status === 'canceling' ? 'border-orange-400' : 'border-move-accent'} bg-move-card p-5`}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#111111' }}>
                {activeSub.planName.toUpperCase()}
              </Text>
              {activeSub.status === 'canceling' ? (
                <View className="rounded-full bg-orange-100 px-3 py-1">
                  <Text className="font-dmsans-bold text-[11px] text-orange-600">{t('subscription.canceling_badge')}</Text>
                </View>
              ) : (
                <View className="rounded-full bg-green-100 px-3 py-1">
                  <Text className="font-dmsans-bold text-[11px] text-green-600">{t('subscription.active_badge')}</Text>
                </View>
              )}
            </View>

            <Text className="font-dmsans-bold text-base text-move-dark">
              {formatPrice(Math.round(activeSub.amount * 100), 'EUR')}{t('subscription.per_month')}
            </Text>

            {activeSub.startsAt && (
              <View className="mt-3">
                <Text className="font-dmsans text-xs uppercase tracking-wider text-move-text-muted">
                  {t('subscription.since')}
                </Text>
                <Text className="font-dmsans-medium text-sm text-move-dark">{formatDate(activeSub.startsAt)}</Text>
              </View>
            )}

            {activeSub.status === 'active' && activeSub.nextPaymentAt && (
              <View className="mt-3 flex-row items-center gap-1.5">
                <Calendar size={14} color="#6B6861" />
                <Text className="font-dmsans text-xs text-move-text-secondary">
                  {t('subscription.next_billing', { date: formatDate(activeSub.nextPaymentAt) })}
                </Text>
              </View>
            )}

            {activeSub.endsAt && (
              <View className="mt-2 flex-row items-center gap-1.5">
                <Calendar size={14} color="#6B6861" />
                <Text className="font-dmsans text-xs text-move-text-secondary">
                  {t('subscription.ends_on', { date: formatDate(activeSub.endsAt) })}
                </Text>
              </View>
            )}

            {activeSub.status === 'active' && (
              <Pressable onPress={handleCancelSubscription} className="mt-4 items-center rounded-lg border border-move-border py-2.5">
                <Text className="font-dmsans text-[13px] text-move-text-muted">{t('subscription.cancel_action')}</Text>
              </Pressable>
            )}
          </View>
        ) : activeCredits ? null : (
          <View className="items-center rounded-2xl bg-move-card p-8">
            <CreditCard size={48} color="#9A9890" />
            <Text className="mt-3 font-dmsans-bold text-base text-move-dark">
              {t('subscription.no_subscription_title')}
            </Text>
            <Text className="mt-1 font-dmsans text-sm text-move-text-muted">
              {t('subscription.no_subscription_subtitle')}
            </Text>
          </View>
        )}

        {/* === FORMULES (source : gym_plans) === */}
        {plansLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color="#111111" />
          </View>
        ) : plansError ? (
          <View className="items-center rounded-2xl bg-move-card p-6">
            <Text className="font-dmsans-bold text-sm text-move-dark">{t('subscription.plans_error')}</Text>
            <Pressable onPress={refetch} className="mt-3 rounded-xl bg-move-dark px-5 py-2.5">
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 13, color: '#C8F000' }}>
                {t('common.retry')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* À l'unité — uniquement si rien d'actif */}
            {showFullPlans && oneTime.length > 0 && (
              <>
                <Text className="mt-2 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
                  {t('subscription.section_one_time')}
                </Text>
                {renderPlans(oneTime)}
              </>
            )}

            {/* Abonnements */}
            {recurring.length > 0 && (
              <>
                <Text className="mt-2 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
                  {showFullPlans
                    ? t('subscription.section_recurring')
                    : hasActiveSub
                      ? t('subscription.upsell_switch_title')
                      : t('subscription.upsell_upgrade_title')}
                </Text>
                {renderPlans(recurring)}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
