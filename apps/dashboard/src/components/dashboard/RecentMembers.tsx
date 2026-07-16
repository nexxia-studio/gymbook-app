import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/Skeleton'
import type { RecentMember } from '@/hooks/useDashboardStats'

// Initiales : prénom+nom si dispo, sinon repli sur l'initiale de l'email.
function getInitials(m: RecentMember): string {
  const first = m.firstName?.trim().charAt(0) ?? ''
  const last = m.lastName?.trim().charAt(0) ?? ''
  const initials = (first + last).toUpperCase()
  return initials || m.email.trim().charAt(0).toUpperCase() || '?'
}

function getDisplayName(m: RecentMember): string {
  const name = `${m.firstName ?? ''} ${m.lastName ?? ''}`.trim()
  return name || m.email
}

export function RecentMembers({ members, loading }: { members: RecentMember[]; loading: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'fr-FR'

  const formatJoined = (iso: string | null): string | null => {
    if (!iso) return null
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  }

  return (
    <div className="rounded-2xl bg-card p-5">
      <h2 className="mb-4 font-display text-lg font-black tracking-tight text-dark">
        {t('dashboard.recent_members')}
      </h2>

      <div className="flex flex-col gap-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton variant="avatar" />
              <div className="flex-1">
                <Skeleton className="mb-1 h-3 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            </div>
          ))
        ) : members.length === 0 ? (
          <p className="py-6 text-center font-body text-sm text-muted">
            {t('dashboard.no_members')}
          </p>
        ) : (
          members.map((member) => {
            const joined = formatJoined(member.joinedAt)
            return (
              <div key={member.id} className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-dim/10 font-body text-xs font-bold text-accent-dim">
                  {getInitials(member)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-sm font-medium text-dark">
                    {getDisplayName(member)}
                  </p>
                  <p className="truncate font-body text-xs text-muted">
                    {joined ? t('dashboard.joined', { date: joined }) : member.email}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
