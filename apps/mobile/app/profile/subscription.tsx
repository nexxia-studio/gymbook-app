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
import {
  DISPLAYABLE_SUBSCRIPTION_STATUSES,
  isSubscriptionActive,
  isSubscriptionCompleted,
} from '../../lib/subscription'

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

// GYM-113 — engagement ferme (miroir client du prédicat serveur _shared/subscription-engagement).
function isEngaged(status: string, endsAt: string | null): boolean {
  return isSubscriptionActive(status) && !!endsAt && new Date(endsAt).getTime() > Date.now()
}
// Terme d'engagement en heure locale gym (Europe/Brussels), format long fr-BE.
function formatEngagedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-BE', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels',
  })
}
// Lit le `code` d'erreur d'une réponse Edge Function (JSON dans error.context).
async function readErrorCode(data: { code?: string } | null, error: unknown): Promise<string | undefined> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try { const b = await ctx.json(); if (b?.code) return b.code as string } catch { /* non-JSON */ }
  }
  return data?.code
}

function PlanCard({
  plan,
  onSelect,
  paying,
  disabled,
  unavailableReason,
}: {
  plan: GymPlan
  onSelect: (plan: GymPlan) => void
  paying: boolean
  disabled: boolean
  unavailableReason?: string | null
}) {
  const { t } = useTranslation()
  const isRecurring = plan.billingType !== 'one_time'
  // GYM-94 — indisponible pour raison métier (abonnement actif) : bouton désactivé + libellé explicite.
  const isBlocked = !!unavailableReason
  const isDisabled = disabled || isBlocked

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
          disabled={isDisabled}
          className={`mt-2 flex-row items-center justify-center gap-2 rounded-xl bg-move-dark py-3 ${isDisabled ? 'opacity-60' : ''}`}
        >
          {paying ? (
            <ActivityIndicator color="#C8F000" />
          ) : (
            <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#C8F000' }}>
              {unavailableReason ?? t('subscription.select')}
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

    // 1. Abonnement récurrent (member_subscriptions). On charge aussi 'completed' (GYM-151)
    //    pour afficher l'état « Terminé » — il ne donne PAS accès (cf. hasActiveSub).
    const { data: sub } = await supabase
      .from('member_subscriptions')
      .select('id, status, starts_at, ends_at, next_payment_at, plan_name, amount')
      .eq('member_id', user.id)
      .in('status', DISPLAYABLE_SUBSCRIPTION_STATUSES)
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

    // 2. Crédits à l'unité (member_credits) — GYM-94 : agrégat multi-lignes.
    //    Solde = SOMME des lignes dispo (fin du limit 1) ; nom/expiration = ligne la plus récente.
    const { data: creditRows } = await supabase
      .from('member_credits')
      .select('plan_id, credits_total, credits_used, credits_remaining, expires_at')
      .eq('member_id', user.id)
      .gt('credits_remaining', 0)
      .order('updated_at', { ascending: false })

    if (creditRows && creditRows.length > 0) {
      const first = creditRows[0]
      setActiveCredits({
        planId: first.plan_id,
        creditsTotal: creditRows.reduce((s, r) => s + (r.credits_total ?? 0), 0),
        creditsUsed: creditRows.reduce((s, r) => s + (r.credits_used ?? 0), 0),
        creditsRemaining: creditRows.reduce((s, r) => s + (r.credits_remaining ?? 0), 0),
        expiresAt: first.expires_at,
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
            const { data, error } = await supabase.functions.invoke('cancel-subscription', {
              body: { subscription_id: activeSub.id },
            })
            if (error || (data && (data as { error?: boolean }).error)) {
              const code = await readErrorCode(data as { code?: string } | null, error)
              if (code === 'SUBSCRIPTION_ENGAGED') {
                // Engagement ferme : pas de résiliation anticipée. Rafraîchit → UI "Engagé jusqu'au".
                Alert.alert(
                  t('subscription.engaged_title'),
                  t('subscription.engaged_alert', { date: formatEngagedDate(activeSub.endsAt ?? new Date().toISOString()) }),
                )
                loadSubscription()
                return
              }
              if (code === 'MOLLIE_CANCEL_FAILED') {
                // SURTOUT PAS un état "résilié" : l'abonnement reste actif.
                Alert.alert(t('subscription.cancel_error_title'), t('subscription.mollie_failed_message'))
                return
              }
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
        // GYM-96 — NAVIGATION PROPRIÉTAIRE (one-time) : on monte l'écran de vérification
        // AVANT d'ouvrir le navigateur, pour que son poll + son filet AppState soient armés
        // quel que soit le mode de retour (deep link, fermeture manuelle du navigateur, retour
        // app). Le deep link n'est plus qu'un raccourci. On passe le payment_id Mollie (connu
        // ici) ; l'écran poll `payments` par mollie_payment_id à défaut du row id du deep link.
        // Récurrent : pas de ligne `payments` à poller → on garde le comportement existant.
        if (plan.billingType === 'one_time' && result.paymentId) {
          router.push({ pathname: '/payment/success', params: { mollie_id: result.paymentId, returnTo: '/profile/subscription' } })
        }
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
  }, [payingId, gymId, userId, refetch, t, router])

  // GYM-94 — règles d'achat :
  //  - one_time (cumul LIBRE) : toujours achetable, SAUF abonnement actif (accès illimité).
  //  - recurring : achetable SAUF abonnement déjà actif (→ upsell futur). Les crédits ne bloquent RIEN.
  // 'completed' est chargé pour l'affichage mais N'EST PAS actif → n'ouvre aucun droit et
  // ne bloque aucun achat (GYM-151). Seuls active/canceling comptent comme abonnement actif.
  const hasActiveSub = isSubscriptionActive(activeSub?.status)

  const activeCreditsName = activeCredits
    ? (oneTime.find((p) => p.id === activeCredits.planId)?.name ?? t('subscription.credits_generic_name'))
    : ''

  // Raison d'indisponibilité d'un plan (null = achetable).
  const unavailableReason = (plan: GymPlan): string | null => {
    if (!hasActiveSub) return null
    if (plan.billingType === 'one_time') return t('subscription.unavailable_unlimited_active')
    return plan.name === activeSub?.planName
      ? t('subscription.current_subscription')
      : t('subscription.upsell_unavailable')
  }

  const renderPlans = (plans: GymPlan[]) =>
    plans.map((plan) => (
      <PlanCard
        key={plan.id}
        plan={plan}
        onSelect={handleSelectPlan}
        paying={payingId === plan.id}
        disabled={payingId !== null}
        unavailableReason={unavailableReason(plan)}
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
        {loading ? null : activeSub && isSubscriptionActive(activeSub.status) ? (
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
              isEngaged(activeSub.status, activeSub.endsAt) ? (
                /* GYM-113 — engagement ferme : bouton Résilier MASQUÉ, on affiche le terme. */
                <View className="mt-4 items-center rounded-lg border border-amber-300 bg-amber-50 py-2.5">
                  <Text className="font-dmsans-medium text-[13px] text-amber-800">
                    {t('subscription.engaged_until', { date: formatEngagedDate(activeSub.endsAt as string) })}
                  </Text>
                </View>
              ) : (
                <Pressable onPress={handleCancelSubscription} className="mt-4 items-center rounded-lg border border-move-border py-2.5">
                  <Text className="font-dmsans text-[13px] text-move-text-muted">{t('subscription.cancel_action')}</Text>
                </Pressable>
              )
            )}
          </View>
        ) : activeSub && isSubscriptionCompleted(activeSub.status) ? (
          /* GYM-151 — engagement arrivé à son terme : état NEUTRE/positif (pas une erreur).
             N'ouvre aucun droit ; les formules ci-dessous restent achetables (réabonnement). */
          <View className="rounded-2xl border-2 border-move-border bg-move-card p-5">
            <View className="mb-3 flex-row items-center justify-between">
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#111111' }}>
                {activeSub.planName.toUpperCase()}
              </Text>
              <View className="rounded-full bg-move-border px-3 py-1">
                <Text className="font-dmsans-bold text-[11px] text-move-text-secondary">
                  {t('subscription.completed_badge')}
                </Text>
              </View>
            </View>
            {activeSub.endsAt && (
              <View className="flex-row items-center gap-1.5">
                <Calendar size={14} color="#6B6861" />
                <Text className="font-dmsans text-sm text-move-text-secondary">
                  {t('subscription.completed_ended_on', { date: formatDate(activeSub.endsAt) })}
                </Text>
              </View>
            )}
            <Text className="mt-2 font-dmsans text-sm text-move-text-muted">
              {t('subscription.completed_subtitle')}
            </Text>
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
            {/* À l'unité — GYM-94 : cumul libre, toujours visible. Désactivé si abonnement illimité actif. */}
            {oneTime.length > 0 && (
              <>
                <Text className="mt-2 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
                  {t('subscription.section_one_time')}
                </Text>
                {renderPlans(oneTime)}
              </>
            )}

            {/* Abonnements — visibles ; en upsell (désactivés) si un abonnement est déjà actif. */}
            {recurring.length > 0 && (
              <>
                <Text className="mt-2 font-dmsans-bold text-xs uppercase tracking-wider text-move-text-muted">
                  {hasActiveSub
                    ? t('subscription.upsell_switch_title')
                    : t('subscription.section_recurring')}
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
