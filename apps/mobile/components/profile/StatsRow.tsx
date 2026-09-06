import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Calendar, AlertCircle, TrendingUp } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

interface StatCardProps {
  value: number
  labelKey: string
  icon: LucideIcon
}

function StatCard({ value, labelKey, icon: Icon }: StatCardProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  return (
    <View className="flex-1 items-center rounded-2xl px-3 py-4" style={{ backgroundColor: tokens.page }}>
      <Icon size={16} color={tokens.onBackgroundMuted} />
      <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 28, color: tokens.onSurface, marginTop: 4 }}>
        {value}
      </Text>
      <Text className="font-dmsans text-[11px]" style={{ color: tokens.onBackgroundMuted }}>
        {t(`profile.stats.${labelKey}`)}
      </Text>
    </View>
  )
}

interface StatsRowProps {
  sessions: number
  noshows: number
  weeks: number
}

export function StatsRow({ sessions, noshows, weeks }: StatsRowProps) {
  return (
    <View className="mx-4 mt-4 flex-row gap-3">
      <StatCard value={sessions} labelKey="sessions" icon={Calendar} />
      <StatCard value={noshows} labelKey="noshows" icon={AlertCircle} />
      <StatCard value={weeks} labelKey="weeks" icon={TrendingUp} />
    </View>
  )
}
