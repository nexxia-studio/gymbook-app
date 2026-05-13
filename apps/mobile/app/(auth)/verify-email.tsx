import { useState, useEffect, useCallback } from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MailCheck } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'

export default function VerifyEmail() {
  const { t } = useTranslation()
  const router = useRouter()
  const { email } = useLocalSearchParams<{ email: string }>()

  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleResend = useCallback(async () => {
    if (cooldown > 0 || !email) return
    await supabase.auth.resend({ type: 'signup', email })
    setCooldown(60)
  }, [cooldown, email])

  return (
    <SafeAreaView className="flex-1 items-center justify-center bg-move-bg px-8">
      <View className="mb-6 h-20 w-20 items-center justify-center rounded-3xl bg-move-accent/10">
        <MailCheck size={40} color="#C8F000" />
      </View>

      <Text className="text-center font-barlow text-3xl uppercase text-move-dark">
        {t('auth.verify_email_title')}
      </Text>

      <Text className="mt-4 text-center font-dmsans text-sm leading-relaxed text-move-text-secondary">
        {t('auth.verify_email_message', { email: email ?? '' })}
      </Text>

      <View className="mt-8 w-full">
        <Button
          title={t('auth.back_to_login')}
          onPress={() => router.replace('/(auth)/login')}
        />
      </View>

      <TouchableOpacity onPress={handleResend} disabled={cooldown > 0} className="mt-4">
        <Text className={`text-center font-dmsans text-sm ${cooldown > 0 ? 'text-move-text-muted' : 'text-move-accent-dim'}`}>
          {cooldown > 0
            ? t('auth.resend_cooldown', { seconds: cooldown })
            : t('auth.resend_email')}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}
