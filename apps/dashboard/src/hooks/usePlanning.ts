import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import type { TimeSlot, Activity, Coach, SlotStatus } from '@/types/planning'

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

function toHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toDateStr(iso: string): string {
  const d = new Date(iso)
  return formatDate(d)
}

interface DbSlot {
  id: string
  starts_at: string
  ends_at: string
  capacity: number
  bookings_count: number | null
  status: string | null
  notes: string | null
  activities: { id: string; name: string; color: string | null; duration_min: number; icon: string | null } | null
  coaches: { id: string; name: string } | null
  bookings: Array<{ id: string; member_id: string; status: string | null }> | null
}

function mapSlot(row: DbSlot): TimeSlot {
  return {
    id: row.id,
    date: toDateStr(row.starts_at),
    startTime: toHHMM(row.starts_at),
    endTime: toHHMM(row.ends_at),
    activity: {
      id: row.activities?.id ?? '',
      name: row.activities?.name ?? '',
      color: row.activities?.color ?? '#4ECDC4',
      durationMin: row.activities?.duration_min ?? 60,
    },
    coach: {
      id: row.coaches?.id ?? '',
      name: row.coaches?.name ?? '',
    },
    booked: row.bookings_count ?? row.bookings?.filter((b) => b.status === 'confirmed').length ?? 0,
    capacity: row.capacity,
    status: (row.status as SlotStatus) ?? 'scheduled',
    members: (row.bookings ?? [])
      .filter((b) => b.status === 'confirmed')
      .map((b) => ({ id: b.member_id, name: b.member_id.slice(0, 8) })),
  }
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

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export function usePlanning() {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null)
  const [filterCoach, setFilterCoach] = useState<string | null>(null)
  const [filterActivity, setFilterActivity] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [activitiesList, setActivitiesList] = useState<Activity[]>([])
  const [coachesList, setCoachesList] = useState<Coach[]>([])

  const gymId = useAuthStore((s) => s.gym_id)

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 6)
    d.setHours(23, 59, 59, 999)
    return d
  }, [weekStart])

  // Fetch slots for the week
  const fetchSlots = useCallback(async () => {
    if (!gymId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('time_slots')
        .select(`
          id, starts_at, ends_at, capacity, bookings_count, status, notes,
          activities(id, name, color, duration_min, icon),
          coaches(id, name),
          bookings(id, member_id, status)
        `)
        .eq('gym_id', gymId)
        .gte('starts_at', weekStart.toISOString())
        .lte('starts_at', weekEnd.toISOString())
        .neq('status', 'deleted')
        .order('starts_at')

      if (error) throw error
      setSlots((data as unknown as DbSlot[] ?? []).map(mapSlot))
    } catch (e) {
      console.error('Failed to fetch slots', e)
    } finally {
      setLoading(false)
    }
  }, [gymId, weekStart, weekEnd])

  // Fetch activities + coaches for filters and modals
  const fetchMeta = useCallback(async () => {
    if (!gymId) return
    const [actRes, coachRes] = await Promise.all([
      supabase.from('activities').select('id, name, color, duration_min').eq('gym_id', gymId).order('sort_order'),
      supabase.from('coaches').select('id, name').eq('gym_id', gymId).order('sort_order'),
    ])
    setActivitiesList((actRes.data ?? []).map((a) => ({
      id: a.id, name: a.name, color: a.color ?? '#4ECDC4', durationMin: a.duration_min,
    })))
    setCoachesList((coachRes.data ?? []).map((c) => ({ id: c.id, name: c.name })))
  }, [gymId])

  useEffect(() => { fetchSlots() }, [fetchSlots])
  useEffect(() => { fetchMeta() }, [fetchMeta])

  // Realtime subscription
  useEffect(() => {
    if (!gymId) return
    const channel = supabase
      .channel('planning-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${gymId}` }, () => fetchSlots())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `gym_id=eq.${gymId}` }, () => fetchSlots())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [gymId, fetchSlots])

  const filteredSlots = useMemo(() => {
    return slots.filter((s) => {
      if (filterCoach && s.coach.id !== filterCoach) return false
      if (filterActivity && s.activity.id !== filterActivity) return false
      if (filterStatus && s.status !== filterStatus) return false
      return true
    })
  }, [slots, filterCoach, filterActivity, filterStatus])

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
    const newStart = timeToMin(startTime)
    const newEnd = newStart + duration
    return slots.some((s) => {
      if (s.id === excludeId) return false
      if (s.coach.id !== coachId || s.date !== date || s.status === 'cancelled') return false
      const sStart = timeToMin(s.startTime)
      const sEnd = timeToMin(s.endTime)
      return newStart < sEnd && newEnd > sStart
    })
  }

  async function createSlot(input: CreateSlotInput): Promise<number> {
    if (!gymId) return 0
    const count = input.repeat ? input.repeatWeeks : 1
    const inserts = []

    for (let i = 0; i < count; i++) {
      const d = new Date(input.date)
      d.setDate(d.getDate() + i * 7)
      const dateStr = formatDate(d)
      const startsAt = `${dateStr}T${input.startTime}:00`
      const endsAt = `${dateStr}T${addMinutes(input.startTime, input.duration)}:00`

      inserts.push({
        gym_id: gymId,
        activity_id: input.activityId,
        coach_id: input.coachId,
        starts_at: startsAt,
        ends_at: endsAt,
        capacity: input.capacity,
        level: input.level,
        notes: input.notes || null,
        status: 'scheduled',
      })
    }

    await supabase.from('time_slots').insert(inserts)
    fetchSlots()
    return count
  }

  async function updateSlot(id: string, input: CreateSlotInput) {
    const dateStr = input.date
    const startsAt = `${dateStr}T${input.startTime}:00`
    const endsAt = `${dateStr}T${addMinutes(input.startTime, input.duration)}:00`

    await supabase.from('time_slots').update({
      activity_id: input.activityId,
      coach_id: input.coachId,
      starts_at: startsAt,
      ends_at: endsAt,
      capacity: input.capacity,
      level: input.level,
      notes: input.notes || null,
    }).eq('id', id)
    fetchSlots()
  }

  async function cancelSlot(id: string) {
    await supabase.from('time_slots').update({ status: 'cancelled' }).eq('id', id)
    fetchSlots()
  }

  async function removeSlot(id: string) {
    await supabase.from('time_slots').delete().eq('id', id)
    fetchSlots()
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
    coaches: coachesList,
    activities: activitiesList,
    createSlot,
    updateSlot,
    cancelSlot,
    removeSlot,
    checkOverlap,
  }
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
