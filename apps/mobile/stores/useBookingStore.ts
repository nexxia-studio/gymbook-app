import { create } from 'zustand'

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

// Mock past bookings
const MOCK_HISTORY: Booking[] = [
  { id: 'h1', slotId: 'past-1', activity: 'HIIT / Hyrox', activityColor: '#FF8E53', date: '2026-05-10', time: '18:00', endTime: '19:00', coach: 'Nicolas', status: 'attended', bookedAt: '2026-05-09T10:00:00Z' },
  { id: 'h2', slotId: 'past-2', activity: 'Open Gym', activityColor: '#4ECDC4', date: '2026-05-09', time: '07:30', endTime: '09:30', coach: 'François', status: 'attended', bookedAt: '2026-05-08T18:00:00Z' },
  { id: 'h3', slotId: 'past-3', activity: 'HIIT / Hyrox', activityColor: '#FF8E53', date: '2026-05-08', time: '19:00', endTime: '20:00', coach: 'Nicolas', status: 'noshow', bookedAt: '2026-05-07T12:00:00Z' },
  { id: 'h4', slotId: 'past-4', activity: 'Open Gym', activityColor: '#4ECDC4', date: '2026-05-06', time: '18:00', endTime: '20:00', coach: 'François', status: 'cancelled', bookedAt: '2026-05-05T09:00:00Z' },
]

interface BookingState {
  bookings: Booking[]
  pastBookings: Booking[]
  favorites: string[]
  addBooking: (slot: { id: string; activity: string; date: string; time: string; endTime: string; coach: string }) => void
  cancelBooking: (slotId: string) => void
  isBooked: (slotId: string) => boolean
  addFavorite: (slotId: string) => void
  removeFavorite: (slotId: string) => void
  isFavorite: (slotId: string) => boolean
  removePastFavorites: () => void
  setBookings: (bookings: Booking[]) => void
}

let nextBookingId = 100

export const useBookingStore = create<BookingState>((set, get) => ({
  bookings: [],
  pastBookings: MOCK_HISTORY,
  favorites: [],

  addBooking: (slot) => {
    const booking: Booking = {
      id: `bk-${nextBookingId++}`,
      slotId: slot.id,
      activity: slot.activity,
      activityColor: slot.activity === 'Open Gym' ? '#4ECDC4' : '#FF8E53',
      date: slot.date,
      time: slot.time,
      endTime: slot.endTime,
      coach: slot.coach,
      status: 'confirmed',
      bookedAt: new Date().toISOString(),
    }
    set((s) => ({ bookings: [...s.bookings, booking] }))
  },

  cancelBooking: (slotId) =>
    set((s) => ({
      bookings: s.bookings.filter((b) => b.slotId !== slotId),
      pastBookings: [
        ...s.pastBookings,
        ...s.bookings
          .filter((b) => b.slotId === slotId)
          .map((b) => ({ ...b, status: 'cancelled' as const })),
      ],
    })),

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
        // Favorites are slot IDs like "2026-05-13-07:30-Open Gym"
        // Extract date from ID
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

  setBookings: (bookings) => set({ bookings }),
}))
