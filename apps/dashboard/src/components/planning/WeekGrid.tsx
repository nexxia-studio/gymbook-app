import { useMemo, useState, useEffect } from 'react'
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
const GRID_START_MIN = 6 * 60
const HOUR_HEIGHT = 60 // px per hour
const MIN_SLOT_HEIGHT = 30
const GAP = 4 // px between overlapping cards
const TOTAL_GRID_HEIGHT = 16 * HOUR_HEIGHT // 16 hours * 60px = 960px

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

function minToPx(min: number): number {
  return (min / 60) * HOUR_HEIGHT
}

// --- Simple overlap algorithm ---
interface ColumnedSlot {
  slot: TimeSlot
  startMin: number
  endMin: number
  column: number
  totalColumns: number
}

function getSlotColumns(slots: TimeSlot[]): ColumnedSlot[] {
  if (slots.length === 0) return []

  const items = slots.map((slot) => ({
    slot,
    startMin: timeToMinutes(slot.startTime),
    endMin: timeToMinutes(slot.endTime),
  }))

  // Sort by start time
  items.sort((a, b) => a.startMin - b.startMin)

  // Greedy column placement
  // columns[i] = endMinutes of last slot placed in column i
  const columns: number[] = []
  const result: ColumnedSlot[] = []

  for (const item of items) {
    let placed = false
    for (let i = 0; i < columns.length; i++) {
      // A column is free if its last slot ends AT or BEFORE this one starts
      if (columns[i] <= item.startMin) {
        columns[i] = item.endMin
        result.push({ ...item, column: i, totalColumns: 0 })
        placed = true
        break
      }
    }
    if (!placed) {
      result.push({ ...item, column: columns.length, totalColumns: 0 })
      columns.push(item.endMin)
    }
  }

  // For each slot, totalColumns = max columns among all overlapping slots
  for (const item of result) {
    const overlapping = result.filter(
      (other) => other.startMin < item.endMin && other.endMin > item.startMin,
    )
    item.totalColumns = Math.max(...overlapping.map((o) => o.column)) + 1
  }



  return result
}

// --- Current time hook ---
function useCurrentMinutes(): number {
  const [mins, setMins] = useState(() => {
    const now = new Date()
    return now.getHours() * 60 + now.getMinutes()
  })

  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date()
      setMins(now.getHours() * 60 + now.getMinutes())
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  return mins
}

export function WeekGrid({ weekDays, getSlotsByDay, onSlotClick, loading }: WeekGridProps) {
  const { t } = useTranslation()
  const currentMinutes = useCurrentMinutes()

  const slotsByDay = useMemo(() => {
    return weekDays.map((d) => ({
      date: d,
      dateStr: formatDateStr(d),
      slots: getSlotsByDay(formatDateStr(d)),
    }))
  }, [weekDays, getSlotsByDay])

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
      <div
        className="relative grid grid-cols-[56px_repeat(7,1fr)]"
        style={{ height: TOTAL_GRID_HEIGHT }}
      >
        {/* Hour labels */}
        <div className="relative border-r border-border">
          {HOURS.map((h) => (
            <div
              key={h}
              className="absolute left-0 right-0 flex items-start justify-end pr-2"
              style={{ top: minToPx(h * 60 - GRID_START_MIN) }}
            >
              <span className="font-body text-[10px] text-muted">
                {String(h).padStart(2, '0')}:00
              </span>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {slotsByDay.map(({ dateStr, date, slots }, dayIdx) => {
          const today = isToday(date)
          const columnedSlots = getSlotColumns(slots)
          const showTimeLine =
            today && currentMinutes >= GRID_START_MIN && currentMinutes <= GRID_START_MIN + 16 * 60

          return (
            <div
              key={dateStr}
              style={{ position: 'relative', width: '100%', overflow: 'visible' }}
              className={`border-r border-border last:border-r-0 ${today ? 'bg-accent/[0.03]' : ''}`}
            >
              {/* Hour lines */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-border/50"
                  style={{ top: minToPx(h * 60 - GRID_START_MIN) }}
                />
              ))}

              {/* Current time line */}
              {showTimeLine && (
                <div
                  className="absolute left-0 right-0 z-20"
                  style={{ top: minToPx(currentMinutes - GRID_START_MIN) }}
                >
                  <div className="relative flex items-center">
                    <div className="absolute -left-1 h-2 w-2 rounded-full bg-red-500" />
                    <div className="h-[2px] w-full bg-red-500" />
                  </div>
                </div>
              )}

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
                columnedSlots.map((item) => {
                  const topPx = minToPx(item.startMin - GRID_START_MIN)
                  const heightPx = Math.max(minToPx(item.endMin - item.startMin), MIN_SLOT_HEIGHT)
                  const widthPercent = 100 / item.totalColumns
                  const leftPercent = item.column * widthPercent
                  const isCompact = heightPx < 50

                  return (
                    <SlotCard
                      key={item.slot.id}
                      slot={item.slot}
                      onClick={() => onSlotClick(item.slot)}
                      compact={isCompact}
                      style={{
                        position: 'absolute',
                        top: `${topPx}px`,
                        height: `${heightPx}px`,
                        left: `calc(${leftPercent}% + ${item.column > 0 ? GAP : 0}px)`,
                        width: `calc(${widthPercent}% - ${GAP}px)`,
                        zIndex: 10 + item.column,
                      }}
                    />
                  )
                })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
