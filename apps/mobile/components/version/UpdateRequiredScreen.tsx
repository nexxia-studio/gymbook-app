// GYM-389 — « Mise à jour requise ». Écran plein, sans « Plus tard » ni autre issue : la
// seule action est d'aller au store. Même composition que « Complète ton profil » — bande
// d'en-tête sur `background`, corps sur `page` — donc aux couleurs de la salle quand elles
// sont connues, et à la palette par défaut sinon (c'est le fournisseur de thème qui tranche).
import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Button } from '../ui/Button'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { useGymName } from '../../hooks/useGymName'

interface Props {
  onUpdate: () => void
  opening: boolean
  /** true quand aucune URL de store n'a pu être ouverte. */
  openFailed: boolean
}

export function UpdateRequiredScreen({ onUpdate, opening, openFailed }: Props) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  // Le nom de la salle s'il est connu, sinon celui de l'app (repli de `useGymName`).
  const nom = useGymName()

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      <View className="px-5 pb-4 pt-3">
        <Text
          accessibilityRole="header"
          style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}
        >
          {t('update_required.title').toUpperCase()}
        </Text>
      </View>

      <View className="flex-1 gap-4 p-4" style={{ backgroundColor: tokens.page }}>
        <View className="rounded-2xl p-4" style={{ backgroundColor: tokens.surface }}>
          <Text className="font-dmsans text-base leading-relaxed" style={{ color: tokens.onSurface }}>
            {t('update_required.message', { name: nom })}
          </Text>
        </View>

        {openFailed && (
          <Text className="font-dmsans text-sm leading-relaxed" style={{ color: SEMANTIC.danger }}>
            {t('update_required.open_failed', { name: nom })}
          </Text>
        )}

        <Button title={t('update_required.button')} onPress={onUpdate} isLoading={opening} />
      </View>
    </SafeAreaView>
  )
}
