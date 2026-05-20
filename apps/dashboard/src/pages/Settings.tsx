import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Wrench } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { ActivityCard } from '@/components/settings/ActivityCard'
import { ActivityModal } from '@/components/settings/ActivityModal'
import { ActivityDeleteModal } from '@/components/settings/ActivityDeleteModal'
import { CoachCard } from '@/components/settings/CoachCard'
import { CoachModal } from '@/components/settings/CoachModal'
import { CoachDeleteModal } from '@/components/settings/CoachDeleteModal'
import { GymSettingsCard } from '@/components/settings/GymSettingsCard'
import { useActivities } from '@/hooks/useActivities'
import { useCoaches } from '@/hooks/useCoaches'
import { useToastStore } from '@/hooks/useToast'
import type { ActivityItem, ActivityFormData } from '@/types/activity'
import type { CoachItem, CoachFormData } from '@/types/coach'
import { MollieConnectCard } from '@/components/settings/MollieConnectCard'

const TABS = ['activities', 'coaches', 'gym', 'plans'] as const
type Tab = (typeof TABS)[number]

function PlaceholderTab() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
        <Wrench className="h-7 w-7 text-accent-dim" />
      </div>
      <p className="font-body text-sm text-muted">{t('placeholder.subtitle')}</p>
    </div>
  )
}

