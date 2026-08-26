import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Calendar } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

interface EmptyDayStateProps {
  isSunday: boolean
}

export function EmptyDayState({ isSunday }: EmptyDayStateProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  return (
    <View className="items-center py-16">
      {/* `bg-move-border/50` reste : un lavis à 50 % n'est pas `tokens.border`. */}
      <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-move-border/50">
        <Calendar size={28} color={tokens.onBackgroundMuted} />
      </View>
      <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
        {t('home.empty_title')}
      </Text>
      <Text className="mt-1 font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
        {isSunday ? t('home.empty_closed') : t('home.empty_none')}
      </Text>
    </View>
  )
}
