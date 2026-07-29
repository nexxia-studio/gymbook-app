// GYM-200 — Modale d'invitation d'un membre d'équipe.
//
// ⚠️ Le sélecteur de rôle ne propose QUE les rôles attribuables (aujourd'hui : gérant).
// Il n'est pas la garde : l'Edge Function revalide contre sa propre liste fermée, et le
// gym_id n'est même pas envoyé — il est lu sur le profil de l'appelant côté serveur.
import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ActionResult } from '@/hooks/useTeam'

// Aligné sur INVITABLE_ROLES de supabase/functions/invite-team-member. Ajouter 'coach' ici
// ET là-bas le jour où le rôle existera en base (GYM-176).
const INVITABLE_ROLES = ['gym_admin'] as const

interface InviteTeamModalProps {
  open: boolean
  onClose: () => void
  onInvite: (input: { email: string; role: string; firstName?: string; lastName?: string }) => Promise<ActionResult>
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function InviteTeamModal({ open, onClose, onInvite }: InviteTeamModalProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDialogElement>(null)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>(INVITABLE_ROLES[0])
  const [errors, setErrors] = useState<{ email?: string; form?: string }>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setFirstName(''); setLastName(''); setEmail('')
    setRole(INVITABLE_ROLES[0]); setErrors({}); setIsSubmitting(false)
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (isSubmitting) return

    const trimmed = email.trim()
    if (!trimmed || !isValidEmail(trimmed)) {
      setErrors({ email: t('team.invite.email_invalid') })
      return
    }
    setErrors({})

    setIsSubmitting(true)
    try {
      const res = await onInvite({ email: trimmed, role, firstName, lastName })
      if (res.ok) {
        onClose()
        return
      }
      // Erreurs métier de l'Edge Function → message actionnable.
      if (res.code === 'EMAIL_EXISTS') setErrors({ email: t('team.invite.error_email_exists') })
      else if (res.code === 'ALREADY_ACTIVE') setErrors({ email: t('team.invite.error_already_active') })
      else if (res.code === 'INVALID_ROLE') setErrors({ form: t('team.invite.error_invalid_role') })
      else if (res.code === 'FORBIDDEN') setErrors({ form: t('team.invite.error_forbidden') })
      else setErrors({ form: t('team.invite.error_generic') })
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClass = 'w-full rounded-xl border border-border bg-card px-4 py-3 font-body text-sm text-dark outline-none transition-colors focus:border-dark'
  const labelClass = 'font-body text-sm font-medium text-dark'
  const errClass = 'text-xs text-red-500 mt-1'

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      className="m-0 h-full w-full max-w-none bg-transparent p-0 backdrop:bg-black/40 md:m-auto md:h-auto md:max-w-[520px] md:rounded-2xl"
    >
      <div className="flex h-full flex-col bg-card md:h-auto md:max-h-[90vh] md:rounded-2xl md:shadow-2xl">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {t('team.invite.title')}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted hover:bg-dark/5">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            <p className="font-body text-sm text-muted">{t('team.invite.subtitle')}</p>

            {errors.form && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{errors.form}</div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass} htmlFor="team-first-name">{t('auth.first_name')}</label>
                <input
                  id="team-first-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="team-last-name">{t('auth.last_name')}</label>
                <input
                  id="team-last-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            <div>
              <label className={labelClass} htmlFor="team-email">{t('auth.email')} *</label>
              <input
                id="team-email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors((p) => ({ ...p, email: undefined })) }}
                className={inputClass}
              />
              {errors.email && <p className={errClass}>{errors.email}</p>}
            </div>

            <div>
              <label className={labelClass} htmlFor="team-role">{t('team.role')} *</label>
              <select
                id="team-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={inputClass}
              >
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{t(`activation.role_labels.${r}`)}</option>
                ))}
              </select>
              <p className="mt-1 font-body text-xs text-muted">{t('team.invite.role_helper')}</p>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" isLoading={isSubmitting}>{t('team.invite.submit')}</Button>
          </div>
        </form>
      </div>
    </dialog>
  )
}
