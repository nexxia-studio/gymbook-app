import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Booking, BookingStatus } from '../../stores/useBookingStore'

interface HistoryCardProps {
  booking: Booking
  dayLabel: string
}

type StatusStyle = { bg: string; text: string; key: string }

// GYM-178 — clés = valeurs DB réelles. 'no_show' (rouge/négatif) remplace l'ancien 'noshow'
// mort ; 'excused' (orange neutre) = absent sans perte de crédit (GYM-174). 'attended' (vert)
// sera désormais posé massivement par le cron (inversion GYM-174).
const STATUS_STYLES: Record<BookingStatus, StatusStyle> = {
  attended: { bg: 'bg-green-500/10', text: 'text-green-600', key: 'status_attended' },
  no_show: { bg: 'bg-red-500/10', text: 'text-red-500', key: 'status_noshow' },
  excused: { bg: 'bg-orange-500/10', text: 'text-orange-500', key: 'status_excused' },
  cancelled: { bg: 'bg-move-border/50', text: 'text-move-text-muted', key: 'status_cancelled' },
  confirmed: { bg: 'bg-green-500/10', text: 'text-green-600', key: 'status_confirmed' },
  waitlisted: { bg: 'bg-orange-500/10', text: 'text-orange-500', key: 'status_waitlisted' },
}

// GYM-178 — fallback défensif pérenne : un statut inconnu ne doit PLUS JAMAIS crasher le
// rendu. Style neutre + libellé = valeur brute (pas de clé i18n → on affiche le statut tel quel).
const DEFAULT_STYLE: StatusStyle = { bg: 'bg-move-border/50', text: 'text-move-text-muted', key: '' }

export function HistoryCard({ booking, dayLabel }: HistoryCardProps) {
  const { t } = useTranslation()
  const style = STATUS_STYLES[booking.status] ?? DEFAULT_STYLE
  const label = style.key ? t(`bookings.${style.key}`) : booking.status

  return (
    <View className="mb-2 flex-row items-center overflow-hidden rounded-2xl bg-move-card">
      <View className="w-1 self-stretch" style={{ backgroundColor: booking.activityColor }} />

      <View className="flex-1 px-3 py-3">
        <Text className="font-dmsans-bold text-[15px] text-move-dark">
          {booking.activity}
        </Text>
        <Text className="font-dmsans text-[13px] text-move-text-secondary">
          {dayLabel} · {booking.time}
        </Text>
        <Text className="font-dmsans text-xs text-move-text-muted">
          {booking.coach}
        </Text>
      </View>

      <View className={`mr-3 rounded-lg px-2.5 py-1 ${style.bg}`}>
        <Text className={`font-dmsans-bold text-[10px] ${style.text}`}>
          {label}
        </Text>
      </View>
    </View>
  )
}
