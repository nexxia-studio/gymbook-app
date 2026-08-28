import { useState, useCallback } from 'react'
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TextInput } from '../../components/ui/TextInput'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { PasswordRules } from '../../components/ui/PasswordRules'
import { Button } from '../../components/ui/Button'
import { validatePassword } from '../../lib/passwordPolicy'
import { Checkbox } from '../../components/ui/Checkbox'
import { InScreenBanner } from '../../components/ui/InScreenBanner'
import { OAuthButtons } from '../../components/auth/OAuthButtons'
import { useAuthStore } from '../../stores/useAuthStore'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { useGymName } from '../../hooks/useGymName'
import { GYM_MODE } from '../../lib/gymResolver'

interface FormErrors {
  firstName?: string
  lastName?: string
  email?: string
  password?: string
  passwordConfirm?: string
  terms?: string
  privacy?: string
}

// GYM-239 — MÊME MINIMUM QUE LE SERVEUR : 8 caractères (Supabase Auth, prod).
//
// L'inscription exigeait 12 là où le serveur se contente de 8. Personne ne pouvait dire
// d'où venait l'écart : le commentaire invoquait un « miroir de la politique serveur »
// pour justifier une valeur qui, précisément, ne la reflétait pas. Un membre de salle de
// sport n'est pas un utilisateur technique, et cette sévérité gratuite se payait à
// l'endroit le plus coûteux du produit — la création de compte.
//
// ⚠️ SEUL LE NOMBRE BAISSE. Les quatre règles de caractères (minuscule, majuscule,
// chiffre, spécial) sont conservées : c'est la longueur qui bloquait inutilement, pas la
// complexité. `validatePassword` les applique toutes, quel que soit ce minimum.
const SIGNUP_MIN_LENGTH = 8

