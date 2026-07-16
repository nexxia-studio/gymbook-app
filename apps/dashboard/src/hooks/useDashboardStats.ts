import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'

// ── Heure locale gym (buckets en Europe/Brussels, pas UTC) — mêmes helpers que
//    pages/Revenue.tsx (source de vérité, cohérence /dashboard ↔ /revenue). ──
const GYM_TZ = 'Europe/Brussels'
function toBxl(iso: string | null): Date | null {
  if (!iso) return null
  return new Date(new Date(iso).toLocaleString('en-US', { timeZone: GYM_TZ }))
}
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}`
}
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay()
  x.setDate(x.getDate() - (day === 0 ? 6 : day - 1))
  return x
}
function weekKey(d: Date): string {
  const m = mondayOf(d)
  return `${m.getFullYear()}-${m.getMonth()}-${m.getDate()}`
}

export type FillPeriod = 'day' | 'week' | 'month'

export interface RecentMember {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  joinedAt: string | null // profiles.created_at (date d'inscription)
}

export interface DashboardStats {
  activeMembers: number
  todaySessions: number
  // Taux de remplissage par période (heure locale). null = aucun créneau → "—".
  fillRates: { day: number | null; week: number | null; month: number | null }
  monthRevenue: number | null
  hasMollie: boolean
  recentMembers: RecentMember[]
}

// Σ bookings confirmés / Σ capacité, borné à 100. null si aucun créneau sur la période.
function fillRate(booked: number, capacity: number): number | null {
  if (capacity <= 0) return null
  return Math.min(Math.round((booked / capacity) * 100), 100)
}

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  // Période du taux de remplissage — le toggle J/S/M ne refetch pas (les 3 taux sont
  // précalculés à partir des créneaux du mois courant). Défaut = semaine.
  const [fillPeriod, setFillPeriod] = useState<FillPeriod>('week')
  const gymId = useAuthStore((s) => s.gym_id)

  const fetchStats = useCallback(async () => {
    if (!gymId) return
    setLoading(true)
    try {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()

      // Repères en heure locale gym.
      const nowB = new Date(now.toLocaleString('en-US', { timeZone: GYM_TZ }))
      const curMonthKey = monthKey(nowB)
      const curWeekKey = weekKey(nowB)
      const curDayKey = dayKey(nowB)
      // Fenêtre UTC généreuse (±10 j autour du mois courant) : couvre le débordement de la
      // semaine aux bords du mois + le décalage TZ. Filtrage exact fait côté client via toBxl.
      const y = nowB.getFullYear(), mo = nowB.getMonth()
      const rangeLowerISO = new Date(Date.UTC(y, mo, 1) - 10 * 86400000).toISOString()
      const rangeUpperISO = new Date(Date.UTC(y, mo + 1, 1) + 10 * 86400000).toISOString()

      const [membersRes, sessionsRes, recentRes, slotsRes, paymentsRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('role', 'member')
          .is('deleted_at', null),
        supabase
          .from('time_slots')
          .select('*', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .gte('starts_at', todayStart)
          .lte('starts_at', todayEnd)
          .eq('status', 'scheduled'),
        // 5 derniers membres inscrits (tri par date d'inscription DESC).
        supabase
          .from('profiles')
          .select('id, first_name, last_name, email, created_at')
          .eq('gym_id', gymId)
          .eq('role', 'member')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(5),
        // Créneaux planifiés autour du mois courant → taux de remplissage.
        // bookings_count = COUNT confirmés (trigger trg_update_bookings_count).
        supabase
          .from('time_slots')
          .select('starts_at, capacity, bookings_count')
          .eq('gym_id', gymId)
          .eq('status', 'scheduled')
          .gte('starts_at', rangeLowerISO)
          .lt('starts_at', rangeUpperISO),
        // Paiements encaissés → CA du mois (même logique que Revenue.tsx kpis.thisMonth).
        supabase
          .from('payments')
          .select('amount, paid_at')
          .eq('gym_id', gymId)
          .eq('status', 'paid')
          .gte('paid_at', rangeLowerISO),
      ])

      const activeMembers = membersRes.count ?? 0
      const todaySessions = sessionsRes.count ?? 0
      const recentMembers: RecentMember[] = (recentRes.data ?? []).map((r) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        joinedAt: r.created_at,
      }))

      // Taux de remplissage par période (heure locale).
      let capD = 0, bkD = 0, capW = 0, bkW = 0, capM = 0, bkM = 0
      for (const s of slotsRes.data ?? []) {
        const b = toBxl(s.starts_at)
        if (!b) continue
        const cap = s.capacity ?? 0
        const booked = s.bookings_count ?? 0
        if (monthKey(b) === curMonthKey) { capM += cap; bkM += booked }
        if (weekKey(b) === curWeekKey) { capW += cap; bkW += booked }
        if (dayKey(b) === curDayKey) { capD += cap; bkD += booked }
      }
      const fillRates = {
        day: fillRate(bkD, capD),
        week: fillRate(bkW, capW),
        month: fillRate(bkM, capM),
      }

      // CA du mois courant : Σ amount des paiements 'paid' dont paid_at ∈ mois en cours (BXL).
      let thisMonthRevenue = 0
      for (const p of paymentsRes.data ?? []) {
        const b = toBxl(p.paid_at)
        if (b && monthKey(b) === curMonthKey) thisMonthRevenue += p.amount ?? 0
      }

      // Check Mollie connection
      const { data: mollieConn } = await supabase
        .from('gym_mollie_connections')
        .select('id')
        .eq('gym_id', gymId)
        .limit(1)
      const hasMollie = (mollieConn?.length ?? 0) > 0

      setStats({
        activeMembers,
        todaySessions,
        fillRates,
        monthRevenue: hasMollie ? thisMonthRevenue : null,
        hasMollie,
        recentMembers,
      })
    } catch (e) {
      console.error('Failed to fetch dashboard stats', e)
      setStats({
        activeMembers: 0,
        todaySessions: 0,
        fillRates: { day: null, week: null, month: null },
        monthRevenue: null,
        hasMollie: false,
        recentMembers: [],
      })
    } finally {
      setLoading(false)
    }
  }, [gymId])

  useEffect(() => { fetchStats() }, [fetchStats])

  // Realtime: refresh KPIs on booking/profile changes + 30s polling fallback.
  // Le fillRate dépend aussi de time_slots (nouveaux créneaux) : pas de canal dédié
  // time_slots → le polling 30s le couvre (bookings_count est mis à jour par trigger,
  // et une résa confirme via la table bookings, déjà écoutée → refetch).
  useEffect(() => {
    if (!gymId) return
    const channel = supabase
      .channel(`kpis-${gymId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `gym_id=eq.${gymId}` }, (payload) => {
        console.log('[Realtime Dashboard] KPI bookings:', payload.eventType)
        fetchStats()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `gym_id=eq.${gymId}` }, (payload) => {
        console.log('[Realtime Dashboard] KPI profiles:', payload.eventType)
        fetchStats()
      })
      .subscribe((status) => {
        console.log('[Realtime Dashboard] KPIs subscription:', status)
      })

    const pollingInterval = setInterval(() => {
      fetchStats()
    }, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(pollingInterval)
    }
  }, [gymId, fetchStats])

  return { stats, loading, refetch: fetchStats, fillPeriod, setFillPeriod }
}
