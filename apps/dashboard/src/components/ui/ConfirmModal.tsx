import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  confirmColor?: 'red' | 'orange' | 'green'
}

const colorClasses = {
  red: 'bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:text-white',
  orange: 'bg-orange-500 text-white hover:bg-orange-600 dark:bg-orange-500 dark:text-white',
  green: 'bg-green-500 text-white hover:bg-green-600 dark:bg-green-500 dark:text-white',
}

export function ConfirmModal({ open, title, message, onConfirm, onCancel, confirmLabel = 'Confirmer', confirmColor = 'orange' }: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      onCancel={onCancel}
      className="m-auto max-w-[420px] rounded-2xl bg-transparent p-0 backdrop:bg-black/40"
    >
      <div className="rounded-2xl bg-card p-6 shadow-2xl">
        {/* Icône « Attention » mode-aware (accent-dim) : indigo sur card claire, lime en sombre
            (orange hors palette). Le bouton de confirmation garde sa couleur sémantique. */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-dim/10">
          <AlertTriangle className="h-7 w-7 text-accent-dim" />
        </div>

        <h2 className="text-center font-display text-xl font-black tracking-tight text-dark">
          {title}
        </h2>

        <p className="mt-3 text-center font-body text-sm text-secondary">
          {message}
        </p>

        <div className="mt-6 flex gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} className="flex-1">
            Annuler
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className={`flex-1 ${colorClasses[confirmColor]}`}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
