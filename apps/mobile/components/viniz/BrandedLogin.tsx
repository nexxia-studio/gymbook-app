// GYM-102 (3/5) — ÉCRAN 03 « CONNEXION », AUX COULEURS DE LA SALLE.
//
// ⚠️ N'EXISTE QU'EN MODE `multi`. `app/(auth)/login.tsx` aiguille sur `GYM_MODE`, figé à
// la compilation : l'écran de Dopamine n'est pas modifié d'un caractère.
//
// La règle de composition vient de la maquette, écran 03 : « Secondaire de la salle en
// fond, primaire sur l'action. La signature Viniz reste discrète, en pied. » Aucune
// couleur n'est écrite en dur ici — tout passe par les jetons résolus, donc par le
// garde-fou de contraste.
import { useState, useCallback, useMemo } from 'react'
import {
  View, Text, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, Image,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { SvgXml } from 'react-native-svg'
import { TextInput } from '../ui/TextInput'
import { PasswordInput } from '../ui/PasswordInput'
import { InScreenBanner } from '../ui/InScreenBanner'
import { useAuthStore } from '../../stores/useAuthStore'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { clearSelectedGymSlug } from '../../lib/gymResolver'
import { clearCachedBrand } from '../../lib/theme/brand'
import { PoweredByViniz } from './PoweredByViniz'
import { markSignupIntent } from '../../lib/signupIntent'

export function BrandedLogin() {
  const { t } = useTranslation()
  const router = useRouter()
  const { tokens, brand } = useTheme()
  const { signIn, isLoading, error, clearError } = useAuthStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [toastVisible, setToastVisible] = useState(false)

  const handleSubmit = useCallback(async () => {
    clearError()
    try {
      await signIn(email, password)
      router.replace('/(tabs)')
    } catch {
      setToastVisible(true)
    }
  }, [email, password, signIn, clearError, router])

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tokens.background }} edges={['top', 'bottom']}>
      <InScreenBanner
        message={toastVisible && error ? t(error) : null}
        onHide={() => setToastVisible(false)}
        anchor="top"
        variant="error"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-6 pb-6 pt-10"
          keyboardShouldPersistTaps="handled"
        >
          {/* ── EN-TÊTE : la salle se présente ─────────────────────────────────────── */}
          <View className="items-center">
            <GymMark />
            <Text
              className="mt-4 text-center text-2xl"
              style={{ color: tokens.onBackground, fontFamily: 'MuseoModerno' }}
            >
              {brand?.name ?? ''}
            </Text>
          </View>

          <Text
            className="mt-8 font-dmsans-bold text-base"
            style={{ color: tokens.onBackground }}
          >
            {t('auth.login_title')}
          </Text>

          {/* ── FORMULAIRE ─────────────────────────────────────────────────────────── */}
          <View className="mt-5 gap-5">
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

            {/* ⚠️ PAS LE <Button/> COMMUN : ses variantes sont câblées sur les classes
                NativeWind de Dopamine (`bg-move-accent`), résolues à la compilation et donc
                insensibles au thème. Ici l'action porte les jetons résolus — c'est le seul
                endroit de l'écran où la couleur de la salle est vraiment décisive. */}
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={isLoading}
              accessibilityRole="button"
              className="items-center rounded-2xl py-4"
              style={{ backgroundColor: tokens.accent, opacity: isLoading ? 0.6 : 1 }}
            >
              <Text className="font-dmsans-bold text-base" style={{ color: tokens.onAccent }}>
                {t('auth.login')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')}>
              <Text
                className="text-center font-dmsans text-sm"
                style={{ color: tokens.onBackgroundMuted }}
              >
                {t('auth.forgot_password')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── 🔴 GYM-293 — L'INSCRIPTION REVIENT, RATTACHÉE À LA SALLE ───────────────
              Le lien avait été retiré (mitigation #230) parce qu'un compte créé en multi
              naissait SANS salle : l'app s'ouvrait vide, sans rien pour l'expliquer ni le
              corriger. `join_gym_self_serve` comble ce trou, et la réconciliation appelle la
              RPC quand le choix vient d'un signup.

              ⚠️ LE SLUG EST MARQUÉ « CHOIX-SIGNUP » AVANT DE NAVIGUER, et c'est ce qui
              distingue les deux parcours. Un choix de CONNEXION sans adhésion veut dire
              « tu n'es pas membre de cette salle » — l'écran de refus de GYM-301. Un choix
              de SIGNUP sans adhésion veut dire « tu viens de créer ton compte, on te
              rattache ». Même état apparent, deux intentions opposées : sans cette marque,
              la réconciliation ne pourrait pas les distinguer. */}
          <TouchableOpacity
            className="mt-6"
            accessibilityRole="button"
            onPress={async () => {
              await markSignupIntent()
              router.push('/(auth)/signup' as never)
            }}
          >
            <Text className="text-center font-dmsans text-sm" style={{ color: tokens.onBackgroundMuted }}>
              {t('auth.no_account')} <Text style={{ color: tokens.accent }}>{t('auth.signup')}</Text>
            </Text>
          </TouchableOpacity>

          {/* ── GYM-288 — LA SORTIE. ───────────────────────────────────────────────────
              🔴 SANS ELLE, UNE SALLE CHOISIE PAR ERREUR ENFERMAIT LE MEMBRE : le slug
              n'était effacé qu'à la DÉCONNEXION, geste inaccessible à qui n'est pas encore
              connecté. La seule issue constatée sur appareil était de désinstaller l'app.

              ⚠️ ICI, RIEN N'EST ENGAGÉ. Le membre n'est pas authentifié, il n'a pas de
              données dans cette salle, aucun cache serveur ne le concerne : effacer le
              choix local suffit, et c'est pour ça que ce geste est SÛR là où « changer de
              salle » une fois connecté demande une bascule serveur et une purge.

              ⚠️ ON EFFACE AUSSI LA MARQUE EN CACHE. Le slug seul laisserait `viniz.gym_brand`
              en place : la salle suivante s'afficherait aux couleurs de la précédente le
              temps du premier chargement. */}
          <TouchableOpacity
            className="mt-10"
            accessibilityRole="button"
            onPress={async () => {
              await clearCachedBrand()
              await clearSelectedGymSlug()
              router.replace('/gym/select' as never)
            }}
          >
            <Text
              className="text-center font-dmsans text-xs underline"
              style={{ color: tokens.onBackgroundMuted }}
            >
              {t('gym_select.not_my_gym')}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── PIED : « propulsé par Viniz », discret ─────────────────────────────────── */}
      <PoweredByViniz />
    </SafeAreaView>
  )
}

