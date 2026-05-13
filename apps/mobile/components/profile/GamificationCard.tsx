import { useEffect } from 'react'
import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Check, Circle, Trophy } from 'lucide-react-native'
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated'

interface GamificationItem {
  key: string
  labelKey: string
  points: number
  completed: boolean
}

interface GamificationCardProps {
  items: GamificationItem[]
  percentage: number
}

export function GamificationCard({ items, percentage }: GamificationCardProps) {
  const { t } = useTranslation()
  const barWidth = useSharedValue(0)

  useEffect(() => {
    barWidth.value = withTiming(percentage, { duration: 1000 })
  }, [percentage, barWidth])

  const barStyle = useAnimatedStyle(() => ({
    width: `${barWidth.value}%`,
  }))

  return (
    <View className="mx-4 mt-4 rounded-2xl bg-[#111111] p-5">
      {/* Header */}
      <View className="flex-row items-center justify-between">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 18, color: '#FFFFFF' }}>
          {t('profile.progression').toUpperCase()}
        </Text>
        <Text className="font-dmsans-bold text-base text-move-accent">
          {percentage}%
        </Text>
      </View>

      {/* Progress bar */}
      <View className="mt-3 h-2 overflow-hidden rounded-full bg-[#333333]">
        <Animated.View
          style={barStyle}
          className="h-full rounded-full bg-move-accent"
        />
      </View>

      {/* Items */}
      <View className="mt-4 gap-2.5">
        {items.map((item) => (
          <View key={item.key} className="flex-row items-center">
            {item.completed ? (
              <View className="h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
                <Check size={12} color="#22C55E" />
              </View>
            ) : (
              <Circle size={20} color="#555555" />
            )}
            <Text className={`ml-3 flex-1 font-dmsans text-sm ${item.completed ? 'text-white' : 'text-white/40'}`}>
              {t(`profile.gamification.${item.labelKey}`)}
            </Text>
            <Text className="font-dmsans-bold text-xs text-move-accent">
              {item.points}pts
            </Text>
          </View>
        ))}
      </View>

      {/* Reward */}
      {percentage >= 100 && (
        <View className="mt-4 flex-row items-center gap-2 rounded-xl bg-move-accent px-4 py-3">
          <Trophy size={18} color="#111111" />
          <Text className="flex-1 font-dmsans-bold text-sm text-[#111111]">
            {t('profile.reward')}
          </Text>
        </View>
      )}
    </View>
  )
}
