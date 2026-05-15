import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

interface AuthState {
  user: User | null
  session: Session | null
  gym_id: string | null
  role: string | null
  isLoading: boolean
  error: string | null
  setUser: (user: User | null, session: Session | null) => void
  setGymContext: (gym_id: string, role: string) => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    phone?: string,
    consents?: { terms: boolean; privacy: boolean; marketing: boolean }
  ) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  clearError: () => void
  initialize: () => Promise<void>
}

function mapSupabaseError(message: string): string {
  if (message.includes('Invalid login credentials')) return 'auth.errors.invalid_credentials'
  if (message.includes('Email not confirmed')) return 'auth.errors.email_not_confirmed'
  if (message.includes('User already registered')) return 'auth.errors.user_already_registered'
  if (message.includes('rate limit') || message.includes('too many')) return 'auth.errors.too_many_requests'
  return 'auth.errors.generic'
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  gym_id: null,
  role: null,
  isLoading: false,
  error: null,

  setUser: (user, session) => set({ user, session }),
  setGymContext: (gym_id, role) => set({ gym_id, role }),
  clearError: () => set({ error: null }),

  signIn: async (email, password) => {
    set({ isLoading: true, error: null })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ isLoading: false, error: mapSupabaseError(error.message) })
      throw error
    }
    // Fetch profile to get gym_id
    const { data: profile } = await supabase
      .from('profiles')
      .select('gym_id, role')
      .eq('id', data.user.id)
      .single()
    set({
      user: data.user,
      session: data.session,
      gym_id: profile?.gym_id ?? null,
      role: profile?.role ?? null,
      isLoading: false,
    })
  },

  signUp: async (email, password, firstName, lastName, phone, consents) => {
    set({ isLoading: true, error: null })
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: firstName,
          last_name: lastName,
          phone: phone ?? null,
          role: 'gym_admin',
          gym_id: null,
          preferred_language: 'fr',
          privacy_policy_accepted: String(consents?.privacy ?? false),
          terms_accepted: String(consents?.terms ?? false),
          marketing_consent: String(consents?.marketing ?? false),
        },
      },
    })
    if (error) {
      set({ isLoading: false, error: mapSupabaseError(error.message) })
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
    set({ isLoading: true })
    await supabase.auth.signOut()
    set({
      user: null,
      session: null,
      gym_id: null,
      role: null,
      isLoading: false,
      error: null,
    })
  },

  initialize: async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('gym_id, role')
        .eq('id', data.session.user.id)
        .single()
      set({
        user: data.session.user,
        session: data.session,
        gym_id: profile?.gym_id ?? null,
        role: profile?.role ?? null,
      })
    }

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ user: session?.user ?? null, session })
    })
  },
}))
