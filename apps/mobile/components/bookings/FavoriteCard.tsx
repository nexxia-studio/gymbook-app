import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react-native'
import { ActivityImage } from '../shared/ActivityImage'

interface FavoriteCardProps {
  activity: string
  /** GYM-216 — activities.image_url. Vide → repli neutre (cas nominal aujourd'hui). */
  imageUrl?: string | null
  /** activities.color, teinte du repli. */
  activityColor?: string | null
  dayLabel: string // weekday name of the recurring motif
  time: string // 'HH:mm', gym-local
  coach: string // coach of the resolved next occurrence ('' if none)
  hasUpcoming: boolean
  nextDateLabel: string | null // date label of the next occurrence
  onRemove: () => void
  onBook?: () => void
}

export function FavoriteCard({ activity, imageUrl, activityColor, dayLabel, time, coach, hasUpcoming, nextDateLabel, onRemove, onBook }: FavoriteCardProps) {
  const { t } = useTranslation()

  return (
    <View className="mb-3 flex-row items-center overflow-hidden rounded-2xl bg-move-card">
      {/* Image — GYM-216 : activities.image_url, repli neutre si vide. */}
      <ActivityImage
        imageUrl={imageUrl}
        activity={activity}
        accentColor={activityColor}
        className="h-20 w-20 overflow-hidden"
        style={{ borderTopLeftRadius: 16, borderBottomLeftRadius: 16 }}
        imageStyle={{ borderTopLeftRadius: 16, borderBottomLeftRadius: 16 }}
        initialsSize={34}
      />

      {/* Info — the recurring motif */}
      <View className="flex-1 px-3 py-2">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 18, color: '#111111' }}>
          {activity.toUpperCase()}
        </Text>
        <Text className="font-dmsans text-[13px] text-move-text-secondary">
          {dayLabel} · {time}
        </Text>
        {hasUpcoming ? (
          <Text className="font-dmsans text-xs text-move-text-muted">
            {nextDateLabel}{coach ? ` · ${coach}` : ''}
          </Text>
        ) : (
          <Text className="font-dmsans text-xs text-move-text-muted">
            {t('bookings.favorite_no_upcoming')}
          </Text>
        )}
      </View>

      {/* Actions */}
      <View className="items-center gap-2 pr-3">
        <TouchableOpacity onPress={onRemove} hitSlop={8}>
          <Heart size={18} color="#EF4444" fill="#EF4444" />
        </TouchableOpacity>
        {hasUpcoming && onBook && (
          <TouchableOpacity
            onPress={onBook}
            activeOpacity={0.8}
            className="rounded-lg bg-move-dark px-3 py-1.5"
          >
            <Text className="font-dmsans-bold text-[10px] text-move-accent">
              {t('bookings.book')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}
