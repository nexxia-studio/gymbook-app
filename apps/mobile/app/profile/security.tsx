import { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, Pressable, Switch, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Shield, Lock, Fingerprint, ChevronLeft, ChevronRight } from 'lucide-react-native'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { useBiometrics } from '../../hooks/useBiometrics'

function ChangePasswordForm({ onPasswordChanged }: { onPasswordChanged: (newPassword: string) => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const reset = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
    setOpen(false)
  }

  const handleSubmit = useCallback(async () => {
    if (next !== confirm) {
      Alert.alert(t('auth.errors.generic'), t('security.passwords_dont_match'))
      return
    }
    if (next.length < 8) {
      Alert.alert(t('auth.errors.generic'), t('security.password_too_short'))
      return
    }
    setIsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) throw new Error('No user')

      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current,
      })
      if (reauthError) {
        Alert.alert(t('auth.errors.generic'), t('security.wrong_password'))
        return
      }

      const { error } = await supabase.auth.updateUser({ password: next })
      if (error) throw error

      onPasswordChanged(next)

      Alert.alert(t('security.updated_title'), t('security.updated_message'), [
        { text: 'OK', onPress: reset },
      ])
    } catch (err) {
      Alert.alert(t('auth.errors.generic'), (err as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [current, next, confirm, onPasswordChanged, t])

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between py-1"
      >
        <Text className="font-dmsans-medium text-sm text-move-dark">
          {t('security.change_password')}
        </Text>
        <ChevronRight size={16} color="#111111" />
      </Pressable>
    )
  }

  const disabled = isLoading || !current || !next || !confirm

  return (
    <View className="gap-3">
      <PasswordInput
        label={t('security.current_password')}
        value={current}
        onChangeText={setCurrent}
      />
      <PasswordInput
        label={t('security.new_password')}
        value={next}
        onChangeText={setNext}
      />
      <PasswordInput
        label={t('security.confirm_password')}
        value={confirm}
        onChangeText={setConfirm}
      />

      <Button
        title={isLoading ? t('security.updating') : t('security.update_password')}
        onPress={handleSubmit}
        isLoading={isLoading}
        disabled={disabled}
      />

      <Pressable onPress={reset}>
        <Text className="text-center font-dmsans text-sm text-move-text-muted">
          {t('security.cancel')}
        </Text>
      </Pressable>
    </View>
  )
}

export default function SecurityScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const {
    isBiometricAvailable,
    isBiometricEnabled,
    getBiometricLabel,
    enableBiometric,
    disableBiometric,
    getSavedCredentials,
    updateSavedPassword,
  } = useBiometrics()

  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(false)
  const [biometricLabel, setBiometricLabel] = useState('')
  const [toggling, setToggling] = useState(false)

  const refresh = useCallback(async () => {
    const [available, enabled, label] = await Promise.all([
      isBiometricAvailable(),
      isBiometricEnabled(),
      getBiometricLabel(),
    ])
    setBiometricAvailable(available)
    setBiometricEnabled(enabled)
    setBiometricLabel(label)
  }, [isBiometricAvailable, isBiometricEnabled, getBiometricLabel])

  useEffect(() => { refresh() }, [refresh])

  const handleToggleBiometric = useCallback(async () => {
    if (biometricEnabled) {
      Alert.alert(
        t('security.disable_biometric_title', { kind: biometricLabel }),
        t('security.disable_biometric_message'),
        [
          { text: t('security.cancel'), style: 'cancel' },
          {
            text: t('security.disable_biometric_confirm'),
            style: 'destructive',
            onPress: async () => {
              await disableBiometric()
              setBiometricEnabled(false)
            },
          },
        ],
      )
      return
    }

    setToggling(true)
    try {
      const creds = await getSavedCredentials()
      if (!creds) {
        Alert.alert(
          t('security.reconnect_required_title'),
          t('security.reconnect_required_message', { kind: biometricLabel }),
        )
        return
      }
      const success = await enableBiometric(creds.email, creds.password)
      if (success) setBiometricEnabled(true)
    } finally {
      setToggling(false)
    }
  }, [biometricEnabled, biometricLabel, disableBiometric, enableBiometric, getSavedCredentials, t])

  return (
    <SafeAreaView className="flex-1 bg-move-dark" edges={['top']}>
      {/* Header */}
      <View className="flex-row items-center justify-between bg-move-dark px-5 pb-6 pt-3">
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: '#FFFFFF', letterSpacing: 2 }}>
          {t('security.title').toUpperCase()}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView className="flex-1 bg-move-bg" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
        {/* Password section */}
        <View className="gap-4 rounded-2xl bg-move-card p-4">
          <View className="flex-row items-center gap-2">
            <Lock size={20} color="#111111" />
            <Text className="font-dmsans-bold text-base text-move-dark">
              {t('security.password_section')}
            </Text>
          </View>
          <ChangePasswordForm onPasswordChanged={updateSavedPassword} />
        </View>

        {/* Biometric section */}
        {biometricAvailable && (
          <View className="gap-4 rounded-2xl bg-move-card p-4">
            <View className="flex-row items-center gap-2">
              <Fingerprint size={20} color="#111111" />
              <Text className="font-dmsans-bold text-base text-move-dark">
                {t('security.biometric_section', { kind: biometricLabel })}
              </Text>
            </View>
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="font-dmsans-medium text-sm text-move-dark">
                  {t('security.biometric_toggle', { kind: biometricLabel })}
                </Text>
                <Text className="mt-0.5 font-dmsans text-xs text-move-text-muted">
                  {t('security.biometric_subtitle')}
                </Text>
              </View>
              <Switch
                value={biometricEnabled}
                onValueChange={handleToggleBiometric}
                disabled={toggling}
                trackColor={{ true: '#C8F000', false: '#E5E5E5' }}
                thumbColor={biometricEnabled ? '#111111' : '#FFFFFF'}
              />
            </View>
          </View>
        )}

        {/* Security note */}
        <View className="flex-row gap-2 rounded-xl border border-move-border bg-move-bg p-3">
          <Shield size={16} color="#6B6861" />
          <Text className="flex-1 font-dmsans text-xs leading-5 text-move-text-secondary">
            {t('security.note')}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
