import { create } from 'zustand'

export interface Booking {
  id: string
  slotId: string
  activity: string
  date: string
  time: string
  coach: string
  bookedAt: string
}

interface BookingState {
  bookings: Booking[]
  favorites: string[]
  addBooking: (slot: { id: string; activity: string; date: string; time: string; coach: string }) => void
  cancelBooking: (slotId: string) => void
  isBooked: (slotId: string) => boolean
  addFavorite: (slotId: string) => void
  removeFavorite: (slotId: string) => void
  isFavorite: (slotId: string) => boolean
  setBookings: (bookings: Booking[]) => void
}

let nextBookingId = 1

export const useBookingStore = create<BookingState>((set, get) => ({
  bookings: [],
  favorites: [],

  addBooking: (slot) => {
    const booking: Booking = {
      id: `bk-${nextBookingId++}`,
      slotId: slot.id,
      activity: slot.activity,
      date: slot.date,
      time: slot.time,
      coach: slot.coach,
      bookedAt: new Date().toISOString(),
    }
    set((s) => ({ bookings: [...s.bookings, booking] }))
  },

  cancelBooking: (slotId) =>
    set((s) => ({ bookings: s.bookings.filter((b) => b.slotId !== slotId) })),

  isBooked: (slotId) => get().bookings.some((b) => b.slotId === slotId),

  addFavorite: (slotId) =>
    set((s) => ({ favorites: [...s.favorites, slotId] })),

  removeFavorite: (slotId) =>
    set((s) => ({ favorites: s.favorites.filter((id) => id !== slotId) })),

  isFavorite: (slotId) => get().favorites.includes(slotId),

  setBookings: (bookings) => set({ bookings }),
}))
