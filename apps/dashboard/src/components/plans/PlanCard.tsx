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
    <div
      className={`flex h-full flex-col rounded-2xl border bg-card p-5 transition-opacity ${
        plan.active ? 'border-border' : 'border-border opacity-55'
      }`}
    >
      {/* Header : nom + populaire + badge actif */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate font-display text-lg font-black uppercase tracking-tight text-dark">
            {plan.name}
          </h3>
          {plan.isPopular && <Star className="h-4 w-4 shrink-0 fill-orange-500 text-orange-500" />}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            plan.active ? 'bg-green-100 text-green-600' : 'bg-dark/10 text-muted'
          }`}
        >
          {plan.active ? t('plans.active') : t('plans.inactive')}
        </span>
      </div>

      {/* Type lisible */}
      <p className="mt-1 font-body text-xs uppercase tracking-wide text-muted">
        {isOneTime ? t('plans.billing.one_time') : t('plans.billing.recurring_fixed')}
      </p>

      {/* Prix mis en avant */}
      <div className="mt-3 flex items-baseline gap-1">
        <span className="font-display text-3xl font-black tracking-tight text-dark">
          {formatPrice(plan.priceCents, plan.currency)}
        </span>
        {!isOneTime && <span className="font-body text-sm text-muted">{t('plans.per_month')}</span>}
      </div>

      {/* Séances ou durée */}
      <p className="mt-1 font-body text-sm text-muted">
        {isOneTime
          ? t('plans.credits_count', { count: plan.creditCount ?? 0 })
          : t('plans.duration_count', { count: plan.durationMonths ?? 0 })}
      </p>

      {/* Description tronquée (2 lignes) — flex-1 pousse les actions en bas */}
      <p className="mt-3 line-clamp-2 flex-1 font-body text-sm text-muted">
        {plan.description || ' '}
      </p>

      {/* Actions discrètes en bas */}
      <div className="mt-4 flex items-center justify-end gap-1 border-t border-border pt-3">
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
  )
}
