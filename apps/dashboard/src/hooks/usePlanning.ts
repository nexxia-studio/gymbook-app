import { useState, useEffect, useMemo, useCallback } from 'react'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymTimezone } from '@/hooks/useGymTimezone'
import { getDisplayStatus, type TimeSlot, type Activity, type Coach, type SlotStatus } from '@/types/planning'

function getMonday(d: Date, tz: string): Date {
  const zoned = toZonedTime(d, tz)
  const day = zoned.getDay()
  const diff = day === 0 ? -6 : 1 - day
  zoned.setDate(zoned.getDate() + diff)
  zoned.setHours(0, 0, 0, 0)
  return fromZonedTime(zoned, tz)
}

function formatDateTz(d: Date, tz: string): string {
  const z = toZonedTime(d, tz)
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`
}

function toHHMM(iso: string, tz: string): string {
  const z = toZonedTime(new Date(iso), tz)
  return `${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')}`
}

function toDateStr(iso: string, tz: string): string {
  return formatDateTz(new Date(iso), tz)
}

interface DbMember {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  noshow_count: number | null
  avatar_url: string | null
}

interface DbBooking {
  id: string
  member_id: string
  status: string | null
  member: DbMember | null
}

interface DbSlot {
  id: string
  starts_at: string
  ends_at: string
  capacity: number
  bookings_count: number | null
  status: string | null
  notes: string | null
  activities: { id: string; name: string; color: string | null; duration_min: number; icon: string | null; active: boolean | null } | null
  coaches: { id: string; name: string; active: boolean | null } | null
  bookings: DbBooking[] | null
}

function mapSlot(row: DbSlot, tz: string): TimeSlot {
  return {
    id: row.id,
    date: toDateStr(row.starts_at, tz),
    startTime: toHHMM(row.starts_at, tz),
    endTime: toHHMM(row.ends_at, tz),
    activity: {
      id: row.activities?.id ?? '',
      name: row.activities?.name ?? '',
      color: row.activities?.color ?? '#4ECDC4',
      durationMin: row.activities?.duration_min ?? 60,
      active: row.activities?.active ?? true,
    },
    coach: {
      id: row.coaches?.id ?? '',
      name: row.coaches?.name ?? '',
      active: row.coaches?.active ?? true,
    },
    booked: row.bookings_count ?? row.bookings?.filter((b) => b.status === 'confirmed').length ?? 0,
    capacity: row.capacity,
    status: (row.status as SlotStatus) ?? 'scheduled',
    members: (row.bookings ?? [])
      .filter((b) => b.status === 'confirmed')
      .map((b) => ({
        id: b.member?.id ?? b.member_id,
        bookingId: b.id,
        firstName: b.member?.first_name ?? '',
        lastName: b.member?.last_name ?? '',
        email: b.member?.email ?? '',
        noshowCount: b.member?.noshow_count ?? 0,
        avatarUrl: b.member?.avatar_url ?? undefined,
      })),
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
  const tz = useGymTimezone()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date(), tz))
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
          activities(id, name, color, duration_min, icon, active),
          coaches(id, name, active),
          bookings(
            id, member_id, status,
            member:profiles(id, first_name, last_name, email, noshow_count, avatar_url)
          )
        `)
        .eq('gym_id', gymId)
        .gte('starts_at', weekStart.toISOString())
        .lte('starts_at', weekEnd.toISOString())
        .neq('status', 'deleted')
        .order('starts_at')

      if (error) throw error
      setSlots((data as unknown as DbSlot[] ?? []).map((row) => mapSlot(row, tz)))
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
      if (filterStatus) {
        const display = getDisplayStatus(s)
        if (display !== filterStatus) return false
      }
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
      setWeekStart(getMonday(new Date(), tz))
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
      // Parse user input as local Brussels time, convert to UTC for storage
      const [y, mo, da] = input.date.split('-').map(Number)
      const baseDate = new Date(y, mo - 1, da)
      baseDate.setDate(baseDate.getDate() + i * 7)
      const dateStr = `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`
      const startsAtUtc = fromZonedTime(new Date(`${dateStr}T${input.startTime}:00`), tz)
      const endsAtUtc = fromZonedTime(new Date(`${dateStr}T${addMinutes(input.startTime, input.duration)}:00`), tz)

      inserts.push({
        gym_id: gymId,
        activity_id: input.activityId,
        coach_id: input.coachId,
        starts_at: startsAtUtc.toISOString(),
        ends_at: endsAtUtc.toISOString(),
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
    const startsAtUtc = fromZonedTime(new Date(`${input.date}T${input.startTime}:00`), tz)
    const endsAtUtc = fromZonedTime(new Date(`${input.date}T${addMinutes(input.startTime, input.duration)}:00`), tz)

    await supabase.from('time_slots').update({
      activity_id: input.activityId,
      coach_id: input.coachId,
      starts_at: startsAtUtc.toISOString(),
      ends_at: endsAtUtc.toISOString(),
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
