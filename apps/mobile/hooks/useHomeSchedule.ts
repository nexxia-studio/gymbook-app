import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useBookingStore } from '../stores/useBookingStore'

const DOPAMINE_GYM_ID = 'a0000000-0000-0000-0000-000000000001'

export interface HomeSlot {
  id: string
  date: string
  time: string
  endTime: string
  activity: string
  activityColor: string
  coach: string
  duration: number
  capacity: number
  booked: number
  imageQuery: string
}

function toHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toDateStr(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function diffMin(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
}

export function useHomeSchedule() {
  const [slots, setSlots] = useState<HomeSlot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [bookedSlotIds, setBookedSlotIds] = useState<Set<string>>(new Set())
  const { favorites, addFavorite, removeFavorite } = useBookingStore()

  const days = (() => {
    const today = new Date()
    return [0, 1, 2].map((offset) => {
      const d = new Date(today)
      d.setDate(d.getDate() + offset)
      d.setHours(0, 0, 0, 0)
      return d
    })
  })()

  const fetchSlots = useCallback(async () => {
    setIsLoading(true)
    try {
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 3)

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

      setSlots((data ?? []).map((row: Record<string, unknown>) => {
        const act = row.activities as Record<string, unknown> | null
        const coach = row.coaches as Record<string, unknown> | null
        const actName = (act?.name as string) ?? 'Open Gym'
        return {
          id: row.id as string,
          date: toDateStr(row.starts_at as string),
          time: toHHMM(row.starts_at as string),
          endTime: toHHMM(row.ends_at as string),
          activity: actName,
          activityColor: (act?.color as string) ?? '#4ECDC4',
          coach: (coach?.name as string) ?? '',
          duration: diffMin(row.starts_at as string, row.ends_at as string),
          capacity: row.capacity as number,
          booked: (row.bookings_count as number) ?? 0,
          imageQuery: actName.includes('Open') ? 'gym,fitness' : 'hiit,workout',
        }
      }))
    } catch (e) {
      console.error('Failed to fetch home schedule', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchSlots() }, [fetchSlots])

  // Fetch member's confirmed bookings
  useEffect(() => {
    async function fetchBooked() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('bookings')
        .select('slot_id')
        .eq('member_id', user.id)
        .in('status', ['confirmed', 'waitlisted'])
      setBookedSlotIds(new Set((data ?? []).map((b) => b.slot_id)))
    }
    fetchBooked()
  }, [slots]) // re-check when slots change

  const scheduleByDay = days.map((d, i) => {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    let daySlots = slots.filter((s) => s.date === dateStr)
    // For today (index 0), hide past slots
    if (i === 0) {
      const now = new Date()
      daySlots = daySlots.filter((s) => {
        const [h, m] = s.endTime.split(':').map(Number)
        const end = new Date(d)
        end.setHours(h, m, 0, 0)
        return end > now
      })
    }
    return { date: d, slots: daySlots }
  })

  const isFavorite = useCallback(
    (slotId: string) => favorites.includes(slotId),
    [favorites],
  )

  const toggleFavorite = useCallback(
    (slotId: string) => {
      if (favorites.includes(slotId)) removeFavorite(slotId)
      else addFavorite(slotId)
    },
    [favorites, addFavorite, removeFavorite],
  )

  const isSlotBooked = useCallback((slotId: string) => bookedSlotIds.has(slotId), [bookedSlotIds])

  return { days, scheduleByDay, isFavorite, toggleFavorite, isSlotBooked, refresh: fetchSlots, isLoading }
}
