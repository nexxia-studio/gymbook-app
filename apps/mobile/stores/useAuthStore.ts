import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { LEGAL_VERSION } from '../constants/legal/meta'
import { captureEvent, identifyUser, resetAnalytics, setAnalyticsGym } from '../lib/analytics'
import { clearSelectedGymSlug, GYM_MODE, FIXED_GYM_ID } from '../lib/gymResolver'
import { activeGymWriteInFlight } from '../lib/activeGymWrites'
import { buildMemberSignupConfirmUrl } from '../lib/gymUrls'

// GYM-289 — 🔴 LA SEULE RÈGLE DE REMPLISSAGE DE `gym_id`. Elle ne vit qu'ici.
//
// À l'instant où une session s'ouvre, on ne connaît pas encore le profil. Deux réponses,
// et une seule est sûre dans chaque mode :
//
//  · `single` → la constante du build, TOUT DE SUITE. C'est le comportement d'avant ce
//    lot, à l'identique : aucune attente, aucune requête supplémentaire, aucune fenêtre
//    pendant laquelle un écran verrait `null`. Le critère du chantier est que l'app de
//    Nico ne change pas — elle ne change pas.
//
//  · `multi` → `null`, le temps que `refreshProfile` lise `profiles.gym_id`. ⚠️ POSER LA
//    CONSTANTE ICI SERAIT LE BUG QU'ON CORRIGE : elle vaut l'uuid de repli de Dopamine,
//    et chaque écran monté avant le profil interrogerait la salle d'un autre client.
//    Mieux vaut une seconde sans données qu'une seconde avec les mauvaises.
function initialSessionGymId(): string | null {
  return GYM_MODE === 'single' ? FIXED_GYM_ID : null
}

/**
 * GYM-289 — ⚠️ CELLE-CI EST UNE ÉCRITURE, PAS UNE LECTURE. Elle alimente les métadonnées
 * d'inscription, que le trigger `handle_new_user` transforme en `profiles.gym_id` : elle
 * décide dans quelle salle un compte est CRÉÉ.
 *
 * En `single`, valeur inchangée — la salle du build, comme avant ce lot.
 *
 * En `multi`, `null` DÉLIBÉRÉMENT, et c'est un manque assumé : l'app connaît le SLUG
 * choisi, pas l'identifiant de la salle, et aucune fonction publique ne fait la
 * conversion. Poser la constante à la place créerait le compte chez DOPAMINE — un membre
 * d'un client inscrit dans les données d'un autre, ce qui ne se rattrape pas côté app.
 * Un compte sans salle donne une app vide, visible et réparable ; c'est le moins mauvais
 * des deux échecs. Le parcours d'inscription multi-salles reste à écrire.
 */
