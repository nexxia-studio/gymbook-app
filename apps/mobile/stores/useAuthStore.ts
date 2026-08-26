import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { GYM_ID } from '../constants/dopamine'
import { LEGAL_VERSION } from '../constants/legal/meta'
import { captureEvent, identifyUser, resetAnalytics } from '../lib/analytics'

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
  /**
   * GYM-224 — code du badge physique qui ouvre la porte de la salle.
   *
   * ⚠️ LECTURE SEULE. Le membre le LIT, il ne le modifie jamais : la colonne est
   * volontairement absente du GRANT UPDATE de GYM-203, donc toute écriture depuis l'app
   * serait refusée par Postgres. Sa saisie appartient au gérant (admin-update-member).
   * NULL = aucun badge attribué, ce qui est un état normal.
   */
  accessBadgeCode: string | null
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
      // GYM-273 — `reason` est la CLÉ i18n déjà calculée par `mapError`, donc une valeur
      // d'un ensemble fermé. ⚠️ Jamais `error.message` brut : c'est du texte libre venu de
      // GoTrue, qui peut contenir l'adresse email — et la convention du lot l'interdit.
      captureEvent('login_failed', { reason: mapError(error.message) })
      set({ isLoading: false, error: mapError(error.message) })
      throw error
    }
    captureEvent('login_succeeded')
    set({ user: data.user, session: data.session, gym_id: GYM_ID, isLoading: false })
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
          gym_id: GYM_ID,
          preferred_language: 'fr',
          privacy_policy_accepted: String(consents?.privacy ?? false),
          terms_accepted: String(consents?.terms ?? false),
          marketing_consent: String(consents?.marketing ?? false),
          // Version des textes acceptés — lue par le trigger DB handle_new_user()
          // (NEW.raw_user_meta_data->>'legal_version') pour poser
          // privacy_policy_version / terms_version sur le profil (GYM-109). Clé exacte requise.
          legal_version: LEGAL_VERSION,
        },
      },
    })
    if (error) {
      set({ isLoading: false, error: mapError(error.message) })
      throw error
    }

    // GYM-273 — `needs_confirmation` distingue les deux issues d'une inscription : compte
    // utilisable tout de suite, ou en attente de l'email de confirmation. C'est la
    // première marche de l'entonnoir d'activation, et elle n'était pas mesurée.
    const needsConfirmation = !data.session
    captureEvent('signup_completed', { needs_confirmation: needsConfirmation })
    if (data.session) {
      set({ user: data.user, session: data.session, gym_id: GYM_ID, isLoading: false })
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
      // GYM-224 — access_badge_code AJOUTÉ ICI. ⚠️ C'est le piège de GYM-216 et GYM-220 :
      // la colonne peut exister en base, la migration passer, l'écran être écrit — si le
      // SELECT ne la demande pas, elle reste indéfiniment vide et le défaut se cherche
      // partout sauf ici. Ce SELECT est la SEULE source de MemberProfile.
      .select('id, first_name, last_name, email, phone, avatar_url, noshow_count, suspended_until, marketing_consent, date_of_birth, address_line, emergency_contact_name, member_since, access_badge_code')
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
          accessBadgeCode: data.access_badge_code,
        },
      })
    }
  },

  initialize: async () => {
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      set({ user: data.session.user, session: data.session, gym_id: GYM_ID })
      // PostHog identify avec l'UUID interne Supabase (jamais l'email — RGPD).
      identifyUser(data.session.user.id)
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      set({
        user: session?.user ?? null,
        session,
        gym_id: session ? GYM_ID : null,
      })
      if (session?.user) identifyUser(session.user.id)
      else resetAnalytics()
    })
  },
}))
