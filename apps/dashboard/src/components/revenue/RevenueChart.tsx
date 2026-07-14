import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'
import { useTheme } from '@/hooks/useTheme'

export interface RevenueBucket {
  label: string
  oneTime: number
  subscription: number
}

export function RevenueChart({ data }: { data: RevenueBucket[] }) {
  const { t } = useTranslation()
  const { isDark } = useTheme()
  // Barres empilées : indigo/violet-doux sur fond clair ; lime/lavande sur les cartes
  // violettes du mode sombre (l'indigo n'y ressort pas). Axes/grille/tooltip via tokens
  // mode-aware (les valeurs claires en dur étaient illisibles en sombre).
  const subscriptionFill = isDark ? '#C8FF3D' : '#4827B4'
  const oneTimeFill = isDark ? '#C8C2E6' : '#8E86B5'

  const hasData = data.some((d) => d.oneTime > 0 || d.subscription > 0)
  if (!hasData) {
    return (
      <div className="flex h-[280px] items-center justify-center font-body text-sm text-muted">
        {t('revenue.chart_empty')}
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 2, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
        {/* interval adaptatif + minTickGap : recharts masque les labels qui se
            chevauchent → tient à 375px sans déborder (iPad : rien ne change). */}
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v: number) => `${v}€`}
        />
        <Tooltip
          formatter={(v: number | string | readonly (number | string)[] | undefined) => `${Number(v).toFixed(2)}€`}
          contentStyle={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderRadius: 12, border: '1px solid var(--border-color)', fontSize: 12 }}
          cursor={{ fill: 'var(--border-color)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="oneTime" stackId="rev" name={t('revenue.chart_one_time')} fill={oneTimeFill} />
        <Bar dataKey="subscription" stackId="rev" name={t('revenue.chart_subscription')} fill={subscriptionFill} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
