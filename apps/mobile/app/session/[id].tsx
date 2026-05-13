import { useState, useCallback, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MapPin } from 'lucide-react-native'
import { SessionHero } from '../../components/session/SessionHero'
import { SessionInfo } from '../../components/session/SessionInfo'
import { SessionDescription } from '../../components/session/SessionDescription'
import { WeekSlots } from '../../components/session/WeekSlots'
import { BookingModal } from '../../components/session/BookingModal'
import { CancelModal } from '../../components/session/CancelModal'
import { useBookingStore } from '../../stores/useBookingStore'

export default function SessionDetail() {
  const { t } = useTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{
    id: string
    activity: string
    date: string
    time: string
    endTime: string
    coach: string
    duration: string
    capacity: string
    booked: string
  }>()

  const { addBooking, cancelBooking, isBooked, favorites, addFavorite, removeFavorite } = useBookingStore()

  const slotId = params.id ?? ''
  const activity = params.activity ?? 'Open Gym'
  const date = params.date ?? ''
  const time = params.time ?? ''
  const endTime = params.endTime ?? ''
  const coach = params.coach ?? ''
  const duration = Number(params.duration) || 60
  const capacity = Number(params.capacity) || 6
  const initialBooked = Number(params.booked) || 0

  const [bookedCount, setBookedCount] = useState(initialBooked)
  const [loading, setLoading] = useState(false)
  const [bookingModalVisible, setBookingModalVisible] = useState(false)
  const [cancelModalVisible, setCancelModalVisible] = useState(false)

  const booked = isBooked(slotId)
  const isFull = bookedCount >= capacity
  const isFav = favorites.includes(slotId)

  // Check if cancellation is < 2h from start
  const isLateCancellation = useMemo(() => {
    if (!date || !time) return false
    const [y, mo, d] = date.split('-').map(Number)
    const [h, m] = time.split(':').map(Number)
    const slotStart = new Date(y, mo - 1, d, h, m)
    return slotStart.getTime() - Date.now() < 2 * 60 * 60 * 1000
  }, [date, time])

  // Format day label
  const days = t('home.days', { returnObjects: true }) as string[]
  const months = t('home.months', { returnObjects: true }) as string[]
  const dayLabel = useMemo(() => {
    if (!date) return ''
    const [y, mo, d] = date.split('-').map(Number)
    const dt = new Date(y, mo - 1, d)
    return `${days[dt.getDay()]} ${d} ${months[dt.getMonth()]}`
  }, [date, days, months])

  // Week slots for same activity
  const weekSlots = useMemo(() => {
    const result: Array<{ id: string; date: string; time: string; dayLabel: string; available: boolean }> = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const TIMES = activity === 'Open Gym'
      ? ['07:30', '18:00']
      : ['12:15', '19:00']

    for (let offset = 0; offset < 7; offset++) {
      const d = new Date(today)
      d.setDate(d.getDate() + offset)
      const dow = d.getDay()
      if (dow === 0) continue

      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const dayName = days[dow] ?? ''

      const timesForDay = dow === 6
        ? (activity === 'Open Gym' ? ['10:00'] : ['09:00', '11:00'])
        : TIMES

      for (const t of timesForDay) {
        result.push({
          id: `${dateStr}-${t}-${activity}`,
          date: dateStr,
          time: t,
          dayLabel: `${dayName} ${d.getDate()}`,
          available: Math.random() > 0.2,
        })
      }
    }
    return result
  }, [activity, days])

  const handleBook = useCallback(async () => {
    setLoading(true)
    await new Promise((r) => setTimeout(r, 800))
    addBooking({ id: slotId, activity, date, time, coach })
    setBookedCount((c) => c + 1)
    setLoading(false)
    setBookingModalVisible(true)
  }, [slotId, activity, date, time, coach, addBooking])

  const handleCancel = useCallback(() => {
    cancelBooking(slotId)
    setBookedCount((c) => Math.max(0, c - 1))
    setCancelModalVisible(false)
  }, [slotId, cancelBooking])

  const toggleFav = useCallback(() => {
    if (isFav) removeFavorite(slotId)
    else addFavorite(slotId)
  }, [isFav, slotId, addFavorite, removeFavorite])

  return (
    <View className="flex-1 bg-move-bg">
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <SessionHero
          activity={activity}
          onBack={() => router.back()}
          isFavorite={isFav}
          onToggleFavorite={toggleFav}
        />

        {/* Info chips + progress */}
        <SessionInfo
          time={time}
          endTime={endTime}
          coach={coach}
          booked={bookedCount}
          capacity={capacity}
        />

        <View className="h-2" />

        {/* Description */}
        <SessionDescription activity={activity} />

        <View className="h-2" />

        {/* Location */}
        <View className="bg-move-card px-5 py-4">
          <Text className="mb-2 font-dmsans-bold text-[11px] uppercase tracking-wider text-move-text-muted">
            {t('session.location')}
          </Text>
          <View className="flex-row items-center gap-2">
            <MapPin size={16} color="#6B6861" />
            <View>
              <Text className="font-dmsans-bold text-sm text-move-dark">
                Dopamine Performance Club
              </Text>
              <Text className="font-dmsans text-xs text-move-text-secondary">
                {t('session.address')}
              </Text>
            </View>
          </View>
        </View>

        <View className="h-2" />

        {/* Other slots this week */}
        <WeekSlots
          slots={weekSlots}
          selectedId={slotId}
          onSelect={(id) => {
            // In a real app, navigate to the new slot
            router.setParams({ id })
          }}
        />

        {/* Bottom spacer for footer */}
        <View className="h-24" />
      </ScrollView>

      {/* Sticky footer */}
      <View
        className="absolute bottom-0 left-0 right-0 border-t border-move-border bg-move-card px-5"
        style={{ paddingBottom: insets.bottom + 16, paddingTop: 16 }}
      >
        <View className="flex-row items-center">
          <View className="flex-1">
            <Text className="font-dmsans-bold text-sm text-move-dark">
              {dayLabel} {time ? `\u00B7 ${time}` : ''}
            </Text>
            <Text className="font-dmsans text-xs text-move-text-muted">
              {activity} \u00B7 {t('home.duration_min', { duration })}
            </Text>
          </View>

          {booked ? (
            <TouchableOpacity
              onPress={() => setCancelModalVisible(true)}
              activeOpacity={0.8}
              className="rounded-xl border-2 border-red-500 px-6 py-3.5"
            >
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: '#EF4444' }}>
                {t('session.cancel').toUpperCase()}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={isFull ? undefined : handleBook}
              disabled={isFull || loading}
              activeOpacity={0.8}
              className={`rounded-xl px-6 py-3.5 ${isFull ? 'bg-orange-500' : 'bg-move-dark'}`}
            >
              {loading ? (
                <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: '#C8F000' }}>...</Text>
              ) : (
                <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: isFull ? '#FFFFFF' : '#C8F000' }}>
                  {isFull ? t('session.waitlist').toUpperCase() : t('session.enroll').toUpperCase()}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Booking success modal */}
      <BookingModal
        visible={bookingModalVisible}
        activity={activity}
        date={dayLabel}
        time={time}
        onViewBookings={() => {
          setBookingModalVisible(false)
          router.replace('/(tabs)/bookings')
        }}
        onClose={() => setBookingModalVisible(false)}
      />

      {/* Cancel confirmation modal */}
      <CancelModal
        visible={cancelModalVisible}
        isLate={isLateCancellation}
        onConfirm={handleCancel}
        onClose={() => setCancelModalVisible(false)}
      />
    </View>
  )
}
