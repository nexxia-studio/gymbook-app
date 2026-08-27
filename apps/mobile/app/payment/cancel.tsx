import { View, Text, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../lib/theme/ThemeProvider'

export default function PaymentCancel() {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.page }} edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center px-8">
        <Text style={{ fontSize: 64, marginBottom: 16 }}>❌</Text>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onSurface, textAlign: 'center', letterSpacing: 2 }}>
          {t('payment.cancel_title')}
        </Text>
        <Text className="mt-3 font-dmsans text-sm text-center" style={{ color: tokens.onBackgroundMuted }}>
          {t('payment.cancel_message')}
        </Text>
        <Pressable
          onPress={() => router.replace('/profile/subscription')}
          // 🔴 GYM-286 — A-3/A-4, EN ATTENTE : fond sombre + libellé lime.
          style={{ backgroundColor: tokens.actionBg }} className="mt-10 w-full items-center rounded-xl py-4"
        >
          <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 16, color: tokens.onAction }}>
            {t('payment.back_to_plans')}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
