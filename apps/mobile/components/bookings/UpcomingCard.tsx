import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Booking } from '../../stores/useBookingStore'

interface UpcomingCardProps {
  booking: Booking
  onCancel: () => void
  dayLabel: string
}

export function UpcomingCard({ booking, onCancel, dayLabel }: UpcomingCardProps) {
  const { t } = useTranslation()

  const statusKey = booking.status === 'waitlisted' ? 'status_waitlisted' : 'status_confirmed'
  const statusBg = booking.status === 'waitlisted' ? 'bg-orange-500/20' : 'bg-green-500/20'
  const statusText = booking.status === 'waitlisted' ? 'text-orange-400' : 'text-green-400'

  return (
    <View className="mb-3 overflow-hidden rounded-2xl bg-[#1A1A1A]">
      <View className="flex-row">
        {/* Color band */}
        <View className="w-1" style={{ backgroundColor: booking.activityColor }} />

        <View className="flex-1 p-4">
          {/* Top: activity + coach */}
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 20, color: '#FFFFFF' }}>
            {booking.activity.toUpperCase()}
          </Text>
          <Text className="mt-0.5 font-dmsans text-[13px] text-white/50">
            {booking.coach}
          </Text>

          {/* Date + time + status */}
          <View className="mt-3 flex-row items-center gap-3">
            <View className="flex-1">
              <Text className="font-dmsans-bold text-sm text-move-accent">
                {dayLabel}
              </Text>
              <Text className="font-dmsans text-sm text-white">
                {booking.time} → {booking.endTime}
              </Text>
            </View>
            <View className={`rounded-lg px-2.5 py-1 ${statusBg}`}>
              <Text className={`font-dmsans-bold text-[10px] ${statusText}`}>
                {t(`bookings.${statusKey}`)}
              </Text>
            </View>
          </View>

          {/* Cancel button */}
          <TouchableOpacity
            onPress={onCancel}
            activeOpacity={0.7}
            className="mt-3 self-start rounded-lg border border-red-500/30 px-3 py-1.5"
          >
            <Text className="font-dmsans-bold text-xs text-red-400">
              {t('bookings.cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
