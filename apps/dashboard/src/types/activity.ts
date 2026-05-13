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
}
