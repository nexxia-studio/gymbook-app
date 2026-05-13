import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Calendar } from 'lucide-react-native'

interface EmptyDayStateProps {
  isSunday: boolean
}

export function EmptyDayState({ isSunday }: EmptyDayStateProps) {
  const { t } = useTranslation()

  return (
    <View className="items-center py-16">
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-move-border/50">
        <Calendar size={28} color="#9A9890" />
      </View>
      <Text className="font-dmsans-bold text-sm text-move-dark">
        {t('home.empty_title')}
      </Text>
      <Text className="mt-1 font-dmsans text-xs text-move-text-muted">
        {isSunday ? t('home.empty_closed') : t('home.empty_none')}
      </Text>
    </View>
  )
}
