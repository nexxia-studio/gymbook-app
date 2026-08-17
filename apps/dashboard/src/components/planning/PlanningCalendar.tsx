import { useCallback, useMemo, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import FullCalendar from '@fullcalendar/react'
import type {
  EventInput,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  DatesSetArg,
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
import { fillPercent, isOverbooked } from '@/lib/capacity'

export type CalendarView = 'timeGridDay' | 'timeGridWeek' | 'dayGridMonth'

export interface PlanningCalendarHandle {
  changeView: (view: CalendarView) => void
  gotoDate: (date: Date | string) => void
  prev: () => void
  next: () => void
  today: () => void
}

interface PlanningCalendarProps {
  slots: TimeSlot[]
  weekStart: Date
  onSlotClick: (slot: TimeSlot) => void
  onSlotCreate?: (date: string, startTime: string) => void
  onDatesChange?: (start: string, end: string) => void
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}



const STATUS_BADGE: Record<DisplayStatus, string> = {
  cancelled: 'bg-red-500/90 text-white',
  completed: 'bg-black/40 text-white',
  in_progress: 'bg-green-500 text-white',
  scheduled: '',
}

function MonthCompactEvent({ slot }: { slot: TimeSlot }) {
  return (
    <div
      className="flex w-full items-center gap-1 overflow-hidden px-1 py-0.5"
      style={{ minWidth: 0 }}
    >
      <span
        className="shrink-0 rounded-full"
        style={{ width: 8, height: 8, backgroundColor: slot.activity.color }}
      />
      <span className="shrink-0 font-body text-[11px] text-secondary">
        {slot.startTime}
      </span>
      <span className="overflow-hidden text-ellipsis whitespace-nowrap font-body text-[11px] font-semibold text-dark">
        {slot.activity.name}
      </span>
    </div>
  )
}

function EventContent({ slot, t }: { slot: TimeSlot; t: (key: string) => string }) {
  // GYM-231 — cf. lib/capacity : barre bornée, compteur fidèle.
  const fill = fillPercent(slot.booked, slot.capacity)
  const over = isOverbooked(slot.booked, slot.capacity)
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
          {/* GYM-229 — masquer plutôt qu'afficher creux. Un créneau en accès libre (Open Gym)
n'a pas de coach : ni « Coach : — », ni ligne vide qui décale la mise en page.
Le test porte sur la PRÉSENCE du coach, pas sur activity.requiresCoach — les deux
ne coïncident pas (un créneau posé avant la bascule garde le sien). */}
          {slot.coach.name && (
            <p className="mt-0.5 truncate font-body text-[10px] text-muted">{slot.coach.name}</p>
          )}
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
              style={{ width: `${fill}%`, backgroundColor: over ? '#B45309' : slot.activity.color }}
            />
          </div>
          <span className={`font-body text-[9px] ${over ? 'font-bold text-amber-700' : 'font-medium text-muted'}`}>
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

/**
 * GYM-234 — BORNES DE LA GRILLE, en un seul endroit.
 *
 * Elles étaient écrites en dur dans le JSX de FullCalendar. Le clic droit doit convertir
 * une position verticale en heure, donc les relire : les laisser en double garantissait
 * qu'élargir la grille (ouvrir à 05:00, passer au pas de 15 min) désaligne SILENCIEUSEMENT
 * le clic droit — il créerait des cours à une heure décalée sans que rien ne le signale.
 */
const SLOT_MIN_HOUR = 6
const SLOT_MAX_HOUR = 22
const SLOT_STEP_MIN = 30
const GRID_SPAN_MIN = (SLOT_MAX_HOUR - SLOT_MIN_HOUR) * 60

/** Minutes depuis SLOT_MIN_HOUR → 'HH:mm'. */
function minutesToTime(minutesFromStart: number): string {
  const total = SLOT_MIN_HOUR * 60 + minutesFromStart
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

export const PlanningCalendar = forwardRef<PlanningCalendarHandle, PlanningCalendarProps>(function PlanningCalendar(
  { slots, weekStart, onSlotClick, onSlotCreate, onDatesChange },
  ref,
) {
  const { t } = useTranslation()
  const tz = useGymTimezone()
  const calendarRef = useRef<FullCalendar | null>(null)
  // GYM-234 — support de l'écoute `contextmenu` : FullCalendar n'expose pas de rappel
  // pour un clic droit sur une case vide, on écoute donc l'événement DOM.
  const rootRef = useRef<HTMLDivElement | null>(null)
  const lastReportedRangeRef = useRef<string>('')
  const isInternalNavRef = useRef(false)
  const slotsById = useMemo(() => {
    const m = new Map<string, TimeSlot>()
    for (const s of slots) m.set(s.id, s)
    return m
  }, [slots])

  // Expose imperative API to the page. prev/next/today delegate to FullCalendar so the
  // step matches the active view (1 day / 7 days / 1 month).
  useImperativeHandle(ref, () => ({
    changeView: (view) => calendarRef.current?.getApi().changeView(view),
    gotoDate: (date) => calendarRef.current?.getApi().gotoDate(date),
    prev: () => calendarRef.current?.getApi().prev(),
    next: () => calendarRef.current?.getApi().next(),
    today: () => calendarRef.current?.getApi().today(),
  }), [])

  // Sync FullCalendar's internal date to the week selected by the page header.
  // Only navigate when the displayed date actually differs from weekStart — otherwise
  // gotoDate→datesSet→onDatesChange→setWeekStart can loop indefinitely (React #185).
  useEffect(() => {
    const api = calendarRef.current?.getApi()
    if (!api) return
    const current = api.getDate()
    const currentYmd = `${current.getFullYear()}-${pad(current.getMonth() + 1)}-${pad(current.getDate())}`
    const wantedYmd = `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`
    if (currentYmd === wantedYmd) return

    isInternalNavRef.current = true
    api.gotoDate(weekStart)
    // FullCalendar fires datesSet synchronously inside gotoDate, but we clear the flag
    // on the next tick to be safe against any async behavior.
    setTimeout(() => { isInternalNavRef.current = false }, 0)
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

  /**
   * GYM-234 (QA Antoine, 18/08) — CRÉATION AU CLIC DROIT.
   *
   * 🔴 DÉCISION INVERSÉE. Le ticket demandait le clic droit ; j'avais tranché pour le clic
   * gauche en invoquant Notion Calendar. C'était mon arbitrage, pas celui d'Antoine, et il
   * le redresse. La sélection FullCalendar (selectable/select/selectAllow/selectMirror) est
   * retirée : vérifié, ces quatre props n'existaient QUE pour la création — le
   * glisser-déposer d'événements passe par `editable`/`eventDrop`, indépendants.
   *
   * ⚠️ FullCalendar N'EXPOSE AUCUN utilitaire public de conversion position → date
   * (vérifié dans ses types : ni positionToDate, ni dateFromPoint). Deux moitiés, donc :
   *
   *   · LA DATE ne se calcule pas — FullCalendar la pose lui-même en `data-date`
   *     (YYYY-MM-DD) sur chaque colonne de jour. On la lit, on ne la déduit pas.
   *   · L'HEURE se calcule, et il a fallu AJOUTER L'ARRONDI que `select` donnait
   *     gratuitement : ratio vertical dans le cadre de la colonne, converti en minutes,
   *     puis PLANCHER au pas de 30 min. Plancher et non arrondi au plus proche : cliquer
   *     dans la case 14:00–14:30 doit donner 14:00, c'est la case désignée. Un arrondi au
   *     plus proche aurait basculé à 14:30 dès la moitié basse de la case.
   */
  const handleContextMenu = useCallback((e: MouseEvent) => {
    if (!onSlotCreate) return

    const target = e.target as HTMLElement | null
    if (!target) return

    // ── Garde 1 : un COURS EXISTANT garde son menu natif. ────────────────────
    //
    // ⚠️ CELLE-CI FONCTIONNE PAR ASCENDANCE, et c'est vérifié dans le source de
    // FullCalendar : les événements sont rendus dans `.fc-timegrid-col-events`, lui-même
    // dans `.fc-timegrid-col-frame`, lui-même dans la colonne. Un événement EST donc
    // descendant de sa colonne — contrairement aux lanes. `closest` remonte bien.
    if (target.closest('.fc-event')) return

    // ── Garde 2 : la colonne, DÉTERMINÉE PAR POSITION et non par ascendance. ──
    //
    // 🔴 C'EST ICI QUE LE PREMIER JET ÉCHOUAIT. Il faisait
    // `target.closest('.fc-timegrid-col[data-date]')`, qui renvoyait TOUJOURS null : la
    // cible d'un clic sur une case vide est une LANE horizontale
    // (`.fc-timegrid-slot-lane`), pleine largeur, qui traverse tous les jours. Lanes et
    // colonnes sont deux couches SŒURS et superposées — le source le confirme,
    // `.fc-timegrid-cols` est en `position:absolute` par-dessus la table des lanes. Aucune
    // ascendance ne relie l'une à l'autre.
    //
    // J'avais pourtant décrit cette superposition au lot précédent, pour écarter le survol
    // par case en CSS. La conséquence sur le clic n'en avait pas été tirée.
    //
    // On balaie donc les colonnes et on retient celle dont le rectangle contient clientX —
    // exactement la logique que le calcul de l'heure applique déjà sur l'axe vertical.
    const root = rootRef.current
    if (!root) return

    // `[data-date]` exclut au passage l'AXE DES HEURES, qui porte aussi la classe
    // `fc-timegrid-col` mais n'est pas une cellule de jour (vérifié dans le source).
    const cols = root.querySelectorAll<HTMLElement>('.fc-timegrid-col[data-date]')
    let col: HTMLElement | null = null
    for (const candidate of cols) {
      const r = candidate.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX < r.right) { col = candidate; break }
    }
    // Aucune colonne sous le curseur → vue mois, vue liste, axe des heures, en-tête, ou
    // hors calendrier. On ne fait RIEN et le menu natif s'affiche.
    if (!col) return

    // ⚠️ REPÈRE DE `data-date` : le calendrier n'a PAS de prop `timeZone` — les créneaux
    // lui sont fournis déjà convertis dans le fuseau du gym (cf. `events` plus bas). La
    // date lue ici est donc exactement dans le même repère que `slot.date`, celui qu'attend
    // SlotModal. Aucune conversion, et aucun décalage possible.
    const date = col.dataset.date
    if (!date) return

    // La colonne (un <td> de `.fc-timegrid-cols`, lui-même en absolu top:0/bottom:0 sur le
    // corps de la grille) couvre exactement slotMinTime → slotMaxTime.
    const rect = col.getBoundingClientRect()
    if (rect.height <= 0) return
    if (e.clientY < rect.top || e.clientY > rect.bottom) return

    const ratio = (e.clientY - rect.top) / rect.height
    const raw = ratio * GRID_SPAN_MIN
    const floored = Math.floor(raw / SLOT_STEP_MIN) * SLOT_STEP_MIN
    // Borné pour qu'un clic tout en bas ne propose pas un cours démarrant à la fermeture.
    const minutes = Math.min(Math.max(floored, 0), GRID_SPAN_MIN - SLOT_STEP_MIN)

    e.preventDefault()
    onSlotCreate(date, minutesToTime(minutes))
  }, [onSlotCreate])

  useEffect(() => {
    const root = rootRef.current
    if (!root || !onSlotCreate) return
    root.addEventListener('contextmenu', handleContextMenu)
    return () => root.removeEventListener('contextmenu', handleContextMenu)
  }, [handleContextMenu, onSlotCreate])

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
    <div ref={rootRef} className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin, listPlugin]}
        initialView="timeGridWeek"
        initialDate={weekStart}
        locale={frLocale}
        firstDay={1}
        headerToolbar={false}
        dayHeaderFormat={{ weekday: 'short', day: 'numeric', omitCommas: true }}
        // GYM-234 — dérivées des MÊMES constantes que le calcul du clic droit. Les laisser
        // en dur ici, c'était garantir qu'élargir la grille désaligne silencieusement la
        // création : le clic droit aurait continué de compter depuis 06:00.
        slotMinTime={`${pad(SLOT_MIN_HOUR)}:00:00`}
        slotMaxTime={`${pad(SLOT_MAX_HOUR)}:00:00`}
        slotDuration={`00:${pad(SLOT_STEP_MIN)}:00`}
        allDaySlot={false}
        nowIndicator
        height="auto"
        expandRows
        events={events}
        editable
        droppable={false}
        eventClick={handleEventClick}
        eventDrop={handleEventDrop}
        eventOverlap
        dayMaxEvents={3}
        moreLinkText={(n) => `+${n}`}
        eventContent={(arg: EventContentArg) => {
          const id = (arg.event.extendedProps as { slotId?: string }).slotId ?? arg.event.id
          const slot = slotsById.get(id)
          if (!slot) return null
          if (arg.view.type === 'dayGridMonth') return <MonthCompactEvent slot={slot} />
          return <EventContent slot={slot} t={t} />
        }}
        datesSet={(info: DatesSetArg) => {
          if (isInternalNavRef.current) return
          if (!onDatesChange) return
          const sd = info.start
          const ed = info.end
          const startIso = `${sd.getFullYear()}-${pad(sd.getMonth() + 1)}-${pad(sd.getDate())}`
          const endIso = `${ed.getFullYear()}-${pad(ed.getMonth() + 1)}-${pad(ed.getDate())}`
          const rangeKey = `${startIso}/${endIso}`
          if (rangeKey === lastReportedRangeRef.current) return
          lastReportedRangeRef.current = rangeKey
          onDatesChange(startIso, endIso)
        }}
      />
    </div>
  )
})
