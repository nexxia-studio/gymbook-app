import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export type BookingStatus = 'confirmed' | 'waitlisted' | 'cancelled' | 'attended' | 'noshow'

export interface Booking {
  id: string
  slotId: string
  activity: string
  activityColor: string
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
  createBooking: (slotId: string) => Promise<{ status: string; code?: string; position?: number; suspended_until?: string | null }>
  cancelBooking: (slotId: string) => Promise<{ noshow?: { level: string; hours?: number } } | void>
  confirmWaitlist: (bookingId: string) => Promise<{ confirmed: boolean; code?: string }>
  fetchBookings: (userId: string) => Promise<void>
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

  createBooking: async (slotId: string) => {
    console.log('[Store] createBooking invoked, slotId:', slotId)
    set({ isLoading: true })
    try {
      console.log('[Store] Calling supabase.functions.invoke("create-booking")')
      const { data, error } = await supabase.functions.invoke('create-booking', {
        body: { slot_id: slotId },
      })
      console.log('[Store] Response data:', JSON.stringify(data))
      console.log('[Store] Response error:', JSON.stringify(error))

      // Handle HTTP errors from Edge Function
      if (error) {
        // supabase-js puts the response body in error.context for FunctionsHttpError
        let errorBody: Record<string, unknown> | null = null
        try {
          if ((error as { context?: Response }).context) {
            errorBody = await (error as { context: Response }).context.json()
            console.log('[Store] Error body:', JSON.stringify(errorBody))
          }
        } catch { /* body already consumed or not JSON */ }

        const code = (errorBody?.code as string) ?? error.message ?? ''

        if (code.includes('SUSPENDED') || code.includes('suspendu')) {
          return { status: 'error' as const, code: 'SUSPENDED', suspended_until: (errorBody?.suspended_until as string) ?? null, position: undefined }
        }
        if (code.includes('MAX_BOOKINGS')) {
          return { status: 'error' as const, code: 'MAX_BOOKINGS_REACHED', position: undefined }
        }
        if (code === 'PAYMENT_REQUIRED') {
          return { status: 'error' as const, code: 'PAYMENT_REQUIRED', position: undefined }
        }
        return { status: 'error' as const, code: 'ERROR', position: undefined }
      }

      // Check if data contains business error (4xx returned as 200 edge case)
      if (data?.error || data?.code) {
        const code = (data.code as string) ?? ''
        if (code === 'SUSPENDED') {
          return { status: 'error' as const, code: 'SUSPENDED', suspended_until: data.suspended_until as string, position: undefined }
        }
        if (code === 'MAX_BOOKINGS_REACHED') {
          return { status: 'error' as const, code: 'MAX_BOOKINGS_REACHED', position: undefined }
        }
        if (code === 'PAYMENT_REQUIRED') {
          return { status: 'error' as const, code: 'PAYMENT_REQUIRED', position: undefined }
        }
        return { status: 'error' as const, code, position: undefined }
      }

      // Success — refresh bookings
      const { data: { user } } = await supabase.auth.getUser()
      if (user) get().fetchBookings(user.id)

      return { status: data.status as string, position: data.position as number | undefined }
    } finally {
      set({ isLoading: false })
    }
  },

  cancelBooking: async (slotId: string) => {
    const booking = get().bookings.find((b) => b.slotId === slotId)
    if (!booking) return

    const { data, error } = await supabase.functions.invoke('cancel-booking', {
      body: { booking_id: booking.id },
    })

    if (error) {
      throw new Error(error.message ?? 'Cancel failed')
    }

    if (data?.error) {
      throw new Error(data.code ?? data.message ?? 'Cancel failed')
    }

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

    return { noshow: noshowResult }
  },

  confirmWaitlist: async (bookingId: string) => {
    set({ isLoading: true })
    try {
      const { data, error } = await supabase.functions.invoke('confirm-waitlist', {
        body: { booking_id: bookingId },
      })

      // Extract code from HTTP error body (FunctionsHttpError puts response on error.context)
      if (error) {
        let errorBody: Record<string, unknown> | null = null
        try {
          if ((error as { context?: Response }).context) {
            errorBody = await (error as { context: Response }).context.json()
          }
        } catch { /* not JSON */ }
        const code = (errorBody?.code as string) ?? ''
        const { data: { user } } = await supabase.auth.getUser()
        if (user) get().fetchBookings(user.id)
        return { confirmed: false, code }
      }

      // Refresh bookings on success
      const { data: { user } } = await supabase.auth.getUser()
      if (user) get().fetchBookings(user.id)

      return { confirmed: data?.confirmed ?? false }
    } finally {
      set({ isLoading: false })
    }
  },

  fetchBookings: async (userId: string) => {
    try {
      // Step 1: fetch bookings (no join — avoids RLS issues on time_slots)
      const { data: rawBookings, error: bErr } = await supabase
        .from('bookings')
        .select('id, slot_id, status, booked_at, waitlist_position, waitlist_notified_at, waitlist_confirmation_deadline')
        .eq('member_id', userId)
        .order('booked_at', { ascending: false })

      console.log('[Bookings] Raw:', rawBookings?.length, 'error:', bErr?.message)

      if (!rawBookings || rawBookings.length === 0) {
        set({ bookings: [], pastBookings: [] })
        return
      }

      // Step 2: fetch corresponding slots separately
      const slotIds = [...new Set(rawBookings.map((b) => b.slot_id))]
      const { data: rawSlots } = await supabase
        .from('time_slots')
        .select('id, starts_at, ends_at, capacity, bookings_count, activities(name, color), coaches(name)')
        .in('id', slotIds)

      console.log('[Bookings] Slots fetched:', rawSlots?.length)

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

      console.log('[Bookings] Upcoming:', bookings.length, 'Past:', pastBookings.length)
      set({ bookings, pastBookings })
    } catch (e) {
      console.error('Failed to fetch bookings', e)
    }
  },

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
