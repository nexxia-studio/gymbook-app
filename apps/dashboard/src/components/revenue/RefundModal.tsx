// GYM-112 — Modal de remboursement d'un paiement Mollie.
// Total ou partiel (max = restant remboursable). Appelle l'Edge Function create-refund ;
// aucune écriture optimiste : le statut/crédits changeront via le webhook Mollie.
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { useToastStore } from '@/hooks/useToast'

export interface RefundTarget {
  id: string
  planName: string
  memberName: string
  amount: number
  refundedAmount: number
  currency: string
}

interface RefundModalProps {
  payment: RefundTarget | null
  onClose: () => void
  onDone: () => void
}

function fmt(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('fr-BE', { style: 'currency', currency }).format(n)
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
}

async function extractErrorCode(error: unknown): Promise<string | undefined> {
  const ctx = (error as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      return body?.code as string | undefined
    } catch { /* non-JSON */ }
  }
  return undefined
}

export function RefundModal({ payment, onClose, onDone }: RefundModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addToast = useToastStore((s) => s.addToast)

  const [mode, setMode] = useState<'total' | 'partial'>('total')
  const [amountInput, setAmountInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remaining = payment ? Math.max(0, payment.amount - payment.refundedAmount) : 0
  const currency = payment?.currency ?? 'EUR'

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (payment && !dialog.open) dialog.showModal()
    if (!payment && dialog.open) dialog.close()
  }, [payment])

  useEffect(() => {
    if (payment) {
      setMode('total')
      setAmountInput(remaining.toFixed(2))
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment])

  if (!payment) return <dialog ref={dialogRef} className="hidden" />

  async function handleConfirm() {
    if (!payment || submitting) return
    const partial = mode === 'partial'
    const amount = partial ? Number(amountInput.replace(',', '.')) : remaining

    if (partial) {
      if (!Number.isFinite(amount) || amount <= 0) {
        setError(t('revenue.refund.error_invalid_amount'))
        return
      }
      if (amount > remaining + 0.005) {
        setError(t('revenue.refund.error_amount_too_high'))
        return
      }
    }

    setSubmitting(true)
    setError(null)
    try {
      const { error: fnError } = await supabase.functions.invoke('create-refund', {
        body: { payment_id: payment.id, ...(partial ? { amount } : {}) },
      })
      if (fnError) {
        const code = await extractErrorCode(fnError)
        if (code === 'INSUFFICIENT_BALANCE') setError(t('revenue.refund.error_insufficient_balance'))
        else if (code === 'MANUAL_PAYMENT') setError(t('revenue.refund.error_manual'))
        else if (code === 'SUBSCRIPTION_PAYMENT') setError(t('revenue.refund.error_subscription'))
        else setError(t('revenue.refund.error_generic'))
        return
      }
      addToast(t('revenue.refund.toast_requested'), 'success')
      onDone()
      onClose()
    } catch {
      setError(t('revenue.refund.error_generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-auto max-w-[440px] rounded-2xl bg-transparent p-0 backdrop:bg-black/40"
    >
      <div className="rounded-2xl bg-card p-6 shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
          <AlertTriangle className="h-7 w-7 text-red-500" />
        </div>

        <h2 className="text-center font-display text-xl font-black tracking-tight text-dark">
          {t('revenue.refund.title')}
        </h2>

        {/* Récap montants */}
        <div className="mt-4 rounded-xl border border-border p-4">
          <p className="font-display text-base font-black tracking-tight text-dark">{payment.planName}</p>
          <p className="mt-0.5 font-body text-sm text-secondary">{payment.memberName}</p>
          <div className="mt-3 flex justify-between font-body text-sm">
            <span className="text-muted">{t('revenue.refund.paid_amount')}</span>
            <span className="font-semibold text-dark">{fmt(payment.amount, currency)}</span>
          </div>
          {payment.refundedAmount > 0 && (
            <div className="mt-1 flex justify-between font-body text-sm">
              <span className="text-muted">{t('revenue.refund.already_refunded')}</span>
              <span className="font-semibold text-dark">{fmt(payment.refundedAmount, currency)}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between font-body text-sm">
            <span className="text-muted">{t('revenue.refund.remaining')}</span>
            <span className="font-semibold text-dark">{fmt(remaining, currency)}</span>
          </div>
        </div>

        {/* Total / Partiel */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(['total', 'partial'] as const).map((m) => (
            <label
              key={m}
              className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 font-body text-sm transition-colors ${
                mode === m ? 'border-dark bg-dark/[0.03] text-dark' : 'border-border text-muted hover:bg-dark/5'
              }`}
            >
              <input
                type="radio"
                name="refund_mode"
                value={m}
                checked={mode === m}
                onChange={() => { setMode(m); setError(null) }}
                className="h-4 w-4 accent-accent"
              />
              {m === 'total' ? t('revenue.refund.mode_total') : t('revenue.refund.mode_partial')}
            </label>
          ))}
        </div>

        {mode === 'partial' && (
          <div className="mt-3">
            <label className="font-body text-sm font-medium text-dark">{t('revenue.refund.amount_label')}</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max={remaining}
              value={amountInput}
              onChange={(e) => { setAmountInput(e.target.value); setError(null) }}
              className="mt-1 w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark"
            />
          </div>
        )}

        {/* Avertissement */}
        <p className="mt-4 rounded-xl bg-orange-50 px-3 py-2.5 text-center font-body text-xs text-orange-700">
          {t('revenue.refund.warning')}
        </p>

        {error && <p className="mt-3 text-center font-body text-xs text-red-500">{error}</p>}

        <div className="mt-6 flex gap-3">
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1" disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            isLoading={submitting}
            className="flex-1 bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:text-white"
          >
            {t('revenue.refund.confirm')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
