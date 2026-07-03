import { View, Text, Image, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react-native'

interface FavoriteCardProps {
  activity: string
  dayLabel: string // weekday name of the recurring motif
  time: string // 'HH:mm', gym-local
  coach: string // coach of the resolved next occurrence ('' if none)
  hasUpcoming: boolean
  nextDateLabel: string | null // date label of the next occurrence
  onRemove: () => void
  onBook?: () => void
}

const IMAGES: Record<string, string> = {
  'Open Gym': 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=200&q=60',
  'HIIT / Hyrox': 'https://images.unsplash.com/photo-1517963879433-6ad2b056d712?w=200&q=60',
}

export function FavoriteCard({ activity, dayLabel, time, coach, hasUpcoming, nextDateLabel, onRemove, onBook }: FavoriteCardProps) {
  const { t } = useTranslation()

  return (
    <View className="mb-3 flex-row items-center overflow-hidden rounded-2xl bg-move-card">
      {/* Image */}
      <Image
        source={{ uri: IMAGES[activity] ?? IMAGES['Open Gym'] }}
        className="h-20 w-20"
        style={{ borderTopLeftRadius: 16, borderBottomLeftRadius: 16 }}
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
