import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter, useFocusEffect } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { CalendarX, Heart, Clock } from 'lucide-react-native'
import { BookingTabs, type BookingTab } from '../../components/bookings/BookingTabs'
import { UpcomingCard } from '../../components/bookings/UpcomingCard'
import { FavoriteCard } from '../../components/bookings/FavoriteCard'
import { HistoryCard } from '../../components/bookings/HistoryCard'
import { LimitBanner } from '../../components/bookings/LimitBanner'
import { CancelModal } from '../../components/session/CancelModal'
import { useBookingStore } from '../../stores/useBookingStore'
import { supabase } from '../../lib/supabase'
import { formatTime, formatDateStr } from '../../utils/timezone'

function formatDayLabel(dateStr: string, days: string[], months: string[]): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  return `${days[dt.getDay()]} ${d} ${months[dt.getMonth()]}`
}

export default function Bookings() {
  const { t } = useTranslation()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<BookingTab>('upcoming')
  const [cancelSlotId, setCancelSlotId] = useState<string | null>(null)

  const { bookings, pastBookings, favorites, cancelBooking, confirmWaitlist, removeFavorite, removePastFavorites, fetchBookings } = useBookingStore()

  const days = t('home.days', { returnObjects: true }) as string[]
  const months = t('home.months', { returnObjects: true }) as string[]

  // Fetch bookings on mount and on tab focus
  useFocusEffect(
    useCallback(() => {
      console.log('[BookingsScreen] focused — fetching bookings')
      async function load() {
        const { supabase } = await import('../../lib/supabase')
        const { data: { user } } = await supabase.auth.getUser()
        if (user) fetchBookings(user.id)
      }
      load()
      removePastFavorites()
    }, [fetchBookings, removePastFavorites])
  )

  const handleCancel = useCallback(async () => {
    if (cancelSlotId) {
      await cancelBooking(cancelSlotId)
      setCancelSlotId(null)
    }
  }, [cancelSlotId, cancelBooking])

  const handleConfirmWaitlist = useCallback(async (bookingId: string) => {
    const result = await confirmWaitlist(bookingId)
    if (result.confirmed) return
    if (result.code === 'WAITLIST_EXPIRED') {
      Alert.alert(t('session.waitlist_expired_title'), t('session.waitlist_expired_message'))
    }
  }, [confirmWaitlist, t])

  const handleWaitlistExpire = useCallback(async () => {
    const { supabase } = await import('../../lib/supabase')
    const { data: { user } } = await supabase.auth.getUser()
    if (user) fetchBookings(user.id)
  }, [fetchBookings])

  // Check late cancellation
  const isLate = useMemo(() => {
    if (!cancelSlotId) return false
    const booking = bookings.find((b) => b.slotId === cancelSlotId)
    if (!booking) return false
    const [y, mo, d] = booking.date.split('-').map(Number)
    const [h, m] = booking.time.split(':').map(Number)
    const start = new Date(y, mo - 1, d, h, m)
    return start.getTime() - Date.now() < 2 * 60 * 60 * 1000
  }, [cancelSlotId, bookings])

  // Enrich favorite slot IDs with real Supabase data (filtered to future slots)
  const [favoritesData, setFavoritesData] = useState<Array<{ id: string; date: string; time: string; activity: string; coach: string }>>([])

  useEffect(() => {
    let cancelled = false
    async function loadFavorites() {
      if (favorites.length === 0) {
        setFavoritesData([])
        return
      }
      const { data } = await supabase
        .from('time_slots')
        .select('id, starts_at, activities(name), coaches(name)')
        .in('id', favorites)
        .gt('starts_at', new Date().toISOString())
        .order('starts_at')
      if (cancelled) return
      setFavoritesData((data ?? []).map((row: Record<string, unknown>) => {
        const act = row.activities as Record<string, unknown> | null
        const coach = row.coaches as Record<string, unknown> | null
        return {
          id: row.id as string,
          date: formatDateStr(row.starts_at as string),
          time: formatTime(row.starts_at as string),
          activity: (act?.name as string) ?? 'Open Gym',
          coach: (coach?.name as string) ?? '',
        }
      }))
    }
    loadFavorites()
    return () => { cancelled = true }
  }, [favorites])

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      {/* Header */}
      <View className="bg-move-dark px-5 pb-4 pt-3">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: '#FFFFFF' }}>
          {t('bookings.title').toUpperCase()}
        </Text>
        <Text className="font-dmsans text-[13px] text-white/40">
          {t('bookings.subtitle')}
        </Text>
      </View>

      {/* Content */}
      <ScrollView className="flex-1 bg-move-bg" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 8 }}>
        {/* Tabs (inside the off-white area) */}
        <BookingTabs active={activeTab} onSelect={setActiveTab} />
        {/* === UPCOMING === */}
        {activeTab === 'upcoming' && (
          <>
            {bookings.length >= 2 && <LimitBanner />}

            {bookings.length === 0 ? (
              <View className="items-center py-20">
                <CalendarX size={40} color="#9A9890" />
                <Text className="mt-3 font-dmsans-bold text-sm text-move-dark">
                  {t('bookings.empty_upcoming')}
                </Text>
                <Text className="mt-1 font-dmsans text-xs text-move-text-muted">
                  {t('bookings.empty_upcoming_hint')}
                </Text>
                <TouchableOpacity
                  onPress={() => router.navigate('/(tabs)/schedule')}
                  activeOpacity={0.8}
                  className="mt-4 rounded-xl bg-move-dark px-5 py-2.5"
                >
                  <Text className="font-dmsans-bold text-xs text-move-accent">
                    {t('bookings.empty_upcoming_cta')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              bookings.map((booking) => (
                <UpcomingCard
                  key={booking.id}
                  booking={booking}
                  dayLabel={formatDayLabel(booking.date, days, months)}
                  onCancel={() => setCancelSlotId(booking.slotId)}
                  onConfirmWaitlist={() => handleConfirmWaitlist(booking.id)}
                  onWaitlistExpire={handleWaitlistExpire}
                />
              ))
            )}
          </>
        )}

        {/* === FAVORITES === */}
        {activeTab === 'favorites' && (
          <>
            {favoritesData.length === 0 ? (
              <View className="items-center py-20">
                <Heart size={40} color="#9A9890" />
                <Text className="mt-3 font-dmsans-bold text-sm text-move-dark">
                  {t('bookings.empty_favorites')}
                </Text>
                <Text className="mt-1 text-center font-dmsans text-xs text-move-text-muted">
                  {t('bookings.empty_favorites_hint')}
                </Text>
              </View>
            ) : (
              favoritesData.map((fav) => (
                <FavoriteCard
                  key={fav.id}
                  slotId={fav.id}
                  activity={fav.activity}
                  date={fav.date}
                  time={fav.time}
                  coach={fav.coach}
                  dayLabel={formatDayLabel(fav.date, days, months)}
                  onRemove={() => removeFavorite(fav.id)}
                  onBook={() => {
                    router.push({
                      pathname: '/session/[id]',
                      params: { id: fav.id, activity: fav.activity, date: fav.date, time: fav.time, coach: fav.coach, duration: fav.activity === 'Open Gym' ? '120' : '60', capacity: fav.activity === 'Open Gym' ? '6' : '12', booked: '3', endTime: '' },
                    })
                  }}
                />
              ))
            )}
          </>
        )}

        {/* === HISTORY === */}
        {activeTab === 'history' && (
          <>
            {pastBookings.length === 0 ? (
              <View className="items-center py-20">
                <Clock size={40} color="#9A9890" />
                <Text className="mt-3 font-dmsans-bold text-sm text-move-dark">
                  {t('bookings.empty_history')}
                </Text>
                <Text className="mt-1 font-dmsans text-xs text-move-text-muted">
                  {t('bookings.empty_history_hint')}
                </Text>
              </View>
            ) : (
              pastBookings.map((booking) => (
                <HistoryCard
                  key={booking.id}
                  booking={booking}
                  dayLabel={formatDayLabel(booking.date, days, months)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Cancel modal */}
      <CancelModal
        visible={!!cancelSlotId}
        isLate={isLate}
        onConfirm={handleCancel}
        onClose={() => setCancelSlotId(null)}
      />
    </SafeAreaView>
  )
}
