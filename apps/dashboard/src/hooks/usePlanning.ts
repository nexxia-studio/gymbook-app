import { useState, useEffect, useMemo, useCallback } from 'react'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymTimezone } from '@/hooks/useGymTimezone'
import { getDisplayStatus, type TimeSlot, type Activity, type Coach, type SlotStatus, type AttendanceStatus } from '@/types/planning'

// GYM-174 — statuts d'une réservation "inscrite" (pointable), hors cancelled/waitlisted.
const ATTENDANCE_STATUSES = ['confirmed', 'attended', 'no_show', 'excused']

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
  deleted_at: string | null
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
    waitlisted: row.bookings?.filter((b) => b.status === 'waitlisted').length ?? 0,
    capacity: row.capacity,
    status: (row.status as SlotStatus) ?? 'scheduled',
    // GYM-146 — ne pas afficher un inscrit dont le compte est supprimé (soft-delete).
    // Filtrage JS (PostgREST ne filtre pas proprement une relation imbriquée via .is()).
    // GYM-174 — on inclut désormais confirmed/attended/no_show/excused (les inscrits
    // pointables), plus seulement 'confirmed', pour permettre le pointage des présences.
    members: (row.bookings ?? [])
      .filter((b) => ATTENDANCE_STATUSES.includes(b.status ?? '') && !b.member?.deleted_at)
      .map((b) => ({
        id: b.member?.id ?? b.member_id,
        bookingId: b.id,
        firstName: b.member?.first_name ?? '',
        lastName: b.member?.last_name ?? '',
        email: b.member?.email ?? '',
        noshowCount: b.member?.noshow_count ?? 0,
        avatarUrl: b.member?.avatar_url ?? undefined,
        status: (b.status as AttendanceStatus) ?? 'confirmed',
      })),
  }
}

export interface CancelSlotSummary {
  bookingsCancelled: number
  creditsRefunded: number
  waitlistCleared: number
  notified: number
}

export interface MemberSearchResult {
  id: string
  firstName: string
  lastName: string
  email: string
}

export interface MarkAttendanceResult {
  status: string
  penalty: { action?: string; type?: string; expires_at?: string | null } | null
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

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return ymd(d)
}

