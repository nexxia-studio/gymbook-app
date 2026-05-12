import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TimeSlot } from '@/types/planning'
import { SlotCard } from './SlotCard'
import { Skeleton } from '@/components/ui/Skeleton'

interface WeekGridProps {
  weekDays: Date[]
  getSlotsByDay: (dateStr: string) => TimeSlot[]
  onSlotClick: (slot: TimeSlot) => void
  loading: boolean
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6) // 06:00 → 22:00

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isToday(d: Date): boolean {
  const now = new Date()
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function WeekGrid({ weekDays, getSlotsByDay, onSlotClick, loading }: WeekGridProps) {
  const { t } = useTranslation()

  // Slots indexed by day
  const slotsByDay = useMemo(() => {
    return weekDays.map((d) => ({
      date: d,
      dateStr: formatDateStr(d),
      slots: getSlotsByDay(formatDateStr(d)),
    }))
  }, [weekDays, getSlotsByDay])

  const gridStartMin = 6 * 60 // 06:00
  const gridEndMin = 22 * 60 // 22:00
  const totalMin = gridEndMin - gridStartMin
  // 1 minute = some px. We use 960 / 16h = 1px per min
  const pxPerMin = 1

  return (
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
      {/* Day headers */}
      <div className="sticky top-0 z-10 grid grid-cols-[56px_repeat(7,1fr)] border-b border-border bg-card">
        <div className="border-r border-border" />
        {slotsByDay.map(({ date }, i) => {
          const today = isToday(date)
          return (
            <div
              key={i}
              className={`border-r border-border px-2 py-3 text-center last:border-r-0 ${
                today ? 'bg-accent/10' : ''
              }`}
            >
              <span className={`font-body text-xs font-semibold uppercase ${today ? 'text-accent-dim' : 'text-muted'}`}>
                {t(`planning.days_short.${DAY_KEYS[i]}`)}
              </span>
              <span className={`ml-1 font-body text-xs ${today ? 'font-bold text-dark' : 'text-secondary'}`}>
                {date.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      {/* Time grid */}
      <div className="relative grid grid-cols-[56px_repeat(7,1fr)]" style={{ height: `${totalMin * pxPerMin}px` }}>
        {/* Hour labels + grid lines */}
        <div className="relative border-r border-border">
          {HOURS.map((h) => {
            const top = (h * 60 - gridStartMin) * pxPerMin
            return (
              <div
                key={h}
                className="absolute left-0 right-0 flex items-start justify-end pr-2"
                style={{ top }}
              >
                <span className="font-body text-[10px] text-muted">
                  {String(h).padStart(2, '0')}:00
                </span>
              </div>
            )
          })}
        </div>

        {/* Day columns with slots */}
        {slotsByDay.map(({ dateStr, date, slots }, dayIdx) => {
          const today = isToday(date)
          return (
            <div
              key={dateStr}
              className={`relative border-r border-border last:border-r-0 ${today ? 'bg-accent/[0.03]' : ''}`}
            >
              {/* Hour lines */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-border/50"
                  style={{ top: (h * 60 - gridStartMin) * pxPerMin }}
                />
              ))}

              {/* Loading skeleton */}
              {loading && dayIdx < 5 && (
                <>
                  <div className="absolute left-1 right-1" style={{ top: 60 }}>
                    <Skeleton className="h-14 rounded-lg" />
                  </div>
                  <div className="absolute left-1 right-1" style={{ top: 400 }}>
                    <Skeleton className="h-10 rounded-lg" />
                  </div>
                </>
              )}

              {/* Slot cards */}
              {!loading &&
                slots.map((slot) => {
                  const startMin = timeToMinutes(slot.startTime)
                  const endMin = timeToMinutes(slot.endTime)
                  const top = (startMin - gridStartMin) * pxPerMin
                  const height = Math.max((endMin - startMin) * pxPerMin, 32)
                  const isCompact = height < 55

                  return (
                    <div
                      key={slot.id}
                      className="absolute left-1 right-1"
                      style={{ top, height }}
                    >
                      <SlotCard slot={slot} onClick={() => onSlotClick(slot)} compact={isCompact} />
                    </div>
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
