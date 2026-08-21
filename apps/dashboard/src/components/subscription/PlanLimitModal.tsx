import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Lock, X } from 'lucide-react'
import { SUBSCRIPTION_TAB_PATH } from './subscriptionPath'

/**
 * GYM-247 — refus de plafond, expliqué avec ses chiffres.
 *
 * ⚠️ POURQUOI UNE MODALE ET PAS UN TOAST. Un toast générique (« impossible d'ajouter ce
 * membre ») est précisément le défaut corrigé par GYM-219 : le gérant a quelqu'un devant
 * lui et ne sait pas s'il doit réessayer, corriger l'email, ou changer de plan. Les Edge
 * Functions renvoient déjà `current` et `max` — les afficher coûte une modale et rend le
 * refus actionnable.
 *
 * Rendue à partir du PAYLOAD du refus serveur, jamais d'un compte local : c'est le
 * serveur qui a dit non, c'est son décompte qui fait foi.
 */
export type PlanLimitKind = 'members' | 'admins'

interface PlanLimitModalProps {
  kind: PlanLimitKind | null
  current?: number
  max?: number
  onClose: () => void
}

export function PlanLimitModal({ kind, current, max, onClose }: PlanLimitModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Même mécanique que les autres modales du dashboard (AddMemberModal) : <dialog>
  // natif piloté par showModal/close, pour hériter du focus trap et de la touche Échap.
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (kind && !el.open) el.showModal()
    if (!kind && el.open) el.close()
  }, [kind])

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[440px] md:rounded-2xl"
    >
      {kind && (
        <div className="flex h-full flex-col bg-card p-6 md:rounded-2xl">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-dim/10">
              <Lock className="h-6 w-6 text-accent-dim" />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-dark/5 hover:text-dark"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {t(`subscription.limit_modal.${kind}.title`)}
          </h2>

          {/* Les chiffres viennent du refus serveur. S'ils manquaient (payload plus ancien),
              on n'invente pas un décompte : le message reste sans chiffres. */}
          {typeof current === 'number' && typeof max === 'number' && (
            <p className="mt-3 font-display text-3xl font-black tracking-tight text-dark">
              {t('subscription.limit_modal.count', { current, max })}
            </p>
          )}

          <p className="mt-2 font-body text-sm text-muted">
            {t(`subscription.limit_modal.${kind}.message`)}
          </p>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
            <Link
              to={SUBSCRIPTION_TAB_PATH}
              onClick={onClose}
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-[#4827B4] px-6 py-3 font-ui text-sm font-bold text-[#C8FF3D] transition-all hover:opacity-90 dark:bg-[#C8FF3D] dark:text-[#17102E]"
            >
              {t('subscription.limit_modal.cta')}
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-border bg-card px-6 py-3 font-ui text-sm font-bold text-dark transition-all hover:bg-dark/5"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
