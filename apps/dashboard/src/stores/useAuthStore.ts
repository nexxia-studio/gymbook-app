import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  session: Session | null
  gym_id: string | null
  role: string | null
  setUser: (user: User | null, session: Session | null) => void
  setGymContext: (gym_id: string, role: string) => void
  signOut: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  gym_id: null,
  role: null,
  setUser: (user, session) => set({ user, session }),
  setGymContext: (gym_id, role) => set({ gym_id, role }),
  signOut: () => set({ user: null, session: null, gym_id: null, role: null }),
}))
