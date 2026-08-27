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
import { CancelModal } from '../../components/session/CancelModal'
import { InScreenBanner } from '../../components/ui/InScreenBanner'
import { useBookingStore, type FavoritePattern } from '../../stores/useBookingStore'
import { supabase } from '../../lib/supabase'
import { useActiveGymId } from '../../lib/activeGym'
import { formatTime, formatDateStr, toLocalTime } from '../../utils/timezone'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { useGymHeaderName } from '../../hooks/useGymName'

function formatDayLabel(dateStr: string, days: string[], months: string[]): string {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, mo - 1, d)
  return `${days[dt.getDay()]} ${d} ${months[dt.getMonth()]}`
}

interface FavoriteCardData {
  key: string
  pattern: FavoritePattern
  activity: string
  // GYM-216 — visuel et teinte lus dans activities, plus déduits du nom du cours.
  imageUrl: string | null
  activityColor: string | null
  dayLabel: string
  time: string
  hasUpcoming: boolean
  nextDateLabel: string | null
  coach: string
  next: {
    id: string
    date: string
    time: string
    activity: string
    coach: string
    // Paramètres d'amorce de l'écran séance : valeurs réelles de l'activité, plus
    // « 120/6 si Open Gym, sinon 60/12 » (faux dès la 3e activité).
    duration: number | null
    capacity: number | null
  } | null
}