function signupGymId(): string | null {
  return GYM_MODE === 'single' ? FIXED_GYM_ID : null
}

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
  /**
   * GYM-292 — 🔴 L'UNIQUE ÉCRITURE DE `gym_id` HORS `refreshProfile`, ET ELLE EXIGE UNE
   * CONFIRMATION SERVEUR.
   *
   * Appelée sur une valeur que LE SERVEUR VIENT DE CONFIRMER, et sur rien d'autre. Deux
   * sources la confirment, et elles seules :
   *   · un `switch_active_gym` RÉUSSI — le serveur vient d'écrire ;
   *   · `my_gym_memberships()`, dont `is_active` est lu dans `profiles.gym_id`, la MÊME
   *     colonne que celle qui décide des données (GYM-292b).
   *
   * Poser la valeur ici plutôt que d'attendre une relecture supprime la fenêtre pendant
   * laquelle une lecture partie plus tôt pouvait rétrograder la bascule.
   *
   * ⚠️ NE JAMAIS L'APPELER SUR UN CHOIX PUREMENT LOCAL. Une salle posée sans que le
   * serveur l'ait acceptée, c'est exactement le désaccord que GYM-292 corrige.
   */
  setActiveGymConfirmed: (gymId: string) => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  // GYM-289 — ⚠️ DÈS L'ÉTAT INITIAL, PAS SEULEMENT À L'OUVERTURE DE SESSION. Plusieurs
  // écrans lisent la salle DÉCONNECTÉ (accueil, « mot de passe oublié », profil de la
  // salle). En `single`, la constante doit donc être là avant toute session : c'est le
  // comportement d'avant ce lot, et le laisser à `null` aurait fait disparaître ces
  // lectures-là chez Dopamine. En `multi`, `null` — il n'y a rien de vrai à répondre.
  gym_id: GYM_MODE === 'single' ? FIXED_GYM_ID : null,
  profile: null,
  isLoading: false,
  error: null,
  clearError: () => set({ error: null }),

  // GYM-292 — voir la déclaration ci-dessus. En `single` la salle vient du build et ne
  // bascule jamais : l'appel est sans effet, ce qui évite à l'appelant de tester le mode.
  setActiveGymConfirmed: (gymId) => {
    if (GYM_MODE === 'single') return
    set({ gym_id: gymId })
  },

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
    set({ user: data.user, session: data.session, gym_id: initialSessionGymId(), isLoading: false })
  },

  signUp: async (email, password, firstName, lastName, phone, consents) => {
    set({ isLoading: true, error: null })
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // 🔴 GYM-293 — LE LIEN DE CONFIRMATION DOIT REVENIR CHEZ LA SALLE, pas chez le
        // dashboard gérant. Sans `emailRedirectTo`, Supabase applique son Site URL global —
        // pointé sur le dashboard — et le membre atterrit sur « Espace réservé aux gérants »,
        // bloqué hors de l'app. Même défaut que GYM-205 sur le mot de passe, même correctif :
        // le relais tenant-aware de GYM-287/303, qui porte le slug dans son chemin.
        emailRedirectTo: await buildMemberSignupConfirmUrl(),
        data: {
          first_name: firstName,
          last_name: lastName,
          phone: phone ?? null,
          role: 'member',
          gym_id: signupGymId(),
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
      set({ user: data.user, session: data.session, gym_id: initialSessionGymId(), isLoading: false })
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
    // GYM-102 (2/5) — purge du choix de salle mémorisé localement.
    //
    // ⚠️ SANS ELLE, LE MEMBRE SUIVANT SUR CET APPAREIL ARRIVERAIT DANS LA SALLE DU
    // PRÉCÉDENT. Ce n'est pas une fuite (un slug est public), c'est une confusion de
    // marque : il croirait ouvrir SON app.
    //
    // Sans effet en mode `single` — la fonction s'en assure elle-même — donc rien ne
    // change pour Dopamine. Et volontairement APRÈS le signOut : la session est ce qui
    // compte, une purge locale qui échoue ne doit pas empêcher de se déconnecter.
    await clearSelectedGymSlug()
    // ⚠️ `gym_id` retombe sur l'état INITIAL, pas sur `null` : en `single` la salle du
    // build reste vraie une fois déconnecté, exactement comme avant ce lot.
    set({
      user: null, session: null, profile: null, error: null, isLoading: false,
      gym_id: GYM_MODE === 'single' ? FIXED_GYM_ID : null,
    })
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
      // GYM-289 — `gym_id` AJOUTÉ. C'est la colonne que le serveur tient à jour (salle
      // ACTIVE, GYM-283) et que l'app n'avait jamais demandée : tout le défaut du
      // white-label tenait dans son absence de cette liste.
      .select('id, gym_id, first_name, last_name, email, phone, avatar_url, noshow_count, suspended_until, marketing_consent, date_of_birth, address_line, emergency_contact_name, member_since, access_badge_code')
      .eq('id', user.id)
      .single()
    if (data) {
      // GYM-289 — l'analytique apprend la salle EN MÊME TEMPS que l'app. Sans effet en
      // `single`, où la valeur est juste depuis le démarrage.
      setAnalyticsGym((data.gym_id as string | null) ?? null)
      set({
        // 🔴 EN `single`, LE SERVEUR N'EST PAS LU. Le critère du chantier est que l'app de
        // Dopamine se comporte exactement comme avant ; lire ici une valeur qu'elle n'a
        // jamais lue serait déjà un changement, et un profil dont le gym_id aurait dérivé
        // en base ferait basculer l'app sur une autre salle sans que rien ne le dise.
        //
        // 🔴 GYM-292 — ET PAS DAVANTAGE QUAND UNE ÉCRITURE EST EN VOL. Cette lecture a pu
        // partir AVANT un `switch_active_gym` et revenir APRÈS lui : elle rapporterait
        // alors la salle QUITTÉE et ferait revenir la bascule en arrière toute seule, sous
        // les yeux du membre. Le reste du profil (nom, avatar, badge…) est appliqué
        // normalement — seule la SALLE est protégée, parce qu'elle seule a un écrivain
        // concurrent. Règle complète : lib/activeGymWrites.ts.
        ...(GYM_MODE === 'single' || activeGymWriteInFlight()
          ? {}
          : { gym_id: (data.gym_id as string | null) ?? null }),
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
      set({ user: data.session.user, session: data.session, gym_id: initialSessionGymId() })
      // PostHog identify avec l'UUID interne Supabase (jamais l'email — RGPD).
      identifyUser(data.session.user.id)
    }
    // 🔴 GYM-292 — CET ABONNEMENT ÉCRASAIT LA SALLE ACTIVE À CHAQUE ÉVÉNEMENT.
    //
    // Il posait `gym_id: session ? initialSessionGymId() : …`, et `initialSessionGymId()`
    // rend `null` en mode multi. Or `onAuthStateChange` ne se déclenche pas qu'à la
    // connexion : `TOKEN_REFRESHED` arrive périodiquement, `USER_UPDATED` après toute
    // modification du compte. Chacun remettait la salle à `null` — l'app perdait ses
    // données sans qu'aucun geste du membre ne l'explique, jusqu'au refresh suivant.
    //
    // La salle n'est donc réinitialisée que quand elle DOIT l'être :
    //   · plus de session      → retour à l'état initial (déconnexion) ;
    //   · un AUTRE utilisateur → la salle du précédent n'a plus aucun sens ;
    //   · même utilisateur     → on ne touche à rien, la salle résolue reste vraie.
    supabase.auth.onAuthStateChange((_event, session) => {
      const precedent = useAuthStore.getState().user?.id ?? null
      const suivant = session?.user?.id ?? null
      const memeUtilisateur = precedent !== null && precedent === suivant

      set({
        user: session?.user ?? null,
        session,
        ...(session && memeUtilisateur
          ? {}
          : { gym_id: session ? initialSessionGymId() : (GYM_MODE === 'single' ? FIXED_GYM_ID : null) }),
      })
      if (session?.user) identifyUser(session.user.id)
      else resetAnalytics()
    })
  },
}))
