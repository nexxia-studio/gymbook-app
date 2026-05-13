import { useState, useCallback } from 'react'
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ArrowLeft, MailCheck } from 'lucide-react-native'
import { TextInput } from '../../components/ui/TextInput'
import { Button } from '../../components/ui/Button'
import { supabase } from '../../lib/supabase'

export default function ForgotPassword() {
  const { t } = useTranslation()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = useCallback(async () => {
    setIsLoading(true)
    await supabase.auth.resetPasswordForEmail(email)
    setIsLoading(false)
    setSent(true)
  }, [email])

  return (
    <SafeAreaView className="flex-1 bg-move-bg" edges={['bottom']}>
      {/* Dark header */}
      <View className="bg-move-dark px-6 pb-16 pt-14">
        <TouchableOpacity onPress={() => router.back()} className="mb-4 flex-row items-center gap-2">
          <ArrowLeft size={20} color="#FFFFFF" />
          <Text className="font-dmsans text-sm text-white/60">{t('common.back')}</Text>
        </TouchableOpacity>
        <Text className="font-barlow text-3xl uppercase text-white">
          {t('auth.forgot_password_title')}
        </Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView className="-mt-8 flex-1" contentContainerClassName="px-6 pb-6" keyboardShouldPersistTaps="handled">
          <View className="rounded-3xl bg-white p-6 shadow-sm">
            {sent ? (
              <View className="items-center py-8">
                <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-move-accent/10">
                  <MailCheck size={32} color="#9DB800" />
                </View>
                <Text className="text-center font-dmsans text-sm leading-relaxed text-move-text-secondary">
                  {t('auth.forgot_password_success')}
                </Text>
                <TouchableOpacity onPress={() => router.replace('/(auth)/login')} className="mt-6">
                  <Text className="font-dmsans-bold text-sm text-move-dark">
                    {t('auth.back_to_login')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="gap-5">
                <Text className="font-dmsans text-sm text-move-text-secondary">
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
