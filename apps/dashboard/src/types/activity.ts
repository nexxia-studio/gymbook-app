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
  /** GYM-228 — masquée par défaut dans /planning (Open Gym). */
  hiddenInPlanning: boolean
  /**
   * GYM-231 — places que le gérant peut ajouter AU-DELÀ de la capacité d'un créneau de
   * cette activité. 0 = capacité dure (défaut, et comportement historique).
   */
  maxOverbook: number
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
  hiddenInPlanning: boolean
  maxOverbook: number
}
