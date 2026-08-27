import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Booking, BookingStatus } from '../../stores/useBookingStore'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

interface HistoryCardProps {
  booking: Booking
  dayLabel: string
}

type StatusStyle = { bg: string; text: string; key: string }

export function HistoryCard({ booking, dayLabel }: HistoryCardProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()

  // GYM-178 — clés = valeurs DB réelles. 'no_show' (rouge/négatif) remplace l'ancien
  // 'noshow' mort ; 'excused' (orange neutre) = absent sans perte de crédit (GYM-174).
  // 'attended' (vert) est désormais posé massivement par le cron (inversion GYM-174).
  //
  // ⚠️ LA TABLE EST DESCENDUE DANS LE COMPOSANT, et il le fallait : hors de lui elle ne
  // pouvait pas lire le thème. Les FONDS restent des classes — ce sont des lavis à 10 %
  // et 50 %, qu'aucun jeton ne nomme. Seules les ENCRES, opaques, passent aux jetons.
  // GYM-286 — A-2, EN ATTENTE pour `text-green-600` #16A34A : ce n'est pas
  // `SEMANTIC.success` #22C55E, et l'approcher serait la régression d'un pixel.
  const STATUS_STYLES: Record<BookingStatus, StatusStyle> = {
    // 🔴 GYM-290 (addendum, décision C) — quatrième vert fusionné vers `SEMANTIC.success`.
    attended: { bg: 'bg-green-500/10', text: SEMANTIC.success, key: 'status_attended' },
    no_show: { bg: 'bg-red-500/10', text: SEMANTIC.danger, key: 'status_noshow' },
    excused: { bg: 'bg-orange-500/10', text: SEMANTIC.warning, key: 'status_excused' },
    cancelled: { bg: 'bg-move-border/50', text: tokens.onBackgroundMuted, key: 'status_cancelled' },
    confirmed: { bg: 'bg-green-500/10', text: SEMANTIC.success, key: 'status_confirmed' },
    waitlisted: { bg: 'bg-orange-500/10', text: SEMANTIC.warning, key: 'status_waitlisted' },
  }

  // GYM-178 — repli défensif pérenne : un statut inconnu ne doit PLUS JAMAIS casser le
  // rendu. Style neutre + libellé = valeur brute (pas de clé i18n).
  const DEFAULT_STYLE: StatusStyle = { bg: 'bg-move-border/50', text: tokens.onBackgroundMuted, key: '' }

  const style = STATUS_STYLES[booking.status] ?? DEFAULT_STYLE
  const label = style.key ? t(`bookings.${style.key}`) : booking.status

  return (
    <View className="mb-2 flex-row items-center overflow-hidden rounded-2xl" style={{ backgroundColor: tokens.surface }}>
      <View className="w-1 self-stretch" style={{ backgroundColor: booking.activityColor }} />

      <View className="flex-1 px-3 py-3">
        <Text className="font-dmsans-bold text-[15px]" style={{ color: tokens.onSurface }}>
          {booking.activity}
        </Text>
        <Text className="font-dmsans text-[13px]" style={{ color: tokens.onSurfaceSecondary }}>
          {dayLabel} · {booking.time}
        </Text>
        {/* GYM-229 — une activité en accès libre (Open Gym) n'a pas de coach.
          Masquer la ligne plutôt que rendre une chaîne vide, qui laisserait un blanc
          dans la mise en page. Ternaire explicite vers `null` et non `coach && …` :
          en React Native, une chaîne vide rendue hors d'un <Text> déclenche un
          avertissement « text strings must be rendered within a <Text> ». */}
        {booking.coach ? (
          <Text className="font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
            {booking.coach}
          </Text>
        ) : null}
      </View>

      <View className={`mr-3 rounded-lg px-2.5 py-1 ${style.bg}`}>
        <Text className="font-dmsans-bold text-[10px]" style={{ color: style.text }}>
          {label}
        </Text>
      </View>
    </View>
  )
}
