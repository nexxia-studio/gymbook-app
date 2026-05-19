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
  }
}

export function isAppleSignInCancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ERR_REQUEST_CANCELED'
}
