import { useCallback } from 'react'
import * as LocalAuthentication from 'expo-local-authentication'
import * as SecureStore from 'expo-secure-store'
import { useTranslation } from 'react-i18next'

const BIOMETRIC_KEY = 'gymbook_biometric_enabled'
const SAVED_EMAIL_KEY = 'gymbook_saved_email'
const SAVED_PASSWORD_KEY = 'gymbook_saved_password'

export type BiometricKind = 'face_id' | 'touch_id' | 'biometric'

export function useBiometrics() {
  const { t } = useTranslation()

  const isBiometricAvailable = useCallback(async (): Promise<boolean> => {
    const compatible = await LocalAuthentication.hasHardwareAsync()
    const enrolled = await LocalAuthentication.isEnrolledAsync()
    return compatible && enrolled
  }, [])

  const getBiometricKind = useCallback(async (): Promise<BiometricKind> => {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync()
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face_id'
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'touch_id'
    return 'biometric'
  }, [])

  const getBiometricLabel = useCallback(async (): Promise<string> => {
    const kind = await getBiometricKind()
    return t(`auth.biometric.kind_${kind}`)
  }, [getBiometricKind, t])

  const isBiometricEnabled = useCallback(async (): Promise<boolean> => {
    const value = await SecureStore.getItemAsync(BIOMETRIC_KEY)
    return value === 'true'
  }, [])

  const enableBiometric = useCallback(async (email: string, password: string): Promise<boolean> => {
    const label = await getBiometricLabel()
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('auth.biometric.enable_prompt', { kind: label }),
      cancelLabel: t('auth.biometric.cancel'),
      fallbackLabel: t('auth.biometric.use_password'),
    })
    if (result.success) {
      await SecureStore.setItemAsync(BIOMETRIC_KEY, 'true')
      await SecureStore.setItemAsync(SAVED_EMAIL_KEY, email)
      await SecureStore.setItemAsync(SAVED_PASSWORD_KEY, password)
    }
    return result.success
  }, [getBiometricLabel, t])

  const disableBiometric = useCallback(async () => {
    await SecureStore.deleteItemAsync(BIOMETRIC_KEY)
    await SecureStore.deleteItemAsync(SAVED_EMAIL_KEY)
    await SecureStore.deleteItemAsync(SAVED_PASSWORD_KEY)
  }, [])

  const authenticateWithBiometric = useCallback(async (): Promise<boolean> => {
    const label = await getBiometricLabel()
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: t('auth.biometric.login_prompt', { kind: label }),
      cancelLabel: t('auth.biometric.use_password'),
      fallbackLabel: t('auth.biometric.use_password'),
    })
    return result.success
  }, [getBiometricLabel, t])

  const getSavedCredentials = useCallback(async (): Promise<{ email: string; password: string } | null> => {
    const email = await SecureStore.getItemAsync(SAVED_EMAIL_KEY)
    const password = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY)
    if (!email || !password) return null
    return { email, password }
  }, [])

  return {
    isBiometricAvailable,
    getBiometricKind,
    getBiometricLabel,
    isBiometricEnabled,
    enableBiometric,
    disableBiometric,
    authenticateWithBiometric,
    getSavedCredentials,
  }
}
