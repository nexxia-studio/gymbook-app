// GYM-129 — Données de la fiche membre (drawer /members).
// Toutes les lectures sont autorisées au gym_admin par les policies RLS
// (member_credits / member_subscriptions / bookings + time_slots/activities,
// USING gym_id = get_my_gym_id() AND is_gym_admin()) → lecture directe côté client,
// aucune Edge nécessaire pour lire. Seule l'écriture identité passe par une Edge.
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'

export interface CreditLine {
  planId: string
  planName: string
  total: number
  used: number
  remaining: number
}

export interface MemberSubscription {
  planName: string
  status: string
  startsAt: string
  endsAt: string | null
  amount: number | null
}

export interface RecentBooking {
  id: string
  status: string
  startsAt: string | null
  activity: string
}

// GYM-182 — une ligne du journal d'ajustements de crédits offerts.
export interface CreditAdjustment {
  id: string
  delta: number
  appliedDelta: number
  reason: string
  createdAt: string
  grantedByName: string
}

// GYM-182 — retour de l'Edge adjust-credits (miroir du jsonb de la RPC).
export interface AdjustResult {
  requested_delta: number
  applied_delta: number
  new_total: number
  new_used: number
  new_remaining: number
  adjustment_id: string
  clamped: boolean
}

// GYM-182 — plan_id sentinelle des crédits offerts manuellement (texte libre, pas une FK).
export const MANUAL_GRANT_PLAN_ID = 'manual_grant'

// Statuts d'abonnement affichés dans la fiche. expired/cancelled → "aucun abonnement".
// GYM-151 — 'completed' (engagement arrivé à son terme) est affiché avec un badge « Terminé »
// (info utile au gérant) plutôt que masqué comme « aucun abonnement ».
const LIVE_SUB_STATUSES = ['active', 'paused', 'suspended', 'completed']

export function useMemberDetail(memberId: string | null) {
  const gymId = useAuthStore((s) => s.gym_id)
  const [credits, setCredits] = useState<CreditLine[]>([])
  const [creditsRemaining, setCreditsRemaining] = useState(0)
  const [giftedRemaining, setGiftedRemaining] = useState(0)
  const [purchasedRemaining, setPurchasedRemaining] = useState(0)
  const [adjustments, setAdjustments] = useState<CreditAdjustment[]>([])
  const [subscription, setSubscription] = useState<MemberSubscription | null>(null)
  const [bookings, setBookings] = useState<RecentBooking[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!memberId || !gymId) return
    setLoading(true)
    try {
      const [creditsRes, plansRes, subRes, bookingsRes, adjustmentsRes] = await Promise.all([
        supabase
          .from('member_credits')
          .select('plan_id, credits_total, credits_used, credits_remaining')
          .eq('member_id', memberId),
        supabase.from('gym_plans').select('id, name').eq('gym_id', gymId),
        supabase
          .from('member_subscriptions')
          .select('plan_name, status, starts_at, ends_at, amount')
          .eq('member_id', memberId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('bookings')
          .select('id, status, booked_at, time_slots(starts_at, activities(name))')
          .eq('member_id', memberId)
          .order('booked_at', { ascending: false })
          .limit(5),
        // GYM-182 — journal des ajustements de crédits (RLS gym_admin). Le granter est embarqué
        // via la FK granted_by (désambiguïsée : deux FK vers profiles sur cette table).
        supabase
          .from('credit_adjustments')
          .select('id, delta, applied_delta, reason, created_at, granter:profiles!credit_adjustments_granted_by_fkey(first_name, last_name)')
          .eq('member_id', memberId)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      const planNames = new Map<string, string>()
      for (const p of (plansRes.data ?? []) as Array<{ id: string; name: string }>) {
        planNames.set(p.id, p.name)
      }

      const creditLines: CreditLine[] = ((creditsRes.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
        planId: c.plan_id as string,
        planName: planNames.get(c.plan_id as string) ?? '—',
        total: (c.credits_total as number) ?? 0,
        used: (c.credits_used as number) ?? 0,
        remaining: (c.credits_remaining as number) ?? 0,
      }))
      setCredits(creditLines)
      setCreditsRemaining(creditLines.reduce((s, c) => s + c.remaining, 0))
      // Décomposition offert (manual_grant) vs acheté (tout le reste).
      const gifted = creditLines.filter((c) => c.planId === MANUAL_GRANT_PLAN_ID).reduce((s, c) => s + c.remaining, 0)
      setGiftedRemaining(gifted)
      setPurchasedRemaining(creditLines.filter((c) => c.planId !== MANUAL_GRANT_PLAN_ID).reduce((s, c) => s + c.remaining, 0))

      const adjLines: CreditAdjustment[] = ((adjustmentsRes.data ?? []) as Array<Record<string, unknown>>).map((a) => {
        const g = a.granter as { first_name?: string; last_name?: string } | Array<{ first_name?: string; last_name?: string }> | null
        const granter = Array.isArray(g) ? g[0] : g
        const name = `${granter?.first_name ?? ''} ${granter?.last_name ?? ''}`.trim()
        return {
          id: a.id as string,
          delta: (a.delta as number) ?? 0,
          appliedDelta: (a.applied_delta as number) ?? 0,
          reason: (a.reason as string) ?? '',
          createdAt: a.created_at as string,
          grantedByName: name || '—',
        }
      })
      setAdjustments(adjLines)

      const sub = subRes.data as Record<string, unknown> | null
      if (sub && LIVE_SUB_STATUSES.includes(sub.status as string)) {
        setSubscription({
          planName: (sub.plan_name as string) ?? '—',
          status: sub.status as string,
          startsAt: sub.starts_at as string,
          endsAt: (sub.ends_at as string | null) ?? null,
          amount: (sub.amount as number | null) ?? null,
        })
      } else {
        setSubscription(null)
      }

      const recent: RecentBooking[] = ((bookingsRes.data ?? []) as Array<Record<string, unknown>>).map((b) => {
        // Embeds to-one typés en tableau par le client — tolérer objet ou tableau.
        const ts = b.time_slots as { starts_at?: string; activities?: unknown } | Array<{ starts_at?: string; activities?: unknown }> | null
        const slot = Array.isArray(ts) ? ts[0] : ts
        const act = slot?.activities as { name?: string } | Array<{ name?: string }> | null | undefined
        const activity = Array.isArray(act) ? act[0]?.name : act?.name
        return {
          id: b.id as string,
          status: b.status as string,
          startsAt: (slot?.starts_at as string | undefined) ?? null,
          activity: activity ?? '—',
        }
      })
      setBookings(recent)
    } catch (e) {
      console.error('Failed to load member detail', e)
    } finally {
      setLoading(false)
    }
  }, [memberId, gymId])

  useEffect(() => {
    if (memberId) load()
  }, [memberId, load])

  // GYM-182 — ajustement manuel via l'Edge adjust-credits (clamp + journal côté RPC).
  // Retourne le résultat (dont `clamped`) pour que l'appelant affiche le bon toast. Recharge
  // la fiche à la fin. Lève en cas d'erreur d'autorisation/validation.
  const adjustCredits = useCallback(async (delta: number, reason: string): Promise<AdjustResult> => {
    if (!memberId) throw new Error('NO_MEMBER')
    const { data, error } = await supabase.functions.invoke('adjust-credits', {
      body: { member_id: memberId, delta, reason },
    })
    if (error) throw error
    await load()
    return data as AdjustResult
  }, [memberId, load])

  return {
    credits, creditsRemaining, giftedRemaining, purchasedRemaining, adjustments,
    subscription, bookings, loading, reload: load, adjustCredits,
  }
}
