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
}

interface BookingState {
  bookings: Booking[]
  pastBookings: Booking[]
  favorites: string[]
  isLoading: boolean
  createBooking: (slotId: string) => Promise<{ status: string; position?: number }>
  cancelBooking: (slotId: string) => Promise<{ noshow?: { level: string; hours?: number } } | void>
  confirmWaitlist: (bookingId: string) => Promise<{ confirmed: boolean }>
  fetchBookings: (userId: string) => Promise<void>
  isBooked: (slotId: string) => boolean
  addFavorite: (slotId: string) => void
  removeFavorite: (slotId: string) => void
  isFavorite: (slotId: string) => boolean
  removePastFavorites: () => void
}

function toHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function toDateStr(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

      // Edge Function returns errors as JSON with code field
      if (error) {
        // Try to parse the error body for business logic codes
        const msg = error.message ?? ''
        if (msg.includes('MAX_BOOKINGS') || msg.includes('2 réservations')) {
          throw new Error('MAX_BOOKINGS_REACHED')
        }
        if (msg.includes('SUSPENDED') || msg.includes('suspendu')) {
          throw new Error('SUSPENDED')
        }
        throw new Error(msg || 'Booking failed')
      }

      // Check if data itself contains an error response (4xx returned as 200 by invoke)
      if (data?.error) {
        throw new Error(data.code ?? data.message ?? 'Booking failed')
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

    return { noshow: noshowResult }
  },

  confirmWaitlist: async (bookingId: string) => {
    set({ isLoading: true })
    try {
      const { data, error } = await supabase.functions.invoke('confirm-waitlist', {
        body: { booking_id: bookingId },
      })
      if (error) throw new Error(error.message ?? 'Confirm failed')

      // Refresh bookings
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
        .select('id, slot_id, status, booked_at, waitlist_position')
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

      function mapRow(row: { id: string; slot_id: string; status: string; booked_at: string | null }): Booking {
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

  addFavorite: (slotId) =>
    set((s) => ({ favorites: s.favorites.includes(slotId) ? s.favorites : [...s.favorites, slotId] })),

  removeFavorite: (slotId) =>
    set((s) => ({ favorites: s.favorites.filter((id) => id !== slotId) })),

  isFavorite: (slotId) => get().favorites.includes(slotId),

  removePastFavorites: () => {
    const now = new Date()
    set((s) => ({
      favorites: s.favorites.filter((id) => {
        const parts = id.split('-')
        if (parts.length >= 3) {
          const dateStr = `${parts[0]}-${parts[1]}-${parts[2]}`
          const slotDate = new Date(dateStr.replace(/-/g, '/'))
          return slotDate >= now || isNaN(slotDate.getTime())
        }
        return true
      }),
    }))
  },
}))
