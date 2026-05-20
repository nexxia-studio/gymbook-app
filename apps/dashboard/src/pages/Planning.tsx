import { useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBoundary } from 'react-error-boundary'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/Button'
import { FilterPills } from '@/components/planning/FilterPills'
import { PlanningCalendar, type PlanningCalendarHandle, type CalendarView } from '@/components/planning/PlanningCalendar'
import { MobileDayList } from '@/components/planning/MobileDayList'
import { SlotDrawer } from '@/components/planning/SlotDrawer'
import { SlotModal, type SlotFormData } from '@/components/planning/SlotModal'
import { SlotDeleteModal, type SlotDeleteMode } from '@/components/planning/SlotDeleteModal'
import { usePlanning } from '@/hooks/usePlanning'
import { useToastStore } from '@/hooks/useToast'
import type { TimeSlot } from '@/types/planning'

function formatWeekRange(start: Date, end: Date, t: (key: string) => string): string {
  const startDay = start.getDate()
  const endDay = end.getDate()
  const startMonth = t(`planning.months.${start.getMonth()}`)
  const endMonth = t(`planning.months.${end.getMonth()}`)
  const year = end.getFullYear()

  if (start.getMonth() === end.getMonth()) {
    return `${startDay} — ${endDay} ${startMonth} ${year}`
  }
  return `${startDay} ${startMonth} — ${endDay} ${endMonth} ${year}`
}

function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function getPeriodLabel(
  view: 'day' | 'week' | 'month',
  periodStart: Date,
  t: (key: string) => string,
): string {
  if (view === 'day') {
    return capitalize(periodStart.toLocaleDateString('fr-BE', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    }))
  }
  if (view === 'month') {
    return capitalize(periodStart.toLocaleDateString('fr-BE', {
      month: 'long', year: 'numeric',
    }))
  }
  const weekEnd = new Date(periodStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const start = periodStart.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })
  const end = weekEnd.toLocaleDateString('fr-BE', { day: 'numeric', month: 'long', year: 'numeric' })
  const weekNum = getIsoWeekNumber(periodStart)
  return `${capitalize(start)} — ${capitalize(end)} · ${t('planning.week_short')} ${weekNum}`
}

