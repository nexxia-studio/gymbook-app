import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { toZonedTime } from 'date-fns-tz'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import { useGymTimezone } from '@/hooks/useGymTimezone'
import { Skeleton } from '@/components/ui/Skeleton'

interface UpcomingSlot {
  id: string
  time: string
  activity: string
  coach: string
  booked: number
  capacity: number
}

function toHHMM(iso: string, tz: string): string {
  const z = toZonedTime(new Date(iso), tz)
  return `${String(z.getHours()).padStart(2, '0')}:${String(z.getMinutes()).padStart(2, '0')}`
}

export function UpcomingSessions() {
  const { t } = useTranslation()
  const gymId = useAuthStore((s) => s.gym_id)
  const tz = useGymTimezone()
  const [slots, setSlots] = useState<UpcomingSlot[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchSlots = useCallback(async () => {
    if (!gymId) return
    setIsLoading(true)

    const { data, error } = await supabase
      .from('time_slots')
      .select(`
        id, starts_at, capacity, bookings_count,
        activities(name),
        coaches(name)
      `)
      .eq('gym_id', gymId)
      .gt('starts_at', new Date().toISOString())
      .neq('status', 'deleted')
      .neq('status', 'cancelled')
      .order('starts_at')
      .limit(3)

    if (!error && data) {
      setSlots(data.map((row) => ({
        id: row.id,
        time: toHHMM(row.starts_at, tz),
        activity: (row.activities as { name: string } | null)?.name ?? '',
        coach: (row.coaches as { name: string } | null)?.name ?? '',
        booked: row.bookings_count ?? 0,
        capacity: row.capacity,
      })))
    }
    setIsLoading(false)
  }, [gymId, tz])

  useEffect(() => { fetchSlots() }, [fetchSlots])

  useEffect(() => {
    if (!gymId) return
    const channel = supabase
      .channel('upcoming-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: `gym_id=eq.${gymId}` }, () => fetchSlots())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [gymId, fetchSlots])

  return (
    <div className="rounded-2xl bg-card p-5">
      <h2 className="mb-4 font-display text-lg font-black tracking-tight text-dark">
        {t('dashboard.upcoming_sessions')}
      </h2>

      <div className="flex flex-col gap-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="table-row" />
          ))
        ) : slots.length === 0 ? (
          <p className="py-6 text-center font-body text-sm text-muted">
            {t('planning.empty')}
          </p>
        ) : (
          slots.map((slot) => (
            <div
              key={slot.id}
              className="flex items-center gap-3 rounded-xl border border-border p-3"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-dim/10">
                <Clock className="h-4 w-4 text-accent-dim" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-body text-sm font-medium text-dark">{slot.activity}</p>
                <p className="font-body text-xs text-muted">
                  {slot.time} &middot; {slot.coach}
                </p>
              </div>
              <span className="font-body text-xs font-semibold text-dark">
                {t('dashboard.booked_of', { booked: slot.booked, capacity: slot.capacity })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
