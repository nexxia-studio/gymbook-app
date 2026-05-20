import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'

export interface SubscriptionSummary {
  isActive: boolean
  detail: string | null
}

/**
 * Resolves the member's active subscription summary by checking, in order:
 *   1. member_credits (one-time drop_in / pack_10 with remaining credits)
 *   2. member_subscriptions (recurring plans)
 * Returns a short display string ("3 séances · Drop-in" / "Abonnement 6 mois").
 */
export function useSubscriptionSummary() {
  const { t } = useTranslation()
  const [summary, setSummary] = useState<SubscriptionSummary>({ isActive: false, detail: null })

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 1. One-time credits first (most immediate signal)
    const { data: credits } = await supabase
      .from('member_credits')
      .select('plan_id, credits_remaining')
      .eq('member_id', user.id)
      .gt('credits_remaining', 0)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (credits?.plan_id) {
      const planName = t(`subscription.plan_${credits.plan_id}_name`)
      setSummary({
        isActive: true,
        detail: `${t('subscription.credits_remaining', { count: credits.credits_remaining })} · ${planName}`,
      })
      return
    }

    // 2. Recurring subscription — read plan_name TEXT directly (Mollie subs have plan_id=null).
    // Fallback to gym_plans.name when only the legacy plan_id (uuid) FK is set.
    const { data: sub } = await supabase
      .from('member_subscriptions')
      .select('id, status, plan_name, plan:gym_plans(name)')
      .eq('member_id', user.id)
      .in('status', ['active', 'canceling'])
      .order('starts_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (sub) {
      const joined = sub.plan as unknown as { name?: string } | null
      const detail = sub.plan_name ?? joined?.name ?? null
      setSummary({ isActive: true, detail })
      return
    }

    setSummary({ isActive: false, detail: null })
  }, [t])

  useEffect(() => { load() }, [load])

  return { summary, refresh: load }
}
