import { View, Text, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'

// GYM-391 (T2) — ÉCRAN MINIMAL : il n'existe que pour que la cloche ait une destination.
// raccourci: en-tête et retour seulement, aucun message affiché — remplacé par la liste en T3.
export default function MessagesScreen() {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      {/* Même en-tête que app/profile/payments.tsx. `replace` et pas `back`, comme les autres
          écrans : la destination est connue, cet écran ne s'ouvre que depuis la cloche de
          l'accueil. */}
      <View className="flex-row items-center justify-between px-5 pb-6 pt-3" style={{ backgroundColor: tokens.background }}>
        <Pressable
          onPress={() => router.replace('/(tabs)')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ChevronLeft size={24} color={tokens.onBackground} />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}>
          {t('messages.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>
      <View className="flex-1" style={{ backgroundColor: tokens.page }} />
    </SafeAreaView>
  )
}
