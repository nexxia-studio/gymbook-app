import { View, Text, TouchableOpacity, ImageBackground } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Booking } from '../../stores/useBookingStore'
import { WaitlistCountdown } from '../shared/WaitlistCountdown'
import { getActivityImageUrl } from '../../utils/activityImages'

interface UpcomingCardProps {
  booking: Booking
  onCancel: () => void
  onConfirmWaitlist?: () => void
  onWaitlistExpire?: () => void
  dayLabel: string
}

function waitlistDeadlineMs(booking: Booking): number | null {
  if (booking.status !== 'waitlisted' || booking.waitlistNotifiedAt === null) return null
  return booking.waitlistConfirmationDeadline
    ? new Date(booking.waitlistConfirmationDeadline).getTime()
    : new Date(booking.waitlistNotifiedAt).getTime() + 30 * 60 * 1000
}

function isWaitlistNotified(booking: Booking): boolean {
  const deadline = waitlistDeadlineMs(booking)
  return deadline !== null && Date.now() < deadline
}

// ÉTAPE 5 — waitlist notifiée dont le délai est écoulé (statut encore waitlisted côté
// client) : la place a été proposée au suivant. Cohérent avec le 410 WAITLIST_EXPIRED.
function isWaitlistExpired(booking: Booking): boolean {
  const deadline = waitlistDeadlineMs(booking)
  return deadline !== null && Date.now() >= deadline
}

export function UpcomingCard({ booking, onCancel, onConfirmWaitlist, onWaitlistExpire, dayLabel }: UpcomingCardProps) {
  const { t } = useTranslation()

  const notified = isWaitlistNotified(booking)
  const expired = isWaitlistExpired(booking)
  const isWaitlisted = booking.status === 'waitlisted'
  // BUG 2 (GYM-96) — délai passé, statut client encore waitlisted : tag « Expirée » neutre
  // (rien à annuler, le cron va retirer la ligne). Prioritaire sur waitlisted/confirmed.
  const statusKey = expired ? 'status_expired' : isWaitlisted ? 'status_waitlisted' : 'status_confirmed'
  const badgeBg = expired ? 'bg-neutral-500' : isWaitlisted ? 'bg-orange-500' : 'bg-green-500'

  return (
    <ImageBackground
      source={{ uri: getActivityImageUrl(booking.activity) }}
      className="mb-3 overflow-hidden rounded-2xl bg-move-dark"
      imageStyle={{ borderRadius: 16, opacity: 0.35 }}
    >
      <View className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(17, 17, 17, 0.65)' }}>
        <View className="flex-row">
          {/* Color band */}
          <View className="w-1 rounded-full" style={{ backgroundColor: booking.activityColor }} />

          <View className="ml-3 flex-1">
            {/* Top: activity + coach */}
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 20, color: '#FFFFFF' }}>
              {booking.activity.toUpperCase()}
            </Text>
            <Text className="mt-0.5 font-dmsans text-[13px] text-white/60">
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
              <View className={`rounded-lg px-2.5 py-1 ${badgeBg}`}>
                <Text className="font-dmsans-bold text-[10px] text-white">
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

            {/* ÉTAPE 5 — délai expiré : la place est passée au suivant (pas de bouton Confirmer) */}
            {expired && (
              <View className="mt-3 rounded-lg bg-red-500/15 px-3 py-2.5">
                <Text className="font-dmsans-bold text-xs text-red-400">
                  {t('bookings.waitlist_expired_card')}
                </Text>
              </View>
            )}

            {/* Cancel / Decline button — masqué quand le délai est expiré (rien à annuler) */}
            {!expired && (
              <TouchableOpacity
                onPress={onCancel}
                activeOpacity={0.7}
                className="mt-3 self-start rounded-lg border border-red-500 px-3 py-1.5"
              >
                <Text className="font-dmsans-bold text-xs text-red-400">
                  {notified ? t('bookings.decline') : t('bookings.cancel')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </ImageBackground>
  )
}
