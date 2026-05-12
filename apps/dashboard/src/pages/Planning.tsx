import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/Button'
import { FilterPills } from '@/components/planning/FilterPills'
import { WeekGrid } from '@/components/planning/WeekGrid'
import { MobileDayList } from '@/components/planning/MobileDayList'
import { SlotDrawer } from '@/components/planning/SlotDrawer'
import { usePlanning } from '@/hooks/usePlanning'

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

export default function Planning() {
  const { t } = useTranslation()
  const {
    weekStart,
    weekEnd,
    weekDays,
    loading,
    getSlotsByDay,
    navigate,
    selectedSlot,
    setSelectedSlot,
    filterCoach,
    setFilterCoach,
    filterActivity,
    setFilterActivity,
    filterStatus,
    setFilterStatus,
    coaches,
    activities,
  } = usePlanning()

  return (
    <DashboardLayout>
      {/* Page header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark lg:text-4xl">
            {t('planning.title')}
          </h1>
          <p className="mt-1 font-body text-sm text-muted">
            {formatWeekRange(weekStart, weekEnd, t)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Week nav */}
          <div className="flex items-center gap-1 rounded-xl bg-card p-1">
            <button
              type="button"
              onClick={() => navigate('prev')}
              className="rounded-lg p-2 text-muted transition-colors hover:bg-dark/5 hover:text-dark"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => navigate('today')}
              className="rounded-lg px-3 py-1.5 font-body text-xs font-semibold text-secondary transition-colors hover:bg-dark/5 hover:text-dark"
            >
              {t('planning.today')}
            </button>
            <button
              type="button"
              onClick={() => navigate('next')}
              className="rounded-lg p-2 text-muted transition-colors hover:bg-dark/5 hover:text-dark"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button className="hidden sm:inline-flex">
            <Plus className="h-4 w-4" />
            {t('planning.new_slot')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 overflow-x-auto pb-1">
        <FilterPills
          coaches={coaches}
          activities={activities}
          filterCoach={filterCoach}
          filterActivity={filterActivity}
          filterStatus={filterStatus}
          onCoachChange={setFilterCoach}
          onActivityChange={setFilterActivity}
          onStatusChange={setFilterStatus}
        />
      </div>

      {/* Desktop week grid */}
      <WeekGrid
        weekDays={weekDays}
        getSlotsByDay={getSlotsByDay}
        onSlotClick={setSelectedSlot}
        loading={loading}
      />

      {/* Mobile day list */}
      <MobileDayList
        weekDays={weekDays}
        getSlotsByDay={getSlotsByDay}
        onSlotClick={setSelectedSlot}
        loading={loading}
      />

      {/* Detail drawer */}
      <SlotDrawer slot={selectedSlot} onClose={() => setSelectedSlot(null)} />

      {/* Mobile FAB */}
      <button
        type="button"
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-dark text-accent shadow-lg transition-transform hover:scale-105 sm:hidden"
      >
        <Plus className="h-6 w-6" />
      </button>
    </DashboardLayout>
  )
}
