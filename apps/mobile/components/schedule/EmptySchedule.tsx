import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SearchX } from 'lucide-react-native'

interface EmptyScheduleProps {
  onReset: () => void
}

export function EmptySchedule({ onReset }: EmptyScheduleProps) {
  const { t } = useTranslation()

  return (
    <View className="flex-1 items-center justify-center py-20">
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-move-border/50">
        <SearchX size={28} color="#9A9890" />
      </View>
      <Text className="font-dmsans-bold text-sm text-move-dark">
        {t('schedule.no_results')}
      </Text>
      <Text className="mt-1 font-dmsans text-xs text-move-text-muted">
        {t('schedule.no_results_hint')}
      </Text>
      <TouchableOpacity
        onPress={onReset}
        activeOpacity={0.7}
        className="mt-4 rounded-xl bg-move-dark px-5 py-2.5"
      >
        <Text className="font-dmsans-bold text-xs text-move-accent">
          {t('schedule.reset_filters')}
        </Text>
      </TouchableOpacity>
    </View>
  )
}
