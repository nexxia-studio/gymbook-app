import { create } from 'zustand'

interface Gym {
  id: string
  name: string
  slug: string
}

interface GymState {
  gym: Gym | null
  setGym: (gym: Gym | null) => void
}

export const useGymStore = create<GymState>((set) => ({
  gym: null,
  setGym: (gym) => set({ gym }),
}))