export default function Planning() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const planning = usePlanning()

  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editSlot, setEditSlot] = useState<TimeSlot | null>(null)
  const [confirmSlot, setConfirmSlot] = useState<TimeSlot | null>(null)
  const [confirmMode, setConfirmMode] = useState<SlotDeleteMode>('cancel')

  const calendarRef = useRef<PlanningCalendarHandle>(null)
  const [view, setView] = useState<'day' | 'week' | 'month'>('week')
  // Real period start as reported by FullCalendar's datesSet — drives the header label
  // independently of weekStart (which only follows day/week views).
  const [currentPeriodStart, setCurrentPeriodStart] = useState<Date>(() => planning.weekStart)

  const handleViewChange = useCallback((next: 'day' | 'week' | 'month') => {
    const map: Record<'day' | 'week' | 'month', CalendarView> = {
      day: 'timeGridDay',
      week: 'timeGridWeek',
      month: 'dayGridMonth',
    }
    calendarRef.current?.changeView(map[next])
    setView(next)
  }, [])

  // Push the full visible range from FullCalendar (datesSet) to the hook so it can
  // refetch the right window — 1 day, 7 days or ~35 days depending on the active view.
  // weekStart is left untouched so the header label still reflects the current week.
  const handleDatesChange = useCallback((start: string, end: string) => {
    // T12:00:00 anchors the date solidly in local time, dodging DST edge cases.
    setCurrentPeriodStart(new Date(`${start}T12:00:00`))
    planning.setVisibleRange(start, end)
  }, [planning])

  // Delegate prev/next/today to FullCalendar — it advances by the view's step
  // (1 day / 7 days / 1 month). The resulting datesSet → handleDatesChange path
  // updates the hook's range and (in week/day views) its weekStart anchor.
  const handlePrev = useCallback(() => calendarRef.current?.prev(), [])
  const handleNext = useCallback(() => calendarRef.current?.next(), [])
  const handleToday = useCallback(() => calendarRef.current?.today(), [])

  async function handleCreate(data: SlotFormData) {
    const count = await planning.createSlot(data)
    setCreateModalOpen(false)
    addToast(
      count > 1
        ? t('slots.toast_created_multiple', { count })
        : t('slots.toast_created'),
    )
  }

  function handleEdit(data: SlotFormData) {
    if (!editSlot) return
    planning.updateSlot(editSlot.id, data)
    setEditSlot(null)
    planning.setSelectedSlot(null)
    addToast(t('slots.toast_updated'))
  }

  function handleConfirm() {
    if (!confirmSlot) return
    if (confirmMode === 'delete') {
      planning.removeSlot(confirmSlot.id)
      addToast(t('slots.toast_deleted'), 'warning')
    } else {
      planning.cancelSlot(confirmSlot.id)
      addToast(
        confirmSlot.booked > 0
          ? t('slots.toast_cancelled', { count: confirmSlot.booked })
          : t('slots.toast_cancelled_empty'),
        'warning',
      )
    }
    setConfirmSlot(null)
    planning.setSelectedSlot(null)
  }

  function handleDrawerEdit(slot: TimeSlot) {
    planning.setSelectedSlot(null)
    setEditSlot(slot)
  }

  function handleDrawerCancel(slot: TimeSlot) {
    planning.setSelectedSlot(null)
    setConfirmMode('cancel')
    setConfirmSlot(slot)
  }

  function handleDrawerDelete(slot: TimeSlot) {
    planning.setSelectedSlot(null)
    setConfirmMode('delete')
    setConfirmSlot(slot)
  }

  return (
    <DashboardLayout>
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark lg:text-4xl">
            {t('planning.title')}
          </h1>
          <p className="mt-1 font-body text-sm font-bold text-dark">
            {getPeriodLabel(view, currentPeriodStart, t)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View switcher */}
          <div className="flex items-center gap-1 rounded-xl bg-card p-1">
            {(['day', 'week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => handleViewChange(v)}
                className={`rounded-lg px-3 py-1.5 font-body text-xs font-semibold transition-colors ${
                  view === v
                    ? 'bg-accent text-dark'
                    : 'text-muted hover:bg-dark/5 hover:text-dark'
                }`}
              >
                {t(`planning.view_${v}`)}
              </button>
            ))}
          </div>

          {/* Date navigation */}
          <div className="flex items-center gap-1 rounded-xl bg-card p-1">
            <button
              type="button"
              onClick={handlePrev}
              className="rounded-lg p-2 text-muted transition-colors hover:bg-dark/5 hover:text-dark"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="rounded-lg px-3 py-1.5 font-body text-xs font-semibold text-secondary transition-colors hover:bg-dark/5 hover:text-dark"
            >
              {t('planning.today')}
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="rounded-lg p-2 text-muted transition-colors hover:bg-dark/5 hover:text-dark"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button className="hidden sm:inline-flex" onClick={() => setCreateModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('planning.new_slot')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 overflow-x-auto pb-1">
        <FilterPills
          coaches={planning.coaches}
          activities={planning.activities}
          filterCoach={planning.filterCoach}
          filterActivity={planning.filterActivity}
          filterStatus={planning.filterStatus}
          onCoachChange={planning.setFilterCoach}
          onActivityChange={planning.setFilterActivity}
          onStatusChange={planning.setFilterStatus}
        />
      </div>

      {/* Desktop week grid (FullCalendar) */}
      <ErrorBoundary
        fallbackRender={({ resetErrorBoundary }) => (
          <div className="hidden items-center justify-center rounded-2xl border border-border bg-card p-12 md:flex">
            <div className="text-center">
              <p className="font-body text-sm text-muted">
                ⚠️ {t('planning.calendar_error')}
              </p>
              <button
                type="button"
                onClick={() => { resetErrorBoundary(); window.location.reload() }}
                className="mt-3 font-body text-sm text-dark underline"
              >
                {t('planning.calendar_reload')}
              </button>
            </div>
          </div>
        )}
      >
        <PlanningCalendar
          ref={calendarRef}
          slots={planning.filteredSlots}
          weekStart={planning.weekStart}
          onSlotClick={planning.setSelectedSlot}
          onDatesChange={handleDatesChange}
        />
      </ErrorBoundary>

      {/* Mobile day list */}
      <MobileDayList
        weekDays={planning.weekDays}
        getSlotsByDay={planning.getSlotsByDay}
        onSlotClick={planning.setSelectedSlot}
        loading={planning.loading}
      />

      {/* Detail drawer */}
      <SlotDrawer
        slot={planning.selectedSlot}
        onClose={() => planning.setSelectedSlot(null)}
        onEdit={handleDrawerEdit}
        onCancel={handleDrawerCancel}
        onDelete={handleDrawerDelete}
      />

      {/* Create modal */}
      <SlotModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleCreate}
        activities={planning.activities}
        coaches={planning.coaches}
        checkOverlap={planning.checkOverlap}
      />

      {/* Edit modal */}
      <SlotModal
        open={!!editSlot}
        onClose={() => setEditSlot(null)}
        onSubmit={handleEdit}
        activities={planning.activities}
        coaches={planning.coaches}
        editSlot={editSlot}
        checkOverlap={planning.checkOverlap}
      />

      {/* Delete/Cancel confirmation */}
      <SlotDeleteModal
        slot={confirmSlot}
        mode={confirmMode}
        onClose={() => setConfirmSlot(null)}
        onConfirm={handleConfirm}
      />

      {/* Mobile FAB */}
      <button
        type="button"
        onClick={() => setCreateModalOpen(true)}
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-[#111111] text-[#C8F000] shadow-lg transition-transform hover:scale-105 dark:bg-[#C8F000] dark:text-[#111111] sm:hidden"
      >
        <Plus className="h-6 w-6" />
      </button>
    </DashboardLayout>
  )
}
