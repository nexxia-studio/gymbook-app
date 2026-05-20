import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, Pressable, Alert, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, CreditCard, Calendar, Check, Star } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'

interface PlanSpec {
  id: 'drop_in' | 'pack_10' | 'monthly_3' | 'monthly_6' | 'monthly_12'
  price: number
  pricePerSession?: number
  saving?: number
  color: string
  popular?: boolean
}

const PLANS: PlanSpec[] = [
  { id: 'drop_in', price: 20, color: '#6B6861' },
  { id: 'pack_10', price: 170, pricePerSession: 17, color: '#3B82F6' },
  { id: 'monthly_3', price: 120, color: '#8B5CF6' },
  { id: 'monthly_6', price: 110, saving: 10, color: '#F97316', popular: true },
  { id: 'monthly_12', price: 95, saving: 25, color: '#C8F000' },
]

interface ActiveSub {
  id: string
  status: string
  startsAt: string | null
  endsAt: string | null
  nextPaymentAt: string | null
  planCode: string | null
  planName: string
  amount: number
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })
}

interface ActiveCredits {
  planId: string
  planName: string
  creditsTotal: number
  creditsUsed: number
  creditsRemaining: number
  expiresAt: string | null
}

export default function SubscriptionScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const [activeSub, setActiveSub] = useState<ActiveSub | null>(null)
  const [activeCredits, setActiveCredits] = useState<ActiveCredits | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSubscription = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // 1. Mollie recurring subscription (member_subscriptions)
    const { data: sub } = await supabase
      .from('member_subscriptions')
      .select('id, status, starts_at, ends_at, next_payment_at, plan_code, plan_name, amount')
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
        planCode: sub.plan_code,
        planName: sub.plan_name ?? '—',
        amount: typeof sub.amount === 'number' ? sub.amount : parseFloat(sub.amount ?? '0'),
      })
    } else {
      setActiveSub(null)
    }

    // 2. One-time credits (member_credits) — drop_in / pack_10
    const { data: credits } = await supabase
      .from('member_credits')
      .select('plan_id, credits_total, credits_used, credits_remaining, expires_at')
      .eq('member_id', user.id)
      .gt('credits_remaining', 0)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (credits && credits.plan_id) {
      const planName = t(`subscription.plan_${credits.plan_id}_name`)
      setActiveCredits({
        planId: credits.plan_id,
        planName,
        creditsTotal: credits.credits_total,
        creditsUsed: credits.credits_used,
        creditsRemaining: credits.credits_remaining,
        expiresAt: credits.expires_at,
      })
    } else {
      setActiveCredits(null)
    }

    setLoading(false)
  }, [t])

  useEffect(() => { loadSubscription() }, [loadSubscription])

  const [paying, setPaying] = useState(false)

  const handleCancelSubscription = useCallback(() => {
    if (!activeSub) return
    Alert.alert(
      t('subscription.cancel_title'),
      t('subscription.cancel_message', {
        plan: activeSub.planName,
        date: formatDate(activeSub.endsAt),
      }),
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

  // Exclusive business rule:
  //  - active monthly sub  → upsell to longer durations only
  //  - active credits      → upsell to all monthly plans
  //  - nothing active      → show all plans (full cards)
  const POPULAR_PLAN_ID = 'monthly_6'
  const hasActiveSub = activeSub?.status === 'active' || activeSub?.status === 'canceling'
  const hasActiveCredits = (activeCredits?.creditsRemaining ?? 0) > 0

  const upsellPlans: PlanSpec[] = (() => {
    if (hasActiveSub) {
      const code = activeSub?.planCode
      if (code === 'monthly_3') return PLANS.filter((p) => p.id === 'monthly_6' || p.id === 'monthly_12')
      if (code === 'monthly_6') return PLANS.filter((p) => p.id === 'monthly_12')
      return [] // monthly_12 → no further upsell
    }
    if (hasActiveCredits) {
      return PLANS.filter((p) => p.id === 'monthly_3' || p.id === 'monthly_6' || p.id === 'monthly_12')
    }
    return []
  })()

  const showFullPlans = !hasActiveSub && !hasActiveCredits

  const handleSelectPlan = useCallback(async (plan: PlanSpec) => {
    setPaying(true)
    try {
      // Recurring plans (monthly_*) → create-subscription
      if (plan.id === 'monthly_3' || plan.id === 'monthly_6' || plan.id === 'monthly_12') {
        const { data, error } = await supabase.functions.invoke('create-subscription', {
          body: { plan_id: plan.id },
        })
        if (error || !data) {
          console.error('[Subscription] error:', error, data)
          Alert.alert(t('subscription.payment_error_title'), t('subscription.payment_error_message'))
          return
        }

        if (data.type === 'first_payment' && data.checkout_url) {
          console.log('[Subscription] first payment URL:', data.checkout_url)
          await Linking.openURL(data.checkout_url)
        } else if (data.type === 'subscription_created') {
          Alert.alert(
            t('subscription.activated_title'),
            t('subscription.activated_message', {
              plan: data.plan_name ?? '',
              date: data.next_payment_at ? new Date(data.next_payment_at).toLocaleDateString('fr-BE') : '—',
            }),
          )
        }
        return
      }

      // One-time plans (drop_in, pack_10) → create-payment
      if (plan.id === 'drop_in' || plan.id === 'pack_10') {
        const { data, error } = await supabase.functions.invoke('create-payment', {
          body: { plan_id: plan.id },
        })
        if (error || !data?.checkout_url) {
          console.error('[Payment] error:', error, data)
          Alert.alert(t('subscription.payment_error_title'), t('subscription.payment_error_message'))
          return
        }
        console.log('[Payment] checkout URL:', data.checkout_url)
        await Linking.openURL(data.checkout_url)
        return
      }

    } catch (err) {
      console.error('[Payment] threw:', err)
      Alert.alert(t('subscription.payment_error_title'), t('subscription.payment_error_message'))
    } finally {
      setPaying(false)
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
          {t('subscription.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView className="flex-1 bg-move-bg" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        {/* One-time credits card (drop_in / pack_10) */}
        {!loading && activeCredits && (
          <View className="rounded-2xl border-2 border-move-accent bg-move-card p-5">
            <View className="mb-3 flex-row items-center justify-between">
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#111111' }}>
                {activeCredits.planName.toUpperCase()}
              </Text>
              <View className="rounded-full bg-green-100 px-3 py-1">
                <Text className="font-dmsans-bold text-[11px] text-green-600">
                  {t('subscription.active_badge')}
                </Text>
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

        {/* Recurring subscription card */}
        {loading ? null : activeSub ? (
          <View className={`rounded-2xl border-2 ${activeSub.status === 'canceling' ? 'border-orange-400' : 'border-move-accent'} bg-move-card p-5`}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#111111' }}>
                {activeSub.planName.toUpperCase()}
              </Text>
              {activeSub.status === 'canceling' ? (
                <View className="rounded-full bg-orange-100 px-3 py-1">
                  <Text className="font-dmsans-bold text-[11px] text-orange-600">
                    {t('subscription.canceling_badge')}
                  </Text>
                </View>
              ) : (
                <View className="rounded-full bg-green-100 px-3 py-1">
                  <Text className="font-dmsans-bold text-[11px] text-green-600">
                    {t('subscription.active_badge')}
                  </Text>
                </View>
              )}
            </View>

            <Text className="font-dmsans-bold text-base text-move-dark">
              {activeSub.amount}€ / {t('subscription.plan_monthly_3_unit')}
            </Text>

            {activeSub.startsAt && (
              <View className="mt-3">
                <Text className="font-dmsans text-xs uppercase tracking-wider text-move-text-muted">
                  {t('subscription.since')}
                </Text>
                <Text className="font-dmsans-medium text-sm text-move-dark">
                  {formatDate(activeSub.startsAt)}
                </Text>
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

            {/* Cancel button — only when not already canceling */}
            {activeSub.status === 'active' && (
              <Pressable
                onPress={handleCancelSubscription}
                className="mt-4 items-center rounded-lg border border-move-border py-2.5"
              >
                <Text className="font-dmsans text-[13px] text-move-text-muted">
                  {t('subscription.cancel_action')}
                </Text>
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

        {/* === UPSELL SECTION (compact pricing cards) === */}
        {upsellPlans.length > 0 && (
          <>
            <Text className="mt-2 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
              {hasActiveSub ? t('subscription.upsell_switch_title') : t('subscription.upsell_upgrade_title')}
            </Text>
            {upsellPlans.map((plan) => {
              const isPopular = plan.id === POPULAR_PLAN_ID
              const planName = t(`subscription.plan_${plan.id}_name`)
              const planDescription = t(`subscription.plan_${plan.id}_description`)
              return (
                <Pressable
                  key={plan.id}
                  onPress={() => handleSelectPlan(plan)}
                  disabled={paying}
                  className={`overflow-hidden rounded-xl border ${isPopular ? 'border-2 border-move-accent bg-move-dark' : 'border-move-border bg-move-card'} ${paying ? 'opacity-60' : ''}`}
                >
                  {isPopular && (
                    <View className="items-center bg-move-accent py-1">
                      <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 10, color: '#111111', letterSpacing: 1 }}>
                        {t('subscription.most_popular')}
                      </Text>
                    </View>
                  )}
                  <View className="flex-row items-center justify-between p-4">
                    <View className="flex-1 pr-3">
                      <Text
                        style={{
                          fontFamily: 'BarlowCondensed_900Black',
                          fontSize: 16,
                          color: isPopular ? '#FFFFFF' : '#111111',
                          letterSpacing: 1,
                        }}
                      >
                        {planName.toUpperCase()}
                      </Text>
                      <Text
                        className="mt-0.5 font-dmsans text-xs"
                        style={{ color: isPopular ? '#9CA3AF' : '#9A9890' }}
                      >
                        {planDescription}
                      </Text>
                    </View>
                    <View className="flex-row items-end gap-2">
                      <View className="items-end">
                        <View className="flex-row items-baseline">
                          <Text
                            style={{
                              fontFamily: 'DMSans_700Bold',
                              fontSize: 20,
                              color: isPopular ? '#C8F000' : '#111111',
                            }}
                          >
                            {plan.price}€
                          </Text>
                          <Text
                            className="font-dmsans text-[11px]"
                            style={{ color: '#9CA3AF', marginLeft: 2 }}
                          >
                            /mois
                          </Text>
                        </View>
                      </View>
                      <View
                        className={`rounded-md px-3 py-1.5 ${isPopular ? 'bg-move-accent' : 'bg-move-dark'}`}
                      >
                        <Text
                          style={{
                            fontFamily: 'DMSans_700Bold',
                            fontSize: 12,
                            color: isPopular ? '#111111' : '#C8F000',
                          }}
                        >
                          {t('subscription.choose')}
                        </Text>
                      </View>
                    </View>
                  </View>
                </Pressable>
              )
            })}
          </>
        )}

        {/* === FULL PLANS SECTION (no active sub / no credits) === */}
        {showFullPlans && (
          <>
            <Text className="mt-2 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
              {t('subscription.available_plans')}
            </Text>

            {PLANS.map((plan) => {
              const planName = t(`subscription.plan_${plan.id}_name`)
              const planDescription = t(`subscription.plan_${plan.id}_description`)
              const planUnit = t(`subscription.plan_${plan.id}_unit`)

              return (
                <View
                  key={plan.id}
                  className={`overflow-hidden rounded-2xl bg-move-card ${plan.popular ? 'border-2 border-orange-500' : 'border border-move-border'}`}
                >
                  {plan.popular && (
                    <View className="flex-row items-center justify-center gap-1.5 bg-orange-50 py-1.5">
                      <Star size={12} color="#F97316" fill="#F97316" />
                      <Text className="font-dmsans-bold text-[11px] text-orange-600">
                        {t('subscription.popular')}
                      </Text>
                    </View>
                  )}

                  <View className="flex-row items-center justify-between p-4" style={{ backgroundColor: plan.color }}>
                    <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#FFFFFF' }}>
                      {planName}
                    </Text>
                    <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 20, color: '#FFFFFF' }}>
                      {plan.price}€
                      <Text style={{ fontSize: 13 }}>/{planUnit}</Text>
                    </Text>
                  </View>

                  <View className="gap-2 p-4">
                    <Text className="font-dmsans text-sm text-move-text-secondary">
                      {planDescription}
                    </Text>

                    {plan.pricePerSession && (
                      <Text className="font-dmsans text-xs text-move-text-muted">
                        {t('subscription.per_session', { price: plan.pricePerSession })}
                      </Text>
                    )}

                    {plan.saving && (
                      <View className="self-start rounded-md bg-green-50 px-2 py-1">
                        <Text className="font-dmsans-bold text-[11px] text-green-600">
                          {t('subscription.saving', { amount: plan.saving })}
                        </Text>
                      </View>
                    )}

                    <Pressable
                      onPress={() => handleSelectPlan(plan)}
                      disabled={paying}
                      className={`mt-2 flex-row items-center justify-center gap-2 rounded-xl bg-move-dark py-3 ${paying ? 'opacity-60' : ''}`}
                    >
                      <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#C8F000' }}>
                        {t('subscription.select')}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
