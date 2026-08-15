import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Clock, User, Users } from 'lucide-react-native'

interface SessionInfoProps {
  time: string
  endTime: string
  coach: string
  booked: number
  capacity: number
}

function InfoChip({ icon: Icon, label }: { icon: typeof Clock; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-xl bg-move-bg px-3 py-2">
      <Icon size={14} color="#6B6861" />
      <Text className="font-dmsans-medium text-xs text-move-text-secondary">{label}</Text>
    </View>
  )
}

export function SessionInfo({ time, endTime, coach, booked, capacity }: SessionInfoProps) {
  const { t } = useTranslation()
  const remaining = capacity - booked
  const pct = booked / capacity

  let barColor = '#22C55E'
  if (pct >= 1) barColor = '#EF4444'
  else if (pct > 0.7) barColor = '#F97316'

  return (
    <View className="bg-move-card px-5 py-4">
      {/* Chips */}
      <View className="flex-row gap-2">
        <InfoChip icon={Clock} label={`${time} → ${endTime}`} />
        {/* GYM-229 — une activité en accès libre (Open Gym) n'a pas de coach.
          Masquer la ligne plutôt que rendre une chaîne vide, qui laisserait un blanc
          dans la mise en page. Ternaire explicite vers `null` et non `coach && …` :
          en React Native, une chaîne vide rendue hors d'un <Text> déclenche un
          avertissement « text strings must be rendered within a <Text> ». */}
        {coach ? <InfoChip icon={User} label={coach} /> : null}
        <InfoChip icon={Users} label={t('session.spots', { booked, capacity })} />
      </View>

      {/* Progress bar */}
      <View className="mt-3 h-1.5 overflow-hidden rounded-full bg-move-border">
        <View
          className="h-full rounded-full"
          style={{ width: `${Math.min(pct * 100, 100)}%`, backgroundColor: barColor }}
        />
      </View>
      <Text className="mt-1 font-dmsans text-[10px] text-move-text-muted">
        {remaining <= 0 ? t('home.full') : `${remaining} ${remaining === 1 ? 'place' : 'places'}`}
      </Text>
    </View>
  )
}
