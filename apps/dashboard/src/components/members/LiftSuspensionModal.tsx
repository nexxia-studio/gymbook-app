// GYM-204 — Modale de levée d'une suspension no-show (fiche membre).
// Motif OBLIGATOIRE : le bouton reste désactivé tant qu'il est vide. Même forme que
// l'ajustement de crédits (GYM-182).
//
// 🔴 Toute erreur est VISIBLE. C'est le silence de l'ancien parcours — écriture cliente
// qui ne matchait aucune ligne, `error` jamais testé — qui a masqué le défaut pendant des
// mois : le gérant voyait un toast de succès alors que rien n'avait changé.
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { X, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useToastStore } from '@/hooks/useToast'
import type { LiftSuspensionResult } from '@/hooks/useGymAdminActions'

interface LiftSuspensionModalProps {
  open: boolean
  onClose: () => void
  memberName: string
  /** Fin de suspension en cours (ISO), pour situer la sanction levée. */
  suspendedUntil: string | null
  onLift: (reason: string) => Promise<LiftSuspensionResult>
  /** Rafraîchissement de la fiche après succès. */
  onDone: () => void
}

// Motifs suggérés (clés i18n). 'other' n'impose aucun texte → champ libre.
const REASON_KEYS = ['checkin_error', 'proof_provided', 'commercial', 'other'] as const

function formatUntil(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('fr-BE', { dateStyle: 'short', timeStyle: 'short' }).format(d)
}

export function LiftSuspensionModal({
  open, onClose, memberName, suspendedUntil, onLift, onDone,
}: LiftSuspensionModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const addToast = useToastStore((s) => s.addToast)

  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => { if (open) { setReason(''); setSubmitting(false) } }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  const canSubmit = reason.trim().length > 0 && !submitting
  const until = formatUntil(suspendedUntil)

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await onLift(reason.trim())
      if (!res.ok) {
        // Message dédié par code métier ; repli explicite sinon. Jamais de faux succès.
        const key = res.code === 'NOT_SUSPENDED' ? 'error_not_suspended'
          : res.code === 'WRONG_GYM' ? 'error_wrong_gym'
          : res.code === 'REASON_REQUIRED' ? 'error_reason_required'
          : res.code === 'FORBIDDEN' ? 'error_forbidden'
          : 'error_generic'
        addToast(t(`members.lift.${key}`), 'error')
        return
      }
      addToast(t('members.lift.toast_success'), 'success')
      onDone()
      onClose()
    } catch {
      addToast(t('members.lift.error_generic'), 'error')
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
            <ShieldOff className="h-5 w-5 text-accent-dim" />
            <h2 className="font-display text-xl font-black tracking-tight text-dark">
              {t('members.lift.title')}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="font-body text-sm text-muted">{memberName}</p>
          {until && (
            <div className="mt-3 rounded-xl bg-dark/[0.03] px-4 py-3">
              <span className="font-body text-sm text-muted">
                {t('members.lift.suspended_until', { date: until })}
              </span>
            </div>
          )}

          {/* Le compteur n'est pas touché : le dire au gérant AVANT qu'il valide. */}
          <p className="mt-3 font-body text-xs text-muted">{t('members.lift.noshow_kept')}</p>

          {/* Motif */}
          <label className={`${labelClass} mt-5 block`}>{t('members.lift.reason_label')} *</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {REASON_KEYS.map((k) => {
              const label = t(`members.lift.reason.${k}`)
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
            placeholder={t('members.lift.reason_placeholder')}
            className="mt-2 w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none focus:border-dark"
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border p-5">
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit} isLoading={submitting}>
            {t('members.lift.confirm')}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
