import { useState, useEffect, useRef } from 'react'
import { View, Text, Pressable, ActivityIndicator } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import { useTranslation } from 'react-i18next'
import { TextInput } from '../../components/ui/TextInput'
import { supabase } from '../../lib/supabase'

/**
 * Route Universal Link : cible de https://links.viniz.app/dopamine/reset-password#access_token=…
 * (email de reset password — GYM-158, v2 de GYM-157). expo-router mappe par path
 * (/dopamine/* couvert par l'AASA), comme confirm-waitlist (GYM-45).
 *
 * Mécanisme de session recovery (constaté) : le client mobile a detectSessionInUrl:false
 * → on établit la session MANUELLEMENT depuis les tokens du fragment via
 * supabase.auth.setSession (même pattern que le retour OAuth Google, lib/oauth.ts), puis
 * updateUser({ password }). Le fallback web (dashboard /reset-password) utilise, lui,
 * detectSessionInUrl (GYM-157).
 */

const MIN_PASSWORD = 8

type Status = 'checking' | 'ready' | 'invalid' | 'done'

// Parse les tokens/erreur d'une URL de recovery, qu'ils soient dans le fragment (#...) —
// cas standard Supabase implicit flow — ou dans la query (?...).
function parseAuthParams(rawUrl: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!rawUrl) return out
  const collect = (segment: string) => {
    for (const kv of segment.split('&')) {
      if (!kv) continue
      const eq = kv.indexOf('=')
      const key = eq >= 0 ? kv.slice(0, eq) : kv
      const val = eq >= 0 ? kv.slice(eq + 1) : ''
      try { out[decodeURIComponent(key)] = decodeURIComponent(val) } catch { out[key] = val }
    }
  }
  const hashIdx = rawUrl.indexOf('#')
  const qIdx = rawUrl.indexOf('?')
  if (qIdx >= 0) collect(rawUrl.slice(qIdx + 1, hashIdx > qIdx ? hashIdx : undefined))
  if (hashIdx >= 0) collect(rawUrl.slice(hashIdx + 1))
  return out
}

export default function ResetPassword() {
  const { t } = useTranslation()
  const router = useRouter()
  const incomingUrl = Linking.useURL()

  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const establishedRef = useRef(false)

  // Établit la session recovery depuis les tokens du lien (une seule fois).
  useEffect(() => {
    if (establishedRef.current) return
    let cancelled = false

    async function establish() {
      const raw = incomingUrl ?? (await Linking.getInitialURL())
      // Attendre l'URL entrante (useURL peut être null au 1er rendu).
      if (!raw) return
      establishedRef.current = true

      const params = parseAuthParams(raw)
      if (cancelled) return

      if (params.error || params.error_code) {
        setStatus('invalid')
        return
      }
      if (params.access_token && params.refresh_token) {
        const { error: sessErr } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        })
        if (cancelled) return
        setStatus(sessErr ? 'invalid' : 'ready')
        return
      }
      // Pas de tokens : une session recovery a-t-elle déjà été posée ? sinon lien invalide.
      const { data } = await supabase.auth.getSession()
      if (cancelled) return
      setStatus(data.session ? 'ready' : 'invalid')
    }

    establish()
    return () => { cancelled = true }
  }, [incomingUrl])

  // Filet : si aucune URL n'arrive (ouverture directe de l'écran), basculer sur "invalide".
  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus((s) => (s === 'checking' ? 'invalid' : s))
    }, 5000)
    return () => clearTimeout(timer)
  }, [])

  async function handleSubmit() {
    if (saving) return
    setError(null)
    if (password.length < MIN_PASSWORD) {
      setError(t('reset.min_length', { count: MIN_PASSWORD }))
      return
    }
    if (password !== confirm) {
      setError(t('reset.mismatch'))
      return
    }
    setSaving(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) {
        setError(t('reset.error_generic'))
        return
      }
      setStatus('done')
    } catch {
      setError(t('reset.error_generic'))
    } finally {
      setSaving(false)
    }
  }

  // Ne signe out la session recovery qu'au moment où l'utilisateur repart se connecter
  // (évite que la redirection auto de sign-out du _layout masque l'écran de succès).
  async function goToLogin() {
    try { await supabase.auth.signOut() } catch { /* best-effort */ }
    router.replace('/(auth)/login')
  }

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top', 'bottom']}>
      <View className="flex-1 justify-center px-6">
        <View className="items-center mb-8">
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 28, color: '#C8F000', letterSpacing: 2 }}>
            DOPAMINE
          </Text>
        </View>

        {status === 'checking' && (
          <View className="items-center gap-4">
            <ActivityIndicator size="large" color="#C8F000" />
            <Text className="font-dmsans text-sm text-move-text-muted">{t('reset.checking')}</Text>
          </View>
        )}

        {status === 'ready' && (
          <View className="rounded-2xl bg-move-card p-6">
            <Text className="font-dmsans-bold text-lg text-move-dark">{t('reset.title')}</Text>
            <Text className="mt-1 mb-5 font-dmsans text-sm text-move-text-secondary">{t('reset.subtitle')}</Text>

            {error && (
              <View className="mb-4 rounded-xl bg-red-50 px-4 py-3">
                <Text className="font-dmsans text-sm text-red-600">{error}</Text>
              </View>
            )}

            <View className="gap-4">
              <TextInput
                label={t('reset.new_password')}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password-new"
                textContentType="newPassword"
                value={password}
                onChangeText={setPassword}
              />
              <TextInput
                label={t('reset.confirm_password')}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password-new"
                textContentType="newPassword"
                value={confirm}
                onChangeText={setConfirm}
              />
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={saving}
              className={`mt-6 flex-row items-center justify-center rounded-xl bg-move-dark py-3.5 ${saving ? 'opacity-60' : ''}`}
            >
              {saving ? (
                <ActivityIndicator color="#C8F000" />
              ) : (
                <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#C8F000' }}>
                  {t('reset.submit')}
                </Text>
              )}
            </Pressable>
          </View>
        )}

        {status === 'done' && (
          <View className="items-center rounded-2xl bg-move-card p-8">
            <Text className="font-dmsans-bold text-lg text-move-dark">{t('reset.success_title')}</Text>
            <Text className="mt-2 mb-6 text-center font-dmsans text-sm text-move-text-secondary">
              {t('reset.success_message')}
            </Text>
            <Pressable onPress={goToLogin} className="rounded-xl bg-move-dark px-6 py-3.5">
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#C8F000' }}>
                {t('reset.go_login')}
              </Text>
            </Pressable>
          </View>
        )}

        {status === 'invalid' && (
          <View className="items-center rounded-2xl bg-move-card p-8">
            <Text className="font-dmsans-bold text-lg text-move-dark">{t('reset.invalid_title')}</Text>
            <Text className="mt-2 mb-6 text-center font-dmsans text-sm text-move-text-secondary">
              {t('reset.invalid_message')}
            </Text>
            <Pressable onPress={goToLogin} className="rounded-xl bg-move-dark px-6 py-3.5">
              <Text style={{ fontFamily: 'DMSans_700Bold', fontSize: 14, color: '#C8F000' }}>
                {t('reset.go_login')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}
