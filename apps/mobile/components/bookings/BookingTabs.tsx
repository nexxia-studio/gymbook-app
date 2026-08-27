import { View, TouchableOpacity, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../lib/theme/ThemeProvider'

export type BookingTab = 'upcoming' | 'favorites' | 'history'

interface BookingTabsProps {
  active: BookingTab
  onSelect: (tab: BookingTab) => void
}

const TABS: BookingTab[] = ['upcoming', 'favorites', 'history']

export function BookingTabs({ active, onSelect }: BookingTabsProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  const labels: Record<BookingTab, string> = {
    upcoming: t('bookings.tab_upcoming'),
    favorites: t('bookings.tab_favorites'),
    history: t('bookings.tab_history'),
  }

  return (
    <View className="flex-row justify-center gap-2 px-5 py-3">
      {TABS.map((tab) => {
        const isActive = tab === active
        return (
          <TouchableOpacity
            key={tab}
            onPress={() => onSelect(tab)}
            activeOpacity={0.7}
            className={`rounded-xl px-4 py-2 ${isActive ? '' : 'border bg-transparent'}`}
            style={isActive ? { backgroundColor: tokens.accent } : { borderColor: tokens.border }}
          >
            {/* ⚠️ `onAccent`, PAS `onSurface` — piège P-6. Le libellé de l'onglet actif est
                posé SUR la couleur d'action de la salle ; c'est la seule encre que le
                garde-fou ait validée pour cet emploi. Les deux valent #111111 chez
                Dopamine, ce qui rend la confusion indolore — et invisible. */}
            <Text
              className="font-dmsans-medium text-xs"
              style={{ color: isActive ? tokens.onAccent : tokens.onSurfaceSecondary }}
            >
              {labels[tab]}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}
