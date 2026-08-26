import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { captureEvent } from '../lib/analytics'
import { tryEdgeInvoke } from '../lib/edgeInvoke'

// GYM-178 — valeurs RÉELLES de bookings.status en base (mapRow caste le statut brut).
// L'ancienne valeur 'noshow' (sans underscore) était morte : la DB écrit 'no_show', jamais
// 'noshow'. Ajout de 'excused' (GYM-174, posé par le gérant).
export type BookingStatus = 'confirmed' | 'waitlisted' | 'cancelled' | 'attended' | 'no_show' | 'excused'

export interface Booking {
  id: string
  slotId: string
  activity: string
  activityColor: string
  /** GYM-216 — activities.image_url. Vide → repli neutre (cas nominal aujourd'hui). */
  imageUrl: string | null
  date: string
  time: string
  endTime: string
  coach: string
  status: BookingStatus
  bookedAt: string
  waitlistNotifiedAt: string | null
  waitlistConfirmationDeadline: string | null
}

interface BookingState {
  bookings: Booking[]
  pastBookings: Booking[]
  favorites: FavoritePattern[]
  isLoading: boolean
  // GYM-96 — passe à true quand un fetch détecte une transition waitlisted → confirmed
  // (promotion serveur). Vit dans le store (survit au remontage de l'écran Réservations,
  // contrairement à un useRef local) → le toast de promotion ne se perd plus.
  justPromoted: boolean
  // GYM-196 — `limit` accompagne MAX_BOOKINGS_REACHED : la limite est configurable par
  // salle et seul le serveur la connaît (l'app ne lit jamais nexxia_gyms).
  createBooking: (slotId: string) => Promise<{ status: string; code?: string; position?: number; suspended_until?: string | null; limit?: number }>
  cancelBooking: (slotId: string) => Promise<{ noshow?: { level: string; hours?: number } } | void>
  confirmWaitlist: (bookingId: string) => Promise<{ confirmed: boolean; code?: string }>
  fetchBookings: (userId: string) => Promise<void>
  clearPromotion: () => void
  isBooked: (slotId: string) => boolean
  loadFavorites: () => Promise<void>
  addFavorite: (slot: FavoriteSlotInput) => Promise<void>
  removeFavorite: (slot: FavoriteSlotInput) => Promise<void>
  removeFavoritePattern: (pattern: FavoritePattern) => Promise<void>
  isFavorite: (slot: FavoriteSlotInput) => boolean
}

import { formatTime, formatDateStr, toLocalTime } from '../utils/timezone'

const toHHMM = formatTime
const toDateStr = formatDateStr

/**
 * A favorite is a recurring MOTIF, not a single dated slot:
 * "this activity, this weekday, this local time" — in the gym's timezone.
 */
export interface FavoritePattern {
  activity_id: string
  day_of_week: number // 0-6, 0 = Sunday, computed in the gym timezone
  local_time: string  // 'HH:mm:ss', gym-local (matches Postgres `time` column)
}

/** Minimal info needed to derive a motif from a concrete dated slot. */
export interface FavoriteSlotInput {
  activityId: string
  startsAt: string // UTC ISO timestamp of the slot
}

/**
 * Derive the recurring motif from a dated slot. ALWAYS converts starts_at
 * (UTC) to the gym timezone — never the device's local time.
 */
function slotToPattern(slot: FavoriteSlotInput): FavoritePattern {
  const local = toLocalTime(slot.startsAt)
  return {
    activity_id: slot.activityId,
    day_of_week: local.getDay(),
    local_time: `${formatTime(slot.startsAt)}:00`,
  }
}

function samePattern(a: FavoritePattern, b: FavoritePattern): boolean {
  return a.activity_id === b.activity_id
    && a.day_of_week === b.day_of_week
    && a.local_time === b.local_time
}

