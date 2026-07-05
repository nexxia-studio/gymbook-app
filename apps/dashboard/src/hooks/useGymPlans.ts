import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { PlanItem, PlanFormData } from '@/types/plan'

function mapRow(row: Record<string, unknown>): PlanItem {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    billingType: (row.billing_type as PlanItem['billingType']) ?? 'one_time',
    creditCount: (row.credit_count as number | null) ?? null,
    durationMonths: (row.duration_months as number | null) ?? null,
    priceCents: row.price_cents as number,
    currency: (row.currency as string) ?? 'EUR',
    isPopular: (row.is_popular as boolean) ?? false,
    active: (row.active as boolean) ?? true,
    sortOrder: (row.sort_order as number) ?? 0,
  }
}

// GYM-56 — `type` (NOT NULL + CHECK) dérivé de billing_type. La contrainte gym_plans_check
// impose : type='credits' ⟺ credit_count ; type='unlimited' ⟺ duration_months.
function toRow(data: PlanFormData) {
  const isOneTime = data.billingType === 'one_time'
  return {
    name: data.name.trim(),
    description: data.description.trim() || null,
    billing_type: data.billingType,
    type: isOneTime ? 'credits' : 'unlimited',
    credit_count: isOneTime ? data.creditCount : null,
    duration_months: isOneTime ? null : data.durationMonths,
    price_cents: Math.round(data.priceEuros * 100),
    is_popular: data.isPopular,
    active: data.active,
    sort_order: data.sortOrder,
  }
}

export function useGymPlans() {
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const gymId = useAuthStore((s) => s.gym_id)

  const fetchPlans = useCallback(async () => {
    if (!gymId) return
    try {
      setIsLoading(true)
      const { data, error: err } = await supabase
        .from('gym_plans')
        .select('*')
        .eq('gym_id', gymId)
        .order('sort_order')
        .order('created_at')
      if (err) throw err
      setPlans((data ?? []).map(mapRow))
      setError(null)
    } catch (e) {
      setError('Failed to load plans')
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }, [gymId])

  useEffect(() => { fetchPlans() }, [fetchPlans])

  const createPlan = useCallback(async (data: PlanFormData) => {
    if (!gymId) return
    const { error: err } = await supabase.from('gym_plans').insert({ gym_id: gymId, ...toRow(data) })
    if (err) throw err
    await fetchPlans()
  }, [gymId, fetchPlans])

  const updatePlan = useCallback(async (id: string, data: PlanFormData) => {
    const { error: err } = await supabase.from('gym_plans').update(toRow(data)).eq('id', id)
    if (err) throw err
    await fetchPlans()
  }, [fetchPlans])

  // GYM-56 — désactivation (jamais de delete : un plan référencé par des paiements/crédits
  // historiques doit rester en base).
  const togglePlanActive = useCallback(async (id: string) => {
    const plan = plans.find((p) => p.id === id)
    if (!plan) return
    const { error: err } = await supabase.from('gym_plans').update({ active: !plan.active }).eq('id', id)
    if (err) throw err
    await fetchPlans()
  }, [plans, fetchPlans])

  return { plans, isLoading, error, createPlan, updatePlan, togglePlanActive, refetch: fetchPlans }
}
