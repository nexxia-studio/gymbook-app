import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Calendar, AlertCircle, TrendingUp } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'

interface StatCardProps {
  value: number
  labelKey: string
  icon: LucideIcon
}

function StatCard({ value, labelKey, icon: Icon }: StatCardProps) {
  const { t } = useTranslation()

  return (
    <View className="flex-1 items-center rounded-2xl bg-move-bg px-3 py-4">
      <Icon size={16} color="#9A9890" />
      <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 28, color: '#111111', marginTop: 4 }}>
        {value}
      </Text>
      <Text className="font-dmsans text-[11px] text-move-text-muted">
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
