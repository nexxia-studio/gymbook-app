export interface ActivityItem {
  id: string
  name: string
  slug: string
  description: string
  durationMin: number
  defaultCapacity: number
  level: string
  icon: string
  color: string
  requiresMedicalCheck: boolean
  /** GYM-229 — false = accès libre, sans encadrement (Open Gym). true par défaut. */
  requiresCoach: boolean
  active: boolean
}

export interface ActivityFormData {
  name: string
  slug: string
  description: string
  durationMin: number
  defaultCapacity: number
  level: string
  icon: string
  color: string
  requiresMedicalCheck: boolean
  requiresCoach: boolean
}
