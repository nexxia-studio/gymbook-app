import { View, Text, TouchableOpacity, Modal } from 'react-native'
import { useTranslation } from 'react-i18next'
import { CheckCircle, Clock } from 'lucide-react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming, withDelay } from 'react-native-reanimated'
import { useEffect } from 'react'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

interface BookingModalProps {
  visible: boolean
  activity: string
  date: string
  time: string
  waitlistPosition?: number | null
  onViewBookings: () => void
  onClose: () => void
}

export function BookingModal({ visible, activity, date, time, waitlistPosition, onViewBookings, onClose }: BookingModalProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const scale = useSharedValue(0)
  const isWaitlist = waitlistPosition != null && waitlistPosition > 0

  useEffect(() => {
    if (visible) {
      scale.value = withDelay(200, withSequence(
        withTiming(1.2, { duration: 200 }),
        withTiming(1, { duration: 150 }),
      ))
    } else {
      scale.value = 0
    }
  }, [visible, scale])

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View className="flex-1 justify-end bg-black/40">
        <View className="rounded-t-3xl px-6 pb-10 pt-8" style={{ backgroundColor: tokens.surface }}>
          <View className="items-center">
            <Animated.View style={iconStyle}>
              {isWaitlist ? (
                <Clock size={56} color={SEMANTIC.warning} />
              ) : (
                <CheckCircle size={56} color={SEMANTIC.success} />
              )}
            </Animated.View>

            <Text className="mt-4 font-barlow text-2xl uppercase" style={{ color: tokens.onSurface }}>
              {isWaitlist
                ? t('session.waitlist_joined')
                : t('session.booking_confirmed')}
            </Text>

            <Text className="mt-2 text-center font-dmsans text-sm" style={{ color: tokens.onSurfaceSecondary }}>
              {isWaitlist
                ? t('session.waitlist_message', { position: waitlistPosition })
                : t('session.booking_details', { activity, date, time })}
            </Text>

            {isWaitlist && (
              <Text className="mt-2 text-center font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
                {t('session.waitlist_hint')}
              </Text>
            )}
          </View>

          <View className="mt-8 gap-3">
            {/* 🔴 GYM-286 — A-3/A-4, EN ATTENTE. `bg-move-dark` + `text-move-accent`
                reste en dur : en mode multi le fond du bouton vaudrait celui de la page,
                1,00:1, invisible. Voir components/ui/Button.tsx. */}
            <TouchableOpacity
              onPress={onViewBookings}
              activeOpacity={0.8}
              className="items-center rounded-2xl bg-move-dark py-4"
            >
              <Text className="font-dmsans-bold text-sm text-move-accent">
                {t('session.view_bookings')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} activeOpacity={0.7} className="items-center py-3">
              <Text className="font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>
                {t('session.back')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  )
}
