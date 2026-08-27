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
import { VINIZ_WORDMARK_SVG } from '../../assets/viniz/brandSvg'

/** Recadrage du wordmark sur l'emprise mesurée de son art (cf. VinizLaunch). */
const WORDMARK_VIEWBOX = '90 574 1275 353'
const WORDMARK_W = 62

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

          {/* ── 🔴 GYM-293 (MITIGATION) — L'INSCRIPTION EST RETIRÉE EN MODE MULTI ───────
              Cet écran n'existe qu'en `multi`, donc retirer le lien ici SUFFIT à rendre
              l'inscription inatteignable de ce côté — et n'affecte pas d'un pixel l'écran
              de Dopamine, qui est un composant distinct (`DopamineLogin`).

              ⚠️ CE QU'ON ÉVITE, ET CE N'EST PAS UNE PRÉCAUTION THÉORIQUE. En `multi`,
              `signupGymId()` rend `null` (stores/useAuthStore.ts) : le trigger
              `handle_new_user` crée alors un profil SANS salle. Le compte existe, la
              session s'ouvre, et l'app est VIDE — aucune requête ne matche, aucun message
              ne l'explique. Le membre a un compte qu'il ne peut pas utiliser et qu'il ne
              peut pas non plus rattacher : le parcours d'inscription rattaché à une salle
              reste à écrire (GYM-293 complet).

              ⚠️ MASQUER PLUTÔT QU'AVERTIR. Un écran d'inscription qui dirait « pas encore
              disponible » serait un cul-de-sac de plus ; l'absence de lien ne promet rien.
              Et la route est gardée de son côté (app/(auth)/signup.tsx) — un lien profond
              ou un retour arrière ne doivent pas rouvrir ce que ce masquage ferme.

              ⚠️ AUCUN AUTRE CHEMIN N'Y MÈNE EN MULTI : cet écran ne porte pas les boutons
              OAuth (vérifié), qui créeraient un compte de la même façon. */}

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

/**
 * La signature Viniz en pied.
 *
 * ⚠️ LE WORDMARK EST RETEINT, ET IL LE FAUT. Son art est du lime #C8FF3D en dur dans le
 * SVG — or le lime ne va que sur fond sombre. Posé tel quel sur une salle aux couleurs
 * claires, il deviendrait illisible : exactement ce que le garde-fou interdit deux lignes
 * plus haut. Une prop `color` de react-native-svg ne suffirait pas — elle n'alimente que
 * `currentColor`, et ces chemins portent un `fill` explicite. On remplace donc la valeur
 * dans le XML, une fois par thème.
 */
function PoweredByViniz() {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const tinted = useMemo(
    () => VINIZ_WORDMARK_SVG.replace(/#c8ff3d/gi, tokens.onBackgroundMuted),
    [tokens.onBackgroundMuted],
  )

  return (
    <View className="flex-row items-center justify-center gap-2 pb-3" style={{ opacity: 0.75 }}>
      <Text className="font-dmsans text-[11px]" style={{ color: tokens.onBackgroundMuted }}>
        {t('branding.powered_by')}
      </Text>
      <SvgXml
        xml={tinted}
        viewBox={WORDMARK_VIEWBOX}
        width={WORDMARK_W}
        height={WORDMARK_W * (353 / 1275)}
      />
    </View>
  )
}
