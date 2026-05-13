import { useState, useCallback } from 'react'
import type { ActivityItem, ActivityFormData } from '@/types/activity'

const INITIAL_ACTIVITIES: ActivityItem[] = [
  { id: 'a1', name: 'EMS', slug: 'ems', description: 'Electrostimulation musculaire', durationMin: 30, defaultCapacity: 4, level: 'all', icon: 'Zap', color: '#FF6B6B', requiresMedicalCheck: true, active: true },
  { id: 'a2', name: 'CrossFit', slug: 'crossfit', description: 'Entraînement fonctionnel haute intensité', durationMin: 60, defaultCapacity: 16, level: 'all', icon: 'Dumbbell', color: '#4ECDC4', requiresMedicalCheck: false, active: true },
  { id: 'a3', name: 'HIIT Circuit', slug: 'hiit-circuit', description: 'Entraînement par intervalles', durationMin: 45, defaultCapacity: 15, level: 'intermediate', icon: 'Flame', color: '#FF8E53', requiresMedicalCheck: false, active: true },
  { id: 'a4', name: 'Open Gym', slug: 'open-gym', description: 'Accès libre à la salle', durationMin: 60, defaultCapacity: 20, level: 'all', icon: 'Activity', color: '#6C5CE7', requiresMedicalCheck: false, active: true },
  { id: 'a5', name: 'Pilates', slug: 'pilates', description: 'Renforcement musculaire en douceur', durationMin: 50, defaultCapacity: 12, level: 'all', icon: 'PersonStanding', color: '#A8E6CF', requiresMedicalCheck: false, active: true },
  { id: 'a6', name: 'Yoga', slug: 'yoga', description: 'Yoga Vinyasa et Hatha', durationMin: 60, defaultCapacity: 14, level: 'all', icon: 'Leaf', color: '#B8B8FF', requiresMedicalCheck: false, active: true },
  { id: 'a7', name: 'Prénatal', slug: 'prenatal', description: 'Activité adaptée aux femmes enceintes', durationMin: 45, defaultCapacity: 10, level: 'beginner', icon: 'Baby', color: '#FFB7C5', requiresMedicalCheck: true, active: true },
  { id: 'a8', name: 'Drainage', slug: 'drainage', description: 'Drainage lymphatique actif', durationMin: 40, defaultCapacity: 8, level: 'all', icon: 'Waves', color: '#81ECEC', requiresMedicalCheck: false, active: true },
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
