import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, CreditCard } from 'lucide-react'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Button } from '@/components/ui/Button'
import { PlanCard } from '@/components/plans/PlanCard'
import { PlanModal } from '@/components/plans/PlanModal'
import { useGymPlans } from '@/hooks/useGymPlans'
import { useToastStore } from '@/hooks/useToast'
import type { PlanItem, PlanFormData } from '@/types/plan'

export default function Plans() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const { plans, isLoading, error, createPlan, updatePlan, togglePlanActive } = useGymPlans()

  const [createOpen, setCreateOpen] = useState(false)
  const [editPlan, setEditPlan] = useState<PlanItem | null>(null)

  async function handleSubmit(data: PlanFormData) {
    try {
      if (editPlan) {
        await updatePlan(editPlan.id, data)
        addToast(t('plans.toast_updated'), 'success')
      } else {
        await createPlan(data)
        addToast(t('plans.toast_created'), 'success')
      }
      setCreateOpen(false)
      setEditPlan(null)
    } catch (e) {
      console.error('[plans] save failed', e)
      addToast(t('plans.toast_error'), 'error')
    }
  }

  async function handleToggleActive(plan: PlanItem) {
    try {
      await togglePlanActive(plan.id)
      addToast(plan.active ? t('plans.toast_deactivated') : t('plans.toast_activated'), 'warning')
    } catch (e) {
      console.error('[plans] toggle failed', e)
      addToast(t('plans.toast_error'), 'error')
    }
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-black uppercase tracking-tight text-dark lg:text-4xl">
            {t('plans.title')}
          </h1>
          <p className="mt-1 font-body text-sm text-muted">{t('plans.subtitle')}</p>
        </div>
        <Button onClick={() => { setEditPlan(null); setCreateOpen(true) }}>
          <Plus className="h-4 w-4" />
          {t('plans.create')}
        </Button>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="font-body text-sm text-muted">{t('common.loading')}</p>
        ) : error ? (
          <p className="font-body text-sm text-red-500">{t('plans.load_error')}</p>
        ) : plans.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10">
              <CreditCard className="h-7 w-7 text-accent-dim" />
            </div>
            <p className="font-body text-sm text-muted">{t('plans.empty')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                onEdit={(p) => { setEditPlan(p); setCreateOpen(true) }}
                onToggleActive={handleToggleActive}
              />
            ))}
          </div>
        )}
      </div>

      <PlanModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); setEditPlan(null) }}
        onSubmit={handleSubmit}
        editPlan={editPlan}
      />
    </DashboardLayout>
  )
}
