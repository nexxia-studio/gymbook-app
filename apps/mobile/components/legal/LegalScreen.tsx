import { View, Text, ScrollView, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { MarkdownText } from './MarkdownText'
import { useTheme } from '../../lib/theme/ThemeProvider'

// Écran légal générique : reçoit le markdown en prop (aujourd'hui depuis constants/legal,
// demain potentiellement depuis la DB) + la version/date affichées en pied de page.
interface LegalScreenProps {
  title: string
  markdown: string
  version: string
  updatedAt: string
}

export function LegalScreen({ title, markdown, version, updatedAt }: LegalScreenProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const { tokens } = useTheme()

  // ⚠️ La `SafeAreaView` porte la couleur de la BANDE, pas celle de la page (piège P-5) :
  // c'est ce qui fait que l'encoche prolonge l'en-tête au lieu d'ouvrir un bandeau clair
  // au-dessus de lui.
  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      <View className="flex-row items-center justify-between px-5 pb-6 pt-3" style={{ backgroundColor: tokens.background }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/profile'))} hitSlop={12}>
          <ChevronLeft size={24} color={tokens.onBackground} />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}>
          {title.toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        className="flex-1"
        style={{ backgroundColor: tokens.page }}
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <MarkdownText markdown={markdown} />

        {/* `border-t` reste : c'est une LARGEUR (piège P-3). Seule la couleur s'en va. */}
        <View className="mt-6 border-t pt-4" style={{ borderColor: tokens.border }}>
          <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
            {t('profile.legal.version', { version, date: updatedAt })}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
