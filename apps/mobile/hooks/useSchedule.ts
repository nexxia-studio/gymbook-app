import { useState, useMemo, useCallback } from 'react'

export interface ScheduleSlot {
  id: string
  date: string
  dayOfWeek: number
  time: string
  endTime: string
  activity: 'Open Gym' | 'HIIT / Hyrox'
  coach: string
  duration: number
  capacity: number
  booked: number
  color: string
}

export interface DaySection {
  date: Date
  dateStr: string
  data: ScheduleSlot[]
}

interface Template {
  time: string
  activity: 'Open Gym' | 'HIIT / Hyrox'
  duration: number
  capacity: number
  color: string
}

const WEEKDAY: Template[] = [
  { time: '07:30', activity: 'Open Gym', duration: 120, capacity: 6, color: '#4ECDC4' },
  { time: '12:15', activity: 'HIIT / Hyrox', duration: 60, capacity: 12, color: '#FF8E53' },
  { time: '18:00', activity: 'Open Gym', duration: 120, capacity: 6, color: '#4ECDC4' },
  { time: '19:00', activity: 'HIIT / Hyrox', duration: 60, capacity: 12, color: '#FF8E53' },
]

const SATURDAY: Template[] = [
  { time: '09:00', activity: 'HIIT / Hyrox', duration: 60, capacity: 12, color: '#FF8E53' },
  { time: '10:00', activity: 'Open Gym', duration: 120, capacity: 6, color: '#4ECDC4' },
  { time: '11:00', activity: 'HIIT / Hyrox', duration: 60, capacity: 12, color: '#FF8E53' },
]

const COACHES = ['Nicolas', 'François']

function addMin(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const t = h * 60 + m + mins
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMonday(d: Date): Date {
  const r = new Date(d)
  const day = r.getDay()
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1))
  r.setHours(0, 0, 0, 0)
  return r
}

function buildSlots(): ScheduleSlot[] {
  const slots: ScheduleSlot[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let offset = 0; offset < 14; offset++) {
    const d = new Date(today)
    d.setDate(d.getDate() + offset)
    const dow = d.getDay()
    if (dow === 0) continue // Sunday closed

    const templates = dow === 6 ? SATURDAY : WEEKDAY
    const dateStr = fmtDate(d)

    templates.forEach((tpl, i) => {
      const booked = Math.min(
        tpl.capacity,
        Math.floor(Math.random() * (tpl.capacity + 2)),
      )
      slots.push({
        id: `${dateStr}-${tpl.time}-${tpl.activity}`,
        date: dateStr,
        dayOfWeek: dow,
        time: tpl.time,
        endTime: addMin(tpl.time, tpl.duration),
        activity: tpl.activity,
        coach: COACHES[(i + dow) % COACHES.length],
        duration: tpl.duration,
        capacity: tpl.capacity,
        booked: Math.max(0, booked),
        color: tpl.color,
      })
    })
  }
  return slots
}

export function useSchedule() {
  const [activityFilter, setActivityFilter] = useState<string | null>(null)
  const [weekFilter, setWeekFilter] = useState<'current' | 'next' | null>(null)
  const [coachFilter, setCoachFilter] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const allSlots = useMemo(() => {
    setIsLoading(true)
    const s = buildSlots()
    setTimeout(() => setIsLoading(false), 300)
    return s
  }, [])

  const filteredSlots = useMemo(() => {
    let result = allSlots

    if (activityFilter) {
      result = result.filter((s) => s.activity === activityFilter)
    }

    if (coachFilter) {
      result = result.filter((s) => s.coach === coachFilter)
    }

    if (weekFilter) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const monday = getMonday(today)
      const start = new Date(monday)
      const end = new Date(monday)

      if (weekFilter === 'current') {
        end.setDate(end.getDate() + 6)
      } else {
        start.setDate(start.getDate() + 7)
        end.setDate(end.getDate() + 13)
      }

      const startStr = fmtDate(start)
      const endStr = fmtDate(end)
      result = result.filter((s) => s.date >= startStr && s.date <= endStr)
    }

    return result
  }, [allSlots, activityFilter, coachFilter, weekFilter])

  const groupedByDay = useMemo<DaySection[]>(() => {
    const map = new Map<string, ScheduleSlot[]>()
    for (const slot of filteredSlots) {
      if (!map.has(slot.date)) map.set(slot.date, [])
      map.get(slot.date)!.push(slot)
    }
    return Array.from(map.entries()).map(([dateStr, data]) => ({
      date: new Date(dateStr.replace(/-/g, '/')),
      dateStr,
      data,
    }))
  }, [filteredSlots])

  const resetFilters = useCallback(() => {
    setActivityFilter(null)
    setWeekFilter(null)
    setCoachFilter(null)
  }, [])

  const hasActiveFilters = activityFilter !== null || weekFilter !== null || coachFilter !== null

  return {
    allSlots,
    filteredSlots,
    groupedByDay,
    isLoading,
    activityFilter,
    setActivityFilter,
    weekFilter,
    setWeekFilter,
    coachFilter,
    setCoachFilter,
    resetFilters,
    hasActiveFilters,
    coaches: COACHES,
  }
}
