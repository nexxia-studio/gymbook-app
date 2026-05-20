import { View, Text, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function PaymentCancel() {
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center px-8">
        <Text style={{ fontSize: 64, marginBottom: 16 }}>❌</Text>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#111111', textAlign: 'center', letterSpacing: 2 }}>
          {t('payment.cancel_title')}
        </Text>
        <Text className="mt-3 font-dmsans text-sm text-move-text-muted text-center">
          {t('payment.cancel_message')}
        </Text>
        <Pressable
          onPress={() => router.replace('/profile/subscription')}
          className="mt-10 w-full items-center rounded-xl bg-move-dark py-4"
        >
          <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: '#C8F000' }}>
            {t('payment.back_to_plans')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
