import { View, Text, ScrollView, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'
import { MarkdownText } from './MarkdownText'

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

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-6 pt-3">
        <Pressable onPress={() => router.replace('/(tabs)/profile')} hitSlop={12}>
          <ChevronLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#FFFFFF', letterSpacing: 2 }}>
          {title.toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        className="flex-1 bg-move-bg"
        contentContainerStyle={{ padding: 20, paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        <MarkdownText markdown={markdown} />

        <View className="mt-6 border-t border-move-border pt-4">
          <Text className="font-dmsans text-xs text-move-text-muted">
            {t('profile.legal.version', { version, date: updatedAt })}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
