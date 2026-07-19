// GYM-144 — Modal d'ajout d'un membre au comptoir (gym_admin).
// Crée le compte via l'Edge Function admin-create-member et, optionnellement,
// enregistre une carte de séances one_time payée sur place (cash / terminal).
import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ChevronDown, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { useGymPlans } from '@/hooks/useGymPlans'
import { useToastStore } from '@/hooks/useToast'

interface AddMemberModalProps {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

type PaymentMethod = 'cash' | 'card_terminal'

function formatPrice(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-BE', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// Lit le code d'erreur métier renvoyé par l'Edge Function (corps JSON porté par
// error.context pour une FunctionsHttpError).
async function extractErrorCode(error: unknown): Promise<string | undefined> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      return body?.code as string | undefined
    } catch {
      /* corps non-JSON */
    }
  }
  return undefined
}

export function AddMemberModal({ open, onClose, onCreated }: AddMemberModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addToast = useToastStore((s) => s.addToast)
  const { plans } = useGymPlans()

  // Cartes de séances vendables au comptoir = plans one_time actifs uniquement.
  const oneTimePlans = plans.filter((p) => p.active && p.billingType === 'one_time')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [cardOpen, setCardOpen] = useState(false)
  const [planId, setPlanId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')

  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string; email?: string }>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  function reset() {
    setFirstName(''); setLastName(''); setEmail(''); setPhone('')
    setCardOpen(false); setPlanId(''); setPaymentMethod('cash')
    setErrors({})
  }

  useEffect(() => {
    if (open) reset()
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const selectedPlan = oneTimePlans.find((p) => p.id === planId) ?? null

  function validate(): boolean {
    const e: typeof errors = {}
    if (!firstName.trim()) e.firstName = t('members.add.validation.first_name_required')
    if (!lastName.trim()) e.lastName = t('members.add.validation.last_name_required')
    if (!email.trim()) e.email = t('members.add.validation.email_required')
    else if (!isValidEmail(email.trim())) e.email = t('members.add.validation.email_invalid')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit(ev: FormEvent) {
    ev.preventDefault()
    if (isSubmitting) return
    if (!validate()) return

    // Une carte n'est envoyée que si la section est ouverte ET un plan choisi.
    const withCard = cardOpen && !!planId
    const body = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim().toLowerCase(),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(withCard ? { plan_id: planId, payment_method: paymentMethod } : {}),
    }

    setIsSubmitting(true)
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-member', { body })

      if (error) {
        const code = await extractErrorCode(error)
        if (code === 'EMAIL_EXISTS') {
          setErrors((prev) => ({ ...prev, email: t('members.add.error_email_exists') }))
        } else {
          addToast(t('members.add.error_generic'), 'error')
        }
        return
      }

      const createdEmail = body.email
      if (data?.email_sent) {
        addToast(t('members.add.toast_success', { email: createdEmail }), 'success')
      } else {
        addToast(t('members.add.toast_success_no_email'), 'warning')
      }
      onCreated()
      onClose()
    } catch (e) {
      addToast((e as Error).message || t('members.add.error_generic'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClass = 'w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark'
  const labelClass = 'font-body text-sm font-medium text-dark'
  const errClass = 'text-xs text-red-500 mt-1'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[520px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {t('members.add.title')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>{t('members.add.first_name')} *</label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputClass}
                />
                {errors.firstName && <p className={errClass}>{errors.firstName}</p>}
              </div>
              <div>
                <label className={labelClass}>{t('members.add.last_name')} *</label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputClass}
                />
                {errors.lastName && <p className={errClass}>{errors.lastName}</p>}
              </div>
            </div>

            {/* Email */}
            <div>
              <label className={labelClass}>{t('members.add.email')} *</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((p) => ({ ...p, email: undefined })) }}
                className={inputClass}
              />
              {errors.email && <p className={errClass}>{errors.email}</p>}
            </div>

            {/* Phone */}
            <div>
              <label className={labelClass}>{t('members.add.phone')}</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('members.add.phone_optional')}
                className={inputClass}
              />
            </div>

            {/* Collapsible : carte de séances payée sur place */}
            <div className="rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setCardOpen((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-muted" />
                  <span className={labelClass}>{t('members.add.card_section')}</span>
                </span>
                <ChevronDown className={`h-4 w-4 text-muted transition-transform ${cardOpen ? 'rotate-180' : ''}`} />
              </button>

              {cardOpen && (
                <div className="flex flex-col gap-4 border-t border-border p-4">
                  {oneTimePlans.length === 0 ? (
                    <p className="font-body text-xs text-muted">{t('members.add.no_plans')}</p>
                  ) : (
                    <>
                      {/* Plan selector */}
                      <div>
                        <label className={labelClass}>{t('members.add.plan')}</label>
                        <select
                          value={planId}
                          onChange={(e) => setPlanId(e.target.value)}
                          className={inputClass}
                        >
                          <option value="">{t('members.add.plan_placeholder')}</option>
                          {oneTimePlans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — {formatPrice(p.priceCents, p.currency)}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Price (read-only) + payment method — only when a plan is chosen */}
                      {selectedPlan && (
                        <>
                          <div className="flex items-center justify-between rounded-xl bg-dark/[0.03] px-4 py-3">
                            <span className="font-body text-sm text-muted">{t('members.add.price')}</span>
                            <span className="font-body text-sm font-bold text-dark">
                              {formatPrice(selectedPlan.priceCents, selectedPlan.currency)}
                            </span>
                          </div>

                          <div>
                            <label className={labelClass}>{t('members.add.payment_method')}</label>
                            <div className="mt-2 grid grid-cols-2 gap-3">
                              {(['cash', 'card_terminal'] as PaymentMethod[]).map((m) => (
                                <label
                                  key={m}
                                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 font-body text-sm transition-colors ${
                                    paymentMethod === m ? 'border-dark bg-dark/[0.03] text-dark' : 'border-border text-muted hover:bg-dark/5'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="payment_method"
                                    value={m}
                                    checked={paymentMethod === m}
                                    onChange={() => setPaymentMethod(m)}
                                    className="h-4 w-4 accent-accent"
                                  />
                                  {m === 'cash' ? t('members.add.method_cash') : t('members.add.method_card')}
                                </label>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit} isLoading={isSubmitting}>
            {t('members.add.submit')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
