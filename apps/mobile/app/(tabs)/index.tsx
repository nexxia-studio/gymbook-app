import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function Home() {
  const { t } = useTranslation()

  return (
    <SafeAreaView className="flex-1 bg-move-bg">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="font-barlow text-5xl uppercase tracking-tight text-move-dark">
          Move95
        </Text>
        <Text className="mt-3 font-dmsans text-base text-move-text-secondary">
          {t('home.subtitle')}
        </Text>
        <View className="mt-6 h-1 w-20 rounded-full bg-move-accent" />
      </View>
    </SafeAreaView>
  )
}
