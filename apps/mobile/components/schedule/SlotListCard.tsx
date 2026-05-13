import { View, Text, TouchableOpacity } from 'react-native'
import { Heart, ChevronRight, Dumbbell, Flame } from 'lucide-react-native'
import { CapacityBadge } from '../home/CapacityBadge'
import type { ScheduleSlot } from '../../hooks/useSchedule'

interface SlotListCardProps {
  slot: ScheduleSlot
  isFavorite: boolean
  onToggleFavorite: () => void
  onPress: () => void
}

export function SlotListCard({ slot, isFavorite, onToggleFavorite, onPress }: SlotListCardProps) {
  const Icon = slot.activity === 'Open Gym' ? Dumbbell : Flame

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="mb-2 flex-row items-center overflow-hidden rounded-2xl bg-move-card"
    >
      {/* Color band */}
      <View className="w-1 self-stretch" style={{ backgroundColor: slot.color }} />

      {/* Time */}
      <View className="w-16 items-center justify-center py-4">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 20, color: '#111111' }}>
          {slot.time}
        </Text>
        <Text className="font-dmsans text-[11px] text-move-text-muted">
          {slot.endTime}
        </Text>
      </View>

      {/* Activity + Coach */}
      <View className="flex-1 py-3">
        <View className="flex-row items-center gap-1.5">
          <Icon size={14} color="#111111" />
          <Text className="font-dmsans-bold text-[15px] text-move-dark">
            {slot.activity}
          </Text>
        </View>
        <Text className="mt-0.5 font-dmsans text-[13px] text-move-text-secondary">
          {slot.coach}
        </Text>
      </View>

      {/* Right: capacity + fav + chevron */}
      <View className="flex-row items-center gap-2 pr-3">
        <CapacityBadge booked={slot.booked} capacity={slot.capacity} />

        <TouchableOpacity onPress={onToggleFavorite} hitSlop={8}>
          <Heart
            size={16}
            color={isFavorite ? '#EF4444' : '#9A9890'}
            fill={isFavorite ? '#EF4444' : 'none'}
          />
        </TouchableOpacity>

        <ChevronRight size={16} color="#9A9890" />
      </View>
    </TouchableOpacity>
  )
}
