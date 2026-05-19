import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import * as QueryParams from 'expo-auth-session/build/QueryParams'
import * as AppleAuthentication from 'expo-apple-authentication'
import { supabase } from './supabase'
import { ensureProfile } from './ensureProfile'

WebBrowser.maybeCompleteAuthSession()

export async function signInWithGoogle(): Promise<void> {
  const redirectUrl = makeRedirectUri({ scheme: 'dopamine', path: 'auth/callback' })

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
  })
  if (error) throw error
  if (!data.url) throw new Error('No OAuth URL returned')

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl)
  if (result.type !== 'success') throw new Error('OAuth cancelled')

  const { params, errorCode } = QueryParams.getQueryParams(result.url)
  if (errorCode) throw new Error(errorCode)

  const { access_token, refresh_token } = params
  if (!access_token || !refresh_token) throw new Error('Missing tokens')

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  })
  if (sessionError) throw sessionError
  if (sessionData.user) await ensureProfile(sessionData.user)
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
    await ensureProfile(data.user)
  }
}

export function isAppleSignInCancelled(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === 'ERR_REQUEST_CANCELED'
}
