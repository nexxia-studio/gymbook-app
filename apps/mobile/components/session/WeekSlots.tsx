import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../lib/theme/ThemeProvider'

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
  const { tokens } = useTheme()

  if (slots.length <= 1) return null

  return (
    <View className="px-5 py-4" style={{ backgroundColor: tokens.surface }}>
      <Text className="mb-3 font-dmsans-bold text-[11px] uppercase tracking-wider" style={{ color: tokens.onBackgroundMuted }}>
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
              // ⚠️ `bg-move-accent/5` et `bg-move-border/30` RESTENT DES CLASSES : ce
              // sont des lavis à 5 % et 30 %, qu'aucun jeton ne nomme. Seules les
              // bordures et les fonds PLEINS passent aux jetons.
              className={`w-36 rounded-2xl px-3 py-3 ${
                selected
                  ? 'border-2 bg-move-accent/5'
                  : s.available
                    ? 'border'
                    : 'border bg-move-border/30'
              }`}
              style={
                selected
                  ? { borderColor: tokens.accent }
                  : s.available
                    ? { borderColor: tokens.border, backgroundColor: tokens.page }
                    : { borderColor: tokens.border }
              }
            >
              <Text
                style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 18, color: s.available ? tokens.onSurface : tokens.onBackgroundMuted }}
              >
                {s.time}
              </Text>
              <Text
                className="mt-0.5 font-dmsans text-xs"
                style={{ color: s.available ? tokens.onSurfaceSecondary : tokens.onBackgroundMuted }}
              >
                {s.dayLabel}
              </Text>
              {!s.available && (
                // GYM-286 — A-2, EN ATTENTE : `text-red-400` vaut #F87171, pas #EF4444.
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
