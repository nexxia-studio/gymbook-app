import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { CoachItem, CoachFormData } from '@/types/coach'

function mapRow(row: Record<string, unknown>): CoachItem {
  const fullName = (row.name as string) ?? ''
  return {
    id: row.id as string,
    firstName: fullName.split(' ')[0] ?? '',
    lastName: fullName.split(' ').slice(1).join(' '),
    bio: (row.bio as string) ?? '',
    photoUrl: (row.photo_url as string) ?? null,
    specialties: (row.specialties as string[]) ?? [],
    sites: ['Neupré'],
    sortOrder: (row.sort_order as number) ?? 0,
    active: (row.active as boolean) ?? true,
  }
}

export function useCoaches() {
  const [coaches, setCoaches] = useState<CoachItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const gymId = useAuthStore((s) => s.gym_id)

  const fetchCoaches = useCallback(async () => {
    if (!gymId) return
    try {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('coaches')
        .select('*')
        .eq('gym_id', gymId)
        .order('sort_order')
      if (error) throw error
      setCoaches((data ?? []).map(mapRow))
    } catch (e) {
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }, [gymId])

  useEffect(() => { fetchCoaches() }, [fetchCoaches])

  const activeCount = coaches.filter((c) => c.active).length

  const createCoach = useCallback(async (data: CoachFormData) => {
    if (!gymId) return
    await supabase.from('coaches').insert({
      gym_id: gymId,
      name: `${data.firstName} ${data.lastName}`.trim(),
      bio: data.bio,
      specialties: data.specialties,
      sort_order: data.sortOrder,
      active: data.active,
    })
    fetchCoaches()
  }, [gymId, fetchCoaches])

  const updateCoach = useCallback(async (id: string, data: CoachFormData) => {
    await supabase.from('coaches').update({
      name: `${data.firstName} ${data.lastName}`.trim(),
      bio: data.bio,
      specialties: data.specialties,
      sort_order: data.sortOrder,
      active: data.active,
    }).eq('id', id)
    fetchCoaches()
  }, [fetchCoaches])

  const toggleCoach = useCallback(async (id: string) => {
    const coach = coaches.find((c) => c.id === id)
    if (!coach) return false
    const newActive = !coach.active
    await supabase.from('coaches').update({ active: newActive }).eq('id', id)
    fetchCoaches()
    return newActive
  }, [coaches, fetchCoaches])

  const deleteCoach = useCallback(async (id: string) => {
    await supabase.from('coaches').delete().eq('id', id)
    fetchCoaches()
  }, [fetchCoaches])

  return {
    coaches, activeCount, isLoading,
    createCoach, updateCoach, toggleCoach, deleteCoach,
  }
}
