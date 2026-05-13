import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

interface CapacityBadgeProps {
  booked: number
  capacity: number
}

export function CapacityBadge({ booked, capacity }: CapacityBadgeProps) {
  const { t } = useTranslation()
  const remaining = capacity - booked
  const pct = remaining / capacity

  let bg: string
  let textColor: string
  if (remaining <= 0) {
    bg = 'bg-red-500/10'
    textColor = 'text-red-500'
  } else if (pct < 0.3) {
    bg = 'bg-orange-500/10'
    textColor = 'text-orange-500'
  } else {
    bg = 'bg-green-500/10'
    textColor = 'text-green-600'
  }

  const label =
    remaining <= 0
      ? t('home.full')
      : remaining === 1
        ? t('home.spots_one')
        : t('home.spots_left', { count: remaining })

  return (
    <View className={`rounded-lg px-2.5 py-1 ${bg}`}>
      <Text className={`font-dmsans-bold text-xs ${textColor}`}>{label}</Text>
    </View>
  )
}
