export interface Coach {
  id: string
  name: string
  active?: boolean
}

export interface Activity {
  id: string
  name: string
  color: string
  durationMin: number
  active?: boolean
}

export type SlotStatus = 'scheduled' | 'completed' | 'cancelled'
export type DisplayStatus = 'scheduled' | 'completed' | 'cancelled' | 'in_progress'

// GYM-174 — statuts de pointage d'une réservation (non pointé = présent).
// 'confirmed' = inscrit, présent par défaut ; 'attended' = présent confirmé par le gérant ;
// 'no_show' = absent (pénalité) ; 'excused' = absent sans perte de crédit.
export type AttendanceStatus = 'confirmed' | 'attended' | 'no_show' | 'excused'

export interface TimeSlot {
  id: string
  date: string // YYYY-MM-DD
  startTime: string // HH:mm
  endTime: string // HH:mm
  activity: Activity
  coach: Coach
  booked: number
  waitlisted: number
  capacity: number
  status: SlotStatus
  members: SlotMember[]
}

export interface SlotMember {
  id: string
  bookingId: string
  firstName: string
  lastName: string
  email: string
  noshowCount: number
  avatarUrl?: string
  // GYM-174 — statut de pointage courant de la réservation.
  status: AttendanceStatus
}

// GYM-174 — un membre "présent" visuellement = inscrit (confirmed) ou pointé présent (attended).
export function isPresent(status: AttendanceStatus): boolean {
  return status === 'confirmed' || status === 'attended'
}

// GYM-174 — au moins une réservation a été pointée (statut ≠ confirmed) → badge "Pointé".
export function hasAttendanceMarked(slot: TimeSlot): boolean {
  return slot.members.some((m) => m.status !== 'confirmed')
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

/**
 * GYM-174 — Le pointage des présences est disponible pour les cours du jour ET les cours
 * passés (un pointage se corrige après coup), jamais pour un cours futur (autre jour à venir)
 * ni pour un créneau annulé. La comparaison se fait au niveau du JOUR local.
 */
export function canTrackAttendance(slot: TimeSlot): boolean {
  if (slot.status === 'cancelled') return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const slotDay = buildLocalDate(slot.date, '00:00')
  if (isNaN(slotDay.getTime())) return false
  return slotDay.getTime() <= today.getTime()
}
