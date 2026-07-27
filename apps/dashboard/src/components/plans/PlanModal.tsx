import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { PlanItem, PlanFormData, BillingType, PlanType } from '@/types/plan'

interface PlanModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: PlanFormData) => void
  editPlan?: PlanItem | null
}

type FormErrors = Partial<Record<keyof PlanFormData, string>>

const EMPTY: PlanFormData = {
  name: '',
  description: '',
  planType: 'credits',
  billingType: 'one_time',
  creditCount: 10,
  durationMonths: null,
  priceEuros: 0,
  isPopular: false,
  active: true,
  sortOrder: 0,
}

export function PlanModal({ open, onClose, onSubmit, editPlan }: PlanModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isEdit = !!editPlan

  const [form, setForm] = useState<PlanFormData>(EMPTY)
  const [errors, setErrors] = useState<FormErrors>({})

  useEffect(() => {
    if (!open) return
    if (editPlan) {
      // GYM-188 — ÉDITION SANS CORRUPTION : tout est repris TEL QUEL depuis la base.
      // Les anciens replis `?? 10` / `?? 3` installaient une valeur à la simple ouverture
      // de la modale : ouvrir un plan illimité (credit_count NULL) puis enregistrer sans
      // rien toucher le transformait en carte de 10 séances. Un NULL signifie « sans objet
      // pour ce type » et doit le rester — le champ s'affiche vide, jamais pré-rempli.
      setForm({
        name: editPlan.name,
        description: editPlan.description,
        planType: editPlan.planType,
        billingType: editPlan.billingType,
        creditCount: editPlan.creditCount,
        durationMonths: editPlan.durationMonths,
        priceEuros: editPlan.priceCents / 100,
        isPopular: editPlan.isPopular,
        active: editPlan.active,
        sortOrder: editPlan.sortOrder,
      })
    } else {
      setForm(EMPTY)
    }
    setErrors({})
  }, [open, editPlan])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Les deux axes sont indépendants : le mode de paiement ne dit RIEN du type de formule.
  const isCredits = form.planType === 'credits'
  const isRecurring = form.billingType === 'recurring_fixed'

  // Changer un sélecteur ne réécrit JAMAIS un autre champ : le formulaire conserve ce que
  // l'utilisateur a saisi s'il fait un aller-retour entre deux types. C'est toRow() qui
  // décide seul quelle colonne part en base et laquelle est forcée à NULL.
  function setPlanType(pt: PlanType) {
    setForm((f) => ({ ...f, planType: pt }))
  }

  function setBillingType(bt: BillingType) {
    setForm((f) => ({ ...f, billingType: bt }))
  }

  function validate(): boolean {
    const e: FormErrors = {}
    if (!form.name.trim()) e.name = t('plans.validation.name_required')
    if (!(form.priceEuros > 0)) e.priceEuros = t('plans.validation.price_positive')
    // La validation suit le TYPE de formule, pas le mode de paiement.
    if (isCredits) {
      if (!form.creditCount || form.creditCount < 1) e.creditCount = t('plans.validation.credits_min')
    } else {
      if (!form.durationMonths || form.durationMonths < 1) e.durationMonths = t('plans.validation.duration_min')
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (!validate()) return
    onSubmit(form)
  }

  const inputClass = 'w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark'
  const labelClass = 'font-body text-sm font-medium text-dark'
  const errClass = 'text-xs text-red-500 mt-1'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[560px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {isEdit ? t('plans.edit_title') : t('plans.create_title')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            {/* Name */}
            <div>
              <label className={labelClass}>{t('plans.name')}</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t('plans.name_placeholder')}
                className={inputClass}
                required
              />
              {errors.name && <p className={errClass}>{errors.name}</p>}
            </div>

            {/* Description */}
            <div>
              <label className={labelClass}>{t('plans.description')}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value.slice(0, 500) }))}
                rows={2}
                className={`${inputClass} resize-none`}
              />
            </div>

            {/* GYM-188 — Axe 1 : ce que le membre obtient. */}
            <div>
              <label className={labelClass}>{t('plans.plan_type')}</label>
              <div className="mt-1 flex gap-2">
                {(['credits', 'unlimited'] as PlanType[]).map((pt) => (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => setPlanType(pt)}
                    className={`flex-1 rounded-xl border px-4 py-3 font-body text-sm font-medium transition-colors ${
                      form.planType === pt
                        ? 'border-accent-dim bg-accent-dim/10 text-dark'
                        : 'border-border text-muted hover:text-dark'
                    }`}
                  >
                    {t(`plans.type.${pt}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* GYM-188 — Axe 2 : comment il le paie. Indépendant de l'axe 1. */}
            <div>
              <label className={labelClass}>{t('plans.billing_type')}</label>
              <div className="mt-1 flex gap-2">
                {(['one_time', 'recurring_fixed'] as BillingType[]).map((bt) => (
                  <button
                    key={bt}
                    type="button"
                    onClick={() => setBillingType(bt)}
                    className={`flex-1 rounded-xl border px-4 py-3 font-body text-sm font-medium transition-colors ${
                      form.billingType === bt
                        ? 'border-accent-dim bg-accent-dim/10 text-dark'
                        : 'border-border text-muted hover:text-dark'
                    }`}
                  >
                    {t(`plans.billing.${bt}`)}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 font-body text-xs text-muted">{t('plans.billing_type_helper')}</p>
            </div>

            {/* Champ conditionnel piloté par le TYPE de formule (plus par le mode de paiement). */}
            {isCredits ? (
              <div>
                <label className={labelClass}>{t('plans.credit_count')}</label>
                <input
                  type="number"
                  min={1}
                  value={form.creditCount ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, creditCount: e.target.value === '' ? null : Number(e.target.value) }))}
                  className={`${inputClass} w-32`}
                />
                {errors.creditCount && <p className={errClass}>{errors.creditCount}</p>}
              </div>
            ) : (
              <div>
                <label className={labelClass}>{t('plans.duration_months')}</label>
                <input
                  type="number"
                  min={1}
                  value={form.durationMonths ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, durationMonths: e.target.value === '' ? null : Number(e.target.value) }))}
                  className={`${inputClass} w-32`}
                />
                {errors.durationMonths && <p className={errClass}>{errors.durationMonths}</p>}
              </div>
            )}

            {/* Price (euros) */}
            <div>
              <label className={labelClass}>{t('plans.price')}</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.priceEuros}
                  onChange={(e) => setForm((f) => ({ ...f, priceEuros: Number(e.target.value) }))}
                  className={`${inputClass} w-32`}
                />
                <span className="font-body text-sm text-muted">€</span>
              </div>
              {errors.priceEuros && <p className={errClass}>{errors.priceEuros}</p>}
              {/* GYM-56 — avertissement édition prix d'un abonnement en cours.
                  GYM-188 : conditionné au MODE DE PAIEMENT (seul un prélèvement récurrent
                  a des souscriptions en cours à ne pas perturber), plus au type de formule. */}
              {isEdit && isRecurring && (
                <div className="mt-2 flex items-start gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                  <p className="font-body text-xs text-orange-700">{t('plans.price_warning_recurring')}</p>
                </div>
              )}
            </div>

            {/* Sort order */}
            <div>
              <label className={labelClass}>{t('plans.sort_order')}</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))}
                className={`${inputClass} w-24`}
              />
            </div>

            {/* Popular + Active */}
            <label className="flex items-center gap-3 rounded-xl border border-border p-4">
              <input
                type="checkbox"
                checked={form.isPopular}
                onChange={(e) => setForm((f) => ({ ...f, isPopular: e.target.checked }))}
                className="h-4 w-4 rounded accent-accent"
              />
              <span className={labelClass}>{t('plans.is_popular')}</span>
            </label>
            <label className="flex items-center gap-3 rounded-xl border border-border p-4">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="h-4 w-4 rounded accent-accent"
              />
              <span className={labelClass}>{t('plans.active_label')}</span>
            </label>
          </div>
        </form>

        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit}>
            {isEdit ? t('common.save') : t('common.create')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
