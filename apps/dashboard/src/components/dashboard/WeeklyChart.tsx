import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import { Skeleton } from '@/components/ui/Skeleton'
import { useTheme } from '@/hooks/useTheme'

const mockWeekly = [
  { day: 'Lun', bookings: 14 },
  { day: 'Mar', bookings: 16 },
  { day: 'Mer', bookings: 12 },
  { day: 'Jeu', bookings: 18 },
  { day: 'Ven', bookings: 15 },
  { day: 'Sam', bookings: 10 },
  { day: 'Dim', bookings: 0 },
]

export function WeeklyChart({ loading }: { loading: boolean }) {
  const { t } = useTranslation()
  const { isDark } = useTheme()

  const data = useMemo(() => mockWeekly, [])
  // Barres : indigo sur fond clair ; lime sur les cartes violettes du mode sombre
  // (l'indigo n'y ressort pas assez).
  const barFill = isDark ? '#C8FF3D' : '#4827B4'

  return (
    <div className="rounded-2xl bg-card p-5">
      <h2 className="mb-4 font-display text-lg font-black tracking-tight text-dark">
        {t('dashboard.weekly_stats')}
      </h2>

      {loading ? (
        <Skeleton className="h-56 w-full rounded-xl" />
      ) : (
        <ResponsiveContainer width="100%" height={224}>
          <BarChart data={data} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--text-muted)', fontSize: 12, fontFamily: 'DM Sans' }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--text-muted)', fontSize: 12, fontFamily: 'DM Sans' }}
              width={32}
            />
            <Tooltip
              cursor={{ fill: 'var(--border-color)', radius: 8 }}
              contentStyle={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: 12,
                fontFamily: 'DM Sans',
                fontSize: 13,
              }}
            />
            <Bar dataKey="bookings" fill={barFill} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
