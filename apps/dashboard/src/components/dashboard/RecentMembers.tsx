import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/Skeleton'

const mockMembers = [
  { name: 'Sophie Janssens', email: 'sophie.j@mail.com', date: '12 mai 2026' },
  { name: 'Lucas Dupont', email: 'lucas.d@mail.com', date: '11 mai 2026' },
  { name: 'Emma Claes', email: 'emma.c@mail.com', date: '10 mai 2026' },
  { name: 'Thomas Peeters', email: 'thomas.p@mail.com', date: '9 mai 2026' },
  { name: 'Léa Maes', email: 'lea.m@mail.com', date: '8 mai 2026' },
]

export function RecentMembers({ loading }: { loading: boolean }) {
  const { t } = useTranslation()

  return (
    <div className="rounded-2xl bg-card p-5">
      <h2 className="mb-4 font-display text-lg font-black uppercase tracking-tight text-dark">
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
        ) : (
          mockMembers.map((member) => (
            <div key={member.email} className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-dim/10 font-body text-xs font-bold text-accent-dim">
                {member.name.split(' ').map((n) => n[0]).join('')}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-sm font-medium text-dark">
                  {member.name}
                </p>
                <p className="font-body text-xs text-muted">
                  {t('dashboard.joined', { date: member.date })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
