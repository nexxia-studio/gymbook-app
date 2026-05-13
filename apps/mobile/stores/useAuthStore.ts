import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface AuthState {
  user: User | null
  session: Session | null
  gym_id: string | null
  isLoading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  initialize: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  gym_id: null,
  isLoading: false,
  error: null,
  clearError: () => set({ error: null }),

  signIn: async (email, password) => {
    set({ isLoading: true, error: null })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ isLoading: false, error: error.message })
      throw error
    }
    set({ user: data.user, session: data.session, isLoading: false })
  },

  signUp: async (email, password, firstName, lastName) => {
    set({ isLoading: true, error: null })
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName, last_name: lastName } },
    })
    if (error) {
      set({ isLoading: false, error: error.message })
      throw error
    }
    const needsConfirmation = !data.session
    if (data.session) {
      set({ user: data.user, session: data.session, isLoading: false })
    } else {
      set({ isLoading: false })
    }
    return { needsConfirmation }
  },

  signOut: async () => {
    await supabase.auth.signOut()
    set({ user: null, session: null, gym_id: null, error: null })
  },

  initialize: async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      set({ user: data.session.user, session: data.session })
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      set({ user: session?.user ?? null, session })
    })
  },
}))
