import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { ActivityItem, ActivityFormData } from '@/types/activity'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function mapRow(row: Record<string, unknown>): ActivityItem {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    description: (row.description as string) ?? '',
    durationMin: row.duration_min as number,
    defaultCapacity: row.default_capacity as number,
    level: (row.default_level as string) ?? 'all',
    icon: (row.icon as string) ?? 'Dumbbell',
    color: (row.color as string) ?? '#4ECDC4',
    requiresMedicalCheck: (row.requires_medical_check as boolean) ?? false,
    active: (row.active as boolean) ?? true,
  }
}

export function useActivities() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const gymId = useAuthStore((s) => s.gym_id)

  const fetchActivities = useCallback(async () => {
    if (!gymId) return
    try {
      setIsLoading(true)
      const { data, error: err } = await supabase
        .from('activities')
        .select('*')
        .eq('gym_id', gymId)
        .order('sort_order')
      if (err) throw err
      setActivities((data ?? []).map(mapRow))
    } catch (e) {
      setError('Failed to load activities')
      console.error(e)
    } finally {
      setIsLoading(false)
    }
  }, [gymId])

  useEffect(() => { fetchActivities() }, [fetchActivities])

  const activeCount = activities.filter((a) => a.active).length

  const createActivity = useCallback(async (data: ActivityFormData) => {
    if (!gymId) return
    await supabase.from('activities').insert({
      gym_id: gymId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      duration_min: data.durationMin,
      default_capacity: data.defaultCapacity,
      default_level: data.level,
      icon: data.icon,
      color: data.color,
      requires_medical_check: data.requiresMedicalCheck,
    })
    fetchActivities()
  }, [gymId, fetchActivities])

  const updateActivity = useCallback(async (id: string, data: ActivityFormData) => {
    await supabase.from('activities').update({
      name: data.name,
      slug: data.slug,
      description: data.description,
      duration_min: data.durationMin,
      default_capacity: data.defaultCapacity,
      default_level: data.level,
      icon: data.icon,
      color: data.color,
      requires_medical_check: data.requiresMedicalCheck,
    }).eq('id', id)
    fetchActivities()
  }, [fetchActivities])

  const getActivityFutureSlots = useCallback(async (id: string): Promise<number> => {
    const { count } = await supabase
      .from('time_slots')
      .select('*', { count: 'exact', head: true })
      .eq('activity_id', id)
      .gt('starts_at', new Date().toISOString())
      .neq('status', 'cancelled')
    return count ?? 0
  }, [])

  const toggleActivity = useCallback(async (id: string) => {
    const activity = activities.find((a) => a.id === id)
    if (!activity) return false
    const newActive = !activity.active
    await supabase.from('activities').update({ active: newActive }).eq('id', id)
    fetchActivities()
    return newActive
  }, [activities, fetchActivities])

  const duplicateActivity = useCallback(async (id: string) => {
    if (!gymId) return null
    const original = activities.find((a) => a.id === id)
    if (!original) return null
    const { data } = await supabase.from('activities').insert({
      gym_id: gymId,
      name: `${original.name} (copie)`,
      slug: slugify(`${original.name} copie`),
      description: original.description,
      duration_min: original.durationMin,
      default_capacity: original.defaultCapacity,
      default_level: original.level,
      icon: original.icon,
      color: original.color,
      requires_medical_check: original.requiresMedicalCheck,
    }).select().single()
    fetchActivities()
    return data ? mapRow(data) : null
  }, [gymId, activities, fetchActivities])

  const deleteActivity = useCallback(async (id: string) => {
    await supabase.from('activities').delete().eq('id', id)
    fetchActivities()
  }, [fetchActivities])

  return {
    activities, activeCount, isLoading, error,
    createActivity, updateActivity, toggleActivity, getActivityFutureSlots,
    duplicateActivity, deleteActivity, slugify, refetch: fetchActivities,
  }
}
