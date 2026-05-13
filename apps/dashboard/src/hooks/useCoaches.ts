import { useState, useCallback } from 'react'
import type { CoachItem, CoachFormData } from '@/types/coach'

const INITIAL_COACHES: CoachItem[] = [
  {
    id: 'c1', firstName: 'Nicolas', lastName: '',
    bio: 'Fondateur Dopamine Performance Club. Coach Hyrox et functional fitness.',
    photoUrl: null, specialties: ['Open Gym', 'HIIT / Hyrox'],
    sites: ['Neupré'], sortOrder: 1, active: true,
  },
  {
    id: 'c2', firstName: 'François', lastName: '',
    bio: 'Coach performance et préparation physique Hyrox.',
    photoUrl: null, specialties: ['Open Gym', 'HIIT / Hyrox'],
    sites: ['Neupré'], sortOrder: 2, active: true,
  },
]

let nextId = 100

export function useCoaches() {
  const [coaches, setCoaches] = useState<CoachItem[]>(INITIAL_COACHES)

  const activeCount = coaches.filter((c) => c.active).length

  const createCoach = useCallback((data: CoachFormData) => {
    const newCoach: CoachItem = {
      ...data,
      id: `c${nextId++}`,
      photoUrl: null,
    }
    setCoaches((prev) => [...prev, newCoach].sort((a, b) => a.sortOrder - b.sortOrder))
  }, [])

  const updateCoach = useCallback((id: string, data: CoachFormData) => {
    setCoaches((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, ...data } : c))
        .sort((a, b) => a.sortOrder - b.sortOrder),
    )
  }, [])

  const toggleCoach = useCallback((id: string) => {
    let isNowActive = false
    setCoaches((prev) =>
      prev.map((c) => {
        if (c.id === id) {
          isNowActive = !c.active
          return { ...c, active: !c.active }
        }
        return c
      }),
    )
    return isNowActive
  }, [])

  const deleteCoach = useCallback((id: string) => {
    setCoaches((prev) => prev.filter((c) => c.id !== id))
  }, [])

  return {
    coaches,
    activeCount,
    createCoach,
    updateCoach,
    toggleCoach,
    deleteCoach,
  }
}
