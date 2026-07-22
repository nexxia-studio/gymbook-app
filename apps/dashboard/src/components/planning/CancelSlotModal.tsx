// GYM-143 — Modal de confirmation d'annulation d'un cours.
// Récap du créneau + motif optionnel + avertissement. La confirmation déclenche
// l'Edge Function cancel-slot (recrédit exact + purge waitlist + notifications).
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Users, Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { TimeSlot } from '@/types/planning'

interface CancelSlotModalProps {
  slot: TimeSlot | null
  isSubmitting: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}

export function CancelSlotModal({ slot, isSubmitting, onClose, onConfirm }: CancelSlotModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [reason, setReason] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (slot && !dialog.open) dialog.showModal()
    if (!slot && dialog.open) dialog.close()
  }, [slot])

  // Réinitialiser le motif à chaque ouverture.
  useEffect(() => {
    if (slot) setReason('')
  }, [slot])

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-auto max-w-[440px] rounded-2xl bg-transparent p-0 backdrop:bg-black/40"
    >
      {slot && (
        <div className="rounded-2xl bg-card p-6 shadow-2xl">
          {/* Icon */}
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
            <AlertTriangle className="h-7 w-7 text-red-500" />
          </div>

          {/* Title */}
          <h2 className="text-center font-display text-xl font-black tracking-tight text-dark">
            {t('slots.cancel_title')}
          </h2>

          {/* Récap */}
          <div className="mt-4 rounded-xl border border-border p-4">
            <p className="font-display text-lg font-black tracking-tight text-dark">{slot.activity.name}</p>
            <p className="mt-0.5 font-body text-sm text-secondary">
              {slot.date} · {slot.startTime} — {slot.endTime}
            </p>
            <div className="mt-3 flex flex-wrap gap-4">
              <span className="inline-flex items-center gap-1.5 font-body text-sm text-dark">
                <Users className="h-4 w-4 text-muted" />
                {t('slots.cancel_recap_enrolled', { count: slot.booked })}
              </span>
              <span className="inline-flex items-center gap-1.5 font-body text-sm text-dark">
                <Clock className="h-4 w-4 text-muted" />
                {t('slots.cancel_recap_waitlist', { count: slot.waitlisted })}
              </span>
            </div>
          </div>

          {/* Motif optionnel */}
          <div className="mt-4">
            <label className="font-body text-sm font-medium text-dark">{t('slots.cancel_reason')}</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 200))}
              placeholder={t('slots.cancel_reason_placeholder')}
              rows={2}
              className="mt-1 w-full resize-none rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark"
            />
          </div>

          {/* Avertissement */}
          <p className="mt-4 rounded-xl bg-orange-50 px-3 py-2.5 text-center font-body text-xs text-orange-700">
            {t('slots.cancel_warning')}
          </p>

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1" disabled={isSubmitting}>
              {t('common.back')}
            </Button>
            <Button
              type="button"
              onClick={() => onConfirm(reason)}
              isLoading={isSubmitting}
              className="flex-1 bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:text-white"
            >
              {t('slots.cancel_confirm')}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  )
}
