// GYM-182 — Modale d'ajustement manuel de crédits (fiche membre).
// Le gérant offre (+) ou retire (−) des crédits, motif obligatoire. L'aperçu montre le solde
// après opération ; un retrait au-delà des crédits OFFERTS disponibles est signalé (clamp).
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Plus, Minus, Gift } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToastStore } from '@/hooks/useToast'
import type { AdjustResult } from '@/hooks/useMemberDetail'

interface AdjustCreditsModalProps {
  open: boolean
  onClose: () => void
  memberName: string
  currentRemaining: number
  giftedRemaining: number
  onAdjust: (delta: number, reason: string) => Promise<AdjustResult>
}

// Motifs suggérés (clés i18n). 'autre' n'impose aucun texte → champ libre.
const REASON_KEYS = ['referral', 'commercial', 'compensation', 'correction', 'other'] as const

export function AdjustCreditsModal({ open, onClose, memberName, currentRemaining, giftedRemaining, onAdjust }: AdjustCreditsModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addToast = useToastStore((s) => s.addToast)

  const [sign, setSign] = useState<1 | -1>(1)
  const [amount, setAmount] = useState('1')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setSign(1); setAmount('1'); setReason(''); setSubmitting(false)
  }

  useEffect(() => { if (open) reset() }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const qty = Math.max(0, Math.floor(Number(amount) || 0))
  const signedDelta = sign * qty
  // Aperçu : un retrait ne peut porter que sur les crédits OFFERTS disponibles → clamp d'aperçu.
  const appliedPreview = sign < 0 ? -Math.min(qty, giftedRemaining) : signedDelta
  const previewRemaining = currentRemaining + appliedPreview
  const willClamp = sign < 0 && qty > giftedRemaining

  const canSubmit = qty > 0 && reason.trim().length > 0 && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await onAdjust(signedDelta, reason.trim())
      if (res.clamped) {
        addToast(t('member_drawer.adjust.toast_clamped', { n: Math.abs(res.applied_delta) }), 'warning')
      } else {
        addToast(t('member_drawer.adjust.toast_success'), 'success')
      }
      onClose()
    } catch {
      addToast(t('member_drawer.adjust.toast_error'), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const labelClass = 'font-body text-sm font-medium text-dark'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[460px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-accent-dim" />
            <h2 className="font-display text-xl font-black tracking-tight text-dark">
              {t('member_drawer.adjust.title')}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="mb-5 font-body text-sm text-muted">{memberName}</p>

          {/* Sens + quantité */}
          <div className="flex items-stretch gap-3">
            <div className="flex overflow-hidden rounded-xl border border-border">
              <button
                type="button"
                onClick={() => setSign(1)}
                className={`flex items-center gap-1 px-3 font-body text-sm font-semibold transition-colors ${sign > 0 ? 'bg-green-500/10 text-green-600' : 'text-muted hover:bg-dark/5'}`}
              >
                <Plus className="h-4 w-4" />{t('member_drawer.adjust.add')}
              </button>
              <button
                type="button"
                onClick={() => setSign(-1)}
                className={`flex items-center gap-1 px-3 font-body text-sm font-semibold transition-colors ${sign < 0 ? 'bg-red-500/10 text-red-600' : 'text-muted hover:bg-dark/5'}`}
              >
                <Minus className="h-4 w-4" />{t('member_drawer.adjust.remove')}
              </button>
            </div>
            <input
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-lg font-bold text-dark outline-none focus:border-dark"
            />
          </div>

          {/* Aperçu du solde après opération */}
          <div className="mt-3 flex items-center justify-between rounded-xl bg-dark/[0.03] px-4 py-3">
            <span className="font-body text-sm text-muted">{t('member_drawer.adjust.preview')}</span>
            <span className="font-display text-xl font-black tracking-tight text-dark">{previewRemaining}</span>
          </div>
          {willClamp && (
            <p className="mt-2 font-body text-xs font-medium text-orange-600">
              {t('member_drawer.adjust.clamp_hint', { n: giftedRemaining })}
            </p>
          )}

          {/* Motif */}
          <label className={`${labelClass} mt-5 block`}>{t('member_drawer.adjust.reason_label')} *</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {REASON_KEYS.map((k) => {
              const label = t(`member_drawer.adjust.reason.${k}`)
              const isOther = k === 'other'
              const active = !isOther && reason === label
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setReason(isOther ? '' : label)}
                  className={`rounded-full border px-3 py-1.5 font-body text-xs font-semibold transition-colors ${active ? 'border-dark bg-dark text-white' : 'border-border text-muted hover:bg-dark/5'}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('member_drawer.adjust.reason_placeholder')}
            className="mt-2 w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none focus:border-dark"
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit} isLoading={submitting}>
            {t('member_drawer.adjust.confirm')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
