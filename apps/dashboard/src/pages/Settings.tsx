import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
// GYM-248 — les sites viennent de gym_sites de LA salle, plus d'un littéral mono-client.
import { useGymSites } from '@/hooks/useGymSites'
import { Plus } from 'lucide-react'
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
import { OpeningHoursCard } from '@/components/settings/OpeningHoursCard'
import { LegalBillingCard } from '@/components/settings/LegalBillingCard'
import { NoshowPolicyCard } from '@/components/settings/NoshowPolicyCard'
import { TeamSection } from '@/components/settings/TeamSection'
import { useActivities } from '@/hooks/useActivities'
import { useCoaches } from '@/hooks/useCoaches'
import { useToastStore } from '@/hooks/useToast'
import type { ActivityItem, ActivityFormData } from '@/types/activity'
import type { CoachItem, CoachFormData } from '@/types/coach'
import { MollieConnectCard } from '@/components/settings/MollieConnectCard'
// GYM-247 — abonnement Viniz de la salle (plan, quotas consommés, grille).
import { SubscriptionSection } from '@/components/settings/SubscriptionSection'
// GYM-285 — Réglages → Apparence : le wizard-couleurs (GYM-248) devenu éditable.
import { AppearanceCard } from '@/components/settings/AppearanceCard'

// GYM-56 — l'onglet "plans" est retiré : le CRUD des formules vit sur la page /plans.
// GYM-200 — onglet "team" : qui a accès au dashboard de la salle (invitations comprises).
// GYM-247 — onglet "subscription" : l'abonnement VINIZ de la salle. À ne pas confondre
// avec "plans" (les formules que la salle vend à ses membres, page /plans) ni avec
// "payments" (le branchement Mollie).
// GYM-285 — onglet "appearance" : les couleurs, le logo et le nom court de la salle, tels
// que les membres les voient dans l'app. Placé juste après "gym" parce qu'il parle de la
// même chose — l'identité de la salle — là où "payments" et "subscription" parlent
// d'argent. ⚠️ À ne pas fondre DANS l'onglet "gym" : celui-ci porte des réglages
// d'exploitation (délais, plafonds, horizon) qu'on ne relit pas en changeant une couleur.
const TABS = ['activities', 'coaches', 'team', 'gym', 'appearance', 'payments', 'subscription'] as const
type Tab = (typeof TABS)[number]

function isTab(v: string | null): v is Tab {
  return v !== null && (TABS as readonly string[]).includes(v)
}

export default function Settings() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)

  // Activities
  const {
    activities, activeCount: actActiveCount, createActivity, updateActivity,
    updateActivityImage,
    toggleActivity, getActivityFutureSlots, duplicateActivity, deleteActivity, slugify,
  } = useActivities()

  // GYM-247 — l'onglet est amorçable par l'URL (?tab=subscription) pour que les CTA
  // d'upsell pointent directement sur l'abonnement. La navigation interne reste en state :
  // seul l'AMORÇAGE lit l'URL, changer d'onglet ne réécrit pas l'historique.
  const [searchParams] = useSearchParams()
  const { siteNames } = useGymSites()
  const requestedTab = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<Tab>(isTab(requestedTab) ? requestedTab : 'activities')
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
  //
  // 🔴 GYM-228 — LE TOAST DE SUCCÈS ÉTAIT AFFIRMÉ SANS PREUVE. Les deux handlers
  // n'attendaient même pas l'écriture et annonçaient la réussite quoi qu'il arrive : une
  // contrainte violée ou un GRANT manquant se serait lu comme un enregistrement réussi.
  // C'est mot pour mot le défaut de GYM-204, qui a masqué une écriture inopérante pendant
  // des mois. Le toast suit désormais le résultat.
  async function handleActCreate(data: ActivityFormData) {
    const res = await createActivity(data)
    if (res.error) {
      addToast(t('activities.toast_save_failed'), 'error')
      return
    }
    setActCreateOpen(false)
    addToast(t('activities.toast_created'))
  }
  async function handleActEdit(data: ActivityFormData) {
    if (!editActivity) return
    const res = await updateActivity(editActivity.id, data)
    if (res.error) {
      addToast(t('activities.toast_save_failed'), 'error')
      return
    }
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
      <h1 className="font-display text-3xl font-black tracking-tight text-dark lg:text-4xl">
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
                ? 'border-accent-dim text-dark'
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
                <h2 className="font-display text-xl font-black tracking-tight text-dark">
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
            {/* 🔴 GYM-215 — L'IMAGE N'EST OFFERTE QU'À L'ÉDITION, et la modale de création
                le dit au lieu de le cacher. Le chemin convenu contient l'identifiant de
                l'activité (`{gym_id}/activities/{activity_id}`) : avant le premier
                enregistrement, cet identifiant n'existe pas. Passer par un chemin
                temporaire puis déplacer le fichier recréerait exactement les orphelins que
                le nommage déterministe supprime. */}
            <ActivityModal open={!!editActivity} onClose={() => setEditActivity(null)} onSubmit={handleActEdit} editActivity={editActivity} slugify={slugify} onImageChange={updateActivityImage} />
            <ActivityDeleteModal activity={deleteActTarget} futureSlotCount={0} onClose={() => setDeleteActTarget(null)} onConfirm={handleActDelete} />
          </>
        )}

        {/* ========= COACHES TAB ========= */}
        {activeTab === 'coaches' && (
          <>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-black tracking-tight text-dark">
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
              availableSites={siteNames}
            />
            <CoachModal
              open={!!editCoach}
              onClose={() => setEditCoach(null)}
              onSubmit={handleCoachEdit}
              editCoach={editCoach}
              availableActivities={availableActivitiesForCoach}
              availableSites={siteNames}
            />
            <CoachDeleteModal
              coach={deleteCoachTarget}
              futureSlotCount={0}
              onClose={() => setDeleteCoachTarget(null)}
              onConfirm={handleCoachDelete}
            />
          </>
        )}

        {/* ========= TEAM TAB (GYM-200) ========= */}
        {activeTab === 'team' && <TeamSection />}

        {/* ========= GYM TAB ========= */}
        {activeTab === 'gym' && (
          <div className="flex flex-col gap-4">
            <GymSettingsCard />
            {/* GYM-228 — horaires d'ouverture. Dans l'onglet SALLE, pas sous l'Open Gym :
                ce sont les heures de Dopamine, et elles serviront aussi à les afficher
                au membre et à contrôler la cohérence des créneaux. */}
            <OpeningHoursCard />
            {/* GYM-175 — politique d'absences (table noshow_rules, distincte de nexxia_gyms). */}
            <NoshowPolicyCard />
            {/* GYM-180 — identité légale de l'émetteur + régime TVA des factures. */}
            <LegalBillingCard />
          </div>
        )}

        {/* ========= APPEARANCE TAB (GYM-285) ========= */}
        {activeTab === 'appearance' && <AppearanceCard />}

        {/* ========= SUBSCRIPTION TAB (GYM-247) ========= */}
        {activeTab === 'subscription' && <SubscriptionSection />}

        {/* ========= PAYMENTS TAB ========= */}
        {activeTab === 'payments' && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="font-display text-xl font-black tracking-tight text-dark">
                {t('settings.payments.title')}
              </h2>
              <p className="mt-1 font-body text-sm text-muted">{t('settings.payments.subtitle')}</p>
            </div>
            <MollieConnectCard />
          </div>
        )}
      </div>

      {/* Confirm modal for toggles */}
      <ConfirmModal {...confirmModal} />
    </DashboardLayout>
  )
}
