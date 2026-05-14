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
    set({ isLoading: true })
    try {
      const { data, error } = await supabase.functions.invoke('create-booking', {
        body: { slot_id: slotId },
      })
      if (error) throw new Error(error.message ?? 'Booking failed')

      // Refresh bookings after success
      const { data: { user } } = await supabase.auth.getUser()
      if (user) get().fetchBookings(user.id)

      return { status: data.status, position: data.position }
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

    if (error) throw new Error(error.message ?? 'Cancel failed')

    // Store the noshow result for UI feedback
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

  fetchBookings: async (userId: string) => {
    try {
      // Future bookings
      const { data: upcoming } = await supabase
        .from('bookings')
        .select(`
          id, slot_id, status, booked_at,
          time_slots!inner(starts_at, ends_at, activities(name, color), coaches(name))
        `)
        .eq('member_id', userId)
        .in('status', ['confirmed', 'waitlisted'])
        .gte('time_slots.starts_at', new Date().toISOString())
        .order('booked_at', { ascending: false })

      const bookings: Booking[] = (upcoming ?? []).map((row: Record<string, unknown>) => {
        const ts = row.time_slots as Record<string, unknown>
        const act = ts?.activities as Record<string, unknown> | null
        const coach = ts?.coaches as Record<string, unknown> | null
        return {
          id: row.id as string,
          slotId: row.slot_id as string,
          activity: (act?.name as string) ?? '',
          activityColor: (act?.color as string) ?? '#4ECDC4',
          date: toDateStr(ts?.starts_at as string),
          time: toHHMM(ts?.starts_at as string),
          endTime: toHHMM(ts?.ends_at as string),
          coach: (coach?.name as string) ?? '',
          status: row.status as BookingStatus,
          bookedAt: row.booked_at as string,
        }
      })

      // Past bookings
      const { data: past } = await supabase
        .from('bookings')
        .select(`
          id, slot_id, status, booked_at,
          time_slots!inner(starts_at, ends_at, activities(name, color), coaches(name))
        `)
        .eq('member_id', userId)
        .lt('time_slots.starts_at', new Date().toISOString())
        .order('booked_at', { ascending: false })
        .limit(20)

      const pastBookings: Booking[] = (past ?? []).map((row: Record<string, unknown>) => {
        const ts = row.time_slots as Record<string, unknown>
        const act = ts?.activities as Record<string, unknown> | null
        const coach = ts?.coaches as Record<string, unknown> | null
        return {
          id: row.id as string,
          slotId: row.slot_id as string,
          activity: (act?.name as string) ?? '',
          activityColor: (act?.color as string) ?? '#4ECDC4',
          date: toDateStr(ts?.starts_at as string),
          time: toHHMM(ts?.starts_at as string),
          endTime: toHHMM(ts?.ends_at as string),
          coach: (coach?.name as string) ?? '',
          status: row.status as BookingStatus,
          bookedAt: row.booked_at as string,
        }
      })

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
