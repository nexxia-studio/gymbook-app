// GYM-387 — « Complète ton profil » : le téléphone, obligatoire ; l'email de contact,
// proposé aux seuls comptes dont l'email de connexion est une adresse relais Apple.
//
// ⚠️ PAS DE « PLUS TARD ». La seule autre issue est la déconnexion — sans elle, un membre
// qui ne veut pas donner son numéro serait enfermé dans une app qu'il ne peut ni utiliser
// ni quitter (même raisonnement que LegalAcceptanceScreen).
//
// 🔴 L'EMAIL DE CONTACT N'EST JAMAIS EXIGÉ (règle Apple 4.8). Il part VIDE, et le bouton
// valide sans lui. Seule une adresse SAISIE et mal formée arrête l'envoi.
import { useState } from 'react'
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { TextInput } from '../ui/TextInput'
import { Button } from '../ui/Button'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'
import { useGymName } from '../../hooks/useGymName'
import { usePaysSalle } from '../../hooks/usePaysSalle'
import { cleErreurTelephone, normaliserTelephone } from '../../lib/telephone'
import { estEmailContactValide } from '../../lib/profilComplet'

interface Props {
  /** true quand l'email de connexion est une adresse relais Apple. */
  proposerEmailContact: boolean
  submitting: boolean
  /** Clé i18n de l'échec d'enregistrement, ou `null`. */
  error: string | null
  onSubmit: (valeurs: { phone: string; contactEmail: string | null }) => void
  onSignOut: () => void
}

export function CompleteProfileScreen({ proposerEmailContact, submitting, error, onSubmit, onSignOut }: Props) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const nomSalle = useGymName()
  const pays = usePaysSalle()
  const [phone, setPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [errors, setErrors] = useState<{ phone?: string; contactEmail?: string }>({})

  function submit() {
    const e: { phone?: string; contactEmail?: string } = {}
    const tel = normaliserTelephone(phone, pays)
    if (!tel.ok) e.phone = t(cleErreurTelephone(tel.raison))
    const email = contactEmail.trim()
    if (proposerEmailContact && email && !estEmailContactValide(email)) {
      e.contactEmail = t('profile_completion.contact_email_invalid')
    }
    setErrors(e)
    if (!tel.ok || e.contactEmail) return
    onSubmit({ phone: tel.e164, contactEmail: proposerEmailContact && email ? email : null })
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top']}>
      <View className="px-5 pb-4 pt-3">
        <Text style={{ fontFamily: 'BarlowCondensed_900Black', fontSize: 24, color: tokens.onBackground, letterSpacing: 2 }}>
          {t('profile_completion.title').toUpperCase()}
        </Text>
        <Text className="mt-2 font-dmsans text-sm leading-relaxed" style={{ color: tokens.onSurfaceSecondary }}>
          {t('profile_completion.explanation', { gym: nomSalle })}
        </Text>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
        style={{ backgroundColor: tokens.page }}
      >
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View className="gap-4 rounded-2xl p-4" style={{ backgroundColor: tokens.surface }}>
            <TextInput
              label={t('profile_completion.phone_label')}
              placeholder={t('auth.phone_placeholder')}
              value={phone}
              onChangeText={setPhone}
              error={errors.phone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              editable={!submitting}
            />

            {proposerEmailContact && (
              <TextInput
                label={t('profile_completion.contact_email_label')}
                placeholder={t('profile_completion.contact_email_placeholder')}
                value={contactEmail}
                onChangeText={setContactEmail}
                error={errors.contactEmail}
                helper={t('profile_completion.contact_email_helper')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                editable={!submitting}
              />
            )}
          </View>

          {error && (
            <Text className="font-dmsans text-sm leading-relaxed" style={{ color: SEMANTIC.danger }}>
              {t(error)}
            </Text>
          )}

          <Button title={t('profile_completion.submit')} onPress={submit} isLoading={submitting} />

          <Pressable onPress={onSignOut} disabled={submitting} className="items-center py-3">
            <Text className="font-dmsans text-sm underline" style={{ color: tokens.onBackgroundMuted }}>
              {t('profile_completion.sign_out')}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
