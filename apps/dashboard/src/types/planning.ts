export interface Coach {
  id: string
  name: string
}

export interface Activity {
  id: string
  name: string
  color: string
  durationMin: number
}

export type SlotStatus = 'scheduled' | 'completed' | 'cancelled'

export interface TimeSlot {
  id: string
  date: string // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string // HH:mm
  activity: Activity
  coach: Coach
  booked: number
  capacity: number
  status: SlotStatus
  members: SlotMember[]
}

export interface SlotMember {
  id: string
  name: string
  avatarUrl?: string
}