export default function Signup() {
  // 🔴 GYM-293b — LA SALLE DE CONTEXTE, ET UN REPLI QUI NE NOMME PERSONNE.
  // `useGymName()` retombait sur « Dopamine Performance Club » : sur cet écran, où le membre
  // n'est par définition PAS connecté, ce repli n'était pas transitoire — il était l'état
  // permanent, et un candidat de n'importe quelle salle s'inscrivait sous l'en-tête de
  // Dopamine. Le hook lit désormais la MARQUE (chargée avant la connexion, c'est sa raison
  // d'être) et retombe sur la plateforme, jamais sur un client.
  const nomSalle = useGymName()
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()
  const { signUp, isLoading, error, clearError } = useAuthStore()

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [toastVisible, setToastVisible] = useState(false)

  function validate(): boolean {
    const e: FormErrors = {}
    if (!firstName.trim()) e.firstName = t('auth.validation.first_name_required')
    if (!lastName.trim()) e.lastName = t('auth.validation.last_name_required')
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = t('auth.validation.email_invalid')
    const pw = validatePassword(password, SIGNUP_MIN_LENGTH)
    if (!pw.valid) {
      const missing = pw.failed.map((id) => t(`auth.password_rules.${id}`, { count: SIGNUP_MIN_LENGTH })).join(' · ')
      e.password = `${t('auth.password_errors.missing_prefix')} ${missing}`
    }
    if (password !== passwordConfirm) e.passwordConfirm = t('auth.validation.password_mismatch')
    if (!terms) e.terms = t('auth.terms_required')
    if (!privacy) e.privacy = t('auth.privacy_required')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = useCallback(async () => {
    clearError()
    if (!validate()) return
    try {
      const { needsConfirmation, email: signupEmail } = await signUp(
        email, password, firstName.trim(), lastName.trim(),
        phone.trim() || undefined,
        { terms, privacy, marketing },
      )
      if (needsConfirmation) {
        router.replace({ pathname: '/(auth)/verify-email', params: { email: signupEmail } })
      } else {
        router.replace('/(tabs)')
      }
    } catch {
      setToastVisible(true)
    }
  }, [email, password, firstName, lastName, phone, terms, privacy, marketing, signUp, clearError, router])

  // ── 🔴 GYM-293 — LA ROUTE ROUVRE EN MULTI, PARCE QUE LE RATTACHEMENT EXISTE ───────
  //
  // Elle avait été fermée (mitigation #230) pour une raison précise : en `multi`,
  // `signupGymId()` rend `null`, le trigger crée un profil SANS salle, et le membre repart
  // avec un compte inutilisable qu'il ne pouvait pas rattacher — le chemin de rattachement
  // n'existait pas.
  //
  // Il existe maintenant : `join_gym_self_serve(p_slug)`. La réconciliation d'ouverture de
  // session l'appelle quand le choix vient d'un SIGNUP et que le compte n'a aucune adhésion
  // (voir lib/activeGymSession.ts). La porte peut donc se rouvrir : ce qu'elle ouvrait sur
  // un cul-de-sac ouvre désormais sur un parcours complet.
  //
  // ⚠️ RIEN NE CHANGE EN `single`. La mitigation ne visait que le multi, et sa levée non
  // plus : l'inscription de Dopamine n'a jamais été touchée, dans un sens comme dans l'autre.

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.page }} edges={['bottom']}>
      <InScreenBanner
        message={toastVisible && error ? t(error) : null}
        onHide={() => setToastVisible(false)}
        anchor="top"
        variant="error"
      />

      {/* Dark header */}
      <View className="px-6 pb-16 pt-14" style={{ backgroundColor: tokens.background }}>
        {/* GYM-297 — le nom de la salle ACTIVE. Cet écran n'a AUCUN aiguillage de mode :
            il est le même en single et en multi, et il écrivait « DOPAMINE » en dur — un
            membre de Studio Yoga créait donc son compte sous l'en-tête d'un autre club. */}
        <Text className="font-barlow text-lg" style={{ color: tokens.onBackground }}>{nomSalle.toUpperCase()}</Text>
        <Text className="mt-4 font-barlow text-3xl uppercase" style={{ color: tokens.onBackground }}>
          {t('auth.signup_title')}
        </Text>
      </View>

      {/* Form */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView className="-mt-8 flex-1" contentContainerClassName="px-6 pb-8" keyboardShouldPersistTaps="handled">
          <View className="rounded-3xl p-6 shadow-sm" style={{ backgroundColor: tokens.surface }}>
            <View className="gap-4">
              {/* OAuth en haut (fix rejet App Store Guideline 4 — GYM-149) :
                  Sign in with Apple / Google au-dessus du formulaire d'inscription. */}
              <OAuthButtons position="top" />

              {/* Name row */}
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <TextInput
                    label={t('auth.first_name')}
                    placeholder={t('auth.first_name_placeholder')}
                    value={firstName}
                    onChangeText={setFirstName}
                    error={errors.firstName}
                    autoComplete="given-name"
                  />
                </View>
                <View className="flex-1">
                  <TextInput
                    label={t('auth.last_name')}
                    placeholder={t('auth.last_name_placeholder')}
                    value={lastName}
                    onChangeText={setLastName}
                    error={errors.lastName}
                    autoComplete="family-name"
                  />
                </View>
              </View>

              <TextInput
                label={t('auth.email')}
                placeholder={t('auth.email_placeholder')}
                value={email}
                onChangeText={setEmail}
                error={errors.email}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />

              <TextInput
                label={t('auth.phone')}
                placeholder={t('auth.phone_placeholder')}
                value={phone}
                onChangeText={setPhone}
                helper={t('auth.phone_optional')}
                keyboardType="phone-pad"
                autoComplete="tel"
              />

              <View className="gap-2">
                <PasswordInput
                  label={t('auth.password')}
                  placeholder={t('auth.password_placeholder')}
                  value={password}
                  onChangeText={setPassword}
                  error={errors.password}
                />
                <PasswordRules password={password} minLength={SIGNUP_MIN_LENGTH} />
              </View>

              <PasswordInput
                label={t('auth.password_confirm')}
                placeholder={t('auth.password_confirm_placeholder')}
                value={passwordConfirm}
                onChangeText={setPasswordConfirm}
                error={errors.passwordConfirm}
              />

              {/* Consents */}
              <View className="gap-3 rounded-2xl border p-4" style={{ borderColor: tokens.border }}>
                <Checkbox checked={terms} onToggle={() => setTerms(!terms)}>
                  <Text className="font-dmsans text-sm" style={{ color: tokens.onSurfaceSecondary }}>
                    {t('auth.terms_accept')}{' '}
                    {/* Lien tapable : le <Text onPress> imbriqué capture le tap et navigue
                        sans déclencher le toggle de la Checkbox parente. */}
                    <Text
                      className="font-dmsans-bold underline"
                      style={{ color: tokens.onSurface }}
                      accessibilityRole="link"
                      onPress={() => router.push('/profile/legal/cgu')}
                    >
                      {t('auth.terms_link')}
                    </Text>
                  </Text>
                </Checkbox>
                {errors.terms && <Text className="font-dmsans text-xs" style={{ color: SEMANTIC.danger }}>{errors.terms}</Text>}

                <Checkbox checked={privacy} onToggle={() => setPrivacy(!privacy)}>
                  <Text className="font-dmsans text-sm" style={{ color: tokens.onSurfaceSecondary }}>
                    {t('auth.privacy_accept')}{' '}
                    <Text
                      className="font-dmsans-bold underline"
                      style={{ color: tokens.onSurface }}
                      accessibilityRole="link"
                      onPress={() => router.push('/profile/legal/privacy')}
                    >
                      {t('auth.privacy_link')}
                    </Text>
                  </Text>
                </Checkbox>
                {errors.privacy && <Text className="font-dmsans text-xs" style={{ color: SEMANTIC.danger }}>{errors.privacy}</Text>}

                <Checkbox checked={marketing} onToggle={() => setMarketing(!marketing)}>
                  <Text className="font-dmsans text-sm" style={{ color: tokens.onSurfaceSecondary }}>
                    {t('auth.marketing_accept', { gym: nomSalle })}
                  </Text>
                </Checkbox>
              </View>

              <Button title={t('auth.signup')} onPress={handleSubmit} isLoading={isLoading} />
            </View>
          </View>

          <TouchableOpacity onPress={() => router.replace('/(auth)/login')} className="mt-6">
            <Text className="text-center font-dmsans text-sm" style={{ color: tokens.onSurfaceSecondary }}>
              {t('auth.already_account')}{' '}
              <Text className="font-dmsans-bold" style={{ color: tokens.onSurface }}>{t('auth.login')}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