export default function Bookings() {
  // GYM-299 — en-tête : le nom COURT s'il existe, sinon le complet.
  const nomSalle = useGymHeaderName()
  const { tokens } = useTheme()
  // GYM-289 — la salle vient de la source unique (lib/activeGym), plus du build.
  const gymId = useActiveGymId()

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
      // ⚠️ Sans salle résolue, on ne requête pas (cf. lib/activeGym). N'arrive qu'en
      // mode `multi`, avant l'arrivée du profil.
      if (!gymId) return
      // Future slots for this gym + activity id → activité (nom, visuel, teinte,
      // durée, capacité) pour les motifs sans occurrence à venir, dont la carte doit
      // rester complète.
      const [{ data: slots }, { data: acts }] = await Promise.all([
        supabase
          .from('time_slots')
          .select('id, activity_id, starts_at, activities(name, color, image_url, duration_min, default_capacity), coaches(name)')
          .eq('gym_id', gymId)
          .gt('starts_at', new Date().toISOString())
          .neq('status', 'cancelled')
          .order('starts_at'),
        supabase
          .from('activities')
          .select('id, name, color, image_url, duration_min, default_capacity')
          .eq('gym_id', gymId),
      ])
      if (cancelled) return

      const rows = (slots ?? []) as Array<Record<string, unknown>>
      const activityById = new Map<string, Record<string, unknown>>(
        (acts ?? []).map((a: Record<string, unknown>) => [a.id as string, a]),
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
        const matchCoach = match ? (match.coaches as Record<string, unknown> | null) : null
        // L'activité du créneau à venir si on en a un, sinon la fiche activité chargée
        // à part : la carte d'un motif sans occurrence garde nom, visuel et teinte.
        const act = (match ? (match.activities as Record<string, unknown> | null) : null)
          ?? activityById.get(fav.activity_id)
          ?? null
        const activity = (act?.name as string) ?? ''
        const nextDate = match ? formatDateStr(match.starts_at as string) : null
        return {
          key: `${fav.activity_id}-${fav.day_of_week}-${fav.local_time}`,
          pattern: fav,
          activity,
          imageUrl: (act?.image_url as string | null) ?? null,
          activityColor: (act?.color as string | null) ?? null,
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
                duration: (act?.duration_min as number | null) ?? null,
                capacity: (act?.default_capacity as number | null) ?? null,
              }
            : null,
        }
      })
      setFavoritesData(cards)
    }
    loadFavorites()
    return () => { cancelled = true }
    // `gymId` en dépendance : les motifs favoris se résolvent sur les créneaux de la
    // salle, ils doivent se recalculer si elle change (cf. GYM-289).
  }, [favorites, t, gymId])

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      {/* Header */}
      <View className="px-5 pb-4 pt-3" style={{ backgroundColor: tokens.background }}>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 32, color: tokens.onBackground }}>
          {t('bookings.title').toUpperCase()}
        </Text>
        {/* GYM-297 — le nom de la salle ACTIVE, plus une clé i18n. Voir schedule.tsx. */}
        {/* 🔴 GYM-300 (3c) — ENCRE RÉSOLUE, OPACITÉ CONSERVÉE. `text-white/40` était un
            BLANC EN DUR : illisible dès que la salle a un fond clair, et l'en-tête de
            Studio Test le montrait — le nom de la salle disparaissait purement et
            simplement de sa propre bande.

            ⚠️ ET `onBackgroundMuted` N'AURAIT PAS FAIT L'AFFAIRE. Chez Dopamine il vaut
            #9A9890, alors qu'un blanc à 40 % sur #111111 rend #707070 : le
            remplacement direct aurait déplacé un pixel en single, ce que le cadrage
            interdit. `tokens.onBackground + '66'` rend EXACTEMENT le blanc à 40 % chez
            Dopamine (0x66 = 102, soit 102/255 = 0,40 pile), et l'encre de la salle
            ailleurs. C'est le motif A-10 de GYM-286 : on migre la teinte, on ne touche
            pas à l'alpha.

            ⚠️ ALPHA SUR LA COULEUR, PAS `opacity` SUR L'ÉLÉMENT — les deux rendent
            pareil ICI, mais `opacity` s'applique à toute la descendance : le jour où ce
            `Text` accueille une icône ou un second fragment, elle les délaverait aussi.
            L'alpha dans la couleur ne teinte que ce qu'elle colore. */}
        <Text
          className="font-dmsans text-[13px]"
          style={{ color: tokens.onBackground + '66' }}
        >
          {nomSalle}
        </Text>
      </View>

      {/* Content */}
      <ScrollView
        className="flex-1"
        style={{ backgroundColor: tokens.page }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 8 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.accent} colors={[tokens.accent]} />
        }
      >
        {/* Tabs (inside the off-white area) */}
        <BookingTabs active={activeTab} onSelect={setActiveTab} />
        {/* === UPCOMING === */}
        {activeTab === 'upcoming' && (
          <>
            {/* GYM-196 — bandeau « limite atteinte » RETIRÉ : il annonçait « 2
                réservations max » avec un seuil codé en dur, or la limite est
                désormais configurable par salle (nexxia_gyms.max_active_bookings) et
                l'app ne lit jamais cette table. Plutôt que de ré-inscrire un chiffre
                faux, on s'en remet au message du serveur au moment de réserver, qui
                porte la vraie valeur. Réactivable dès que la limite sera exposée à
                l'app (voir compte-rendu GYM-196). */}

            {bookings.length === 0 ? (
              <View className="items-center py-20">
                <CalendarX size={40} color={tokens.onBackgroundMuted} />
                <Text className="mt-3 font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                  {t('bookings.empty_upcoming')}
                </Text>
                <Text className="mt-1 font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
                  {t('bookings.empty_upcoming_hint')}
                </Text>
                {/* 🔴 GYM-286 — A-3/A-4, EN ATTENTE : `bg-move-dark` + `text-move-accent`. */}
                <TouchableOpacity
                  onPress={() => router.navigate('/(tabs)/schedule')}
                  activeOpacity={0.8}
                  style={{ backgroundColor: tokens.actionBg }} className="mt-4 rounded-xl px-5 py-2.5"
                >
                  <Text style={{ color: tokens.onAction }} className="font-dmsans-bold text-xs">
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
                <Heart size={40} color={tokens.onBackgroundMuted} />
                <Text className="mt-3 font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                  {t('bookings.empty_favorites')}
                </Text>
                <Text className="mt-1 text-center font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
                  {t('bookings.empty_favorites_hint')}
                </Text>
              </View>
            ) : (
              favoritesData.map((fav) => (
                <FavoriteCard
                  key={fav.key}
                  activity={fav.activity}
                  imageUrl={fav.imageUrl}
                  activityColor={fav.activityColor}
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
                      params: {
                        id: next.id,
                        activity: next.activity,
                        date: next.date,
                        time: next.time,
                        coach: next.coach,
                        // Valeurs réelles de l'activité ; l'écran séance les remplace
                        // de toute façon par celles du créneau après sa requête.
                        duration: next.duration != null ? String(next.duration) : '',
                        capacity: next.capacity != null ? String(next.capacity) : '',
                        booked: '',
                        endTime: '',
                      },
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
                <Clock size={40} color={tokens.onBackgroundMuted} />
                <Text className="mt-3 font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                  {t('bookings.empty_history')}
                </Text>
                <Text className="mt-1 font-dmsans text-xs" style={{ color: tokens.onBackgroundMuted }}>
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
