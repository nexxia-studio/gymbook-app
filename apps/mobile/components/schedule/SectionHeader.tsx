import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

interface SectionHeaderProps {
  date: Date
}

export function SectionHeader({ date }: SectionHeaderProps) {
  const { t } = useTranslation()
  const days = t('home.days', { returnObjects: true }) as string[]
  const months = t('home.months', { returnObjects: true }) as string[]

  const label = `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`.toUpperCase()

  return (
    <View className="bg-move-bg px-1 pb-2 pt-4">
      <Text className="font-dmsans-bold text-[11px] uppercase tracking-wider text-move-text-muted">
        {label}
      </Text>
    </View>
  )
}
