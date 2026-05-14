import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'

export interface DashboardStats {
  activeMembers: number
  todaySessions: number
  fillRate: number
  monthRevenue: number
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

      const [membersRes, sessionsRes, bookingsRes] = await Promise.all([
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
      ])

      const activeMembers = membersRes.count ?? 0
      const todaySessions = sessionsRes.count ?? 0
      const monthBookings = bookingsRes.count ?? 0

      // Estimate fill rate from bookings vs capacity
      const fillRate = todaySessions > 0 ? Math.min(Math.round((monthBookings / (todaySessions * 30)) * 100), 100) : 0

      setStats({
        activeMembers,
        todaySessions,
        fillRate: fillRate || 0,
        monthRevenue: monthBookings * 15, // rough estimate
      })
    } catch (e) {
      console.error('Failed to fetch dashboard stats', e)
      setStats({ activeMembers: 0, todaySessions: 0, fillRate: 0, monthRevenue: 0 })
    } finally {
      setLoading(false)
    }
  }, [gymId])

  useEffect(() => { fetchStats() }, [fetchStats])

  return { stats, loading, refetch: fetchStats }
}
