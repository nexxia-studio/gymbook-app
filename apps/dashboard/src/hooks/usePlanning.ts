import { useState, useMemo, useCallback } from 'react'
import type { TimeSlot, Activity, Coach, SlotStatus } from '@/types/planning'

// --- Dopamine Performance Club activities ---
const ACTIVITIES: Activity[] = [
  { id: 'opengym', name: 'Open Gym', color: '#4ECDC4', durationMin: 120 },
  { id: 'hiit', name: 'HIIT / Hyrox', color: '#FF8E53', durationMin: 60 },
]

const COACHES: Coach[] = [
  { id: 'c1', name: 'Nicolas' },
  { id: 'c2', name: 'François' },
]

const MOCK_MEMBERS = [
  { id: 'm1', name: 'Sophie Janssens' },
  { id: 'm2', name: 'Lucas Dupont' },
  { id: 'm3', name: 'Emma Claes' },
  { id: 'm4', name: 'Thomas Peeters' },
  { id: 'm5', name: 'Léa Maes' },
  { id: 'm6', name: 'Arthur Willems' },
  { id: 'm7', name: 'Chloé Lambert' },
  { id: 'm8', name: 'Nathan Dubois' },
]

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function pickMembers(count: number) {
  const shuffled = [...MOCK_MEMBERS].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

// --- Slot templates per day type ---
interface SlotTemplate {
  time: string
  activityIdx: number
  coachIdx: number
  capacity: number
  booked: number
  status: SlotStatus
}

// Real Dopamine schedule: 0=Open Gym (2h, cap 6), 1=HIIT/Hyrox (1h, cap 12)
// Coaches: 0=Nicolas, 1=François — alternating
const WEEKDAY_TEMPLATES: SlotTemplate[][] = [
  // Monday
  [
    { time: '07:30', activityIdx: 0, coachIdx: 0, capacity: 6, booked: 4, status: 'scheduled' },
    { time: '12:15', activityIdx: 1, coachIdx: 1, capacity: 12, booked: 8, status: 'scheduled' },
    { time: '18:00', activityIdx: 1, coachIdx: 0, capacity: 12, booked: 11, status: 'scheduled' },
    { time: '19:00', activityIdx: 0, coachIdx: 1, capacity: 6, booked: 5, status: 'scheduled' },
  ],
  // Tuesday
  [
    { time: '07:30', activityIdx: 1, coachIdx: 1, capacity: 12, booked: 7, status: 'scheduled' },
    { time: '12:15', activityIdx: 0, coachIdx: 0, capacity: 6, booked: 3, status: 'scheduled' },
    { time: '18:00', activityIdx: 0, coachIdx: 1, capacity: 6, booked: 6, status: 'scheduled' },
    { time: '19:00', activityIdx: 1, coachIdx: 0, capacity: 12, booked: 10, status: 'scheduled' },
  ],
  // Wednesday
  [
    { time: '07:30', activityIdx: 0, coachIdx: 0, capacity: 6, booked: 2, status: 'scheduled' },
    { time: '12:15', activityIdx: 1, coachIdx: 1, capacity: 12, booked: 9, status: 'scheduled' },
    { time: '18:00', activityIdx: 1, coachIdx: 0, capacity: 12, booked: 12, status: 'scheduled' },
    { time: '19:00', activityIdx: 0, coachIdx: 1, capacity: 6, booked: 4, status: 'scheduled' },
  ],
  // Thursday
  [
    { time: '07:30', activityIdx: 1, coachIdx: 1, capacity: 12, booked: 5, status: 'scheduled' },
    { time: '12:15', activityIdx: 0, coachIdx: 0, capacity: 6, booked: 4, status: 'scheduled' },
    { time: '18:00', activityIdx: 0, coachIdx: 1, capacity: 6, booked: 6, status: 'scheduled' },
    { time: '19:00', activityIdx: 1, coachIdx: 0, capacity: 12, booked: 11, status: 'scheduled' },
  ],
  // Friday
  [
    { time: '07:30', activityIdx: 0, coachIdx: 0, capacity: 6, booked: 3, status: 'scheduled' },
    { time: '12:15', activityIdx: 1, coachIdx: 1, capacity: 12, booked: 7, status: 'scheduled' },
    { time: '18:00', activityIdx: 1, coachIdx: 0, capacity: 12, booked: 10, status: 'scheduled' },
    { time: '19:00', activityIdx: 0, coachIdx: 1, capacity: 6, booked: 5, status: 'scheduled' },
  ],
]

const SATURDAY_TEMPLATES: SlotTemplate[] = [
  { time: '09:00', activityIdx: 1, coachIdx: 0, capacity: 12, booked: 9, status: 'scheduled' },
  { time: '10:00', activityIdx: 0, coachIdx: 1, capacity: 6, booked: 4, status: 'scheduled' },
  { time: '11:00', activityIdx: 1, coachIdx: 0, capacity: 12, booked: 6, status: 'scheduled' },
]

const SUNDAY_TEMPLATES: SlotTemplate[] = []

function buildWeekSlots(monday: Date): TimeSlot[] {
  const slots: TimeSlot[] = []
  let id = 0

  function addDay(dayOffset: number, templates: SlotTemplate[]) {
    const d = new Date(monday)
    d.setDate(d.getDate() + dayOffset)
    const dateStr = formatDate(d)

    for (const tpl of templates) {
      const activity = ACTIVITIES[tpl.activityIdx]
      slots.push({
        id: `slot-${id++}`,
        date: dateStr,
        startTime: tpl.time,
        endTime: addMinutes(tpl.time, activity.durationMin),
        activity,
        coach: COACHES[tpl.coachIdx],
        booked: tpl.booked,
        capacity: tpl.capacity,
        status: tpl.status,
        members: pickMembers(tpl.booked),
      })
    }
  }

  for (let i = 0; i < 5; i++) addDay(i, WEEKDAY_TEMPLATES[i])
  addDay(5, SATURDAY_TEMPLATES)
  addDay(6, SUNDAY_TEMPLATES)

  return slots
}

export interface CreateSlotInput {
  activityId: string
  coachId: string
  date: string
  startTime: string
  duration: number
  capacity: number
  level: string
  notes: string
  repeat: boolean
  repeatWeeks: number
}

let nextSlotId = 1000

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function usePlanning() {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [filterCoach, setFilterCoach] = useState<string | null>(null)
  const [filterActivity, setFilterActivity] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [extraSlots, setExtraSlots] = useState<TimeSlot[]>([])
  const [version, setVersion] = useState(0)

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 6)
    return d
  }, [weekStart])

  const baseSlots = useMemo(() => {
    setLoading(true)
    const s = buildWeekSlots(weekStart)
    setTimeout(() => setLoading(false), 400)
    return s
  }, [weekStart])

  const allSlots = useMemo(() => {
    void version // trigger recalc on CRUD
    return [...baseSlots, ...extraSlots]
  }, [baseSlots, extraSlots, version])

  const filteredSlots = useMemo(() => {
    return allSlots.filter((s) => {
      if (filterCoach && s.coach.id !== filterCoach) return false
      if (filterActivity && s.activity.id !== filterActivity) return false
      if (filterStatus && s.status !== filterStatus) return false
      return true
    })
  }, [allSlots, filterCoach, filterActivity, filterStatus])

  const getSlotsByDay = useCallback(
    (dateStr: string) => filteredSlots.filter((s) => s.date === dateStr),
    [filteredSlots],
  )

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      return d
    })
  }, [weekStart])

  function navigate(dir: 'prev' | 'next' | 'today') {
    setSelectedSlot(null)
    if (dir === 'today') {
      setWeekStart(getMonday(new Date()))
    } else {
      setWeekStart((prev) => {
        const d = new Date(prev)
        d.setDate(d.getDate() + (dir === 'next' ? 7 : -7))
        return d
      })
    }
  }

  function checkOverlap(coachId: string, date: string, startTime: string, duration: number, excludeId?: string): boolean {
    const newStart = timeToMinutes(startTime)
    const newEnd = newStart + duration
    return allSlots.some((s) => {
      if (s.id === excludeId) return false
      if (s.coach.id !== coachId || s.date !== date || s.status === 'cancelled') return false
      const sStart = timeToMinutes(s.startTime)
      const sEnd = timeToMinutes(s.endTime)
      return newStart < sEnd && newEnd > sStart
    })
  }

  function createSlot(input: CreateSlotInput): number {
    const activity = ACTIVITIES.find((a) => a.id === input.activityId)!
    const coach = COACHES.find((c) => c.id === input.coachId)!
    const count = input.repeat ? input.repeatWeeks : 1
    const newSlots: TimeSlot[] = []

    for (let i = 0; i < count; i++) {
      const d = new Date(input.date)
      d.setDate(d.getDate() + i * 7)
      const dateStr = formatDate(d)

      newSlots.push({
        id: `slot-${nextSlotId++}`,
        date: dateStr,
        startTime: input.startTime,
        endTime: addMinutes(input.startTime, input.duration),
        activity,
        coach,
        booked: 0,
        capacity: input.capacity,
        status: 'scheduled',
        members: [],
      })
    }

    setExtraSlots((prev) => [...prev, ...newSlots])
    setVersion((v) => v + 1)
    return count
  }

  function updateSlot(id: string, input: CreateSlotInput) {
    const activity = ACTIVITIES.find((a) => a.id === input.activityId)!
    const coach = COACHES.find((c) => c.id === input.coachId)!

    // Update in extra slots
    setExtraSlots((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              activity,
              coach,
              date: input.date,
              startTime: input.startTime,
              endTime: addMinutes(input.startTime, input.duration),
              capacity: input.capacity,
            }
          : s,
      ),
    )
    setVersion((v) => v + 1)
  }

  function cancelSlot(id: string) {
    // Mark as cancelled in extra slots or base slots
    setExtraSlots((prev) => {
      const found = prev.find((s) => s.id === id)
      if (found) {
        return prev.map((s) => (s.id === id ? { ...s, status: 'cancelled' as const } : s))
      }
      // If it's a base slot, copy it as cancelled to extras
      const base = baseSlots.find((s) => s.id === id)
      if (base) {
        return [...prev, { ...base, status: 'cancelled' as const }]
      }
      return prev
    })
    setVersion((v) => v + 1)
  }

  function removeSlot(id: string) {
    // Permanently remove from extras
    setExtraSlots((prev) => prev.filter((s) => s.id !== id))
    setVersion((v) => v + 1)
  }

  return {
    weekStart,
    weekEnd,
    weekDays,
    loading,
    filteredSlots,
    getSlotsByDay,
    navigate,
    selectedSlot,
    setSelectedSlot,
    filterCoach,
    setFilterCoach,
    filterActivity,
    setFilterActivity,
    filterStatus,
    setFilterStatus,
    coaches: COACHES,
    activities: ACTIVITIES,
    createSlot,
    updateSlot,
    cancelSlot,
    removeSlot,
    checkOverlap,
  }
}
