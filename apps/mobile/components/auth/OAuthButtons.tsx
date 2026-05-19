import { useCallback } from 'react'
import { View, Text, Pressable, Platform, Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import * as AppleAuthentication from 'expo-apple-authentication'
import { signInWithGoogle, signInWithApple, isAppleSignInCancelled } from '../../lib/oauth'
import { ADMIN_ACCOUNT_ERROR } from '../../lib/ensureProfile'

export function OAuthButtons() {
  const { t } = useTranslation()
  const router = useRouter()

  const handleGoogle = useCallback(async () => {
    try {
      const result = await signInWithGoogle()
      if (result.success) router.replace('/(tabs)')
    } catch (err) {
      const message = (err as Error).message ?? ''
      if (message === ADMIN_ACCOUNT_ERROR) {
        Alert.alert(t('auth.admin_account_title'), t('auth.admin_account_message'))
        return
      }
      console.error('[Google OAuth]', err)
      Alert.alert(t('auth.errors.generic'), t('auth.google_error'))
    }
  }, [router, t])

  const handleApple = useCallback(async () => {
    try {
      await signInWithApple()
      router.replace('/(tabs)')
    } catch (err) {
      if (isAppleSignInCancelled(err)) return
      const message = (err as Error).message ?? ''
      if (message === ADMIN_ACCOUNT_ERROR) {
        Alert.alert(t('auth.admin_account_title'), t('auth.admin_account_message'))
        return
      }
      console.error('[Apple Sign In]', err)
      Alert.alert(t('auth.errors.generic'), t('auth.apple_error'))
    }
  }, [router, t])

  return (
    <View className="gap-2">
      {/* Divider */}
      <View className="my-4 flex-row items-center gap-3">
        <View className="h-px flex-1 bg-move-border" />
        <Text className="font-dmsans text-xs uppercase text-move-text-muted">
          {t('auth.or')}
        </Text>
        <View className="h-px flex-1 bg-move-border" />
      </View>

      {/* Google */}
      <Pressable
        onPress={handleGoogle}
        className="flex-row items-center justify-center gap-3 rounded-xl border border-move-border bg-white px-6 py-3.5"
      >
        <View
          className="h-5 w-5 items-center justify-center rounded"
          style={{ backgroundColor: '#FFFFFF' }}
        >
          <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 16, color: '#4285F4' }}>G</Text>
        </View>
        <Text className="font-dmsans-medium text-base text-move-dark">
          {t('auth.continue_with_google')}
        </Text>
      </Pressable>

      {/* Apple — iOS only */}
      {Platform.OS === 'ios' && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={12}
          style={{ width: '100%', height: 50 }}
          onPress={handleApple}
        />
      )}
    </View>
  )
}
