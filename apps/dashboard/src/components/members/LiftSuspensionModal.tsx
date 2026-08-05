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
import { useMemberDiscipline } from '@/hooks/useMemberDiscipline'
import type { LiftSuspensionResult } from '@/hooks/useGymAdminActions'

interface LiftSuspensionModalProps {
  open: boolean
  onClose: () => void
  /** GYM-214 — charge le dossier disciplinaire résumé sous la décision. */
  memberId: string | null
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
  open, onClose, memberId, memberName, suspendedUntil, onLift, onDone,
}: LiftSuspensionModalProps) {
  const { t } = useTranslation()
  // GYM-214 — c'est AU MOMENT DE DÉCIDER que l'information sert : lever une sanction
  // sans savoir si c'est la 2e absence en trois semaines ou la 3e en deux ans, c'est
  // décider à l'aveugle. C'était tout l'objet du ticket.
  const { summary, penalties } = useMemberDiscipline(memberId)
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

  // GYM-214 — la sanction QUI COURT : la plus récente encore active et non levée.
  // `active` exclut déjà les pénalités levées (une levée ne touche pas expires_at,
  // le rapprochement se fait à la lecture — cf. lib/penalties).
  const currentPenalty = penalties.find((p) => p.active) ?? null
  // Levées déjà accordées : une récidive après un geste commercial ne se lit pas
  // comme une première demande.
  const priorLifts = penalties.filter((p) => p.lift !== null).length

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

          {/* GYM-214 — résumé du dossier AVANT de valider. Muet quand il n'y a rien à
              dire : un encart « 0 absence » n'aiderait aucune décision. */}
          {summary && summary.noshowCount > 0 && (
            <div className="mt-3 rounded-xl border border-border px-4 py-3">
              <p className="font-body text-sm font-semibold text-dark">
                {t('members.lift.summary.noshow_count', { count: summary.noshowCount })}
              </p>
              {summary.lastNoShowAt && (
                <p className="mt-0.5 font-body text-xs text-muted">
                  {t('members.lift.summary.last_absence', { date: formatUntil(summary.lastNoShowAt) })}
                </p>
              )}
              {/* Sanction en cours : la plus récente encore active et non levée. */}
              {currentPenalty && (
                <p className="mt-1.5 font-body text-xs text-muted">
                  {t('members.lift.summary.current', {
                    origin: t(`member_drawer.discipline.origin.${currentPenalty.origin}`),
                    date: formatUntil(currentPenalty.appliedAt),
                  })}
                </p>
              )}
              {/* Une levée antérieure change complètement la lecture d'une récidive. */}
              {priorLifts > 0 && (
                <p className="mt-1.5 font-body text-xs font-semibold text-amber-700">
                  {t('members.lift.summary.prior_lifts', { count: priorLifts })}
                </p>
              )}
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
