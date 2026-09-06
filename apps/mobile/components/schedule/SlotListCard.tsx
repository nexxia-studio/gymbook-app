import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Heart, ChevronRight } from 'lucide-react-native'
import { resolveActivityIcon } from '../../lib/activityIcons'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { CapacityBadge } from '../home/CapacityBadge'
import { getDisplayStatus } from '../../utils/slotStatus'
import type { ScheduleSlot } from '../../hooks/useSchedule'

interface SlotListCardProps {
  slot: ScheduleSlot
  isFavorite: boolean
  onToggleFavorite: () => void
  onPress: () => void
}

export function SlotListCard({ slot, isFavorite, onToggleFavorite, onPress }: SlotListCardProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  // ⚠️ TABLE DESCENDUE DANS LE COMPOSANT : hors de lui elle ne pouvait pas lire le thème.
  // GYM-286 — `bg-gray-400` #9CA3AF reste : gris de la palette Tailwind, hors des huit
  // gris d'A-6, et aucun jeton ne le vaut.
  // ⚠️ `SEMANTIC.onSignal` ET NON `tokens.onBackground` : l'encre est posée sur une
  // pastille de SIGNAL, dont la couleur ne bouge pas. Chez une salle claire,
  // `onBackground` vaut une encre SOMBRE — illisible sur le vert comme sur le rouge.
  const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
    in_progress: { bg: SEMANTIC.success, text: SEMANTIC.onSignal },
    completed: { bg: '#9CA3AF', text: SEMANTIC.onSignal },
    cancelled: { bg: SEMANTIC.danger, text: SEMANTIC.onSignal },
  }
  // GYM-220 — icône choisie par le gérant (activities.icon), plus déduite du nom.
  const Icon = resolveActivityIcon(slot.icon)
  const displayStatus = getDisplayStatus(slot)

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      className="mb-2 flex-row items-center overflow-hidden rounded-2xl"
      style={{ backgroundColor: tokens.surface }}
    >
      {/* Color band */}
      <View className="w-1 self-stretch" style={{ backgroundColor: slot.color }} />

      {/* Time */}
      <View className="w-16 items-center justify-center py-4">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 20, color: tokens.onSurface }}>
          {slot.time}
        </Text>
        <Text className="font-dmsans text-[11px]" style={{ color: tokens.onBackgroundMuted }}>
          {slot.endTime}
        </Text>
      </View>

      {/* Activity + Coach + Status badge */}
      <View className="flex-1 py-3">
        <View className="flex-row items-center gap-1.5">
          <Icon size={14} color={tokens.onSurface} />
          <Text className="font-dmsans-bold text-[15px]" style={{ color: tokens.onSurface }}>
            {slot.activity}
          </Text>
          {displayStatus !== 'scheduled' && STATUS_STYLES[displayStatus] && (
            <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: STATUS_STYLES[displayStatus].bg }}>
              <Text className="font-dmsans-bold text-[9px]" style={{ color: STATUS_STYLES[displayStatus].text }}>
                {t(`planning.status.${displayStatus}`)}
              </Text>
            </View>
          )}
        </View>
        {/* GYM-229 — une activité en accès libre (Open Gym) n'a pas de coach.
          Masquer la ligne plutôt que rendre une chaîne vide, qui laisserait un blanc
          dans la mise en page. Ternaire explicite vers `null` et non `coach && …` :
          en React Native, une chaîne vide rendue hors d'un <Text> déclenche un
          avertissement « text strings must be rendered within a <Text> ». */}
        {slot.coach ? (
          <Text className="mt-0.5 font-dmsans text-[13px]" style={{ color: tokens.onSurfaceSecondary }}>
            {slot.coach}
          </Text>
        ) : null}
      </View>

      {/* Right: capacity + fav + chevron */}
      <View className="flex-row items-center gap-2 pr-3">
        <CapacityBadge booked={slot.booked} capacity={slot.capacity} />

        <TouchableOpacity onPress={onToggleFavorite} hitSlop={8}>
          <Heart
            size={16}
            color={isFavorite ? SEMANTIC.danger : tokens.onBackgroundMuted}
            fill={isFavorite ? SEMANTIC.danger : 'none'}
          />
        </TouchableOpacity>

        <ChevronRight size={16} color={tokens.onBackgroundMuted} />
      </View>
    </TouchableOpacity>
  )
}
