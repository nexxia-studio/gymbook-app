import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Booking } from '../../stores/useBookingStore'
import { WaitlistCountdown } from '../shared/WaitlistCountdown'

interface UpcomingCardProps {
  booking: Booking
  onCancel: () => void
  onConfirmWaitlist?: () => void
  onWaitlistExpire?: () => void
  dayLabel: string
}

function isWaitlistNotified(booking: Booking): boolean {
  if (booking.status !== 'waitlisted' || booking.waitlistNotifiedAt === null) return false
  const deadline = booking.waitlistConfirmationDeadline
    ? new Date(booking.waitlistConfirmationDeadline).getTime()
    : new Date(booking.waitlistNotifiedAt).getTime() + 30 * 60 * 1000
  return Date.now() < deadline
}

export function UpcomingCard({ booking, onCancel, onConfirmWaitlist, onWaitlistExpire, dayLabel }: UpcomingCardProps) {
  const { t } = useTranslation()

  const notified = isWaitlistNotified(booking)
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

          {notified && booking.waitlistConfirmationDeadline && (
            <View className="mt-3">
              <WaitlistCountdown
                deadline={booking.waitlistConfirmationDeadline}
                onExpire={onWaitlistExpire}
              />
              <TouchableOpacity
                onPress={onConfirmWaitlist}
                activeOpacity={0.8}
                className="mt-2 self-start rounded-lg bg-move-accent px-4 py-2"
              >
                <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 14, color: '#111111' }}>
                  {t('bookings.confirm_my_place').toUpperCase()}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Cancel / Decline button */}
          <TouchableOpacity
            onPress={onCancel}
            activeOpacity={0.7}
            className="mt-3 self-start rounded-lg border border-red-500/30 px-3 py-1.5"
          >
            <Text className="font-dmsans-bold text-xs text-red-400">
              {notified ? t('bookings.decline') : t('bookings.cancel')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
