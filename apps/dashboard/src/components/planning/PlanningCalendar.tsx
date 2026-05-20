import { useCallback, useMemo, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import FullCalendar from '@fullcalendar/react'
import type {
  EventInput,
  EventClickArg,
  EventContentArg,
  DateSelectArg,
  EventDropArg,
} from '@fullcalendar/core'
import frLocale from '@fullcalendar/core/locales/fr'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import listPlugin from '@fullcalendar/list'
import { fromZonedTime } from 'date-fns-tz'
import { supabase } from '@/lib/supabase'
import { useGymTimezone } from '@/hooks/useGymTimezone'
import { getDisplayStatus, type TimeSlot, type DisplayStatus } from '@/types/planning'

interface PlanningCalendarProps {
  slots: TimeSlot[]
  weekStart: Date
  onSlotClick: (slot: TimeSlot) => void
  onSlotCreate?: (date: string, startTime: string) => void
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDateInTz(date: Date): string {
  // FullCalendar passes local-time dates; we read y/m/d via local getters
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function timeInTz(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const STATUS_BADGE: Record<DisplayStatus, string> = {
  cancelled: 'bg-red-500/90 text-white',
  completed: 'bg-black/40 text-white',
  in_progress: 'bg-green-500 text-white',
  scheduled: '',
}

function EventContent({ slot, t }: { slot: TimeSlot; t: (key: string) => string }) {
  const fillPercent = Math.round((slot.booked / slot.capacity) * 100)
  const displayStatus = getDisplayStatus(slot)
  const isLive = displayStatus === 'in_progress'
  const isActivitySuspended = slot.activity.active === false
  const isCoachUnavailable = slot.coach.active === false
  const isFrozen = isActivitySuspended || isCoachUnavailable

  return (
    <div
      className={`group relative box-border h-full w-full overflow-hidden rounded-xl p-1.5 text-left ${
        isFrozen ? 'opacity-40 grayscale' : ''
      }`}
      style={{
        backgroundColor: `${slot.activity.color}20`,
        borderLeft: `3px solid ${slot.activity.color}`,
        ...(isLive && !isFrozen ? { outline: '2px solid #22C55E', outlineOffset: '-2px' } : {}),
      }}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate font-body text-xs font-semibold text-dark">{slot.activity.name}</p>
          <p className="font-body text-[10px] text-secondary">
            {slot.startTime} — {slot.endTime}
          </p>
          <p className="mt-0.5 truncate font-body text-[10px] text-muted">{slot.coach.name}</p>
        </div>
        {displayStatus !== 'scheduled' && !isFrozen && (
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold ${STATUS_BADGE[displayStatus]}`}
          >
            {isLive && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
            {t(`planning.status.${displayStatus}`)}
          </span>
        )}
      </div>

      {!isFrozen && (
        <div className="mt-1 flex items-center gap-1">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-dark/10">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${fillPercent}%`, backgroundColor: slot.activity.color }}
            />
          </div>
          <span className="font-body text-[9px] font-medium text-muted">
            {slot.booked}/{slot.capacity}
          </span>
        </div>
      )}

      {isFrozen && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl">
          {isActivitySuspended ? (
            <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[8px] font-semibold text-white shadow">
              {t('planning.status.suspended')}
            </span>
          ) : (
            <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[8px] font-semibold text-white shadow">
              {t('planning.status.coach_unavailable')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export function PlanningCalendar({ slots, weekStart, onSlotClick, onSlotCreate }: PlanningCalendarProps) {
  const { t } = useTranslation()
  const tz = useGymTimezone()
  const calendarRef = useRef<FullCalendar | null>(null)
  const slotsById = useMemo(() => {
    const m = new Map<string, TimeSlot>()
    for (const s of slots) m.set(s.id, s)
    return m
  }, [slots])

  // Sync FullCalendar's internal date to the week selected by the page header
  useEffect(() => {
    const api = calendarRef.current?.getApi()
    if (api) api.gotoDate(weekStart)
  }, [weekStart])

  const events: EventInput[] = useMemo(() => {
    const mapped: EventInput[] = slots.map((slot) => {
      const isFrozen = slot.activity.active === false || slot.coach.active === false
      return {
        id: slot.id,
        // slot.date / startTime / endTime are already in the gym timezone (Brussels),
        // so FullCalendar should treat them as local time (no `timeZone` prop set on the calendar).
        start: `${slot.date}T${slot.startTime}:00`,
        end: `${slot.date}T${slot.endTime}:00`,
        editable: !isFrozen && slot.status !== 'cancelled',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
        textColor: 'inherit',
        classNames: ['gymbook-event'],
        extendedProps: { slotId: slot.id },
      }
    })
    console.log('[PlanningCalendar] mapped events:', mapped.length, 'first:', mapped[0])
    return mapped
  }, [slots])

  const handleEventClick = useCallback((info: EventClickArg) => {
    const id = (info.event.extendedProps as { slotId?: string }).slotId ?? info.event.id
    const slot = slotsById.get(id)
    if (slot) onSlotClick(slot)
  }, [slotsById, onSlotClick])

  const handleDateClick = useCallback((info: DateSelectArg) => {
    if (!onSlotCreate) return
    const date = isoDateInTz(info.start)
    const startTime = timeInTz(info.start)
    onSlotCreate(date, startTime)
  }, [onSlotCreate])

  // Drag&drop: update starts_at / ends_at directly via Supabase.
  // The Realtime subscription in usePlanning picks up the change and refreshes the UI.
  const handleEventDrop = useCallback(async (info: EventDropArg) => {
    const id = (info.event.extendedProps as { slotId?: string }).slotId ?? info.event.id
    const slot = slotsById.get(id)
    if (!slot) { info.revert(); return }

    if ((slot.booked ?? 0) > 0) {
      const ok = window.confirm(
        t('planning.move_with_bookings_confirm', { count: slot.booked }),
      )
      if (!ok) { info.revert(); return }
      // TODO: send notification to enrolled members (separate edge function)
    }

    const startDate = info.event.start
    const endDate = info.event.end
    if (!startDate || !endDate) { info.revert(); return }

    const startIso = fromZonedTime(startDate, tz).toISOString()
    const endIso = fromZonedTime(endDate, tz).toISOString()

    const { error } = await supabase
      .from('time_slots')
      .update({ starts_at: startIso, ends_at: endIso, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) {
      console.error('[PlanningCalendar] update failed:', error)
      info.revert()
    }
  }, [slotsById, tz, t])

  return (
    <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, listPlugin]}
        initialView="timeGridWeek"
        initialDate={weekStart}
        locale={frLocale}
        firstDay={1}
        headerToolbar={false}
        dayHeaderFormat={{ weekday: 'short', day: 'numeric', omitCommas: true }}
        slotMinTime="06:00:00"
        slotMaxTime="22:00:00"
        slotDuration="00:30:00"
        allDaySlot={false}
        nowIndicator
        height="auto"
        expandRows
        events={events}
        editable
        droppable={false}
        selectable={!!onSlotCreate}
        selectMirror={false}
        selectAllow={() => !!onSlotCreate}
        select={handleDateClick}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        eventOverlap
        eventContent={(arg: EventContentArg) => {
          const id = (arg.event.extendedProps as { slotId?: string }).slotId ?? arg.event.id
          const slot = slotsById.get(id)
          if (!slot) return null
          return <EventContent slot={slot} t={t} />
        }}
      />
    </div>
  )
}
