import { useState, useCallback } from 'react'
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ArrowLeft, MailCheck } from 'lucide-react-native'
import { TextInput } from '../../components/ui/TextInput'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'
import { buildMemberResetPasswordUrl } from '../../lib/gymUrls'
import { useTheme } from '../../lib/theme/ThemeProvider'

export default function ForgotPassword() {
  const { tokens } = useTheme()
  const { t } = useTranslation()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = useCallback(async () => {
    setIsLoading(true)
    // GYM-205 — redirectTo EXPLICITE, obligatoire. Sans lui, Supabase applique son Site URL
    // global, repointé le 29/07 vers le dashboard gérant pour réparer les invitations : le
    // membre recevait un lien vers app.viniz.app → « Espace réservé aux gérants », et se
    // retrouvait définitivement bloqué hors de l'app. L'URL est construite depuis le slug
    // de la salle (jamais en dur), avec repli sur la constante de build.
    const redirectTo = await buildMemberResetPasswordUrl()
    await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    setIsLoading(false)
    setSent(true)
  }, [email])

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.page }} edges={['bottom']}>
      {/* Bande sombre — `text-white/60` reste : un blanc à 60 % n'est pas `onBackground`. */}
      <View className="px-6 pb-16 pt-14" style={{ backgroundColor: tokens.background }}>
        <TouchableOpacity onPress={() => router.back()} className="mb-4 flex-row items-center gap-2">
          <ArrowLeft size={20} color={tokens.onBackground} />
          <Text className="font-dmsans text-sm text-white/60">{t('common.back')}</Text>
        </TouchableOpacity>
        <Text className="font-barlow text-3xl uppercase" style={{ color: tokens.onBackground }}>
          {t('auth.forgot_password_title')}
        </Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView className="-mt-8 flex-1" contentContainerClassName="px-6 pb-6" keyboardShouldPersistTaps="handled">
          <View className="rounded-3xl p-6 shadow-sm" style={{ backgroundColor: tokens.surface }}>
            {sent ? (
              <View className="items-center py-8">
                <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-move-accent/10">
                  {/* GYM-286 — A-1, EN ATTENTE : #9DB800 dit ici un SUCCÈS mais reste un
                      lime de marque. Le cockpit n'a pas tranché. */}
                  <MailCheck size={32} color="#9DB800" />
                </View>
                <Text className="text-center font-dmsans text-sm leading-relaxed" style={{ color: tokens.onSurfaceSecondary }}>
                  {t('auth.forgot_password_success')}
                </Text>
                <TouchableOpacity onPress={() => router.replace('/(auth)/login')} className="mt-6">
                  <Text className="font-dmsans-bold text-sm" style={{ color: tokens.onSurface }}>
                    {t('auth.back_to_login')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="gap-5">
                <Text className="font-dmsans text-sm" style={{ color: tokens.onSurfaceSecondary }}>
                  {t('auth.forgot_password_subtitle')}
                </Text>

                <TextInput
                  label={t('auth.email')}
                  placeholder={t('auth.email_placeholder')}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                />

                <Button
                  title={t('auth.forgot_password_submit')}
                  onPress={handleSubmit}
                  isLoading={isLoading}
                />
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
