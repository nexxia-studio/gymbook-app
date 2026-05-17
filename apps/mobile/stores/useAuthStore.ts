import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

const DOPAMINE_GYM_ID = 'a0000000-0000-0000-0000-000000000001'

function mapError(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'auth.errors.invalid_credentials'
  if (msg.includes('Email not confirmed')) return 'auth.errors.email_not_confirmed'
  if (msg.includes('User already registered')) return 'auth.errors.user_already_registered'
  return 'auth.errors.generic'
}

export interface MemberProfile {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  avatarUrl: string | null
  noshowCount: number
  suspendedUntil: string | null
  marketingConsent: boolean
  dateOfBirth: string | null
  addressLine: string | null
  emergencyContactName: string | null
  memberSince: string | null
}

interface AuthState {
  user: User | null
  session: Session | null
  gym_id: string | null
  profile: MemberProfile | null
  isLoading: boolean
  error: string | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    firstName: string,
    lastName: string,
    phone?: string,
    consents?: { terms: boolean; privacy: boolean; marketing: boolean },
  ) => Promise<{ needsConfirmation: boolean; email: string }>
  signOut: () => Promise<void>
  initialize: () => Promise<void>
  refreshProfile: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  gym_id: null,
  profile: null,
  isLoading: false,
  error: null,
  clearError: () => set({ error: null }),

  signIn: async (email, password) => {
    set({ isLoading: true, error: null })
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      set({ isLoading: false, error: mapError(error.message) })
      throw error
    }
    set({ user: data.user, session: data.session, gym_id: DOPAMINE_GYM_ID, isLoading: false })
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
          role: 'member',
          gym_id: DOPAMINE_GYM_ID,
          preferred_language: 'fr',
          privacy_policy_accepted: String(consents?.privacy ?? false),
          terms_accepted: String(consents?.terms ?? false),
          marketing_consent: String(consents?.marketing ?? false),
        },
      },
    })
    if (error) {
      set({ isLoading: false, error: mapError(error.message) })
      throw error
    }

    const needsConfirmation = !data.session
    if (data.session) {
      set({ user: data.user, session: data.session, gym_id: DOPAMINE_GYM_ID, isLoading: false })
    } else {
      set({ isLoading: false })
    }
    return { needsConfirmation, email }
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut()
    } catch {
      // Continue even if signOut fails
    }
    set({ user: null, session: null, gym_id: null, profile: null, error: null, isLoading: false })
  },

  refreshProfile: async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, phone, avatar_url, noshow_count, suspended_until, marketing_consent, date_of_birth, address_line, emergency_contact_name, member_since')
      .eq('id', user.id)
      .single()
    if (data) {
      set({
        profile: {
          id: data.id,
          firstName: data.first_name ?? '',
          lastName: data.last_name ?? '',
          email: data.email,
          phone: data.phone,
          avatarUrl: data.avatar_url,
          noshowCount: data.noshow_count ?? 0,
          suspendedUntil: data.suspended_until,
          marketingConsent: data.marketing_consent ?? false,
          dateOfBirth: data.date_of_birth,
          addressLine: data.address_line,
          emergencyContactName: data.emergency_contact_name,
          memberSince: data.member_since,
        },
      })
    }
  },

  initialize: async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      set({ user: data.session.user, session: data.session, gym_id: DOPAMINE_GYM_ID })
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        user: session?.user ?? null,
        session,
        gym_id: session ? DOPAMINE_GYM_ID : null,
      })
    })
  },
}))
