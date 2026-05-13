import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { CoachItem } from '@/types/coach'

interface CoachDeleteModalProps {
  coach: CoachItem | null
  futureSlotCount: number
  onClose: () => void
  onConfirm: () => void
}

export function CoachDeleteModal({ coach, futureSlotCount, onClose, onConfirm }: CoachDeleteModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const blocked = futureSlotCount > 0

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (coach && !dialog.open) dialog.showModal()
    if (!coach && dialog.open) dialog.close()
  }, [coach])

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-auto max-w-[400px] rounded-2xl bg-transparent p-0 backdrop:bg-black/40"
    >
      {coach && (
        <div className="rounded-2xl bg-card p-6 shadow-2xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50">
            <Trash2 className="h-7 w-7 text-red-500" />
          </div>

          <h2 className="text-center font-display text-xl font-black uppercase tracking-tight text-dark">
            {t('coaches.delete_title')}
          </h2>

          <p className="mt-3 text-center font-body text-sm text-secondary">
            {blocked
              ? t('coaches.delete_blocked', { count: futureSlotCount })
              : t('coaches.delete_message')}
          </p>

          <div className="mt-6 flex gap-3">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
              {t('common.back')}
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              disabled={blocked}
              className="flex-1 bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:text-white"
            >
              {t('coaches.delete_confirm')}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  )
}
