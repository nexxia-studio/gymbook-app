import { useMemo, useState, useCallback } from 'react'
import { useBookingStore } from '../stores/useBookingStore'

export interface HomeSlot {
  id: string
  date: string // YYYY-MM-DD
  time: string // HH:mm
  endTime: string
  activity: 'Open Gym' | 'HIIT / Hyrox'
  coach: string
  duration: number
  capacity: number
  booked: number
  imageQuery: string
}

interface DayTemplate {
  time: string
  activity: 'Open Gym' | 'HIIT / Hyrox'
  duration: number
  capacity: number
}

const WEEKDAY_SCHEDULE: DayTemplate[] = [
  { time: '07:30', activity: 'Open Gym', duration: 120, capacity: 6 },
  { time: '12:15', activity: 'HIIT / Hyrox', duration: 60, capacity: 12 },
  { time: '18:00', activity: 'Open Gym', duration: 120, capacity: 6 },
  { time: '19:00', activity: 'HIIT / Hyrox', duration: 60, capacity: 12 },
]

const SATURDAY_SCHEDULE: DayTemplate[] = [
  { time: '09:00', activity: 'HIIT / Hyrox', duration: 60, capacity: 12 },
  { time: '10:00', activity: 'Open Gym', duration: 120, capacity: 6 },
  { time: '11:00', activity: 'HIIT / Hyrox', duration: 60, capacity: 12 },
]

const COACHES = ['Nicolas', 'François']

const MOCK_BOOKED: Record<string, number> = {
  '07:30-Open Gym': 4, '12:15-HIIT / Hyrox': 8,
  '18:00-Open Gym': 6, '19:00-HIIT / Hyrox': 10,
  '09:00-HIIT / Hyrox': 9, '10:00-Open Gym': 3, '11:00-HIIT / Hyrox': 7,
}

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getScheduleForDay(date: Date): HomeSlot[] {
  const dow = date.getDay() // 0=Sun
  if (dow === 0) return [] // Sunday closed

  const templates = dow === 6 ? SATURDAY_SCHEDULE : WEEKDAY_SCHEDULE
  const dateStr = formatDateStr(date)

  return templates.map((tpl, i) => ({
    id: `${dateStr}-${tpl.time}-${tpl.activity}`,
    date: dateStr,
    time: tpl.time,
    endTime: addMinutes(tpl.time, tpl.duration),
    activity: tpl.activity,
    coach: COACHES[(i + dow) % COACHES.length],
    duration: tpl.duration,
    capacity: tpl.capacity,
    booked: MOCK_BOOKED[`${tpl.time}-${tpl.activity}`] ?? Math.floor(Math.random() * tpl.capacity),
    imageQuery: tpl.activity === 'Open Gym' ? 'gym,fitness' : 'hiit,workout',
  }))
}

export function useHomeSchedule() {
  const [refreshKey, setRefreshKey] = useState(0)
  const { favorites, addFavorite, removeFavorite } = useBookingStore()

  const days = useMemo(() => {
    const today = new Date()
    return [0, 1, 2].map((offset) => {
      const d = new Date(today)
      d.setDate(d.getDate() + offset)
      d.setHours(0, 0, 0, 0)
      return d
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const scheduleByDay = useMemo(
    () => days.map((d) => ({ date: d, slots: getScheduleForDay(d) })),
    [days],
  )

  const isFavorite = useCallback(
    (slotId: string) => favorites.includes(slotId),
    [favorites],
  )

  const toggleFavorite = useCallback(
    (slotId: string) => {
      if (favorites.includes(slotId)) {
        removeFavorite(slotId)
      } else {
        addFavorite(slotId)
      }
    },
    [favorites, addFavorite, removeFavorite],
  )

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  return { days, scheduleByDay, isFavorite, toggleFavorite, refresh }
}