export const useBookingStore = create<BookingState>((set, get) => ({
  bookings: [],
  pastBookings: [],
  favorites: [],
  isLoading: false,
  justPromoted: false,

  createBooking: async (slotId: string) => {
    set({ isLoading: true })
    try {
      // GYM-270 — la lecture de `error.context` vit désormais dans lib/edgeInvoke.ts, avec
      // le filtrage Sentry : SUSPENDED, MAX_BOOKINGS_REACHED et PAYMENT_REQUIRED sont des
      // refus NORMAUX du produit et n'alertent plus personne. Le cas « erreur métier rendue
      // en 200 », que ce bloc traitait à part, est absorbé par le helper.
      const res = await tryEdgeInvoke<Record<string, unknown>>('create-booking', { slot_id: slotId })

      if (!res.ok) {
        const { code, message, body } = res.error
        // Repli sur le message quand le corps ne porte pas de code : c'est le comportement
        // d'origine, conservé — certaines réponses anciennes ne renvoyaient que du texte.
        const signal = code || message || ''

        if (signal.includes('SUSPENDED') || signal.includes('suspendu')) {
          return { status: 'error' as const, code: 'SUSPENDED', suspended_until: (body?.suspended_until as string) ?? null, position: undefined }
        }
        if (signal.includes('MAX_BOOKINGS')) {
          // GYM-196 — la limite est configurable par salle : c'est le SERVEUR qui la
          // communique (champ `limit`). L'app ne lit jamais nexxia_gyms et ne doit pas
          // ajouter de requête pour l'apprendre.
          return { status: 'error' as const, code: 'MAX_BOOKINGS_REACHED', limit: body?.limit as number | undefined, position: undefined }
        }
        if (code === 'PAYMENT_REQUIRED') {
          return { status: 'error' as const, code: 'PAYMENT_REQUIRED', position: undefined }
        }
        // Code inconnu : déjà remonté à Sentry par le helper (avec les tags edge_function
        // et edge_code) — inutile de le signaler une seconde fois ici.
        return { status: 'error' as const, code: code || 'ERROR', position: undefined }
      }

      const data = res.data

      // Success — refresh bookings
      const { data: { user } } = await supabase.auth.getUser()
      if (user) get().fetchBookings(user.id)

      // GYM-273 — une place en liste d'attente n'est PAS une réservation : la distinguer
      // permet de mesurer la pression sur les créneaux complets, qui est la donnée dont un
      // gérant a besoin pour décider d'ouvrir un cours de plus.
      const bookingStatus = data.status as string
      captureEvent('booking_created', { status: bookingStatus })
      if (bookingStatus === 'waitlisted') {
        captureEvent('waitlist_joined', { position: (data.position as number | undefined) ?? null })
      }
      return { status: bookingStatus, position: data.position as number | undefined }
    } finally {
      set({ isLoading: false })
    }
  },

  cancelBooking: async (slotId: string) => {
    const booking = get().bookings.find((b) => b.slotId === slotId)
    if (!booking) return

    // GYM-270 — `tryEdgeInvoke` couvre les deux anciens chemins d'échec (erreur HTTP et
    // `data.error` rendu en 200) et a déjà remonté à Sentry ce qui le méritait. On relance
    // l'EdgeError telle quelle : elle porte le code et le message du serveur, là où
    // `new Error('Cancel failed')` les perdait tous les deux.
    const res = await tryEdgeInvoke<{ noshow?: { level: string; hours?: number } }>('cancel-booking', { booking_id: booking.id })
    if (!res.ok) throw res.error

    const data = res.data
    const noshowResult = data?.noshow

    // Move to past bookings locally
    set((s) => ({
      bookings: s.bookings.filter((b) => b.slotId !== slotId),
      pastBookings: [
        { ...booking, status: 'cancelled' as const },
        ...s.pastBookings,
      ],
    }))

    // Refresh profile to update noshow_count if late cancellation
    if (noshowResult) {
      const { useAuthStore } = await import('./useAuthStore')
      useAuthStore.getState().refreshProfile()
    }

    captureEvent('booking_cancelled')
    return { noshow: noshowResult }
  },

  confirmWaitlist: async (bookingId: string) => {
    set({ isLoading: true })
    try {
      // GYM-270 — deuxième copie de la lecture de `error.context` supprimée : c'était la
      // MÊME que dans createBooking, réécrite. Elles ne traitaient déjà pas les mêmes cas.
      const res = await tryEdgeInvoke<{ confirmed?: boolean }>('confirm-waitlist', { booking_id: bookingId })

      if (!res.ok) {
        // Rafraîchir dans tous les cas : la place a pu être prise entre-temps (SLOT_FULL),
        // et la liste affichée doit refléter l'état réel avant que le membre ne réessaie.
        const { data: { user } } = await supabase.auth.getUser()
        if (user) get().fetchBookings(user.id)
        return { confirmed: false, code: res.error.code }
      }

      const data = res.data

      // Refresh bookings on success
      const { data: { user } } = await supabase.auth.getUser()
      if (user) get().fetchBookings(user.id)

      // GYM-273 — la promotion effective : le membre était en attente, il a sa place.
      // C'est l'issue que mesure la boucle « place libérée → notification → confirmation ».
      const confirmed = data?.confirmed ?? false
      if (confirmed) captureEvent('waitlist_promoted')

      return { confirmed }
    } finally {
      set({ isLoading: false })
    }
  },

  fetchBookings: async (userId: string) => {
    try {
      // Step 1: fetch bookings (no join — avoids RLS issues on time_slots)
      const { data: rawBookings } = await supabase
        .from('bookings')
        .select('id, slot_id, status, booked_at, waitlist_position, waitlist_notified_at, waitlist_confirmation_deadline')
        .eq('member_id', userId)
        .order('booked_at', { ascending: false })

      if (!rawBookings || rawBookings.length === 0) {
        set({ bookings: [], pastBookings: [] })
        return
      }

      // Step 2: fetch corresponding slots separately
      const slotIds = [...new Set(rawBookings.map((b) => b.slot_id))]
      const { data: rawSlots } = await supabase
        .from('time_slots')
        .select('id, starts_at, ends_at, capacity, bookings_count, activities(name, color, image_url), coaches(name)')
        .in('id', slotIds)

      // Step 3: combine and split
      const now = new Date()
      const slotMap = new Map<string, Record<string, unknown>>()
      for (const s of (rawSlots ?? []) as Array<Record<string, unknown>>) {
        slotMap.set(s.id as string, s)
      }

      function mapRow(row: { id: string; slot_id: string; status: string; booked_at: string | null; waitlist_notified_at?: string | null; waitlist_confirmation_deadline?: string | null }): Booking {
        const ts = slotMap.get(row.slot_id)
        const act = ts?.activities as Record<string, unknown> | null
        const coach = ts?.coaches as Record<string, unknown> | null
        return {
          id: row.id,
          slotId: row.slot_id,
          activity: (act?.name as string) ?? '',
          activityColor: (act?.color as string) ?? '#4ECDC4',
          imageUrl: (act?.image_url as string | null) ?? null,
          date: ts?.starts_at ? toDateStr(ts.starts_at as string) : '',
          time: ts?.starts_at ? toHHMM(ts.starts_at as string) : '',
          endTime: ts?.ends_at ? toHHMM(ts.ends_at as string) : '',
          coach: (coach?.name as string) ?? '',
          status: row.status as BookingStatus,
          bookedAt: row.booked_at ?? '',
          waitlistNotifiedAt: row.waitlist_notified_at ?? null,
          waitlistConfirmationDeadline: row.waitlist_confirmation_deadline ?? null,
        }
      }

      const bookings = rawBookings
        .filter((b) => {
          if (b.status !== 'confirmed' && b.status !== 'waitlisted') return false
          const ts = slotMap.get(b.slot_id)
          if (!ts?.starts_at) return false
          return new Date(ts.starts_at as string) > now
        })
        .map(mapRow)

      const pastBookings = rawBookings
        .filter((b) => {
          const ts = slotMap.get(b.slot_id)
          if (!ts?.starts_at) return false
          return new Date(ts.starts_at as string) <= now
        })
        .slice(0, 20)
        .map(mapRow)

      // GYM-96 — détection de promotion AVANT le set, contre l'état PRÉCÉDENT du store
      // (et non un useRef d'écran qui se réinitialise au remontage). promote_waitlist_atomic
      // conserve le booking.id (UPDATE en place) → comparaison par id fiable.
      const prevStatuses = new Map(get().bookings.map((b) => [b.id, b.status]))
      const promoted = bookings.some((b) => prevStatuses.get(b.id) === 'waitlisted' && b.status === 'confirmed')

      set(promoted ? { bookings, pastBookings, justPromoted: true } : { bookings, pastBookings })
    } catch (e) {
      console.error('Failed to fetch bookings', e)
    }
  },

  clearPromotion: () => set({ justPromoted: false }),

  isBooked: (slotId) => get().bookings.some((b) => b.slotId === slotId),

  loadFavorites: async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { set({ favorites: [] }); return }
    const { data, error } = await supabase
      .from('favorites')
      .select('activity_id, day_of_week, local_time')
      .eq('member_id', user.id)
    if (error) { console.error('Failed to load favorites', error); return }
    set({
      favorites: (data ?? []).map((r: Record<string, unknown>) => ({
        activity_id: r.activity_id as string,
        day_of_week: r.day_of_week as number,
        local_time: r.local_time as string,
      })),
    })
  },

  addFavorite: async (slot) => {
    const pattern = slotToPattern(slot)
    const prev = get().favorites
    if (prev.some((f) => samePattern(f, pattern))) return
    set({ favorites: [...prev, pattern] }) // optimistic
    const { data: { user } } = await supabase.auth.getUser()
    const { useAuthStore } = await import('./useAuthStore')
    const gymId = useAuthStore.getState().gym_id
    if (!user || !gymId) { set({ favorites: prev }); return } // rollback
    const { error } = await supabase.from('favorites').upsert(
      {
        gym_id: gymId,
        member_id: user.id,
        activity_id: pattern.activity_id,
        day_of_week: pattern.day_of_week,
        local_time: pattern.local_time,
      },
      { onConflict: 'member_id,activity_id,day_of_week,local_time' },
    )
    if (error) { console.error('Failed to add favorite', error); set({ favorites: prev }) } // rollback
  },

  removeFavorite: async (slot) => {
    await get().removeFavoritePattern(slotToPattern(slot))
  },

  removeFavoritePattern: async (pattern) => {
    const prev = get().favorites
    set({ favorites: prev.filter((f) => !samePattern(f, pattern)) }) // optimistic
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { set({ favorites: prev }); return }
    const { error } = await supabase
      .from('favorites')
      .delete()
      .eq('member_id', user.id)
      .eq('activity_id', pattern.activity_id)
      .eq('day_of_week', pattern.day_of_week)
      .eq('local_time', pattern.local_time)
    if (error) { console.error('Failed to remove favorite', error); set({ favorites: prev }) } // rollback
  },

  isFavorite: (slot) => {
    if (!slot.activityId || !slot.startsAt) return false
    const pattern = slotToPattern(slot)
    return get().favorites.some((f) => samePattern(f, pattern))
  },
}))
