import { useState, useEffect, useCallback } from 'react'
import { View, Text, TouchableOpacity } from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MailCheck } from 'lucide-react-native'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/ui/Button'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

export default function VerifyEmail() {
  const { tokens } = useTheme()
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
    <SafeAreaView className="flex-1 items-center justify-center px-8" style={{ backgroundColor: tokens.page }}>
      <View className="mb-6 h-20 w-20 items-center justify-center rounded-3xl bg-move-accent/10">
        <MailCheck size={40} color={tokens.accent} />
      </View>

      <Text className="text-center font-barlow text-3xl uppercase" style={{ color: tokens.onSurface }}>
        {t('auth.verify_email_title')}
      </Text>

      <Text className="mt-4 text-center font-dmsans text-sm leading-relaxed" style={{ color: tokens.onSurfaceSecondary }}>
        {t('auth.verify_email_message', { email: email ?? '' })}
      </Text>

      <View className="mt-8 w-full">
        <Button
          title={t('auth.back_to_login')}
          onPress={() => router.replace('/(auth)/login')}
        />
      </View>

      <TouchableOpacity onPress={handleResend} disabled={cooldown > 0} className="mt-4">
        {/* 🔴 GYM-290 (décision C, A-1) — SCISSION : le renvoi REDEVENU POSSIBLE est un
            succès, pas la marque. Change un pixel chez Dopamine (#9DB800 → #22C55E),
            exclusion de parité motivée « décision C ». */}
        {/* ⚠️ `style` AVANT `className`, et ce n'est pas cosmétique : `verify-screen-parity`
            compare les couleurs DANS L'ORDRE DU SOURCE. La branche migrée (le gris) doit
            donc apparaître avant la branche laissée en dur (le lime), comme dans le
            fichier d'origine. */}
        <Text
          style={{ color: cooldown > 0 ? tokens.onBackgroundMuted : SEMANTIC.success }}
          className="text-center font-dmsans text-sm"
        >
          {cooldown > 0
            ? t('auth.resend_cooldown', { seconds: cooldown })
            : t('auth.resend_email')}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}
