import { useState, useEffect, useCallback, useMemo } from 'react'
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native'
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
import { InScreenBanner } from '../../components/bookings/InScreenBanner'
import { useBookingStore, type FavoritePattern } from '../../stores/useBookingStore'
import { supabase } from '../../lib/supabase'
import { GYM_ID } from '../../constants/dopamine'
import { formatTime, formatDateStr, toLocalTime } from '../../utils/timezone'

function formatDayLabel(dateStr: string, days: string[], months: string[]): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  return `${days[dt.getDay()]} ${d} ${months[dt.getMonth()]}`
}

interface FavoriteCardData {
  key: string
  pattern: FavoritePattern
  activity: string
  dayLabel: string
  time: string
  hasUpcoming: boolean
  nextDateLabel: string | null
  coach: string
  next: { id: string; date: string; time: string; activity: string; coach: string } | null
}

export default function Bookings() {
  const { t } = useTranslation()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<BookingTab>('upcoming')
  const [cancelSlotId, setCancelSlotId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // Canal unique de bannière in-screen (promotion + délai expiré). null = rien affiché.
  const [banner, setBanner] = useState<string | null>(null)
  const hideBanner = useCallback(() => setBanner(null), [])

  const { bookings, pastBookings, favorites, cancelBooking, confirmWaitlist, removeFavoritePattern, fetchBookings, justPromoted, clearPromotion } = useBookingStore()

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
    }, [fetchBookings])
  )

  // ÉTAPE 3 — Pull-to-refresh (À venir + Historique partagent la même liste).
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) await fetchBookings(user.id)
    } finally {
      setRefreshing(false)
    }
  }, [fetchBookings])

  // ÉTAPE 4 — Bannière de promotion : le flag `justPromoted` est levé par le store dans
  // fetchBookings (détection waitlisted → confirmed contre l'état précédent). Le store
  // survit au remontage de l'écran, contrairement à l'ancien useRef local qui perdait la
  // baseline et absorbait la transition. On consomme puis on remet à zéro.
  useEffect(() => {
    if (justPromoted) {
      setBanner(t('bookings.waitlist_promoted_toast'))
      clearPromotion()
    }
  }, [justPromoted, clearPromotion, t])

  const handleCancel = useCallback(async () => {
    if (cancelSlotId) {
      await cancelBooking(cancelSlotId)
      setCancelSlotId(null)
    }
  }, [cancelSlotId, cancelBooking])

  const handleConfirmWaitlist = useCallback(async (bookingId: string) => {
    const result = await confirmWaitlist(bookingId)
    if (result.confirmed) return
    // ÉTAPE 5 — 410 WAITLIST_EXPIRED : même état « délai expiré » (bannière non bloquante).
    // La carte reflète l'état expiré si la réservation est encore présente après refetch.
    if (result.code === 'WAITLIST_EXPIRED') {
      setBanner(t('bookings.waitlist_expired_card'))
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

  // Resolve each favorite MOTIF to its next upcoming occurrence.
  // A card = one motif; the next matching future slot (if any) feeds "Book".
  const [favoritesData, setFavoritesData] = useState<FavoriteCardData[]>([])

  useEffect(() => {
    let cancelled = false
    async function loadFavorites() {
      if (favorites.length === 0) {
        setFavoritesData([])
        return
      }
      // Future slots for this gym + activity id → name map (for motifs with no
      // upcoming occurrence, so the card still shows the activity name).
      const [{ data: slots }, { data: acts }] = await Promise.all([
        supabase
          .from('time_slots')
          .select('id, activity_id, starts_at, activities(name), coaches(name)')
          .eq('gym_id', GYM_ID)
          .gt('starts_at', new Date().toISOString())
          .neq('status', 'cancelled')
          .order('starts_at'),
        supabase.from('activities').select('id, name').eq('gym_id', GYM_ID),
      ])
      if (cancelled) return

      const rows = (slots ?? []) as Array<Record<string, unknown>>
      const activityName = new Map<string, string>(
        (acts ?? []).map((a: Record<string, unknown>) => [a.id as string, a.name as string]),
      )

      const cards: FavoriteCardData[] = favorites.map((fav) => {
        // Slots are ordered by starts_at → first match is the next occurrence
        const match = rows.find((row) => {
          const startsAt = row.starts_at as string
          const local = toLocalTime(startsAt)
          return (row.activity_id as string) === fav.activity_id
            && local.getDay() === fav.day_of_week
            && `${formatTime(startsAt)}:00` === fav.local_time
        })
        const days = t('home.days', { returnObjects: true }) as string[]
        const months = t('home.months', { returnObjects: true }) as string[]
        const matchAct = match ? (match.activities as Record<string, unknown> | null) : null
        const matchCoach = match ? (match.coaches as Record<string, unknown> | null) : null
        const activity = (matchAct?.name as string) ?? activityName.get(fav.activity_id) ?? 'Open Gym'
        const nextDate = match ? formatDateStr(match.starts_at as string) : null
        return {
          key: `${fav.activity_id}-${fav.day_of_week}-${fav.local_time}`,
          pattern: fav,
          activity,
          dayLabel: days[fav.day_of_week] ?? '',
          time: fav.local_time.slice(0, 5),
          hasUpcoming: !!match,
          nextDateLabel: nextDate ? formatDayLabel(nextDate, days, months) : null,
          coach: (matchCoach?.name as string) ?? '',
          next: match
            ? {
                id: match.id as string,
                date: nextDate as string,
                time: formatTime(match.starts_at as string),
                activity,
                coach: (matchCoach?.name as string) ?? '',
              }
            : null,
        }
      })
      setFavoritesData(cards)
    }
    loadFavorites()
    return () => { cancelled = true }
  }, [favorites, t])

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
      <ScrollView
        className="flex-1 bg-move-bg"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 8 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#C8F000" colors={['#C8F000']} />
        }
      >
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
                  key={fav.key}
                  activity={fav.activity}
                  dayLabel={fav.dayLabel}
                  time={fav.time}
                  coach={fav.coach}
                  hasUpcoming={fav.hasUpcoming}
                  nextDateLabel={fav.nextDateLabel}
                  onRemove={() => removeFavoritePattern(fav.pattern)}
                  onBook={fav.next ? () => {
                    const next = fav.next!
                    router.push({
                      pathname: '/session/[id]',
                      params: { id: next.id, activity: next.activity, date: next.date, time: next.time, coach: next.coach, duration: next.activity === 'Open Gym' ? '120' : '60', capacity: next.activity === 'Open Gym' ? '6' : '12', booked: '3', endTime: '' },
                    })
                  } : undefined}
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

      {/* ÉTAPE 4/5 — bannière in-screen (promotion waitlist / délai expiré) */}
      <InScreenBanner message={banner} onHide={hideBanner} />
    </SafeAreaView>
  )
}
