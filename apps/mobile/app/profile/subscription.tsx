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
  creditsRemaining: number | null
  planName: string
  pricePerUnit: number
  unit: string
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function SubscriptionScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const [activeSub, setActiveSub] = useState<ActiveSub | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: sub } = await supabase
        .from('member_subscriptions')
        .select('id, status, starts_at, ends_at, credits_remaining, plan_id, plan:gym_plans(name, price_cents, billing_type, credit_count)')
        .eq('member_id', user.id)
        .eq('status', 'active')
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (sub) {
        const plan = sub.plan as unknown as { name?: string; price_cents?: number; billing_type?: string; credit_count?: number } | null
        const cents = plan?.price_cents ?? 0
        const billing = plan?.billing_type ?? 'one_time'
        const unit = billing === 'recurring' ? t('subscription.plan_monthly_3_unit') : (plan?.credit_count ? t('subscription.plan_pack_10_unit') : t('subscription.plan_drop_in_unit'))
        setActiveSub({
          id: sub.id,
          status: sub.status,
          startsAt: sub.starts_at,
          endsAt: sub.ends_at,
          creditsRemaining: sub.credits_remaining,
          planName: plan?.name ?? '—',
          pricePerUnit: cents / 100,
          unit,
        })
      }
      setLoading(false)
    })()
  }, [t])

  const handleSelectPlan = useCallback((plan: PlanSpec) => {
    Alert.alert(
      t('subscription.contact_title', { plan: t(`subscription.plan_${plan.id}_name`) }),
      t('subscription.contact_message', {
        price: plan.price,
        unit: t(`subscription.plan_${plan.id}_unit`),
      }),
      [
        { text: t('subscription.contact_close'), style: 'cancel' },
        { text: t('subscription.contact_cta'), onPress: () => Linking.openURL('mailto:contact@dopamineclub.be') },
      ],
    )
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
        {/* Active sub or empty state */}
        {loading ? null : activeSub ? (
          <View className="rounded-2xl border-2 border-move-accent bg-move-card p-5">
            <View className="mb-3 self-start rounded-full bg-green-100 px-3 py-1">
              <Text className="font-dmsans-bold text-[11px] text-green-600">
                {t('subscription.active_badge')}
              </Text>
            </View>
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#111111' }}>
              {activeSub.planName.toUpperCase()}
            </Text>
            <Text className="mt-1 font-dmsans-bold text-base text-move-dark">
              {activeSub.pricePerUnit}€ / {activeSub.unit}
            </Text>

            {activeSub.creditsRemaining !== null && (
              <Text className="mt-2 font-dmsans text-sm text-move-text-secondary">
                {t('subscription.credits_remaining', { count: activeSub.creditsRemaining })}
              </Text>
            )}

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

            {activeSub.endsAt && (
              <View className="mt-3 flex-row items-center gap-1.5">
                <Calendar size={14} color="#6B6861" />
                <Text className="font-dmsans text-xs text-move-text-secondary">
                  {t('subscription.next_billing', { date: formatDate(activeSub.endsAt) })}
                </Text>
              </View>
            )}
          </View>
        ) : (
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

        {/* Plans */}
        <Text className="mt-2 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
          {t('subscription.available_plans')}
        </Text>

        {PLANS.map((plan) => {
          const planName = t(`subscription.plan_${plan.id}_name`)
          const planDescription = t(`subscription.plan_${plan.id}_description`)
          const planUnit = t(`subscription.plan_${plan.id}_unit`)
          const isCurrent = activeSub?.planName === planName

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
                  disabled={isCurrent}
                  className={`mt-2 flex-row items-center justify-center gap-2 rounded-xl py-3 ${isCurrent ? 'bg-green-100' : 'bg-move-dark'}`}
                >
                  {isCurrent && <Check size={16} color="#16A34A" />}
                  <Text
                    style={{
                      fontFamily: 'DMSans_700Bold',
                      fontSize: 14,
                      color: isCurrent ? '#16A34A' : '#C8F000',
                    }}
                  >
                    {isCurrent ? t('subscription.current_plan') : t('subscription.select')}
                  </Text>
                </Pressable>
              </View>
            </View>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}
