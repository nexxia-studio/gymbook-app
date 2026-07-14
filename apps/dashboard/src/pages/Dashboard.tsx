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
import { useDashboardStats } from '@/hooks/useDashboardStats'

export default function Dashboard() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const firstName = user?.user_metadata?.first_name ?? ''
  const { stats, loading } = useDashboardStats()

  return (
    <DashboardLayout>
      {/* EXPÉRIMENTAL liquid-glass : fond décoratif derrière les cards (réversible) */}
      <div className="glass-bg -m-4 p-4 lg:-m-6 lg:p-6">
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
            <KpiCard className="glass-card" icon={Users} label={t('dashboard.kpi.active_members')} value={stats.activeMembers} />
            <KpiCard className="glass-card" icon={Calendar} label={t('dashboard.kpi.today_sessions')} value={stats.todaySessions} />
            <KpiCard className="glass-card" icon={TrendingUp} label={t('dashboard.kpi.fill_rate')} value={stats.fillRate} suffix="%" />
            <KpiCard className="glass-card" icon={CreditCard} label={t('dashboard.kpi.month_revenue')} value={stats.monthRevenue ?? 0} prefix={stats.hasMollie ? "\u20ac" : ""} suffix={stats.hasMollie ? "" : " —"} />
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
          <RecentMembers loading={loading} />
        </div>
        <div className="lg:col-span-7">
          <WeeklyChart loading={loading} />
        </div>
      </div>
      </div>{/* /glass-bg EXPÉRIMENTAL */}
    </DashboardLayout>
  )
}
