import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react-native'

export function LimitBanner() {
  const { t } = useTranslation()

  return (
    <View className="mx-5 mb-3 flex-row items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3">
      <AlertTriangle size={18} color="#92400E" />
      <View className="flex-1">
        <Text className="font-dmsans-bold text-xs text-amber-800">
          {t('bookings.limit_title')}
        </Text>
        <Text className="font-dmsans text-[11px] text-amber-700">
          {t('bookings.limit_hint')}
        </Text>
      </View>
    </View>
  )
}
