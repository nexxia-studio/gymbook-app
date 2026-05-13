import { create } from 'zustand'

interface Booking {
  id: string
  slotId: string
  status: string
  bookedAt: string
}

interface BookingState {
  bookings: Booking[]
  favorites: string[]
  addFavorite: (slotId: string) => void
  removeFavorite: (slotId: string) => void
  isFavorite: (slotId: string) => boolean
  setBookings: (bookings: Booking[]) => void
}

export const useBookingStore = create<BookingState>((set, get) => ({
  bookings: [],
  favorites: [],
  addFavorite: (slotId) =>
    set((s) => ({ favorites: [...s.favorites, slotId] })),
  removeFavorite: (slotId) =>
    set((s) => ({ favorites: s.favorites.filter((id) => id !== slotId) })),
  isFavorite: (slotId) => get().favorites.includes(slotId),
  setBookings: (bookings) => set({ bookings }),
}))
