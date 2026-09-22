import { View, Text, Image } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Clock, User, Users } from 'lucide-react-native'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

interface SessionInfoProps {
  time: string
  endTime: string
  coach: string
  /**
   * 🔴 22/09 — LA PHOTO DU COACH, ENFIN LUE PAR L'APP DES MEMBRES.
   *
   * `coaches.photo_url` existe depuis toujours et le dashboard la remplit désormais — mais
   * AUCUN écran de l'app ne la lisait : seuls les types générés la mentionnaient. Les trois
   * requêtes qui vont chercher un coach demandaient `coaches(name)`, un point c'est tout.
   *
   * `null` = pas de photo, et c'est le cas NORMAL (une salle qui n'en a pas mis, un
   * Open Gym sans coach) : la puce retombe sur sa seule icône, exactement comme avant.
   */
  coachPhoto?: string | null
  booked: number
  capacity: number
}

function InfoChip({ icon: Icon, label, photo }: {
  icon: typeof Clock
  label: string
  /** Remplace l'icône quand elle existe — jamais les deux, la puce est étroite. */
  photo?: string | null
}) {
  const { tokens } = useTheme()

  return (
    <View className="flex-row items-center gap-1.5 rounded-xl px-3 py-2" style={{ backgroundColor: tokens.page }}>
      {photo ? (
        // ⚠️ `cover` : une photo de personne se recadre. Et la taille suit celle de
        // l'icône qu'elle remplace — une puce qui grandirait ferait sauter la rangée.
        <Image source={{ uri: photo }} style={{ width: 18, height: 18, borderRadius: 9 }} resizeMode="cover" />
      ) : (
        <Icon size={14} color={tokens.onSurfaceSecondary} />
      )}
      <Text className="font-dmsans-medium text-xs" style={{ color: tokens.onSurfaceSecondary }}>{label}</Text>
    </View>
  )
}

export function SessionInfo({ time, endTime, coach, coachPhoto, booked, capacity }: SessionInfoProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const remaining = capacity - booked
  const pct = booked / capacity

  // La barre de remplissage est un SIGNAL, pas une décoration : vert tant qu'il reste de
  // la place, orange quand ça se remplit, rouge quand c'est complet. Elle ne suit donc
  // jamais la marque — une salle verte ne doit pas afficher « complet » en vert.
  let barColor: string = SEMANTIC.success
  if (pct >= 1) barColor = SEMANTIC.danger
  else if (pct > 0.7) barColor = SEMANTIC.warning

  return (
    <View className="px-5 py-4" style={{ backgroundColor: tokens.surface }}>
      {/* Chips */}
      <View className="flex-row gap-2">
        <InfoChip icon={Clock} label={`${time} → ${endTime}`} />
        {/* GYM-229 — une activité en accès libre (Open Gym) n'a pas de coach.
          Masquer la ligne plutôt que rendre une chaîne vide, qui laisserait un blanc
          dans la mise en page. Ternaire explicite vers `null` et non `coach && …` :
          en React Native, une chaîne vide rendue hors d'un <Text> déclenche un
          avertissement « text strings must be rendered within a <Text> ». */}
        {coach ? <InfoChip icon={User} label={coach} photo={coachPhoto} /> : null}
        <InfoChip icon={Users} label={t('session.spots', { booked, capacity })} />
      </View>

      {/* Progress bar */}
      <View className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: tokens.border }}>
        <View
          className="h-full rounded-full"
          style={{ width: `${Math.min(pct * 100, 100)}%`, backgroundColor: barColor }}
        />
      </View>
      <Text className="mt-1 font-dmsans text-[10px]" style={{ color: tokens.onBackgroundMuted }}>
        {remaining <= 0 ? t('home.full') : `${remaining} ${remaining === 1 ? 'place' : 'places'}`}
      </Text>
    </View>
  )
}
