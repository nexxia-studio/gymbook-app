import { useState, useEffect, useCallback, useMemo } from 'react'
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
import { supabase } from '../../lib/supabase'
import { getDisplayStatus } from '../../utils/slotStatus'

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

  const { createBooking, cancelBooking, isBooked, favorites, addFavorite, removeFavorite } = useBookingStore()

  const slotId = params.id ?? ''

  // Slot data — fetched from Supabase, params used as initial fallback only
  const [slotData, setSlotData] = useState({
    activity: params.activity ?? 'Open Gym',
    date: params.date ?? '',
    time: params.time ?? '',
    endTime: params.endTime ?? '',
    coach: params.coach ?? '',
    duration: Number(params.duration) || 60,
    capacity: Number(params.capacity) || 6,
    booked: Number(params.booked) || 0,
  })

  const { activity, date, time, endTime, coach, duration, capacity } = slotData

  const [bookedCount, setBookedCount] = useState(slotData.booked)
  const [loading, setLoading] = useState(false)
  const [bookingModalVisible, setBookingModalVisible] = useState(false)
  const [cancelModalVisible, setCancelModalVisible] = useState(false)

  // Fetch fresh slot data from Supabase when id changes
  useEffect(() => {
    if (!slotId) return
    setBookingModalVisible(false)
    setCancelModalVisible(false)

    async function loadSlot() {
      const { data } = await supabase
        .from('time_slots')
        .select(`
          id, starts_at, ends_at, capacity, bookings_count, status,
          activities(name, duration_min),
          coaches(name)
        `)
        .eq('id', slotId)
        .single()

      if (data) {
        const s = new Date(data.starts_at)
        const e = new Date(data.ends_at)
        const act = data.activities as unknown as { name: string; duration_min: number } | null
        const coa = data.coaches as unknown as { name: string } | null
        const actName = act?.name ?? activity
        const coachName = coa?.name ?? coach
        const dur = act?.duration_min ?? duration

        setSlotData({
          activity: actName,
          date: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`,
          time: `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`,
          endTime: `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`,
          coach: coachName,
          duration: dur,
          capacity: data.capacity,
          booked: data.bookings_count ?? 0,
        })
        setBookedCount(data.bookings_count ?? 0)
      }
    }
    loadSlot()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId])

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

  // Fetch other slots for same activity (real Supabase)
  const [weekSlots, setWeekSlots] = useState<Array<{ id: string; date: string; time: string; dayLabel: string; available: boolean }>>([])

  useEffect(() => {
    async function fetchOtherSlots() {
      if (!slotId) return
      const now = new Date()
      const in14Days = new Date(now)
      in14Days.setDate(in14Days.getDate() + 14)

      const { data } = await supabase
        .from('time_slots')
        .select('id, starts_at, ends_at, capacity, bookings_count, status')
        .eq('gym_id', 'a0000000-0000-0000-0000-000000000001')
        .neq('id', slotId)
        .neq('status', 'cancelled')
        .gte('starts_at', now.toISOString())
        .lte('starts_at', in14Days.toISOString())
        .order('starts_at')

      if (!data) return

      // Filter same activity by name match (since we don't have activity_id in params)
      // and only keep scheduled slots
      const filtered = data
        .filter((row) => {
          const slotDate = new Date(row.starts_at)
          const slotEndDate = new Date(row.ends_at)
          // Same duration → same activity (Open Gym 120min vs HIIT 60min)
          const dur = Math.round((slotEndDate.getTime() - slotDate.getTime()) / 60000)
          return dur === duration
        })
        .filter((row) => {
          const s = new Date(row.starts_at)
          const e = new Date(row.ends_at)
          const status = getDisplayStatus({
            date: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`,
            time: `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`,
            endTime: `${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`,
          })
          return status === 'scheduled'
        })
        .slice(0, 6)

      setWeekSlots(filtered.map((row) => {
        const s = new Date(row.starts_at)
        const dayName = days[s.getDay()] ?? ''
        const monthName = months[s.getMonth()] ?? ''
        const available = (row.bookings_count ?? 0) < row.capacity
        return {
          id: row.id,
          date: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`,
          time: `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`,
          dayLabel: `${dayName} ${s.getDate()} ${monthName}`,
          available,
        }
      }))
    }
    fetchOtherSlots()
  }, [slotId, duration, days, months])

  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null)

  const handleBook = useCallback(async () => {
    setLoading(true)
    try {
      const result = await createBooking(slotId)
      if (result.status === 'waitlisted') {
        setWaitlistPosition(result.position ?? 1)
      } else {
        setBookedCount((c) => c + 1)
      }
      setBookingModalVisible(true)
    } catch {
      // Error handled in store
    } finally {
      setLoading(false)
    }
  }, [slotId, createBooking])

  const handleCancel = useCallback(async () => {
    await cancelBooking(slotId)
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
          onSelect={(selectedSlotId) => {
            const selected = weekSlots.find((s) => s.id === selectedSlotId)
            if (!selected) return
            router.replace({
              pathname: '/session/[id]',
              params: {
                id: selectedSlotId,
                activity,
                date: selected.date,
                time: selected.time,
                endTime: '',
                coach,
                duration: String(duration),
                capacity: String(capacity),
                booked: '0',
              },
            } as never)
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
        waitlistPosition={waitlistPosition}
        onViewBookings={() => {
          setBookingModalVisible(false)
          setWaitlistPosition(null)
          router.replace('/(tabs)/bookings')
        }}
        onClose={() => {
          setBookingModalVisible(false)
          setWaitlistPosition(null)
        }}
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
