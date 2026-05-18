import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native'
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
import { MaxBookingsModal } from '../../components/session/MaxBookingsModal'
import { SuspensionModal } from '../../components/session/SuspensionModal'
import { useBookingStore } from '../../stores/useBookingStore'
import { supabase } from '../../lib/supabase'
import { getDisplayStatus } from '../../utils/slotStatus'
import { formatTime, formatDateStr, toLocalTime } from '../../utils/timezone'

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

  const { createBooking, cancelBooking, confirmWaitlist, favorites, addFavorite, removeFavorite } = useBookingStore()

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
  const [maxBookingsVisible, setMaxBookingsVisible] = useState(false)
  const [suspensionModal, setSuspensionModal] = useState<{ visible: boolean; until: string | null }>({ visible: false, until: null })
  const [bookingState, setBookingState] = useState<'available' | 'confirmed' | 'waitlisted'>('available')
  const [existingBookingId, setExistingBookingId] = useState<string | null>(null)
  const [waitlistNotifiedAt, setWaitlistNotifiedAt] = useState<string | null>(null)
  const [waitlistConfirmationDeadline, setWaitlistConfirmationDeadline] = useState<string | null>(null)

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
        const act = data.activities as unknown as { name: string; duration_min: number } | null
        const coa = data.coaches as unknown as { name: string } | null
        const actName = act?.name ?? activity
        const coachName = coa?.name ?? coach
        const dur = act?.duration_min ?? duration

        setSlotData({
          activity: actName,
          date: formatDateStr(data.starts_at),
          time: formatTime(data.starts_at),
          endTime: formatTime(data.ends_at),
          coach: coachName,
          duration: dur,
          capacity: data.capacity,
          booked: data.bookings_count ?? 0,
        })
        setBookedCount(data.bookings_count ?? 0)
      }
    }

    async function checkExistingBooking() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setBookingState('available'); return }

      const { data: existing } = await supabase
        .from('bookings')
        .select('id, status, waitlist_notified_at, waitlist_confirmation_deadline')
        .eq('slot_id', slotId)
        .eq('member_id', user.id)
        .in('status', ['confirmed', 'waitlisted'])
        .maybeSingle()

      setExistingBookingId(existing?.id ?? null)
      setWaitlistNotifiedAt(existing?.waitlist_notified_at ?? null)
      setWaitlistConfirmationDeadline(existing?.waitlist_confirmation_deadline ?? null)

      if (existing?.status === 'confirmed') setBookingState('confirmed')
      else if (existing?.status === 'waitlisted') setBookingState('waitlisted')
      else setBookingState('available')
    }

    loadSlot()
    checkExistingBooking()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId])

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
          const status = getDisplayStatus({
            date: formatDateStr(row.starts_at),
            time: formatTime(row.starts_at),
            endTime: formatTime(row.ends_at),
          })
          return status === 'scheduled'
        })
        .slice(0, 6)

      setWeekSlots(filtered.map((row) => {
        const localS = toLocalTime(row.starts_at)
        const dayName = days[localS.getDay()] ?? ''
        const monthName = months[localS.getMonth()] ?? ''
        const available = (row.bookings_count ?? 0) < row.capacity
        return {
          id: row.id,
          date: formatDateStr(row.starts_at),
          time: formatTime(row.starts_at),
          dayLabel: `${dayName} ${localS.getDate()} ${monthName}`,
          available,
        }
      }))
    }
    fetchOtherSlots()
  }, [slotId, duration, days, months])

  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null)

  const handleBook = useCallback(async () => {
    console.log('[Booking] handleBook called, slotId:', slotId)
    setLoading(true)
    console.log('[Booking] Calling createBooking...')
    const result = await createBooking(slotId)
    console.log('[Booking] Result:', JSON.stringify(result))
    setLoading(false)

    if (!result) return

    if (result.code === 'SUSPENDED') {
      setSuspensionModal({ visible: true, until: result.suspended_until ?? null })
      return
    }
    if (result.code === 'MAX_BOOKINGS_REACHED') {
      setMaxBookingsVisible(true)
      return
    }
    if (result.status === 'error') return // generic error, logged in store

    if (result.status === 'waitlisted') {
      setWaitlistPosition(result.position ?? 1)
      setBookingState('waitlisted')
      setBookingModalVisible(true)
      return
    }

    // Confirmed
    setBookedCount((c) => c + 1)
    setBookingState('confirmed')
    setBookingModalVisible(true)
  }, [slotId, createBooking])

  const handleCancel = useCallback(async () => {
    await cancelBooking(slotId)
    setBookedCount((c) => Math.max(0, c - 1))
    setBookingState('available')
    setExistingBookingId(null)
    setWaitlistNotifiedAt(null)
    setWaitlistConfirmationDeadline(null)
    setCancelModalVisible(false)
  }, [slotId, cancelBooking])

  const handleConfirmWaitlist = useCallback(async () => {
    if (!existingBookingId) return
    setLoading(true)
    const result = await confirmWaitlist(existingBookingId)
    setLoading(false)

    if (result.confirmed) {
      setBookingState('confirmed')
      setBookedCount((c) => c + 1)
      setWaitlistNotifiedAt(null)
      return
    }

    if (result.code === 'WAITLIST_EXPIRED') {
      Alert.alert(t('session.waitlist_expired_title'), t('session.waitlist_expired_message'))
      setBookingState('available')
      setExistingBookingId(null)
      setWaitlistNotifiedAt(null)
      setWaitlistConfirmationDeadline(null)
    }
  }, [existingBookingId, confirmWaitlist, t])

  const isNotified = (() => {
    if (bookingState !== 'waitlisted' || waitlistNotifiedAt === null) return false
    const deadline = waitlistConfirmationDeadline
      ? new Date(waitlistConfirmationDeadline).getTime()
      : new Date(waitlistNotifiedAt).getTime() + 30 * 60 * 1000
    return Date.now() < deadline
  })()

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
        {isNotified && (
          <View className="mb-3 rounded-lg bg-orange-100 px-3 py-2">
            <Text className="font-dmsans-bold text-xs text-orange-600">
              {t('session.spot_available_banner')}
            </Text>
          </View>
        )}

        <View className="flex-row items-center">
          <View className="flex-1">
            <Text className="font-dmsans-bold text-sm text-move-dark">
              {dayLabel} {time ? `· ${time}` : ''}
            </Text>
            <Text className="font-dmsans text-xs text-move-text-muted">
              {activity} · {t('home.duration_min', { duration })}
            </Text>
          </View>

          {bookingState === 'confirmed' ? (
            <TouchableOpacity
              onPress={() => setCancelModalVisible(true)}
              activeOpacity={0.8}
              className="rounded-xl border-2 border-red-500 px-6 py-3.5"
            >
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: '#EF4444' }}>
                {t('session.cancel').toUpperCase()}
              </Text>
            </TouchableOpacity>
          ) : bookingState === 'waitlisted' && isNotified ? (
            <TouchableOpacity
              onPress={handleConfirmWaitlist}
              disabled={loading}
              activeOpacity={0.8}
              className="rounded-xl bg-move-dark px-6 py-3.5"
            >
              {loading ? (
                <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: '#C8F000' }}>...</Text>
              ) : (
                <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: '#C8F000' }}>
                  {t('session.confirm_my_place').toUpperCase()}
                </Text>
              )}
            </TouchableOpacity>
          ) : bookingState === 'waitlisted' ? (
            <TouchableOpacity
              onPress={() => setCancelModalVisible(true)}
              activeOpacity={0.8}
              className="rounded-xl border-2 border-orange-500 px-6 py-3.5"
            >
              <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: '#F97316' }}>
                {t('session.quit_waitlist').toUpperCase()}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleBook}
              disabled={loading}
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

        {isNotified && (
          <TouchableOpacity
            onPress={() => setCancelModalVisible(true)}
            activeOpacity={0.7}
            className="mt-3 self-center"
          >
            <Text className="font-dmsans-bold text-xs text-move-text-muted underline">
              {t('session.decline')}
            </Text>
          </TouchableOpacity>
        )}
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

      <MaxBookingsModal
        visible={maxBookingsVisible}
        onViewBookings={() => {
          setMaxBookingsVisible(false)
          router.replace('/(tabs)/bookings' as never)
        }}
        onClose={() => setMaxBookingsVisible(false)}
      />

      <SuspensionModal
        visible={suspensionModal.visible}
        suspendedUntil={suspensionModal.until}
        onClose={() => setSuspensionModal({ visible: false, until: null })}
      />
    </View>
  )
}
