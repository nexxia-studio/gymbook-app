import { useTranslation } from 'react-i18next'
import {
  Users,
  Calendar,
  TrendingUp,
  CreditCard,
} from 'lucide-react'
import { useAuthStore } from '@/stores/useAuthStore'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { Skeleton } from '@/components/ui/Skeleton'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { TodayPlanning } from '@/components/dashboard/TodayPlanning'
import { UpcomingSessions } from '@/components/dashboard/UpcomingSessions'
import { RecentMembers } from '@/components/dashboard/RecentMembers'
import { WeeklyChart } from '@/components/dashboard/WeeklyChart'
import { useDashboardStats, type FillPeriod } from '@/hooks/useDashboardStats'

// Toggle Jour/Semaine/Mois du taux de remplissage — même style que le toggle 12m/8w
// de Revenue.tsx (bg-dark/5 p-*, bouton actif bg-card shadow-sm), version compacte
// pour tenir dans le coin de la KpiCard.
const FILL_PERIODS: FillPeriod[] = ['day', 'week', 'month']
function FillToggle({ period, onChange }: { period: FillPeriod; onChange: (p: FillPeriod) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex gap-0.5 rounded-lg bg-dark/5 p-0.5">
      {FILL_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          title={t(`dashboard.fill_${p}`)}
          aria-label={t(`dashboard.fill_${p}`)}
          className={`rounded-md px-2 py-0.5 font-body text-[11px] font-semibold transition-all ${
            period === p ? 'bg-card text-dark shadow-sm' : 'text-muted hover:text-dark'
          }`}
        >
          {/* Initiales J/S/M — compact, ne déborde à aucune largeur (la grille passe à
              4 colonnes étroites dès lg=1024) ; nom complet en title/aria. */}
          {t(`dashboard.fill_${p}_short`)}
        </button>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const firstName = user?.user_metadata?.first_name ?? ''
  const { stats, loading, fillPeriod, setFillPeriod } = useDashboardStats()
  const fillRate = stats ? stats.fillRates[fillPeriod] : null

  return (
    <DashboardLayout>
      <h1 className="mb-6 font-display text-3xl font-black tracking-tight text-dark lg:text-4xl">
        {t('dashboard.greeting', { name: firstName })}
      </h1>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {loading || !stats ? (
          <>
            <Skeleton variant="kpi" />
            <Skeleton variant="kpi" />
            <Skeleton variant="kpi" />
            <Skeleton variant="kpi" />
          </>
        ) : (
          <>
            <KpiCard icon={Users} label={t('dashboard.kpi.active_members')} value={stats.activeMembers} />
            <KpiCard icon={Calendar} label={t('dashboard.kpi.today_sessions')} value={stats.todaySessions} />
            <KpiCard
              icon={TrendingUp}
              label={t('dashboard.kpi.fill_rate')}
              value={fillRate ?? 0}
              suffix="%"
              placeholder={fillRate === null ? '—' : undefined}
              action={<FillToggle period={fillPeriod} onChange={setFillPeriod} />}
            />
            <KpiCard icon={CreditCard} label={t('dashboard.kpi.month_revenue')} value={stats.monthRevenue ?? 0} prefix={stats.hasMollie ? "\u20ac" : ""} suffix={stats.hasMollie ? "" : " —"} />
          </>
        )}
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <TodayPlanning />
        </div>
        <div className="lg:col-span-4">
          <UpcomingSessions />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <RecentMembers members={stats?.recentMembers ?? []} loading={loading} />
        </div>
        <div className="lg:col-span-7">
          <WeeklyChart loading={loading} />
        </div>
      </div>
    </DashboardLayout>
  )
}
