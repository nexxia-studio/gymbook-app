import { useState, useCallback } from 'react'
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TextInput } from '../../components/ui/TextInput'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { PasswordStrength } from '../../components/ui/PasswordStrength'
import { Button } from '../../components/ui/Button'
import { Checkbox } from '../../components/ui/Checkbox'
import { InScreenBanner } from '../../components/ui/InScreenBanner'
import { OAuthButtons } from '../../components/auth/OAuthButtons'
import { useAuthStore } from '../../stores/useAuthStore'

interface FormErrors {
  firstName?: string
  lastName?: string
  email?: string
  password?: string
  passwordConfirm?: string
  terms?: string
  privacy?: string
}

export default function Signup() {
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
    if (password.length < 12) e.password = t('auth.validation.password_min')
    else if (!/[A-Z]/.test(password)) e.password = t('auth.validation.password_uppercase')
    else if (!/[0-9]/.test(password)) e.password = t('auth.validation.password_number')
    else if (!/[^A-Za-z0-9]/.test(password)) e.password = t('auth.validation.password_special')
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

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['bottom']}>
      <InScreenBanner
        message={toastVisible && error ? t(error) : null}
        onHide={() => setToastVisible(false)}
        anchor="top"
        variant="error"
      />

      {/* Dark header */}
      <View className="bg-move-dark px-6 pb-16 pt-14">
        <Text className="font-barlow text-lg text-white">DOPAMINE</Text>
        <Text className="mt-4 font-barlow text-3xl uppercase text-white">
          {t('auth.signup_title')}
        </Text>
      </View>

      {/* Form */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView className="-mt-8 flex-1" contentContainerClassName="px-6 pb-8" keyboardShouldPersistTaps="handled">
          <View className="rounded-3xl bg-white p-6 shadow-sm">
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
                <PasswordStrength password={password} />
              </View>

              <PasswordInput
                label={t('auth.password_confirm')}
                placeholder={t('auth.password_confirm_placeholder')}
                value={passwordConfirm}
                onChangeText={setPasswordConfirm}
                error={errors.passwordConfirm}
              />

              {/* Consents */}
              <View className="gap-3 rounded-2xl border border-move-border p-4">
                <Checkbox checked={terms} onToggle={() => setTerms(!terms)}>
                  <Text className="font-dmsans text-sm text-move-text-secondary">
                    {t('auth.terms_accept')}{' '}
                    {/* Lien tapable : le <Text onPress> imbriqué capture le tap et navigue
                        sans déclencher le toggle de la Checkbox parente. */}
                    <Text
                      className="font-dmsans-bold text-move-dark underline"
                      accessibilityRole="link"
                      onPress={() => router.push('/profile/legal/cgu')}
                    >
                      {t('auth.terms_link')}
                    </Text>
                  </Text>
                </Checkbox>
                {errors.terms && <Text className="font-dmsans text-xs text-red-500">{errors.terms}</Text>}

                <Checkbox checked={privacy} onToggle={() => setPrivacy(!privacy)}>
                  <Text className="font-dmsans text-sm text-move-text-secondary">
                    {t('auth.privacy_accept')}{' '}
                    <Text
                      className="font-dmsans-bold text-move-dark underline"
                      accessibilityRole="link"
                      onPress={() => router.push('/profile/legal/privacy')}
                    >
                      {t('auth.privacy_link')}
                    </Text>
                  </Text>
                </Checkbox>
                {errors.privacy && <Text className="font-dmsans text-xs text-red-500">{errors.privacy}</Text>}

                <Checkbox checked={marketing} onToggle={() => setMarketing(!marketing)}>
                  <Text className="font-dmsans text-sm text-move-text-secondary">
                    {t('auth.marketing_accept')}
                  </Text>
                </Checkbox>
              </View>

              <Button title={t('auth.signup')} onPress={handleSubmit} isLoading={isLoading} />
            </View>
          </View>

          <TouchableOpacity onPress={() => router.replace('/(auth)/login')} className="mt-6">
            <Text className="text-center font-dmsans text-sm text-move-text-secondary">
              {t('auth.already_account')}{' '}
              <Text className="font-dmsans-bold text-move-dark">{t('auth.login')}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
