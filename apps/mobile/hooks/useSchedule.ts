import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const DOPAMINE_GYM_ID = 'a0000000-0000-0000-0000-000000000001'

export interface ScheduleSlot {
  id: string
  date: string
  dayOfWeek: number
  time: string
  endTime: string
  activity: string
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

function toHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getMonday(d: Date): Date {
  const r = new Date(d)
  const day = r.getDay()
  r.setDate(r.getDate() - (day === 0 ? 6 : day - 1))
  r.setHours(0, 0, 0, 0)
  return r
}

export function useSchedule() {
  const [allSlots, setAllSlots] = useState<ScheduleSlot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activityFilter, setActivityFilter] = useState<string | null>(null)
  const [weekFilter, setWeekFilter] = useState<'current' | 'next' | null>(null)
  const [coachFilter, setCoachFilter] = useState<string | null>(null)

  const fetchSlots = useCallback(async () => {
    setIsLoading(true)
    try {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 14)

      const { data, error } = await supabase
        .from('time_slots')
        .select(`
          id, starts_at, ends_at, capacity, bookings_count,
          activities(name, color, duration_min),
          coaches(name)
        `)
        .eq('gym_id', DOPAMINE_GYM_ID)
        .gte('starts_at', start.toISOString())
        .lt('starts_at', end.toISOString())
        .neq('status', 'cancelled')
        .order('starts_at')

      if (error) throw error

      setAllSlots((data ?? []).map((row: Record<string, unknown>) => {
        const act = row.activities as Record<string, unknown> | null
        const coach = row.coaches as Record<string, unknown> | null
        const startsAt = row.starts_at as string
        const d = new Date(startsAt)
        return {
          id: row.id as string,
          date: toDateStr(d),
          dayOfWeek: d.getDay(),
          time: toHHMM(startsAt),
          endTime: toHHMM(row.ends_at as string),
          activity: (act?.name as string) ?? 'Open Gym',
          coach: (coach?.name as string) ?? '',
          duration: (act?.duration_min as number) ?? 60,
          capacity: row.capacity as number,
          booked: (row.bookings_count as number) ?? 0,
          color: (act?.color as string) ?? '#4ECDC4',
        }
      }))
    } catch (e) {
      console.error('Failed to fetch schedule', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchSlots() }, [fetchSlots])

  const filteredSlots = useMemo(() => {
    let result = allSlots

    if (activityFilter) result = result.filter((s) => s.activity === activityFilter)
    if (coachFilter) result = result.filter((s) => s.coach === coachFilter)

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

      const startStr = toDateStr(start)
      const endStr = toDateStr(end)
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

  // Extract unique coaches from fetched data
  const coaches = useMemo(() => {
    const names = new Set(allSlots.map((s) => s.coach))
    return Array.from(names).filter(Boolean)
  }, [allSlots])

  return {
    allSlots, filteredSlots, groupedByDay, isLoading,
    activityFilter, setActivityFilter,
    weekFilter, setWeekFilter,
    coachFilter, setCoachFilter,
    resetFilters, hasActiveFilters, coaches,
  }
}