export default function Settings() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)

  // Activities
  const {
    activities, activeCount: actActiveCount, createActivity, updateActivity,
    toggleActivity, getActivityFutureSlots, duplicateActivity, deleteActivity, slugify,
  } = useActivities()

  const [activeTab, setActiveTab] = useState<Tab>('activities')
  const [actCreateOpen, setActCreateOpen] = useState(false)
  const [editActivity, setEditActivity] = useState<ActivityItem | null>(null)
  const [deleteActTarget, setDeleteActTarget] = useState<ActivityItem | null>(null)

  // Coaches
  const {
    coaches, activeCount: coachActiveCount,
    createCoach, updateCoach, toggleCoach, getCoachFutureSlots, deleteCoach,
  } = useCoaches()

  const [coachCreateOpen, setCoachCreateOpen] = useState(false)
  const [editCoach, setEditCoach] = useState<CoachItem | null>(null)
  const [deleteCoachTarget, setDeleteCoachTarget] = useState<CoachItem | null>(null)

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState({
    open: false, title: '', message: '',
    onConfirm: () => {}, onCancel: () => {},
    confirmLabel: 'Confirmer', confirmColor: 'orange' as 'red' | 'orange' | 'green',
  })

  // Activity colors map for coach pills
  const activityColors = useMemo(() => {
    const map: Record<string, string> = {}
    for (const a of activities) map[a.name] = a.color
    return map
  }, [activities])

  const availableActivitiesForCoach = useMemo(
    () => activities.filter((a) => a.active).map((a) => ({ name: a.name, color: a.color })),
    [activities],
  )

  // --- Activity handlers ---
  function handleActCreate(data: ActivityFormData) {
    createActivity(data)
    setActCreateOpen(false)
    addToast(t('activities.toast_created'))
  }
  function handleActEdit(data: ActivityFormData) {
    if (!editActivity) return
    updateActivity(editActivity.id, data)
    setEditActivity(null)
    addToast(t('activities.toast_updated'))
  }
  async function handleActToggle(id: string) {
    const activity = activities.find((a) => a.id === id)
    if (!activity) return

    if (activity.active) {
      const futureCount = await getActivityFutureSlots(id)
      if (futureCount > 0) {
        setConfirmModal({
          open: true,
          title: t('activities.toggle_confirm_title'),
          message: t('activities.toggle_confirm_message', { count: futureCount }),
          confirmLabel: t('activities.toggle_confirm_button'),
          confirmColor: 'orange',
          onConfirm: async () => {
            await toggleActivity(id)
            setConfirmModal((p) => ({ ...p, open: false }))
            addToast(t('activities.toast_deactivated'))
          },
          onCancel: () => setConfirmModal((p) => ({ ...p, open: false })),
        })
        return
      }
    }
    const isNowActive = await toggleActivity(id)
    addToast(t(isNowActive ? 'activities.toast_activated' : 'activities.toast_deactivated'))
  }
  async function handleActDuplicate(id: string) {
    const dup = await duplicateActivity(id)
    if (dup) addToast(t('activities.toast_duplicated'))
  }
  function handleActDelete() {
    if (!deleteActTarget) return
    deleteActivity(deleteActTarget.id)
    setDeleteActTarget(null)
    addToast(t('activities.toast_deleted'), 'warning')
  }

  // --- Coach handlers ---
  function handleCoachCreate(data: CoachFormData) {
    createCoach(data)
    setCoachCreateOpen(false)
    addToast(t('coaches.toast_created'))
  }
  function handleCoachEdit(data: CoachFormData) {
    if (!editCoach) return
    updateCoach(editCoach.id, data)
    setEditCoach(null)
    addToast(t('coaches.toast_updated'))
  }
  async function handleCoachToggle(id: string) {
    const coach = coaches.find((c) => c.id === id)
    if (!coach) return

    if (coach.active) {
      const futureCount = await getCoachFutureSlots(id)
      if (futureCount > 0) {
        setConfirmModal({
          open: true,
          title: t('coaches.toggle_confirm_title'),
          message: t('coaches.toggle_confirm_message', { name: coach.firstName, count: futureCount }),
          confirmLabel: t('coaches.toggle_confirm_button'),
          confirmColor: 'orange',
          onConfirm: async () => {
            await toggleCoach(id)
            setConfirmModal((p) => ({ ...p, open: false }))
            addToast(t('coaches.toast_deactivated'))
          },
          onCancel: () => setConfirmModal((p) => ({ ...p, open: false })),
        })
        return
      }
    }
    const isNowActive = await toggleCoach(id)
    addToast(t(isNowActive ? 'coaches.toast_activated' : 'coaches.toast_deactivated'))
  }
  function handleCoachDelete() {
    if (!deleteCoachTarget) return
    deleteCoach(deleteCoachTarget.id)
    setDeleteCoachTarget(null)
    addToast(t('coaches.toast_deleted'), 'warning')
  }

  return (
    <DashboardLayout>
      {/* Page header */}
      <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark lg:text-4xl">
        {t('settings.title')}
      </h1>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 border-b-2 px-4 py-2.5 font-body text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'border-accent text-dark'
                : 'border-transparent text-muted hover:text-dark'
            }`}
          >
            {t(`settings.tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="mt-6">
        {/* ========= ACTIVITIES TAB ========= */}
        {activeTab === 'activities' && (
          <>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-black uppercase tracking-tight text-dark">
                  {t('activities.title')}
                </h2>
                <p className="mt-1 font-body text-sm text-muted">{t('activities.subtitle')}</p>
                <p className="mt-0.5 font-body text-xs text-muted">
                  {t('activities.count', { total: activities.length })} &middot; {t('activities.count_active', { active: actActiveCount })}
                </p>
              </div>
              <Button onClick={() => setActCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t('activities.new')}
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {activities.map((activity) => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  onEdit={() => setEditActivity(activity)}
                  onDuplicate={() => handleActDuplicate(activity.id)}
                  onDelete={() => setDeleteActTarget(activity)}
                  onToggle={() => handleActToggle(activity.id)}
                />
              ))}
            </div>

            <ActivityModal open={actCreateOpen} onClose={() => setActCreateOpen(false)} onSubmit={handleActCreate} slugify={slugify} />
            <ActivityModal open={!!editActivity} onClose={() => setEditActivity(null)} onSubmit={handleActEdit} editActivity={editActivity} slugify={slugify} />
            <ActivityDeleteModal activity={deleteActTarget} futureSlotCount={0} onClose={() => setDeleteActTarget(null)} onConfirm={handleActDelete} />
          </>
        )}

        {/* ========= COACHES TAB ========= */}
        {activeTab === 'coaches' && (
          <>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-black uppercase tracking-tight text-dark">
                  {t('coaches.title')}
                </h2>
                <p className="mt-1 font-body text-sm text-muted">{t('coaches.subtitle')}</p>
                <p className="mt-0.5 font-body text-xs text-muted">
                  {t('coaches.count', { total: coaches.length })} &middot; {t('coaches.count_active', { active: coachActiveCount })}
                </p>
              </div>
              <Button onClick={() => setCoachCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t('coaches.new')}
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {coaches.map((coach) => (
                <CoachCard
                  key={coach.id}
                  coach={coach}
                  activityColors={activityColors}
                  onEdit={() => setEditCoach(coach)}
                  onToggle={() => handleCoachToggle(coach.id)}
                  onDelete={() => setDeleteCoachTarget(coach)}
                />
              ))}
            </div>

            <CoachModal
              open={coachCreateOpen}
              onClose={() => setCoachCreateOpen(false)}
              onSubmit={handleCoachCreate}
              availableActivities={availableActivitiesForCoach}
              availableSites={['Neupré']}
            />
            <CoachModal
              open={!!editCoach}
              onClose={() => setEditCoach(null)}
              onSubmit={handleCoachEdit}
              editCoach={editCoach}
              availableActivities={availableActivitiesForCoach}
              availableSites={['Neupré']}
            />
            <CoachDeleteModal
              coach={deleteCoachTarget}
              futureSlotCount={0}
              onClose={() => setDeleteCoachTarget(null)}
              onConfirm={handleCoachDelete}
            />
          </>
        )}

        {/* ========= GYM TAB ========= */}
        {activeTab === 'gym' && (
          <div className="flex flex-col gap-4">
            <GymSettingsCard />
            <MollieConnectCard />
          </div>
        )}

        {/* ========= PLACEHOLDER TABS ========= */}
        {activeTab === 'plans' && <PlaceholderTab />}
      </div>

      {/* Confirm modal for toggles */}
      <ConfirmModal {...confirmModal} />
    </DashboardLayout>
  )
}
