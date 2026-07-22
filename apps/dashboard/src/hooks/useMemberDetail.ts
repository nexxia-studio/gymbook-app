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

// Statuts d'abonnement affichés dans la fiche. expired/cancelled → "aucun abonnement".
// GYM-151 — 'completed' (engagement arrivé à son terme) est affiché avec un badge « Terminé »
// (info utile au gérant) plutôt que masqué comme « aucun abonnement ».
const LIVE_SUB_STATUSES = ['active', 'paused', 'suspended', 'completed']

export function useMemberDetail(memberId: string | null) {
  const gymId = useAuthStore((s) => s.gym_id)
  const [credits, setCredits] = useState<CreditLine[]>([])
  const [creditsRemaining, setCreditsRemaining] = useState(0)
  const [subscription, setSubscription] = useState<MemberSubscription | null>(null)
  const [bookings, setBookings] = useState<RecentBooking[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!memberId || !gymId) return
    setLoading(true)
    try {
      const [creditsRes, plansRes, subRes, bookingsRes] = await Promise.all([
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

  return { credits, creditsRemaining, subscription, bookings, loading, reload: load }
}