export function usePlanning() {
  const tz = useGymTimezone()
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date(), tz))
  // Date range actually fetched. Defaults to the week of weekStart but can be widened
  // by view changes (month/day) via setVisibleRange.
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const start = ymd(getMonday(new Date(), tz))
    return { start, end: addDaysIso(start, 7) }
  })
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

  // Keep dateRange aligned with weekStart when the page navigates via prev/today/next.
  // View-change-driven range updates (setVisibleRange) leave weekStart untouched.
  useEffect(() => {
    const start = ymd(weekStart)
    const end = addDaysIso(start, 7)
    setDateRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [weekStart])

  // Fetch slots for the visible date range
  const fetchSlots = useCallback(async () => {
    if (!gymId) return
    setLoading(true)
    try {
      const startIso = new Date(`${dateRange.start}T00:00:00`).toISOString()
      const endIso = new Date(`${dateRange.end}T23:59:59`).toISOString()
      const { data, error } = await supabase
        .from('time_slots')
        .select(`
          id, starts_at, ends_at, capacity, bookings_count, status, notes,
          activities(id, name, color, duration_min, icon, active),
          coaches(id, name, active),
          bookings(
            id, member_id, status,
            member:profiles(id, first_name, last_name, email, noshow_count, avatar_url, deleted_at)
          )
        `)
        .eq('gym_id', gymId)
        .gte('starts_at', startIso)
        .lte('starts_at', endIso)
        .neq('status', 'deleted')
        .order('starts_at')

      if (error) throw error
      setSlots((data as unknown as DbSlot[] ?? []).map((row) => mapSlot(row, tz)))
    } catch (e) {
      console.error('Failed to fetch slots', e)
    } finally {
      setLoading(false)
    }
  }, [gymId, dateRange.start, dateRange.end, tz])

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

  // Realtime subscription (gym-scoped channel) + 30s polling fallback
  useEffect(() => {
    if (!gymId) return
    const channel = supabase
      .channel(`planning-${gymId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${gymId}` }, (payload) => {
        console.log('[Realtime Dashboard] time_slots:', payload.eventType)
        fetchSlots()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `gym_id=eq.${gymId}` }, (payload) => {
        console.log('[Realtime Dashboard] bookings:', payload.eventType)
        fetchSlots()
      })
      .subscribe((status) => {
        console.log('[Realtime Dashboard] Planning subscription:', status)
      })

    const pollingInterval = setInterval(() => {
      fetchSlots()
    }, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(pollingInterval)
    }
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

  // Snap any date (Date or YYYY-MM-DD) to the Monday of that week and update the active week.
  function goToDate(date: Date | string) {
    setSelectedSlot(null)
    const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : new Date(date)
    setWeekStart(getMonday(d, tz))
  }

  // Set the visible date range. In day/week views (≤ 8 days), also realign weekStart
  // to the Monday of the displayed range so the page header label updates. In month
  // view (~35-42 days), leave weekStart untouched — the header keeps the last week label.
  function setVisibleRange(start: string, end: string) {
    setDateRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    const startDate = new Date(`${start}T00:00:00`)
    const endDate = new Date(`${end}T00:00:00`)
    const daysSpan = Math.round((endDate.getTime() - startDate.getTime()) / 86400000)
    if (daysSpan > 0 && daysSpan <= 8) {
      const monday = getMonday(startDate, tz)
      setWeekStart((prev) => (ymd(prev) === ymd(monday) ? prev : monday))
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

  // GYM-143 — l'annulation passe par l'Edge Function cancel-slot (annulation atomique
  // + recrédit exact des membres + purge waitlist + notifications), JAMAIS par un simple
  // UPDATE de statut (qui n'aurait ni recrédité ni notifié). Retourne le résumé pour le toast.
  async function cancelSlot(id: string, reason?: string): Promise<CancelSlotSummary> {
    const { data, error } = await supabase.functions.invoke('cancel-slot', {
      body: { slot_id: id, reason: reason?.trim() || undefined },
    })
    if (error) throw error
    await fetchSlots()
    return {
      bookingsCancelled: (data?.bookings_cancelled as number) ?? 0,
      creditsRefunded: (data?.credits_refunded as number) ?? 0,
      waitlistCleared: (data?.waitlist_cleared as number) ?? 0,
      notified: (data?.notified as number) ?? 0,
    }
  }

  // GYM-174 — pointage d'une réservation via l'Edge Function mark-attendance
  // (mark_attendance_atomic : crédit + pénalités atomiques ; notification de sanction).
  // JAMAIS un simple UPDATE de statut (qui ne gérerait ni crédit ni pénalité ni notif).
  async function markAttendance(bookingId: string, status: AttendanceStatus): Promise<MarkAttendanceResult> {
    const { data, error } = await supabase.functions.invoke('mark-attendance', {
      body: { action: 'mark', booking_id: bookingId, status },
    })
    if (error) throw error
    await fetchSlots()
    return {
      status: (data?.status as string) ?? 'updated',
      penalty: (data?.penalty ?? null) as MarkAttendanceResult['penalty'],
    }
  }

  // GYM-174 — inscription à la volée d'un membre présent au comptoir puis pointé présent.
  async function walkIn(slotId: string, memberId: string): Promise<void> {
    const { error } = await supabase.functions.invoke('mark-attendance', {
      body: { action: 'walkin', slot_id: slotId, member_id: memberId },
    })
    if (error) throw error
    await fetchSlots()
  }

  // GYM-174 — recherche de membres de la salle pour le walk-in (hors déjà-inscrits).
  async function searchGymMembers(query: string, excludeIds: string[]): Promise<MemberSearchResult[]> {
    if (!gymId) return []
    const term = query.trim()
    if (term.length < 2) return []
    const { data, error } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('gym_id', gymId)
      .eq('role', 'member')
      .is('deleted_at', null)
      .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,email.ilike.%${term}%`)
      .limit(8)
    if (error) {
      console.error('searchGymMembers failed', error)
      return []
    }
    return (data ?? [])
      .filter((m) => !excludeIds.includes(m.id))
      .map((m) => ({
        id: m.id,
        firstName: m.first_name ?? '',
        lastName: m.last_name ?? '',
        email: m.email ?? '',
      }))
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
    goToDate,
    setVisibleRange,
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
    markAttendance,
    walkIn,
    searchGymMembers,
  }
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
