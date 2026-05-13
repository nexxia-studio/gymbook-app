import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Booking, BookingStatus } from '../../stores/useBookingStore'

interface HistoryCardProps {
  booking: Booking
  dayLabel: string
}

const STATUS_STYLES: Record<BookingStatus, { bg: string; text: string; key: string }> = {
  attended: { bg: 'bg-green-500/10', text: 'text-green-600', key: 'status_attended' },
  noshow: { bg: 'bg-red-500/10', text: 'text-red-500', key: 'status_noshow' },
  cancelled: { bg: 'bg-move-border/50', text: 'text-move-text-muted', key: 'status_cancelled' },
  confirmed: { bg: 'bg-green-500/10', text: 'text-green-600', key: 'status_confirmed' },
  waitlisted: { bg: 'bg-orange-500/10', text: 'text-orange-500', key: 'status_waitlisted' },
}

export function HistoryCard({ booking, dayLabel }: HistoryCardProps) {
  const { t } = useTranslation()
  const style = STATUS_STYLES[booking.status]

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
          {t(`bookings.${style.key}`)}
        </Text>
      </View>
    </View>
  )
}
