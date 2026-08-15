import { View, Text, TouchableOpacity, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react-native'
import { CapacityBadge } from './CapacityBadge'
import { getDisplayStatus } from '../../utils/slotStatus'
import type { HomeSlot } from '../../hooks/useHomeSchedule'
import { LinearGradient } from '../../components/home/Gradient'
import { ActivityImage } from '../shared/ActivityImage'
import { resolveActivityIcon } from '../../lib/activityIcons'

interface SessionCardProps {
  slot: HomeSlot
  isFavorite: boolean
  isBooked: boolean
  isWaitlisted: boolean
  onToggleFavorite: () => void
  onPress: () => void
}

export function SessionCard({ slot, isFavorite, isBooked, isWaitlisted, onToggleFavorite, onPress }: SessionCardProps) {
  const { t } = useTranslation()
  const isFull = slot.booked >= slot.capacity
  // GYM-220 — icône choisie par le gérant (activities.icon), plus déduite du nom.
  const Icon = resolveActivityIcon(slot.icon)
  const displayStatus = getDisplayStatus(slot)

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }]}
      className="mb-4 overflow-hidden rounded-2xl bg-move-card shadow-sm"
    >
      {/* Image area — GYM-216 : activities.image_url, repli neutre si vide.
          Le filigrane d'initiales est porté par le repli lui-même (il n'a plus à être
          plaqué par-dessus une vraie photo). */}
      <ActivityImage
        imageUrl={slot.imageUrl}
        activity={slot.activity}
        accentColor={slot.activityColor}
        className="h-44"
        imageStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
        initialsSize={120}
      >
        <LinearGradient />

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
          {/* GYM-229 — une activité en accès libre (Open Gym) n'a pas de coach.
          Masquer la ligne plutôt que rendre une chaîne vide, qui laisserait un blanc
          dans la mise en page. Ternaire explicite vers `null` et non `coach && …` :
          en React Native, une chaîne vide rendue hors d'un <Text> déclenche un
          avertissement « text strings must be rendered within a <Text> ». */}
          {slot.coach ? (
            <Text className="mt-0.5 font-dmsans text-[13px] text-white/60">{slot.coach}</Text>
          ) : null}
        </View>
      </ActivityImage>

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
        ) : isWaitlisted ? (
          <View className="rounded-lg bg-orange-100 px-4 py-2.5">
            <Text className="font-dmsans-bold text-xs text-orange-500">
              {t('home.waitlisted_badge')}
            </Text>
          </View>
        ) : isFull ? (
          <View className="rounded-lg bg-orange-500 px-4 py-2.5">
            <Text className="font-dmsans-bold text-xs text-white">
              {t('session.waitlist')}
            </Text>
          </View>
        ) : (
          <View className="rounded-lg bg-move-dark px-4 py-2.5">
            <Text className="font-dmsans-bold text-xs text-move-accent">
              {t('home.book')}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  )
}
