import { View, Text, TouchableOpacity } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Booking } from '../../stores/useBookingStore'
import { WaitlistCountdown } from '../shared/WaitlistCountdown'
import { ActivityImage } from '../shared/ActivityImage'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

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
  const { tokens } = useTheme()

  const notified = isWaitlistNotified(booking)
  const expired = isWaitlistExpired(booking)
  const isWaitlisted = booking.status === 'waitlisted'
  // BUG 2 (GYM-96) — délai passé, statut client encore waitlisted : tag « Expirée » neutre
  // (rien à annuler, le cron va retirer la ligne). Prioritaire sur waitlisted/confirmed.
  const statusKey = expired ? 'status_expired' : isWaitlisted ? 'status_waitlisted' : 'status_confirmed'
  // GYM-286 — A-2/gris, EN ATTENTE pour `bg-neutral-500` #737373 : aucun jeton ne le vaut.
  const badgeBg = expired ? '#737373' : isWaitlisted ? SEMANTIC.warning : SEMANTIC.success

  return (
    <ActivityImage
      imageUrl={booking.imageUrl}
      activity={booking.activity}
      accentColor={booking.activityColor}
      className="mb-3 overflow-hidden rounded-2xl"
      style={{ backgroundColor: tokens.background }}
      imageStyle={{ borderRadius: 16, opacity: 0.35 }}
      initialsSize={110}
    >
      <View className="rounded-2xl p-4" style={{ backgroundColor: 'rgba(17, 17, 17, 0.65)' }}>
        <View className="flex-row">
          {/* Color band */}
          <View className="w-1 rounded-full" style={{ backgroundColor: booking.activityColor }} />

          <View className="ml-3 flex-1">
            {/* Top: activity + coach */}
            <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 20, color: tokens.onBackground }}>
              {booking.activity.toUpperCase()}
            </Text>
            {/* GYM-229 — une activité en accès libre (Open Gym) n'a pas de coach.
          Masquer la ligne plutôt que rendre une chaîne vide, qui laisserait un blanc
          dans la mise en page. Ternaire explicite vers `null` et non `coach && …` :
          en React Native, une chaîne vide rendue hors d'un <Text> déclenche un
          avertissement « text strings must be rendered within a <Text> ». */}
            {booking.coach ? (
              <Text className="mt-0.5 font-dmsans text-[13px] text-white/60">
                {booking.coach}
              </Text>
            ) : null}

            {/* Date + time + status */}
            <View className="mt-3 flex-row items-center gap-3">
              <View className="flex-1">
                <Text className="font-dmsans-bold text-sm" style={{ color: tokens.accent }}>
                  {dayLabel}
                </Text>
                <Text className="font-dmsans text-sm" style={{ color: tokens.onBackground }}>
                  {booking.time} → {booking.endTime}
                </Text>
              </View>
              {/* ⚠️ `SEMANTIC.onSignal` ET NON `tokens.onBackground` : l'encre est posée
                  sur une pastille de SIGNAL (gris / orange / vert), dont la couleur ne
                  bouge pas. Chez une salle claire, `onBackground` vaut une encre SOMBRE,
                  illisible sur l'orange. */}
              <View className="rounded-lg px-2.5 py-1" style={{ backgroundColor: badgeBg }}>
                <Text className="font-dmsans-bold text-[10px]" style={{ color: SEMANTIC.onSignal }}>
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
                  className="mt-2 self-start rounded-lg px-4 py-2"
                  style={{ backgroundColor: tokens.accent }}
                >
                  <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 14, color: tokens.onAccent }}>
                    {t('bookings.confirm_my_place').toUpperCase()}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ÉTAPE 5 — délai expiré : la place est passée au suivant (pas de bouton Confirmer) */}
            {expired && (
              <View className="mt-3 rounded-lg bg-red-500/15 px-3 py-2.5">
                {/* GYM-286 — A-2, EN ATTENTE : `text-red-400` #F87171 ≠ #EF4444. */}
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
                className="mt-3 self-start rounded-lg border px-3 py-1.5"
                style={{ borderColor: SEMANTIC.danger }}
              >
                <Text className="font-dmsans-bold text-xs text-red-400">
                  {notified ? t('bookings.decline') : t('bookings.cancel')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </ActivityImage>
  )
}
