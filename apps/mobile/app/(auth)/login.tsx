import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TextInput } from '../../components/ui/TextInput'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { Button } from '../../components/ui/Button'
import { Toast } from '../../components/ui/Toast'
import { OAuthButtons } from '../../components/auth/OAuthButtons'
import { useAuthStore } from '../../stores/useAuthStore'
import { useBiometrics } from '../../hooks/useBiometrics'

export default function Login() {
  const { t } = useTranslation()
  const router = useRouter()
  const { signIn, isLoading, error, clearError } = useAuthStore()
  const {
    isBiometricAvailable, isBiometricEnabled, authenticateWithBiometric,
    getSavedCredentials, getBiometricLabel, enableBiometric,
  } = useBiometrics()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [toastVisible, setToastVisible] = useState(false)

  // Auto-propose biometric login on mount if previously enabled
  useEffect(() => {
    (async () => {
      const available = await isBiometricAvailable()
      const enabled = await isBiometricEnabled()
      if (!available || !enabled) return

      const success = await authenticateWithBiometric()
      if (!success) return

      const creds = await getSavedCredentials()
      if (!creds) return

      try {
        await signIn(creds.email, creds.password)
        router.replace('/(tabs)')
      } catch {
        // Saved creds may be stale — let the user log in manually
      }
    })()
  }, [isBiometricAvailable, isBiometricEnabled, authenticateWithBiometric, getSavedCredentials, signIn, router])

  const offerBiometricSetup = useCallback(async (signedInEmail: string, signedInPassword: string) => {
    const available = await isBiometricAvailable()
    const enabled = await isBiometricEnabled()
    if (!available || enabled) return

    const label = await getBiometricLabel()
    Alert.alert(
      t('auth.biometric.offer_title', { kind: label }),
      t('auth.biometric.offer_message', { kind: label }),
      [
        { text: t('auth.biometric.offer_later'), style: 'cancel' },
        {
          text: t('auth.biometric.offer_enable'),
          onPress: () => { enableBiometric(signedInEmail, signedInPassword) },
        },
      ],
    )
  }, [isBiometricAvailable, isBiometricEnabled, getBiometricLabel, enableBiometric, t])

  const handleSubmit = useCallback(async () => {
    clearError()
    try {
      await signIn(email, password)
      await offerBiometricSetup(email, password)
      router.replace('/(tabs)')
    } catch {
      setToastVisible(true)
    }
  }, [email, password, signIn, clearError, router, offerBiometricSetup])

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['bottom']}>
      <Toast
        message={error ? t(error) : ''}
        visible={toastVisible}
        onHide={() => setToastVisible(false)}
        variant="error"
      />

      {/* Dark header */}
      <View className="bg-move-dark px-6 pb-16 pt-14">
        <Text className="font-barlow text-lg text-white">DOPAMINE</Text>
        <Text className="mt-4 font-barlow text-3xl uppercase text-white">
          {t('auth.login_title')}
        </Text>
      </View>

      {/* Form card */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          className="-mt-8 flex-1"
          contentContainerClassName="px-6 pb-6"
          keyboardShouldPersistTaps="handled"
        >
          <View className="rounded-3xl bg-white p-6 shadow-sm">
            <View className="gap-5">
              <TextInput
                label={t('auth.email')}
                placeholder={t('auth.email_placeholder')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
              />

              <PasswordInput
                label={t('auth.password')}
                placeholder={t('auth.password_placeholder')}
                value={password}
                onChangeText={setPassword}
                autoComplete="password"
              />

              <Button
                title={t('auth.login')}
                onPress={handleSubmit}
                isLoading={isLoading}
              />

              <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
                <Text className="text-center font-dmsans text-sm text-move-text-muted">
                  {t('auth.forgot_password')}
                </Text>
              </TouchableOpacity>

              <OAuthButtons />
            </View>
          </View>

          <TouchableOpacity onPress={() => router.replace('/(auth)/signup')} className="mt-6">
            <Text className="text-center font-dmsans text-sm text-move-text-secondary">
              {t('auth.no_account')}{' '}
              <Text className="font-dmsans-bold text-move-dark">{t('auth.signup')}</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
