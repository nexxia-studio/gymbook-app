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
import { SEMANTIC } from '../../lib/theme/semantic'
import { GYM_MODE } from '../../lib/gymResolver'
import { PoweredByViniz } from '../../components/viniz/PoweredByViniz'

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
          {/* 🔴 GYM-304 — ENCRE RÉSOLUE, OPACITÉ CONSERVÉE. `text-white/60` était un BLANC EN
              DUR posé sur `tokens.background` : illisible dès que la salle a un fond clair.
              Mesuré sur le fond constaté #E9E8E8 — un blanc à 60 % y disparaît.
              
              ⚠️ `tokens.onBackground`, PAS `onBackgroundMuted` — c'est toute la leçon de la PR
              #235. `onBackgroundMuted` est choisi par le MODE (`hslLightness > 80`), un critère
              qui classe « sombre » un fond vif : il descend sous 3:1 sur 7 000 salles sur
              19 600. `onBackground`, lui, est choisi par `bestInkOn`, c'est-à-dire par le
              CONTRASTE RÉEL. Le critère est la luminance, jamais la teinte.
              
              ⚠️ L'ALPHA EST CONSERVÉ : 0x99 = 153, soit 153/255 = 0,60 pile. Chez Dopamine
              `onBackground` vaut #FFFFFF — le rendu est donc le blanc à 60 % d'aujourd'hui, au
              pixel. C'est le motif A-10, comme les en-têtes de #232 (3c). */}
          <Text className="font-dmsans text-sm" style={{ color: tokens.onBackground + '99' }}>
            {t('common.back')}
          </Text>
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
                  {/* 🔴 GYM-290 (décision C, A-1) — SCISSION : c'est un SUCCÈS (le mail
                      est parti), donc `SEMANTIC.success`. Change un pixel chez Dopamine,
                      exclusion de parité motivée « décision C ». */}
                  <MailCheck size={32} color={SEMANTIC.success} />
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

      {/* 🔴 GYM-303 — LE MOT-MARQUE VINIZ SUR L'ÉCRAN DE DEMANDE DE RÉINITIALISATION.
          C'est le point de départ d'un parcours qui se poursuit hors de l'app — email,
          navigateur, page web — et où la marque Viniz apparaît désormais partout. Sans lui,
          le membre partait d'un écran anonyme pour arriver sur des pages signées.

          ⚠️ COMPOSANT RÉUTILISÉ, PAS RECOPIÉ : c'est celui extrait au lot GYM-301, avec sa
          règle de teinte du lot GYM-302 (le lime seulement là où il est lisible). Une
          seconde signature aurait divergé de la première au premier changement de charte.

          ⚠️ MULTI SEULEMENT. En single, l'app est celle de Dopamine : y ajouter une
          signature Viniz changerait l'app de production, ce que le cadrage interdit — et
          la parité le vérifie. */}
      {GYM_MODE === 'multi' ? <PoweredByViniz /> : null}
    </SafeAreaView>
  )
}
