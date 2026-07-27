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
  /** GYM-193 — offre limitée à un achat par membre (attribut du plan, jamais son nom). */
  oncePerMember: boolean
  sortOrder: number | null
}

// GYM-193 — statuts de paiement qui CONSOMMENT le droit à une offre limitée.
// ⚠️ Doit rester aligné sur la garde serveur (create-payment → 409 PLAN_ALREADY_USED),
// qui seule fait foi. Un remboursement ne rouvre pas le droit : le membre a bénéficié de
// l'offre. 'pending' / 'failed' / 'expired' / 'canceled' ne consomment rien — un paiement
// abandonné doit pouvoir être réessayé.
const CONSUMING_PAYMENT_STATUSES = ['paid', 'partially_refunded', 'refunded']

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
      .select('id, name, description, price_cents, currency, credit_count, duration_months, billing_type, features, is_popular, once_per_member, sort_order')
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
        oncePerMember: p.once_per_member ?? false,
        sortOrder: p.sort_order,
      }
    })

    // ── GYM-193 — masquer une offre déjà consommée ─────────────────────────────
    // Une seule requête, et UNIQUEMENT s'il existe au moins un plan limité : tant
    // qu'aucune salle n'active l'option, le coût est nul. Le filtre `in('plan_id', …)`
    // borne le résultat aux seuls plans concernés (quelques lignes au plus).
    // ⚠️ payments.plan_id est un TEXT : comparaison texte↔texte, aucun cast.
    //
    // COMPORTEMENT SÛR PAR DÉFAUT : en cas d'échec de la requête, `consumed` reste vide
    // et TOUT est affiché. Mieux vaut proposer une offre que le serveur refusera (409)
    // que de masquer à tort une offre à un membre qui y a droit.
    //
    // On ne traite PAS ici le cas « abonnement actif » : il est déjà couvert côté
    // serveur par la garde GYM-94.
    const limitedPlanIds = mapped.filter((p) => p.oncePerMember).map((p) => p.id)
    const consumed = new Set<string>()

    if (user && limitedPlanIds.length > 0) {
      const { data: prior, error: priorError } = await supabase
        .from('payments')
        .select('plan_id')
        .eq('member_id', user.id)
        .eq('gym_id', gymId)
        .in('plan_id', limitedPlanIds)
        .in('status', CONSUMING_PAYMENT_STATUSES)

      if (!priorError && prior) {
        for (const row of prior) if (row.plan_id) consumed.add(row.plan_id as string)
      }
    }

    const visible = consumed.size > 0 ? mapped.filter((p) => !consumed.has(p.id)) : mapped

    setState({
      oneTime: visible.filter((p) => p.billingType === 'one_time'),
      recurring: visible.filter((p) => p.billingType !== 'one_time'),
      loading: false,
      error: false,
    })
  }, [gymId])

  useEffect(() => { load() }, [load])

  return { ...state, refetch: load }
}
