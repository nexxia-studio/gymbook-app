import { useTranslation } from 'react-i18next'
import { Star, Pencil, Eye, EyeOff } from 'lucide-react'
import type { PlanItem } from '@/types/plan'

interface PlanCardProps {
  plan: PlanItem
  onEdit: (plan: PlanItem) => void
  onToggleActive: (plan: PlanItem) => void
}

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-BE', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

export function PlanCard({ plan, onEdit, onToggleActive }: PlanCardProps) {
  const { t } = useTranslation()
  const isOneTime = plan.billingType === 'one_time'

  return (
    <div className={`rounded-2xl border bg-card p-5 transition-opacity ${plan.active ? 'border-border' : 'border-border opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-black uppercase tracking-tight text-dark">{plan.name}</h3>
            {plan.isPopular && (
              <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-600">
                <Star className="h-3 w-3 fill-orange-500 text-orange-500" />
                {t('plans.popular')}
              </span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${plan.active ? 'bg-green-100 text-green-600' : 'bg-dark/10 text-muted'}`}>
              {plan.active ? t('plans.active') : t('plans.inactive')}
            </span>
          </div>

          <p className="mt-1 font-body text-xs uppercase tracking-wide text-muted">
            {isOneTime ? t('plans.billing.one_time') : t('plans.billing.recurring_fixed')}
          </p>

          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-body text-base font-bold text-dark">
              {formatPrice(plan.priceCents, plan.currency)}
              {!isOneTime && <span className="font-normal text-muted">{t('plans.per_month')}</span>}
            </span>
            <span className="font-body text-sm text-muted">
              {isOneTime
                ? t('plans.credits_count', { count: plan.creditCount ?? 0 })
                : t('plans.duration_count', { count: plan.durationMonths ?? 0 })}
            </span>
          </div>

          {plan.description && (
            <p className="mt-2 font-body text-sm text-muted">{plan.description}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleActive(plan)}
            title={plan.active ? t('plans.deactivate') : t('plans.activate')}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-dark/5 hover:text-dark"
          >
            {plan.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => onEdit(plan)}
            title={t('common.edit')}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-dark/5 hover:text-dark"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
