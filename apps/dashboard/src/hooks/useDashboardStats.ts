import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'

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
  fillRate: number
  monthRevenue: number | null
  hasMollie: boolean
  recentMembers: RecentMember[]
}

export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const gymId = useAuthStore((s) => s.gym_id)

  const fetchStats = useCallback(async () => {
    if (!gymId) return
    setLoading(true)
    try {
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      const [membersRes, sessionsRes, bookingsRes, recentRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .eq('role', 'member'),
        supabase
          .from('time_slots')
          .select('*', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .gte('starts_at', todayStart)
          .lte('starts_at', todayEnd)
          .eq('status', 'scheduled'),
        supabase
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .eq('gym_id', gymId)
          .gte('booked_at', monthStart)
          .eq('status', 'confirmed'),
        // 5 derniers membres inscrits (tri par date d'inscription DESC).
        supabase
          .from('profiles')
          .select('id, first_name, last_name, email, created_at')
          .eq('gym_id', gymId)
          .eq('role', 'member')
          .order('created_at', { ascending: false })
          .limit(5),
      ])

      const activeMembers = membersRes.count ?? 0
      const todaySessions = sessionsRes.count ?? 0
      const monthBookings = bookingsRes.count ?? 0
      const recentMembers: RecentMember[] = (recentRes.data ?? []).map((r) => ({
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        joinedAt: r.created_at,
      }))

      // Check Mollie connection
      const { data: mollieConn } = await supabase
        .from('gym_mollie_connections')
        .select('id')
        .eq('gym_id', gymId)
        .limit(1)
      const hasMollie = (mollieConn?.length ?? 0) > 0

      const fillRate = todaySessions > 0 ? Math.min(Math.round((monthBookings / (todaySessions * 30)) * 100), 100) : 0

      setStats({
        activeMembers,
        todaySessions,
        fillRate: fillRate || 0,
        monthRevenue: hasMollie ? monthBookings * 15 : null,
        hasMollie,
        recentMembers,
      })
    } catch (e) {
      console.error('Failed to fetch dashboard stats', e)
      setStats({ activeMembers: 0, todaySessions: 0, fillRate: 0, monthRevenue: null, hasMollie: false, recentMembers: [] })
    } finally {
      setLoading(false)
    }
  }, [gymId])

  useEffect(() => { fetchStats() }, [fetchStats])

  // Realtime: refresh KPIs on booking/profile changes + 30s polling fallback
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

  return { stats, loading, refetch: fetchStats }
}
