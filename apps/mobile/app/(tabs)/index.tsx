import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAuthStore } from '../../stores/useAuthStore'

export default function Home() {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const firstName = user?.user_metadata?.first_name ?? 'Move95'

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['top']}>
      <View className="flex-1 items-center justify-center px-6">
        <View className="flex-row">
          <Text className="font-barlow text-5xl text-move-dark">MOVE</Text>
          <Text className="font-barlow text-5xl text-move-accent">95</Text>
        </View>
        <Text className="mt-3 font-dmsans text-base text-move-text-secondary">
          {t('home.greeting', { name: firstName })}
        </Text>
        <Text className="mt-1 font-dmsans text-sm text-move-text-muted">
          {t('home.subtitle')}
        </Text>
        <View className="mt-6 h-0.5 w-10 rounded-full bg-move-accent" />
      </View>
    </SafeAreaView>
  )
}
