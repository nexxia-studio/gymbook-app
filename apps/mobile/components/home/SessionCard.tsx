import { View, Text, TouchableOpacity, Pressable } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react-native'
import { CapacityBadge } from './CapacityBadge'
import { getDisplayStatus } from '../../utils/slotStatus'
import type { HomeSlot } from '../../hooks/useHomeSchedule'
import { LinearGradient } from '../../components/home/Gradient'
import { ActivityImage } from '../shared/ActivityImage'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
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
  const { tokens } = useTheme()
  const isFull = slot.booked >= slot.capacity
  // GYM-220 — icône choisie par le gérant (activities.icon), plus déduite du nom.
  const Icon = resolveActivityIcon(slot.icon)
  const displayStatus = getDisplayStatus(slot)

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        { backgroundColor: tokens.surface },
      ]}
      className="mb-4 overflow-hidden rounded-2xl shadow-sm"
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
          {/* Le cœur emploie `SEMANTIC.danger` pour ce que ce jeton GARANTIT — une
              couleur fixe, qui ne suit jamais la marque — non pour ce qu'il nomme. */}
          <Heart size={18} color={isFavorite ? SEMANTIC.danger : tokens.onBackground} fill={isFavorite ? SEMANTIC.danger : 'none'} />
        </TouchableOpacity>

        {/* Status badge — top left */}
        {displayStatus === 'in_progress' && (
          // ⚠️ `bg-white` et `text-white` RESTENT DES CLASSES : ce sont des encres posées
          // sur une pastille de SIGNAL (le vert « en cours »), et aucun jeton ne nomme
          // l'encre d'un signal. `tokens.onBackground` serait faux — chez une salle
          // claire il vaut une encre SOMBRE, illisible sur ce vert. Remonté au cockpit.
          <View className="absolute left-3 top-3 flex-row items-center gap-1 rounded-full px-2.5 py-1" style={{ backgroundColor: SEMANTIC.success }}>
            {/* GYM-286 — encre sur SIGNAL, laissée : aucun jeton ne la nomme. */}
            <View className="h-1.5 w-1.5 rounded-full bg-white" />
            <Text className="font-dmsans-bold text-[10px] text-white">{t('planning.status.in_progress')}</Text>
          </View>
        )}

        {/* Activity info */}
        <View className="absolute bottom-3 left-4">
          <View className="flex-row items-center gap-2">
            <Icon size={18} color={tokens.onBackground} />
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 22, color: tokens.onBackground }}>
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
          <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
            {slot.time} — {slot.endTime}
          </Text>
          <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
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
          // `bg-orange-100` #FFEDD5 reste (A-2, aucun jeton) ; l'encre, elle, EST
          // `SEMANTIC.warning` #F97316 au caractère près.
          <View className="rounded-lg bg-orange-100 px-4 py-2.5">
            <Text className="font-dmsans-bold text-xs" style={{ color: SEMANTIC.warning }}>
              {t('home.waitlisted_badge')}
            </Text>
          </View>
        ) : isFull ? (
          <View className="rounded-lg px-4 py-2.5" style={{ backgroundColor: SEMANTIC.warning }}>
            {/* GYM-286 — encre sur SIGNAL (fond `warning`), laissée : aucun jeton. */}
            <Text className="font-dmsans-bold text-xs text-white">
              {t('session.waitlist')}
            </Text>
          </View>
        ) : (
          // 🔴 GYM-286 — A-3/A-4, EN ATTENTE : `bg-move-dark` + `text-move-accent`.
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
