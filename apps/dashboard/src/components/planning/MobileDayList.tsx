import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TimeSlot } from '@/types/planning'
import { SlotCard } from './SlotCard'
import { Skeleton } from '@/components/ui/Skeleton'

interface MobileDayListProps {
  weekDays: Date[]
  getSlotsByDay: (dateStr: string) => TimeSlot[]
  onSlotClick: (slot: TimeSlot) => void
  loading: boolean
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isToday(d: Date): boolean {
  const now = new Date()
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
}

export function MobileDayList({ weekDays, getSlotsByDay, onSlotClick, loading }: MobileDayListProps) {
  const { t } = useTranslation()

  // Default to today's index or Monday
  const todayIdx = useMemo(() => {
    const idx = weekDays.findIndex(isToday)
    return idx >= 0 ? idx : 0
  }, [weekDays])

  const [activeDay, setActiveDay] = useState(todayIdx)
  const selectedDate = weekDays[activeDay]
  const dateStr = formatDateStr(selectedDate)
  const slots = getSlotsByDay(dateStr)

  return (
    <div className="md:hidden">
      {/* Day tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-card p-1">
        {weekDays.map((d, i) => {
          const today = isToday(d)
          const active = i === activeDay
          return (
            <button
              key={i}
              type="button"
              onClick={() => setActiveDay(i)}
              className={`flex shrink-0 flex-col items-center rounded-lg px-3 py-2 transition-all ${
                active
                  ? 'bg-[#4827B4] text-[#C8FF3D] dark:bg-[#C8FF3D] dark:text-[#17102E]'
                  : today
                    ? 'bg-accent-dim/10 text-dark'
                    : 'text-muted hover:text-dark'
              }`}
            >
              <span className="font-body text-[10px] font-semibold uppercase">
                {t(`planning.days_short.${DAY_KEYS[i]}`)}
              </span>
              <span className="font-body text-sm font-bold">{d.getDate()}</span>
            </button>
          )
        })}
      </div>

      {/* Slot list */}
      <div className="flex flex-col gap-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} variant="table-row" />
          ))
        ) : slots.length === 0 ? (
          <div className="rounded-xl bg-card p-6 text-center">
            <p className="font-body text-sm text-muted">{t('planning.empty_day')}</p>
          </div>
        ) : (
          slots.map((slot) => (
            <SlotCard key={slot.id} slot={slot} onClick={() => onSlotClick(slot)} />
          ))
        )}
      </div>
    </div>
  )
}
