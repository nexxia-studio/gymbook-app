import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import * as AppleAuthentication from 'expo-apple-authentication'
import Constants from 'expo-constants'
import { supabase } from './supabase'
import { ensureProfile, checkRoleAndEnsureProfile } from './ensureProfile'

WebBrowser.maybeCompleteAuthSession()

const isExpoGo = Constants.appOwnership === 'expo'

export function getRedirectUri(): string {
  if (isExpoGo) {
    return makeRedirectUri({
      scheme: 'exp',
      path: 'auth/callback',
      preferLocalhost: false,
      isTripleSlashed: true,
    })
  }
  return makeRedirectUri({ scheme: 'dopamine', path: 'auth/callback' })
}

function parseTokensFromUrl(callbackUrl: string): { access_token: string | null; refresh_token: string | null } {
  const url = new URL(callbackUrl)
  const fragment = url.hash ? new URLSearchParams(url.hash.slice(1)) : null
  const query = url.searchParams
  return {
    access_token: fragment?.get('access_token') ?? query.get('access_token'),
    refresh_token: fragment?.get('refresh_token') ?? query.get('refresh_token'),
  }
}

export type OAuthResult = { success: true } | { success: false; cancelled: true }

export async function signInWithGoogle(): Promise<OAuthResult> {
  const redirectUrl = getRedirectUri()
  console.log('[OAuth] Redirect URL:', redirectUrl)

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
  })
  if (error) throw error
  if (!data.url) throw new Error('No OAuth URL returned')

  console.log('[OAuth] Opening:', data.url)
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl, { showInRecents: true })
  console.log('[OAuth] Result type:', result.type)

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { success: false, cancelled: true }
  }
  if (result.type !== 'success' || !result.url) {
    throw new Error(`OAuth flow failed: ${result.type}`)
  }

  console.log('[OAuth] Callback URL:', result.url)
  const { access_token, refresh_token } = parseTokensFromUrl(result.url)
  console.log('[OAuth] Tokens found:', !!access_token, !!refresh_token)

  if (!access_token || !refresh_token) throw new Error('Missing tokens')

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  })
  if (sessionError) throw sessionError
  if (sessionData.user) await checkRoleAndEnsureProfile(sessionData.user)
  return { success: true }
}

/**
 * Sign in with Apple — conforme App Store Guideline 4 (GYM-149).
 *
 * Verrou anti-2e-rejet : ce flux ne DOIT JAMAIS ouvrir un écran de complétion
 * qui force la saisie du nom/email après Apple.
 * - Apple ne renvoie `fullName` qu'au 1er login → on le capte ici et on le
 *   fusionne dans user_metadata si absent (best effort, silencieux).
 * - `checkRoleAndEnsureProfile` crée le profil sans champ obligatoire côté UI.
 * - L'appelant (OAuthButtons.handleApple) redirige directement vers /(tabs).
 * La complétion de profil reste OPTIONNELLE et user-initiated dans /(tabs)/profile
 * et /profile/edit — ne pas la rendre bloquante.
 */
export async function signInWithApple(): Promise<void> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
  })

  const { identityToken, fullName } = credential
  if (!identityToken) throw new Error('No identity token')

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
  })
  if (error) throw error

  if (data.user) {
    // Apple only returns fullName on the first sign-in. Merge into user_metadata if missing.
    if (fullName?.givenName && !data.user.user_metadata?.first_name) {
      await supabase.auth.updateUser({
        data: {
          first_name: fullName.givenName,
          last_name: fullName.familyName ?? '',
          full_name: `${fullName.givenName} ${fullName.familyName ?? ''}`.trim(),
        },
      })
    }
    await checkRoleAndEnsureProfile(data.user)
    await healAppleProfileName(data.user.id, fullName)
  }
}

/**
 * GYM-150 volet B — heal du profil Apple.
 *
 * Apple ne fournit `fullName` (givenName/familyName) qu'à la 1re authentification,
 * et JAMAIS dans l'id_token — seul le client le reçoit via `credential.fullName`.
 * Le trigger DB handle_new_user() a donc pu créer le profil avec first_name/last_name
 * vides. Ici, une fois le profil garanti existant, si Apple nous a donné le nom ET
 * que la ligne `profiles` est vide → on complète directement la table.
 * Best-effort : ne bloque jamais le login (log silencieux si l'UPDATE échoue).
 * RLS `id = auth.uid()` autorise cet UPDATE par l'utilisateur lui-même.
 */
async function healAppleProfileName(
  userId: string,
  fullName: AppleAuthentication.AppleAuthenticationFullName | null,
): Promise<void> {
  if (!fullName?.givenName && !fullName?.familyName) return
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('first_name')
      .eq('id', userId)
      .maybeSingle()

    // On ne heal que si le profil existe et que first_name est vide/null.
    if (!profile || (profile.first_name && profile.first_name.trim() !== '')) return

    await supabase
      .from('profiles')
      .update({
        first_name: fullName.givenName ?? '',
        last_name: fullName.familyName ?? '',
      })
      .eq('id', userId)
  } catch (e) {
    console.error('[OAuth] healAppleProfileName failed (non-blocking)', e)
  }
}

export function isAppleSignInCancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ERR_REQUEST_CANCELED'
}
