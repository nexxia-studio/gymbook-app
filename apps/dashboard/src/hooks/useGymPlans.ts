import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { PlanItem, PlanFormData } from '@/types/plan'

function mapRow(row: Record<string, unknown>): PlanItem {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    // GYM-188 — `type` est lu TEL QUEL, jamais recalculé depuis billing_type.
    planType: (row.type as PlanItem['planType']) ?? 'credits',
    billingType: (row.billing_type as PlanItem['billingType']) ?? 'one_time',
    // NULL reste NULL : un plan illimité n'a pas de credit_count, et inversement.
    creditCount: (row.credit_count as number | null) ?? null,
    durationMonths: (row.duration_months as number | null) ?? null,
    priceCents: row.price_cents as number,
    currency: (row.currency as string) ?? 'EUR',
    isPopular: (row.is_popular as boolean) ?? false,
    // GYM-193 — offre limitée à un achat par membre (attribut du plan, jamais son nom).
    oncePerMember: (row.once_per_member as boolean) ?? false,
    active: (row.active as boolean) ?? true,
    sortOrder: (row.sort_order as number) ?? 0,
  }
}

// GYM-188 — `type` vient du formulaire, il n'est PLUS dérivé de billing_type : les deux
// axes sont indépendants, d'où les 4 combinaisons (dont « illimité payé en une fois »).
//
// C'est ici, et nulle part ailleurs, qu'on décide ce qui part en base : la colonne qui n'a
// pas de sens pour le type choisi est forcée à NULL. Le formulaire peut donc conserver une
// saisie devenue hors-sujet (l'utilisateur bascule d'un type à l'autre sans rien perdre)
// sans qu'elle puisse jamais être persistée.
//
// La contrainte gym_plans_check (type='credits' ⟺ credit_count NOT NULL ;
// type='unlimited' ⟺ duration_months NOT NULL) est satisfaite par construction, la
// validation du formulaire garantissant que le champ pertinent est renseigné.
//
// duration_months reste NULL pour les plans de crédits : apply_paid_payment ne lit pas
// cette colonne et ne pose aucune expiration — introduire une durée de validité des
// crédits serait un changement de comportement, hors périmètre GYM-188.
function toRow(data: PlanFormData) {
  const isCredits = data.planType === 'credits'
  return {
    name: data.name.trim(),
    description: data.description.trim() || null,
    billing_type: data.billingType,
    type: data.planType,
    credit_count: isCredits ? data.creditCount : null,
    duration_months: isCredits ? null : data.durationMonths,
    price_cents: Math.round(data.priceEuros * 100),
    is_popular: data.isPopular,
    once_per_member: data.oncePerMember,
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
