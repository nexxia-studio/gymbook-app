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
export type DisplayStatus = 'scheduled' | 'completed' | 'cancelled' | 'in_progress'

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

/**
 * Build a local Date from "YYYY-MM-DD" + "HH:mm" without UTC parsing pitfalls.
 * new Date("YYYY-MM-DD") parses as UTC, causing timezone shifts.
 * Instead we parse the parts and use the Date constructor with local values.
 */
function buildLocalDate(dateStr: string, timeStr: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, m] = timeStr.split(':').map(Number)
  return new Date(y, mo - 1, d, h, m, 0, 0)
}

/**
 * Compute the display status dynamically from current time.
 * Priority: cancelled > completed (past) > in_progress (now) > scheduled (future)
 */
export function getDisplayStatus(slot: TimeSlot): DisplayStatus {
  if (slot.status === 'cancelled') return 'cancelled'

  const now = Date.now()
  const startMs = buildLocalDate(slot.date, slot.startTime).getTime()
  const endMs = buildLocalDate(slot.date, slot.endTime).getTime()

  if (isNaN(endMs) || isNaN(startMs)) return 'scheduled'

  if (endMs < now) return 'completed'
  if (startMs <= now && now <= endMs) return 'in_progress'
  return 'scheduled'
}
