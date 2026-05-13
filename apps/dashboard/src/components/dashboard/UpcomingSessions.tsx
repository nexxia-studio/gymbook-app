import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { Skeleton } from '@/components/ui/Skeleton'

const mockUpcoming = [
  { time: '12:00', activity: 'EMS', coach: 'François', booked: 3, capacity: 4 },
  { time: '17:30', activity: 'HIIT Circuit', coach: 'Nicolas', booked: 11, capacity: 15 },
  { time: '19:00', activity: 'Yoga', coach: 'Victoria', booked: 7, capacity: 14 },
]

export function UpcomingSessions({ loading }: { loading: boolean }) {
  const { t } = useTranslation()

  return (
    <div className="rounded-2xl bg-card p-5">
      <h2 className="mb-4 font-display text-lg font-black uppercase tracking-tight text-dark">
        {t('dashboard.upcoming_sessions')}
      </h2>

      <div className="flex flex-col gap-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} variant="table-row" />
          ))
        ) : (
          mockUpcoming.map((slot) => (
            <div
              key={`${slot.time}-${slot.activity}`}
              className="flex items-center gap-3 rounded-xl border border-border p-3"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10">
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
