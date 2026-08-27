import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react-native'
import { ActivityImage } from '../shared/ActivityImage'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

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
  const { tokens } = useTheme()

  return (
    <View className="mb-3 flex-row items-center overflow-hidden rounded-2xl" style={{ backgroundColor: tokens.surface }}>
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
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 18, color: tokens.onSurface }}>
          {activity.toUpperCase()}
        </Text>
        <Text className="font-dmsans text-[13px]" style={{ color: tokens.onSurfaceSecondary }}>
          {dayLabel} · {time}
        </Text>
        {hasUpcoming ? (
          <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
            {nextDateLabel}{coach ? ` · ${coach}` : ''}
          </Text>
        ) : (
          <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
            {t('bookings.favorite_no_upcoming')}
          </Text>
        )}
      </View>

      {/* Actions */}
      <View className="items-center gap-2 pr-3">
        <TouchableOpacity onPress={onRemove} hitSlop={8}>
          {/* Le cœur emploie `SEMANTIC.danger` pour ce que ce jeton GARANTIT — une
              couleur fixe, qui ne suit jamais la marque — non pour ce qu'il nomme. */}
          <Heart size={18} color={SEMANTIC.danger} fill={SEMANTIC.danger} />
        </TouchableOpacity>
        {hasUpcoming && onBook && (
          // 🔴 GYM-286 — A-3/A-4, EN ATTENTE : `bg-move-dark` + `text-move-accent`.
          <TouchableOpacity
            onPress={onBook}
            activeOpacity={0.8}
            style={{ backgroundColor: tokens.actionBg }} className="rounded-lg px-3 py-1.5"
          >
            <Text style={{ color: tokens.onAction }} className="font-dmsans-bold text-[10px]">
              {t('bookings.book')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  )
}
