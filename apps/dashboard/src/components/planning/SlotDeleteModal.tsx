import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Trash2, CheckCircle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { TimeSlot } from '@/types/planning'

export type SlotDeleteMode = 'delete' | 'cancel'

interface SlotDeleteModalProps {
  slot: TimeSlot | null
  mode: SlotDeleteMode
  onClose: () => void
  onConfirm: () => void
}

export function SlotDeleteModal({ slot, mode, onClose, onConfirm }: SlotDeleteModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (slot && !dialog.open) dialog.showModal()
    if (!slot && dialog.open) dialog.close()
  }, [slot])

  const isDelete = mode === 'delete'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-auto max-w-[400px] rounded-2xl bg-transparent p-0 backdrop:bg-black/40"
    >
      {slot && (
        <div className="rounded-2xl bg-card p-6 shadow-2xl">
          {/* Icon */}
          <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${
            isDelete ? 'bg-red-50' : 'bg-orange-50'
          }`}>
            {isDelete
              ? <Trash2 className="h-7 w-7 text-red-500" />
              : <AlertTriangle className="h-7 w-7 text-orange-500" />
            }
          </div>

          {/* Title */}
          <h2 className="text-center font-display text-xl font-black uppercase tracking-tight text-dark">
            {isDelete ? t('slots.permanently_delete_title') : t('slots.cancel_title')}
          </h2>

          {/* Message */}
          <p className="mt-3 text-center font-body text-sm text-secondary">
            {isDelete
              ? t('slots.permanently_delete_message')
              : slot.booked > 0
                ? t('slots.cancel_message', { count: slot.booked })
                : t('slots.cancel_message_empty')
            }
          </p>

          {/* Notifications section — cancel mode with members */}
          {!isDelete && slot.booked > 0 && (
            <div className="mt-4 rounded-xl border border-border p-3">
              <p className="mb-2 font-body text-xs font-semibold text-dark">
                {t('slots.cancel_notifications')}
              </p>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-accent-dim" />
                  <span className="font-body text-xs text-secondary">{t('slots.cancel_notif_push')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-3.5 w-3.5 text-accent-dim" />
                  <span className="font-body text-xs text-secondary">{t('slots.cancel_notif_email')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted" />
                  <span className="font-body text-xs text-muted">{t('slots.cancel_notif_sms')}</span>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex gap-3">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
              {t('common.back')}
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              className={`flex-1 ${
                isDelete
                  ? 'bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:text-white'
                  : 'bg-orange-500 text-white hover:bg-orange-600 dark:bg-orange-500 dark:text-white'
              }`}
            >
              {isDelete ? t('slots.permanently_delete_confirm') : t('slots.cancel_confirm')}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  )
}
