// GYM-200 — Onglet « Équipe » de /settings : qui a accès au dashboard de la salle.
//
// Chaque ligne indique le statut de l'invitation (en attente / actif), déduit côté serveur
// de auth.users.last_sign_in_at (cf. Edge Function team-access).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, MailCheck, RotateCcw, UserMinus, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmModal } from '@/components/ui/ConfirmModal'
import { InviteTeamModal } from '@/components/settings/InviteTeamModal'
import { useTeam, type TeamMember } from '@/hooks/useTeam'
import { useToastStore } from '@/hooks/useToast'

export function TeamSection() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const { members, isLoading, adminCount, inviteMember, resendInvite, revokeAccess } = useTeam()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<TeamMember | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  function displayName(m: TeamMember): string {
    return `${m.firstName} ${m.lastName}`.trim() || m.email
  }

  async function handleInvite(input: Parameters<typeof inviteMember>[0]) {
    const res = await inviteMember(input)
    if (res.ok) {
      if (res.resent) addToast(t('team.toast_resent'))
      // L'envoi est best-effort côté serveur : le compte existe même si l'email a échoué.
      // On le dit franchement plutôt que d'annoncer un succès trompeur.
      else if (res.emailSent) addToast(t('team.toast_invited'))
      else addToast(t('team.toast_invited_no_email'), 'warning')
    }
    return res
  }

  async function handleResend(m: TeamMember) {
    setBusyId(m.id)
    try {
      const res = await resendInvite(m)
      if (res.ok && res.emailSent !== false) addToast(t('team.toast_resent'))
      else if (res.ok) addToast(t('team.toast_invited_no_email'), 'warning')
      else addToast(t('team.error_generic'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    const target = revokeTarget
    setRevokeTarget(null)
    setBusyId(target.id)
    try {
      const res = await revokeAccess(target.id)
      if (res.ok) addToast(t('team.toast_revoked', { name: displayName(target) }), 'warning')
      else if (res.code === 'LAST_ADMIN') addToast(t('team.error_last_admin'), 'error')
      else if (res.code === 'CANNOT_REVOKE_SELF') addToast(t('team.error_revoke_self'), 'error')
      else addToast(t('team.error_generic'), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl font-black tracking-tight text-dark">
            {t('team.title')}
          </h2>
          <p className="mt-1 font-body text-sm text-muted">{t('team.subtitle')}</p>
          <p className="mt-0.5 font-body text-xs text-muted">
            {t('team.count', { total: members.length })}
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('team.invite.new')}
        </Button>
      </div>

      {isLoading ? (
        <p className="font-body text-sm text-muted">{t('common.loading')}</p>
      ) : members.length === 0 ? (
        <p className="font-body text-sm text-muted">{t('team.empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {members.map((m) => (
            <div
              key={m.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-body text-sm font-bold text-dark">{displayName(m)}</span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-dark/5 px-2 py-0.5 font-body text-xs text-dark/60">
                    <ShieldCheck className="h-3 w-3" />
                    {t(`activation.role_labels.${m.role}`, { defaultValue: m.role })}
                  </span>
                  {/* pending === null : statut indéterminable (lecture auth en échec) →
                      on n'affiche rien plutôt que d'annoncer « en attente » à tort. */}
                  {m.pending === true && (
                    <span className="rounded-full bg-orange-100 px-2 py-0.5 font-body text-xs text-orange-700">
                      {t('team.status_pending')}
                    </span>
                  )}
                  {m.pending === false && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-body text-xs text-green-700">
                      <MailCheck className="h-3 w-3" />
                      {t('team.status_active')}
                    </span>
                  )}
                  {m.isSelf && (
                    <span className="font-body text-xs text-muted">{t('team.you')}</span>
                  )}
                </div>
                <p className="mt-1 truncate font-body text-xs text-muted">{m.email}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {m.pending === true && (
                  <Button
                    variant="secondary"
                    onClick={() => { void handleResend(m) }}
                    isLoading={busyId === m.id}
                    className="px-4 py-2 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('team.resend')}
                  </Button>
                )}
                {/* Un gérant ne retire ni son propre accès ni celui du dernier gérant :
                    l'action n'est même pas proposée. La garde autoritative est serveur. */}
                {!m.isSelf && !(m.role === 'gym_admin' && adminCount <= 1) && (
                  <Button
                    variant="ghost"
                    onClick={() => setRevokeTarget(m)}
                    className="px-4 py-2 text-xs"
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                    {t('team.revoke')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <InviteTeamModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={handleInvite}
      />

      <ConfirmModal
        open={!!revokeTarget}
        title={t('team.revoke_confirm_title')}
        message={t('team.revoke_confirm_message', { name: revokeTarget ? displayName(revokeTarget) : '' })}
        confirmLabel={t('team.revoke')}
        confirmColor="red"
        onConfirm={() => { void handleRevoke() }}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  )
}
