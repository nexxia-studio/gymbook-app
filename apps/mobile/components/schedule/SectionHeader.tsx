import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../lib/theme/ThemeProvider'

interface SectionHeaderProps {
  date: Date
}

export function SectionHeader({ date }: SectionHeaderProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  if (!date || isNaN(date.getTime())) {
    return null
  }

  const days = t('home.days', { returnObjects: true }) as string[]
  const months = t('home.months', { returnObjects: true }) as string[]

  const dayName = days[date.getDay()] ?? ''
  const monthName = months[date.getMonth()] ?? ''
  const label = `${dayName} ${date.getDate()} ${monthName}`.toUpperCase()

  return (
    <View className="px-1 pb-2 pt-4" style={{ backgroundColor: tokens.page }}>
      <Text className="font-dmsans-bold text-[11px] uppercase tracking-wider" style={{ color: tokens.onBackgroundMuted }}>
        {label}
      </Text>
    </View>
  )
}
