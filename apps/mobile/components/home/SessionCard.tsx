import { View, Text, TouchableOpacity, ImageBackground, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Heart, Dumbbell, Flame } from 'lucide-react-native'
import { CapacityBadge } from './CapacityBadge'
import { getDisplayStatus } from '../../utils/slotStatus'
import type { HomeSlot } from '../../hooks/useHomeSchedule'
import { LinearGradient } from '../../components/home/Gradient'

interface SessionCardProps {
  slot: HomeSlot
  isFavorite: boolean
  isBooked: boolean
  onToggleFavorite: () => void
  onPress: () => void
}

const IMAGE_URLS: Record<string, string> = {
  'Open Gym': 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&q=80',
  'HIIT / Hyrox': 'https://images.unsplash.com/photo-1517963879433-6ad2b056d712?w=800&q=80',
}

const INITIALS: Record<string, string> = {
  'Open Gym': 'OG',
  'HIIT / Hyrox': 'HX',
}

export function SessionCard({ slot, isFavorite, isBooked, onToggleFavorite, onPress }: SessionCardProps) {
  const { t } = useTranslation()
  const isFull = slot.booked >= slot.capacity
  const Icon = slot.activity === 'Open Gym' ? Dumbbell : Flame
  const displayStatus = getDisplayStatus(slot)

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
      className="mb-4 overflow-hidden rounded-2xl bg-move-card shadow-sm"
    >
      {/* Image area */}
      <ImageBackground
        source={{ uri: IMAGE_URLS[slot.activity] }}
        className="h-44"
        imageStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <LinearGradient />

        {/* Watermark */}
        <View className="absolute inset-0 items-center justify-center">
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 120, color: 'rgba(255,255,255,0.08)' }}>
            {INITIALS[slot.activity] ?? ''}
          </Text>
        </View>

        {/* Favorite button */}
        <TouchableOpacity
          onPress={onToggleFavorite}
          activeOpacity={0.7}
          className="absolute right-3 top-3 h-9 w-9 items-center justify-center rounded-full bg-black/30"
        >
          <Heart size={18} color={isFavorite ? '#EF4444' : '#FFFFFF'} fill={isFavorite ? '#EF4444' : 'none'} />
        </TouchableOpacity>

        {/* Status badge — top left */}
        {displayStatus === 'in_progress' && (
          <View className="absolute left-3 top-3 flex-row items-center gap-1 rounded-full bg-green-500 px-2.5 py-1">
            <View className="h-1.5 w-1.5 rounded-full bg-white" />
            <Text className="font-dmsans-bold text-[10px] text-white">{t('planning.status.in_progress')}</Text>
          </View>
        )}

        {/* Activity info */}
        <View className="absolute bottom-3 left-4">
          <View className="flex-row items-center gap-2">
            <Icon size={18} color="#FFFFFF" />
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: '#FFFFFF' }}>
              {slot.activity.toUpperCase()}
            </Text>
          </View>
          <Text className="mt-0.5 font-dmsans text-[13px] text-white/60">{slot.coach}</Text>
        </View>
      </ImageBackground>

      {/* Footer */}
      <View className="flex-row items-center px-4 py-3">
        <View className="flex-1">
          <Text className="font-dmsans-bold text-sm text-move-dark">
            {slot.time} — {slot.endTime}
          </Text>
          <Text className="font-dmsans text-xs text-move-text-muted">
            {t('home.duration_min', { duration: slot.duration })}
          </Text>
        </View>

        <View className="mx-3">
          <CapacityBadge booked={slot.booked} capacity={slot.capacity} />
        </View>

        {isBooked ? (
          <View className="rounded-lg bg-green-100 px-4 py-2.5">
            <Text className="font-dmsans-bold text-xs text-green-600">
              {t('home.booked')}
            </Text>
          </View>
        ) : (
          <View className={`rounded-lg px-4 py-2.5 ${isFull ? 'bg-move-border' : 'bg-move-dark'}`}>
            <Text className={`font-dmsans-bold text-xs ${isFull ? 'text-move-text-muted' : 'text-move-accent'}`}>
              {isFull ? t('home.full') : t('home.book')}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  )
}
