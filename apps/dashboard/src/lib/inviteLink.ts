// GYM-202 — Reconnaissance d'une arrivée par lien d'INVITATION Supabase.
//
// Constat prod (29/07) : le lien d'invitation N'EST PAS un lien de confirmation inerte —
// il ouvre une VRAIE session. supabase-js (detectSessionInUrl=true par défaut) échange le
// fragment au chargement du client : l'utilisateur est authentifié SANS avoir jamais saisi
// de mot de passe. Le dashboard le voyait connecté, sans gym_id, et le renvoyait vers
// /pending — compte à moitié créé, session ouverte une seule fois, plus aucune reconnexion
// possible faute de mot de passe utilisable.
//
// Ce que dépose exactement un lien d'invitation (après le /verify de GoTrue) :
//   #access_token=<jwt>&expires_at=…&expires_in=3600&refresh_token=…
//   &token_type=bearer&type=invite
// Le discriminant est `type=invite` (un reset dépose `type=recovery`).
//
// Cas d'erreur (lien expiré / déjà consommé), sans access_token NI type :
//   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid…
//
// ⚠️ On lit `initialUrlHash` (capturé au niveau module dans lib/supabase.ts AVANT
// createClient — mécanisme GYM-164) et JAMAIS window.location.hash : supabase-js consomme
// le fragment et nettoie l'URL avant même le montage de React.
import { initialUrlHash } from '@/lib/supabase'

// Ancres de début de paramètre : '#' en tête de fragment ou '&' entre deux paramètres.
// Volontairement plus strict qu'un includes() : un JWT est du base64url et peut contenir
// n'importe quelle sous-chaîne, y compris « error ».
const hasParam = (hash: string, re: RegExp) => re.test(hash)

export interface InviteLink {
  /** `type=invite` présent → arrivée par invitation, à coup sûr. */
  isInvite: boolean
  /** Un access_token était présent : ne JAMAIS conclure « invalide » de façon synchrone. */
  hasToken: boolean
  /** Supabase a explicitement renvoyé une erreur (lien expiré ou déjà consommé). */
  hasError: boolean
}

function parse(hash: string): InviteLink {
  return {
    isInvite: hasParam(hash, /[#&]type=invite(&|$)/),
    hasToken: hasParam(hash, /[#&]access_token=/),
    hasError: hasParam(hash, /[#&]error(_code|_description)?=/),
  }
}

/** Snapshot du fragment d'arrivée. Constant pour toute la durée de vie de la page. */
export const inviteLink: InviteLink = parse(initialUrlHash)

/** Route d'activation. Publique au sens du routeur, mais exige une session valide. */
export const ACTIVATION_PATH = '/welcome'

// Une fois l'activation terminée (ou explicitement abandonnée), le fragment d'arrivée reste
// en mémoire — mais ne doit plus rediriger, sinon /dashboard rebondit en boucle vers /welcome.
let consumed = false
export function markInviteConsumed(): void {
  consumed = true
}

// Routes qui gèrent DÉJÀ leur propre fragment ou n'ont rien à voir avec l'activation.
//
// /reset-password est exclue de façon DÉLIBÉRÉE : les invitations MEMBRE (GYM-144, marque
// Dopamine) y atterrissent et y sont déjà traitées correctement (écran de définition du mot
// de passe + lien de téléchargement de l'app). Intercepter ce parcours enverrait un membre
// sur une page d'activation brandée Viniz — régression. GYM-164 vient d'y être corrigé : on
// n'y touche pas.
const EXCLUDED_PREFIXES = [
  ACTIVATION_PATH,
  // GYM-248 — /signup et /signup/confirmed gèrent leur PROPRE fragment (type=signup, cf.
  // lib/signupLink.ts). Sans cette exclusion, un lien de confirmation expiré atterrissant
  // là serait pris pour une invitation expirée et détourné vers /welcome.
  '/signup',
  '/reset-password',
  '/forgot-password',
  '/legal',
  '/support',
  '/payment',
  '/mollie',
]

/**
 * Faut-il détourner l'arrivée courante vers la page d'activation ?
 *
 * Appelé au-dessus de <Routes> : la décision précède donc TOUTE autre — en particulier la
 * redirection vers /pending décidée par ProtectedRoute quand gym_id est absent.
 */
export function shouldInterceptInvite(pathname: string): boolean {
  if (consumed) return false
  if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false

  // Cas nominal : le fragment porte type=invite, aucune ambiguïté possible.
  if (inviteLink.isInvite) return true

  // Lien d'invitation expiré / déjà consommé : GoTrue ne renvoie alors NI access_token NI
  // type, seulement l'erreur — impossible de distinguer un invite d'un recovery sur le seul
  // fragment. On ne s'en saisit donc QUE sur la racine (Site URL), où un recovery ne peut
  // pas atterrir : les deux envois de reset du dashboard passent un redirectTo explicite
  // vers /reset-password (ForgotPassword.tsx, ResetPassword.tsx) et le dashboard n'a aucun
  // parcours OAuth susceptible de déposer une erreur ici.
  if (inviteLink.hasError && pathname === '/') return true

  return false
}
