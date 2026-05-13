export interface CoachItem {
  id: string
  firstName: string
  lastName: string
  bio: string
  photoUrl: string | null
  specialties: string[]
  sites: string[]
  sortOrder: number
  active: boolean
}

export interface CoachFormData {
  firstName: string
  lastName: string
  bio: string
  specialties: string[]
  sites: string[]
  sortOrder: number
  active: boolean
}
