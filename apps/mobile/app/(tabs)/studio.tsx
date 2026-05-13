import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function Studio() {
  const { t } = useTranslation()

  return (
    <SafeAreaView className="flex-1 bg-move-bg">
      <View className="flex-1 items-center justify-center">
        <Text className="font-barlow text-2xl uppercase text-move-dark">
          {t('studio.title')}
        </Text>
      </View>
    </SafeAreaView>
  )
}
