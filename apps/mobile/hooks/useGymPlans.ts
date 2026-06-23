// GYM-76 — Source de vérité unique des formules : table gym_plans (UUID), fini les codes string.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import i18n from '../lib/i18n'
import { useAuthStore } from '../stores/useAuthStore'

export interface GymPlan {
  id: string // UUID → c'est le plan_id à envoyer au backend
  name: string
  description: string | null
  priceCents: number
  currency: string
  creditCount: number | null
  durationMonths: number | null
  billingType: string
  features: string[] | null
  isPopular: boolean
  sortOrder: number | null
}

interface UseGymPlansState {
  oneTime: GymPlan[]
  recurring: GymPlan[]
  loading: boolean
  error: boolean
}

/**
 * Récupère les formules actives de la gym courante, traduites selon
 * profiles.preferred_language (fallback langue i18n puis colonnes de base),
 * et les sépare en `oneTime` (billing_type = 'one_time') vs `recurring`.
 */
export function useGymPlans() {
  const gymId = useAuthStore((s) => s.gym_id)
  const [state, setState] = useState<UseGymPlansState>({
    oneTime: [],
    recurring: [],
    loading: true,
    error: false,
  })

  const load = useCallback(async () => {
    if (!gymId) {
      setState({ oneTime: [], recurring: [], loading: false, error: false })
      return
    }
    setState((s) => ({ ...s, loading: true, error: false }))

    // Langue de traduction : profiles.preferred_language → i18n.language → 'fr'
    let lang = i18n.language || 'fr'
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('preferred_language')
        .eq('id', user.id)
        .maybeSingle()
      if (prof?.preferred_language) lang = prof.preferred_language
    }

    const { data: plans, error } = await supabase
      .from('gym_plans')
      .select('id, name, description, price_cents, currency, credit_count, duration_months, billing_type, features, is_popular, sort_order')
      .eq('gym_id', gymId)
      .eq('active', true)
      .order('sort_order', { ascending: true })

    if (error || !plans) {
      setState({ oneTime: [], recurring: [], loading: false, error: true })
      return
    }

    // Traductions (fallback colonnes de base si absente)
    const ids = plans.map((p) => p.id)
    const { data: translations } = await supabase
      .from('gym_plan_translations')
      .select('plan_id, name, description, features')
      .in('plan_id', ids)
      .eq('language', lang)

    const byPlan = new Map((translations ?? []).map((tr) => [tr.plan_id, tr]))

    const mapped: GymPlan[] = plans.map((p) => {
      const tr = byPlan.get(p.id)
      return {
        id: p.id,
        name: tr?.name ?? p.name,
        description: tr?.description ?? p.description,
        priceCents: p.price_cents,
        currency: p.currency ?? 'EUR',
        creditCount: p.credit_count,
        durationMonths: p.duration_months,
        billingType: p.billing_type ?? '',
        features: tr?.features ?? p.features,
        isPopular: p.is_popular ?? false,
        sortOrder: p.sort_order,
      }
    })

    setState({
      oneTime: mapped.filter((p) => p.billingType === 'one_time'),
      recurring: mapped.filter((p) => p.billingType !== 'one_time'),
      loading: false,
      error: false,
    })
  }, [gymId])

  useEffect(() => { load() }, [load])

  return { ...state, refetch: load }
}