/**
 * Le logo de la salle — ou, à défaut, son NOM.
 *
 * ⚠️ MÊME RÈGLE QUE CÔTÉ SERVEUR. `_shared/gym-branding.ts` (headerHtml) fait déjà
 * exactement cela dans les emails : logo si `logo_url`, sinon le nom composé dans la
 * police d'affichage. Les deux surfaces doivent se ressembler, sans quoi un membre
 * recevrait un email d'une marque et ouvrirait une app d'une autre.
 *
 * ⚠️ ET LE CAS SANS LOGO EST LE CAS NOMINAL : `logo_url` est NULL par défaut, et l'upload
 * de logo depuis le dashboard est encore à faire (GYM-263). Une salle qui vient de
 * s'inscrire n'a donc PAS de logo — le repli n'est pas une rustine, c'est le chemin
 * ordinaire des premiers jours.
 */
function GymMark() {
  const { tokens, brand } = useTheme()

  if (brand?.logoUrl) {
    return (
      <Image
        source={{ uri: brand.logoUrl }}
        style={{ width: 96, height: 96 }}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel={brand.name}
      />
    )
  }

  const initials = (brand?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <View
      className="h-20 w-20 items-center justify-center rounded-3xl"
      style={{ backgroundColor: tokens.surface, borderColor: tokens.border, borderWidth: 1 }}
    >
      <Text
        className="text-2xl"
        style={{ color: tokens.onBackground, fontFamily: 'MuseoModerno' }}
      >
        {initials}
      </Text>
    </View>
  )
}

