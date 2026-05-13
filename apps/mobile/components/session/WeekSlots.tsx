import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'

interface MiniSlot {
  id: string
  date: string
  time: string
  dayLabel: string
  available: boolean
}

interface WeekSlotsProps {
  slots: MiniSlot[]
  selectedId: string
  onSelect: (id: string) => void
}

export function WeekSlots({ slots, selectedId, onSelect }: WeekSlotsProps) {
  const { t } = useTranslation()

  if (slots.length <= 1) return null

  return (
    <View className="bg-move-card px-5 py-4">
      <Text className="mb-3 font-dmsans-bold text-[11px] uppercase tracking-wider text-move-text-muted">
        {t('session.other_slots')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {slots.map((s) => {
          const selected = s.id === selectedId
          return (
            <TouchableOpacity
              key={s.id}
              onPress={() => onSelect(s.id)}
              activeOpacity={0.7}
              className={`w-36 rounded-2xl px-3 py-3 ${
                selected
                  ? 'border-2 border-move-accent bg-move-accent/5'
                  : s.available
                    ? 'border border-move-border bg-move-bg'
                    : 'border border-move-border bg-move-border/30'
              }`}
            >
              <Text
                style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 18, color: s.available ? '#111111' : '#9A9890' }}
              >
                {s.time}
              </Text>
              <Text className={`mt-0.5 font-dmsans text-xs ${s.available ? 'text-move-text-secondary' : 'text-move-text-muted'}`}>
                {s.dayLabel}
              </Text>
              {!s.available && (
                <Text className="mt-1 font-dmsans-bold text-[10px] text-red-400">
                  {t('home.full')}
                </Text>
              )}
            </TouchableOpacity>
          )
        })}
      </ScrollView>
    </View>
  )
}
