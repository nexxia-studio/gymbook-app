import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'

export interface Member {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  role: string
  noshowCount: number
  suspendedUntil: string | null
  memberSince: string | null
  lastSeenAt: string | null
  pushToken: string | null
}

export function useMembers() {
  const [members, setMembers] = useState<Member[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')
  const gymId = useAuthStore((s) => s.gym_id)

  const fetchMembers = useCallback(async () => {
    if (!gymId) return
    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, first_name, last_name, email, phone, role, noshow_count, suspended_until, member_since, last_seen_at, push_token, created_at')
        .eq('gym_id', gymId)
        .eq('role', 'member')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (error) throw error
      setMembers((data ?? []).map((r) => ({
        id: r.id,
        firstName: r.first_name ?? '',
        lastName: r.last_name ?? '',
        email: r.email,
        phone: r.phone,
        role: r.role,
        noshowCount: r.noshow_count ?? 0,
        suspendedUntil: r.suspended_until,
        memberSince: r.member_since ?? r.created_at,
        lastSeenAt: r.last_seen_at,
        pushToken: r.push_token,
      })))
    } catch (e) {
      console.error('Failed to fetch members', e)
    } finally {
      setIsLoading(false)
    }
  }, [gymId])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  // Realtime
  useEffect(() => {
    if (!gymId) return
    const channel = supabase
      .channel(`members-${gymId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `gym_id=eq.${gymId}` }, () => fetchMembers())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [gymId, fetchMembers])

  const filteredMembers = members.filter((m) => {
    if (search) {
      const q = search.toLowerCase()
      if (!`${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)) return false
    }
    if (statusFilter === 'suspended') {
      return m.suspendedUntil && new Date(m.suspendedUntil) > new Date()
    }
    if (statusFilter === 'active') {
      return !m.suspendedUntil || new Date(m.suspendedUntil) <= new Date()
    }
    return true
  })

  const activeCount = members.filter((m) => !m.suspendedUntil || new Date(m.suspendedUntil) <= new Date()).length

  return {
    members: filteredMembers,
    totalCount: members.length,
    activeCount,
    isLoading,
    search, setSearch,
    statusFilter, setStatusFilter,
    refetch: fetchMembers,
  }
}
