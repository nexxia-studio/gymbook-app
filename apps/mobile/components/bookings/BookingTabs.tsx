import { View, TouchableOpacity, Text } from 'react-native'
import { useTranslation } from 'react-i18next'

export type BookingTab = 'upcoming' | 'favorites' | 'history'

interface BookingTabsProps {
  active: BookingTab
  onSelect: (tab: BookingTab) => void
}

const TABS: BookingTab[] = ['upcoming', 'favorites', 'history']

export function BookingTabs({ active, onSelect }: BookingTabsProps) {
  const { t } = useTranslation()

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
            className={`rounded-xl px-4 py-2 ${
              isActive ? 'bg-move-accent' : 'border border-move-border bg-transparent'
            }`}
          >
            <Text
              className={`font-dmsans-medium text-xs ${
                isActive ? 'text-[#111111]' : 'text-move-text-secondary'
              }`}
            >
              {labels[tab]}
            </Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}
