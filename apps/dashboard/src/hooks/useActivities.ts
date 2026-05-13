import { useState, useCallback } from 'react'
import type { ActivityItem, ActivityFormData } from '@/types/activity'

const INITIAL_ACTIVITIES: ActivityItem[] = [
  { id: 'a1', name: 'Open Gym', slug: 'open-gym', description: 'Accès libre aux équipements Hyrox et musculation. Coaching disponible.', durationMin: 120, defaultCapacity: 6, level: 'all', icon: 'Dumbbell', color: '#4ECDC4', requiresMedicalCheck: false, active: true },
  { id: 'a2', name: 'HIIT / Hyrox', slug: 'hiit-hyrox', description: 'Entraînement haute intensité inspiré des compétitions Hyrox.', durationMin: 60, defaultCapacity: 12, level: 'all', icon: 'Flame', color: '#FF8E53', requiresMedicalCheck: false, active: true },
]

let nextId = 100

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function useActivities() {
  const [activities, setActivities] = useState<ActivityItem[]>(INITIAL_ACTIVITIES)

  const activeCount = activities.filter((a) => a.active).length

  const createActivity = useCallback((data: ActivityFormData) => {
    const newActivity: ActivityItem = {
      ...data,
      id: `a${nextId++}`,
      active: true,
    }
    setActivities((prev) => [...prev, newActivity])
  }, [])

  const updateActivity = useCallback((id: string, data: ActivityFormData) => {
    setActivities((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...data } : a)),
    )
  }, [])

  const toggleActivity = useCallback((id: string) => {
    setActivities((prev) =>
      prev.map((a) => (a.id === id ? { ...a, active: !a.active } : a)),
    )
    return activities.find((a) => a.id === id)?.active ? false : true
  }, [activities])

  const duplicateActivity = useCallback((id: string) => {
    const original = activities.find((a) => a.id === id)
    if (!original) return null
    const dup: ActivityItem = {
      ...original,
      id: `a${nextId++}`,
      name: `${original.name} (copie)`,
      slug: slugify(`${original.name} copie`),
    }
    setActivities((prev) => [...prev, dup])
    return dup
  }, [activities])

  const deleteActivity = useCallback((id: string) => {
    setActivities((prev) => prev.filter((a) => a.id !== id))
  }, [])

  return {
    activities,
    activeCount,
    createActivity,
    updateActivity,
    toggleActivity,
    duplicateActivity,
    deleteActivity,
    slugify,
  }
}
