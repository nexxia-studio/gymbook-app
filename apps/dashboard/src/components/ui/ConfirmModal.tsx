import { useEffect, useRef, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

interface ConfirmModalProps {
  open: boolean
  title: string
  /** Texte simple sous le titre. Optionnel quand `children` porte le contenu. */
  message?: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  /** `primary` = le bouton d'action du dashboard (indigo / lime), sans couleur d'alerte. */
  confirmColor?: 'red' | 'orange' | 'green' | 'primary'
  // ── GYM-134 — options ajoutées pour la confirmation d'envoi d'une communication. Toutes
  // facultatives : sans elles, la modale rend et se comporte exactement comme avant.
  /** Contenu libre sous le message (aperçu, détail). */
  children?: ReactNode
  cancelLabel?: string
  /** Icône de l'en-tête. Par défaut : le triangle « Attention ». */
  icon?: ReactNode
  /** Action en cours : boutons désactivés, Échap et clic extérieur sans effet. */
  busy?: boolean
  /** Libellé du bouton de confirmation pendant l'action. */
  busyLabel?: string
  /** Un clic sur le fond ferme la modale (comme Échap). */
  closeOnBackdrop?: boolean
  /** À l'ouverture, le focus va sur le bouton de confirmation plutôt que sur « Annuler ». */
  focusConfirm?: boolean
}

const colorClasses = {
  red: 'bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:text-white',
  orange: 'bg-orange-500 text-white hover:bg-orange-600 dark:bg-orange-500 dark:text-white',
  green: 'bg-green-500 text-white hover:bg-green-600 dark:bg-green-500 dark:text-white',
  primary: '',
}

export function ConfirmModal({
  open, title, message, onConfirm, onCancel, confirmLabel = 'Confirmer', confirmColor = 'orange',
  children, cancelLabel = 'Annuler', icon, busy = false, busyLabel, closeOnBackdrop = false, focusConfirm = false,
}: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      // `showModal` donne le focus au premier élément focalisable, ici « Annuler ».
      if (focusConfirm) dialog.querySelector<HTMLButtonElement>('[data-confirm-button]')?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open, focusConfirm])

  return (
    <dialog
      ref={dialogRef}
      // Échap. Le navigateur fermerait la modale de lui-même : on l'en empêche toujours, et
      // c'est `open` qui décide. Pendant l'action, la demande est ignorée.
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      // Pendant l'action, Échap ne doit rien faire. Certains navigateurs ferment une modale
      // au SECOND Échap même si le premier `cancel` a été refusé : on arrête la touche ici,
      // et `onClose` rouvre la modale si elle s'est fermée malgré tout.
      onKeyDown={(e) => {
        if (busy && e.key === 'Escape') e.preventDefault()
      }}
      onClose={() => {
        if (!open) return
        if (busy) dialogRef.current?.showModal()
        else onCancel()
      }}
      // Clic sur le fond : la cible est alors le <dialog> lui-même, jamais son contenu.
      onClick={(e) => {
        if (closeOnBackdrop && !busy && e.target === e.currentTarget) onCancel()
      }}
      className="m-auto max-w-[420px] rounded-2xl bg-transparent p-0 backdrop:bg-black/40"
    >
      <div className="rounded-2xl bg-card p-6 shadow-2xl">
        {/* Icône « Attention » mode-aware (accent-dim) : indigo sur card claire, lime en sombre
            (orange hors palette). Le bouton de confirmation garde sa couleur sémantique. */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-dim/10">
          {icon ?? <AlertTriangle className="h-7 w-7 text-accent-dim" />}
        </div>

        <h2 className="text-center font-display text-xl font-black tracking-tight text-dark">
          {title}
        </h2>

        {message && (
          <p className="mt-3 text-center font-body text-sm text-secondary">
            {message}
          </p>
        )}

        {children}

        <div className="mt-6 flex gap-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy} className="flex-1">
            {cancelLabel}
          </Button>
          <Button
            type="button"
            data-confirm-button
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 ${colorClasses[confirmColor]}`}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
