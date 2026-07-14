import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { useTranslation } from 'react-i18next'

export interface RevenueBucket {
  label: string
  oneTime: number
  subscription: number
}

export function RevenueChart({ data }: { data: RevenueBucket[] }) {
  const { t } = useTranslation()

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
        <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E0" vertical={false} />
        {/* interval adaptatif + minTickGap : recharts masque les labels qui se
            chevauchent → tient à 375px sans déborder (iPad : rien ne change). */}
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9A9890' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
        <YAxis
          tick={{ fontSize: 11, fill: '#9A9890' }}
          axisLine={false}
          tickLine={false}
          width={44}
          tickFormatter={(v: number) => `${v}€`}
        />
        <Tooltip
          formatter={(v: number | string | readonly (number | string)[] | undefined) => `${Number(v).toFixed(2)}€`}
          contentStyle={{ borderRadius: 12, border: '1px solid #E8E6E0', fontSize: 12 }}
          cursor={{ fill: 'rgba(0,0,0,0.04)' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="oneTime" stackId="rev" name={t('revenue.chart_one_time')} fill="#8E86B5" />
        <Bar dataKey="subscription" stackId="rev" name={t('revenue.chart_subscription')} fill="#4827B4" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
