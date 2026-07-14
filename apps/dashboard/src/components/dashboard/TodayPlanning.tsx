import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymTimezone } from '@/hooks/useGymTimezone'
import { Skeleton } from '@/components/ui/Skeleton'
import type { DisplayStatus } from '@/types/planning'

interface SlotRow {
  id: string
  time: string
  endTime: string
  durationMin: number
  activity: string
  coach: string
  booked: number
  capacity: number
}

const statusColors: Record<DisplayStatus, string> = {
  scheduled: 'bg-accent-dim/15 text-accent-dim',
  completed: 'bg-dark/5 text-muted',
  cancelled: 'bg-red-50 text-red-500',
  in_progress: 'bg-green-500/15 text-green-600',
}

function getDisplayStatus(time: string, endTime: string, tz: string): DisplayStatus {
  const now = toZonedTime(new Date(), tz)
  const [sh, sm] = time.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const start = new Date(now)
  start.setHours(sh, sm, 0, 0)
  const end = new Date(now)
  end.setHours(eh, em, 0, 0)

  if (end < now) return 'completed'
  if (start <= now && now <= end) return 'in_progress'
  return 'scheduled'
}

function toHHMM(iso: string, tz: string): string {
  const z = toZonedTime(new Date(iso), tz)
  return `${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')}`
}

export function TodayPlanning() {
  const { t } = useTranslation()
  const gymId = useAuthStore((s) => s.gym_id)
  const tz = useGymTimezone()
  const [slots, setSlots] = useState<SlotRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchSlots = useCallback(async () => {
    if (!gymId) return
    setIsLoading(true)

    const now = toZonedTime(new Date(), tz)
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(now)
    todayEnd.setHours(23, 59, 59, 999)

    const { data, error } = await supabase
      .from('time_slots')
      .select(`
        id, starts_at, ends_at, capacity, bookings_count, status,
        activities(name),
        coaches(name)
      `)
      .eq('gym_id', gymId)
      .gte('starts_at', fromZonedTime(todayStart, tz).toISOString())
      .lte('starts_at', fromZonedTime(todayEnd, tz).toISOString())
      .neq('status', 'deleted')
      .order('starts_at')

    if (!error && data) {
      setSlots(data.map((row) => {
        const startTime = toHHMM(row.starts_at, tz)
        const endTime = toHHMM(row.ends_at, tz)
        const startMs = new Date(row.starts_at).getTime()
        const endMs = new Date(row.ends_at).getTime()
        return {
          id: row.id,
          time: startTime,
          endTime,
          durationMin: Math.round((endMs - startMs) / 60000),
          activity: (row.activities as { name: string } | null)?.name ?? '',
          coach: (row.coaches as { name: string } | null)?.name ?? '',
          booked: row.bookings_count ?? 0,
          capacity: row.capacity,
        }
      }))
    }
    setIsLoading(false)
  }, [gymId, tz])

  useEffect(() => { fetchSlots() }, [fetchSlots])

  // Realtime
  useEffect(() => {
    if (!gymId) return
    const channel = supabase
      .channel('today-planning')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_slots', filter: `gym_id=eq.${gymId}` }, () => fetchSlots())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `gym_id=eq.${gymId}` }, () => fetchSlots())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [gymId, fetchSlots])

  return (
    <div className="rounded-2xl bg-card p-5">
      <h2 className="mb-4 font-display text-lg font-black tracking-tight text-dark">
        {t('dashboard.today_planning')}
      </h2>

      <div className="flex flex-col gap-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="table-row" />
          ))
        ) : slots.length === 0 ? (
          <p className="py-6 text-center font-body text-sm text-muted">
            {t('planning.empty_day')}
          </p>
        ) : (
          slots.map((slot) => {
            const fillPercent = Math.round((slot.booked / slot.capacity) * 100)
            const displayStatus = getDisplayStatus(slot.time, slot.endTime, tz)
            const isLive = displayStatus === 'in_progress'

            return (
              <div
                key={slot.id}
                className={`flex items-center gap-4 rounded-xl border p-3 transition-colors hover:bg-background ${
                  isLive ? 'border-green-300' : 'border-border'
                }`}
              >
                <span className="w-12 shrink-0 font-body text-sm font-semibold text-dark">
                  {slot.time}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-sm font-medium text-dark">{slot.activity}</p>
                  <p className="font-body text-xs text-muted">{slot.coach}</p>
                </div>

                <div className="hidden w-28 flex-col gap-1 sm:flex">
                  <div className="h-1.5 overflow-hidden rounded-full bg-dark/5">
                    <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${fillPercent}%` }} />
                  </div>
                  <span className="font-body text-xs text-muted">
                    {t('dashboard.booked_of', { booked: slot.booked, capacity: slot.capacity })}
                  </span>
                </div>

                {displayStatus === 'scheduled' ? (
                  <span className="shrink-0 rounded-lg bg-accent px-2.5 py-1 font-body text-xs font-medium text-[#111111]">
                    {t('dashboard.slot_status.scheduled')}
                  </span>
                ) : (
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 font-body text-xs font-medium ${statusColors[displayStatus]}`}>
                    {isLive && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />}
                    {t(`dashboard.slot_status.${displayStatus}`)}
                  </span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
