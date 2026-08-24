// GYM-248 — Reconnaissance d'une arrivée par lien de CONFIRMATION D'EMAIL.
//
// Même mécanique que lib/inviteLink.ts (GYM-202), et pour la même raison : supabase-js
// (detectSessionInUrl=true) échange le fragment AU CHARGEMENT du client et nettoie l'URL
// avant même le montage de React. On lit donc `initialUrlHash`, capturé au niveau module
// dans lib/supabase.ts AVANT createClient — JAMAIS window.location.hash.
//
// Ce que dépose un lien de confirmation d'inscription (après le /verify de GoTrue) :
//   #access_token=<jwt>&expires_at=…&refresh_token=…&token_type=bearer&type=signup
// Le discriminant est `type=signup` — un invite dépose `type=invite`, un reset
// `type=recovery`. Les trois sont distincts et ne se marchent pas dessus.
//
// Cas d'erreur (lien expiré / déjà consommé), sans access_token NI type :
//   #error=access_denied&error_code=otp_expired&error_description=…
import { initialUrlHash } from '@/lib/supabase'

export interface SignupLink {
  /** `type=signup` présent → arrivée par confirmation d'email, à coup sûr. */
  isSignup: boolean
  /** Un access_token était présent : ne JAMAIS conclure « invalide » de façon synchrone. */
  hasToken: boolean
  /** GoTrue a explicitement renvoyé une erreur (lien expiré ou déjà consommé). */
  hasError: boolean
}

// Ancres de début de paramètre, comme dans inviteLink : un JWT est du base64url et peut
// contenir n'importe quelle sous-chaîne, y compris « error ». Un includes() mentirait.
const hasParam = (hash: string, re: RegExp) => re.test(hash)

export const signupLink: SignupLink = {
  isSignup: hasParam(initialUrlHash, /[#&]type=signup(&|$)/),
  hasToken: hasParam(initialUrlHash, /[#&]access_token=/),
  hasError: hasParam(initialUrlHash, /[#&]error(_code|_description)?=/),
}

/** Route d'atterrissage du lien de confirmation. Passée en emailRedirectTo au signUp. */
export const SIGNUP_CONFIRMED_PATH = '/signup/confirmed'
