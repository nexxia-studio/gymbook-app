import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useGymStore } from '@/stores/useGymStore'
import { DEFAULT_TIMEZONE } from '@/lib/timezone'

interface AuthState {
  user: User | null
  session: Session | null
  gym_id: string | null
  role: string | null
  isLoading: boolean
  // true une fois initialize() terminé (session résolue ou confirmée absente).
  // Les gardes de route DOIVENT attendre ce flag : sinon un deep link vers une
  // route protégée est évalué avec session=null pendant l'init async → rebond
  // vers /login puis /dashboard, et la route demandée est perdue.
  initialized: boolean
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

// Charge le gym complet (nom, slug, timezone) dans useGymStore.
// Best-effort : une erreur ici NE DOIT PAS casser le login — le user reste
// connecté, gym reste null et l'UI retombe sur son fallback ('Viniz').
async function loadGymContext(gymId: string | null): Promise<void> {
  if (!gymId) {
    useGymStore.getState().setGym(null)
    return
  }
  const { data, error } = await supabase
    .from('nexxia_gyms')
    .select('id, name, slug, timezone')
    .eq('id', gymId)
    .single()
  if (error || !data) {
    useGymStore.getState().setGym(null)
    return
  }
  useGymStore.getState().setGym({
    id: data.id,
    name: data.name,
    slug: data.slug,
    timezone: data.timezone ?? DEFAULT_TIMEZONE,
  })
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
  initialized: false,
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
    await loadGymContext(profile?.gym_id ?? null)
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
          // GYM-200 §5 — `role` et `gym_id` NE SONT PLUS ENVOYÉS, et ne doivent jamais
          // l'être : handle_new_user() recopie les user_metadata telles quelles, si bien
          // qu'un role:'gym_admin' posé ici s'auto-attribuait le dashboard complet. À
          // défaut, le trigger applique COALESCE(..., 'member') et gym_id NULL.
          // Un accès gérant s'obtient exclusivement par invitation (invite-team-member),
          // où le rôle est décidé et scellé côté serveur par celui qui invite.
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
    useGymStore.getState().setGym(null)
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
      await loadGymContext(profile?.gym_id ?? null)
    }

    // Auth résolue (avec ou sans session) → les gardes peuvent statuer.
    set({ initialized: true })

    // GYM-227 — COHÉRENCE DE L'AFFICHAGE.
    //
    // 🔴 Ce listener ne mettait à jour que `user` et `session`. Sur une déconnexion, il
    // laissait donc `gym_id` et `role` intacts, et useGymStore chargé : l'interface
    // continuait d'afficher un gérant, sa salle et ses menus alors que plus aucun appel ne
    // pouvait aboutir. C'est la moitié invisible du défaut du 12/08 — le 401 était la
    // moitié visible, l'écran qui affirmait le contraire était l'autre.
    //
    // Désormais SIGNED_OUT vide TOUT, y compris la salle : ProtectedRoute voit session
    // null et renvoie vers /login. Une session morte ne laisse aucune coquille à l'écran.
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        useGymStore.getState().setGym(null)
        set({ user: null, session: null, gym_id: null, role: null })
        return
      }

      // TOKEN_REFRESHED / SIGNED_IN / USER_UPDATED — le jeton change, l'identité non.
      // On ne refait PAS la requête profil : elle est déjà faite par initialize() et
      // signIn(), et un renouvellement horaire n'a aucune raison de la rejouer.
      set({ user: session.user, session })
    })
  },
}))
