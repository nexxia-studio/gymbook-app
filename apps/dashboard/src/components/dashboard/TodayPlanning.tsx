import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/Skeleton'
import type { DisplayStatus } from '@/types/planning'

interface Slot {
  time: string
  durationMin: number
  activity: string
  coach: string
  booked: number
  capacity: number
}

const mockTodaySlots: Slot[] = [
  { time: '07:00', durationMin: 60, activity: 'CrossFit', coach: 'Nicolas', booked: 12, capacity: 16 },
  { time: '09:30', durationMin: 50, activity: 'Pilates', coach: 'Léna', booked: 8, capacity: 12 },
  { time: '12:00', durationMin: 30, activity: 'EMS', coach: 'François', booked: 3, capacity: 4 },
  { time: '17:30', durationMin: 45, activity: 'HIIT Circuit', coach: 'Nicolas', booked: 11, capacity: 15 },
  { time: '19:00', durationMin: 60, activity: 'Yoga', coach: 'Victoria', booked: 7, capacity: 14 },
  { time: '20:00', durationMin: 60, activity: 'CrossFit', coach: 'François', booked: 9, capacity: 16 },
]

const statusColors: Record<DisplayStatus, string> = {
  scheduled: 'bg-accent/15 text-accent-dim',
  completed: 'bg-dark/5 text-muted',
  cancelled: 'bg-red-50 text-red-500',
  in_progress: 'bg-green-500/15 text-green-600',
}

function getSlotDisplayStatus(time: string, durationMin: number): DisplayStatus {
  const now = new Date()
  const [h, m] = time.split(':').map(Number)
  const today = new Date()
  today.setHours(h, m, 0, 0)
  const end = new Date(today.getTime() + durationMin * 60_000)

  if (end < now) return 'completed'
  if (today <= now && now <= end) return 'in_progress'
  return 'scheduled'
}

export function TodayPlanning({ loading }: { loading: boolean }) {
  const { t } = useTranslation()

  return (
    <div className="rounded-2xl bg-card p-5">
      <h2 className="mb-4 font-display text-lg font-black uppercase tracking-tight text-dark">
        {t('dashboard.today_planning')}
      </h2>

      <div className="flex flex-col gap-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="table-row" />
          ))
        ) : (
          mockTodaySlots.map((slot) => {
            const fillPercent = Math.round((slot.booked / slot.capacity) * 100)
            const displayStatus = getSlotDisplayStatus(slot.time, slot.durationMin)
            const isLive = displayStatus === 'in_progress'

            return (
              <div
                key={`${slot.time}-${slot.activity}`}
                className={`flex items-center gap-4 rounded-xl border p-3 transition-colors hover:bg-background ${
                  isLive ? 'border-green-300' : 'border-border'
                }`}
              >
                {/* Time */}
                <span className="w-12 shrink-0 font-body text-sm font-semibold text-dark">
                  {slot.time}
                </span>

                {/* Activity + Coach */}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-sm font-medium text-dark">
                    {slot.activity}
                  </p>
                  <p className="font-body text-xs text-muted">{slot.coach}</p>
                </div>

                {/* Fill bar */}
                <div className="hidden w-28 flex-col gap-1 sm:flex">
                  <div className="h-1.5 overflow-hidden rounded-full bg-dark/5">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-500"
                      style={{ width: `${fillPercent}%` }}
                    />
                  </div>
                  <span className="font-body text-xs text-muted">
                    {t('dashboard.booked_of', { booked: slot.booked, capacity: slot.capacity })}
                  </span>
                </div>

                {/* Status badge */}
                {displayStatus !== 'scheduled' && (
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 font-body text-xs font-medium ${statusColors[displayStatus]}`}>
                    {isLive && (
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                    )}
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
