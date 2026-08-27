import { useEffect } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Check, Circle, Trophy, ChevronRight } from 'lucide-react-native'
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

interface GamificationItem {
  key: string
  labelKey: string
  points: number
  completed: boolean
  onPress?: () => void
}

interface GamificationCardProps {
  items: GamificationItem[]
  percentage: number
}

export function GamificationCard({ items, percentage }: GamificationCardProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const barWidth = useSharedValue(0)

  useEffect(() => {
    barWidth.value = withTiming(percentage, { duration: 1000 })
  }, [percentage, barWidth])

  const barStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%`,
  }))

  return (
    <View className="mx-4 mt-4 rounded-2xl p-5" style={{ backgroundColor: tokens.background }}>
      {/* Header */}
      <View className="flex-row items-center justify-between">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 18, color: tokens.onBackground }}>
          {t('profile.progression').toUpperCase()}
        </Text>
        <Text className="font-dmsans-bold text-base" style={{ color: tokens.accent }}>
          {percentage}%
        </Text>
      </View>

      {/* Progress bar */}
      {/* GYM-286 — A-6, EN ATTENTE. #333333 reste : aucun jeton n'en est voisin (34
          unités du plus proche), et c'est la PISTE d'une barre posée sur le fond sombre —
          la rattacher au fond l'effacerait. Il manque un gris neutre sur fond sombre. */}
      <View className="mt-3 h-2 overflow-hidden rounded-full bg-[#333333]">
        <Animated.View
          style={[barStyle, { backgroundColor: tokens.accent }]}
          className="h-full rounded-full"
        />
      </View>

      {/* Items */}
      <View className="mt-4 gap-2.5">
        {items.map((item) => {
          const isClickable = !item.completed && !!item.onPress
          const Row = (
            <>
              {item.completed ? (
                <View className="h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
                  <Check size={12} color={SEMANTIC.success} />
                </View>
              ) : (
                // GYM-286 — A-6, EN ATTENTE. #555555 reste : 22 unités du jeton le plus
                // proche, ce n'est pas un voisin. Même manque de vocabulaire que #333333.
                <Circle size={20} color="#555555" />
              )}
              {/* `text-white/60` reste : un blanc à 60 % n'est pas `tokens.onBackground`. */}
              <Text
                className={`ml-3 flex-1 font-dmsans text-sm ${item.completed ? '' : 'text-white/60'}`}
                style={item.completed ? { color: tokens.onBackground } : undefined}
              >
                {t(`profile.gamification.${item.labelKey}`)}
              </Text>
              <Text className="font-dmsans-bold text-xs" style={{ color: tokens.accent }}>
                {item.points}pts
              </Text>
              {isClickable && <ChevronRight size={14} color={tokens.accent} />}
            </>
          )
          if (isClickable) {
            return (
              <Pressable
                key={item.key}
                onPress={item.onPress}
                className="flex-row items-center"
              >
                {Row}
              </Pressable>
            )
          }
          return (
            <View key={item.key} className="flex-row items-center">
              {Row}
            </View>
          )
        })}
      </View>

      {/* Reward */}
      {percentage >= 100 && (
        // ⚠️ `onAccent` deux fois : l'icône ET le libellé sont posés SUR `accent` (P-6).
        <View className="mt-4 flex-row items-center gap-2 rounded-xl px-4 py-3" style={{ backgroundColor: tokens.accent }}>
          <Trophy size={18} color={tokens.onAccent} />
          <Text className="flex-1 font-dmsans-bold text-sm" style={{ color: tokens.onAccent }}>
            {t('profile.reward')}
          </Text>
        </View>
      )}
    </View>
  )
}
