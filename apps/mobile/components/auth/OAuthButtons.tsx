import { useCallback } from 'react'
import { View, Text, Pressable, Platform, Alert } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import * as AppleAuthentication from 'expo-apple-authentication'
import { signInWithGoogle, signInWithApple, isAppleSignInCancelled } from '../../lib/oauth'
import { ADMIN_ACCOUNT_ERROR } from '../../lib/ensureProfile'
import { GoogleLogo } from './GoogleLogo'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { parseHex, prefersDarkInk } from '../../lib/theme/contrast'

interface OAuthButtonsProps {
  /**
   * Contrôle l'orientation du séparateur « OU » autour des boutons OAuth.
   * - 'top'    → boutons OAuth PUIS séparateur en dessous (le formulaire email suit).
   *              Utilisé sur login/signup pour présenter Sign in with Apple en haut
   *              (fix rejet App Store Guideline 4 — GYM-149).
   * - 'bottom' → séparateur au-dessus des boutons (comportement historique).
   * Défaut 'bottom' pour ne rien casser ailleurs.
   */
  position?: 'top' | 'bottom'
  /**
   * 🔴 GYM-323 — SUR QUEL FOND LES BOUTONS SONT POSÉS. Ce n'est pas un réglage de goût :
   * deux des trois couleurs de ces boutons dépendent du fond, et le fond n'est pas le même
   * selon l'écran.
   *
   *  · 'card' (DÉFAUT) — une carte `tokens.surface`. C'est l'usage historique : login et
   *    signup de Dopamine montent les boutons dans une carte blanche. Valeur par défaut
   *    pour que ces deux écrans ne bougent PAS d'un pixel.
   *  · 'background' — directement sur `tokens.background`. C'est l'écran brandé, qui n'a
   *    aucune carte : le formulaire est posé à même le fond de la salle.
   *
   * ⚠️ POURQUOI ÇA NE POUVAIT PAS ÊTRE DEVINÉ. Le composant lit `tokens`, pas le fond de
   * son parent : rien dans le thème ne dit sur quoi on l'a monté. Mesuré sur les six
   * thèmes, `surface` et `background` ne diffèrent que de 1,00 à 1,09 — et `border` de
   * 1,00 à 1,02 : un bouton `surface` bordé `border` posé sur `background` n'aurait EU
   * AUCUNE limite visible. C'est le piège déjà documenté dans ui/Checkbox.tsx (GYM-293b)
   * et retrouvé en GYM-337, à un troisième endroit.
   */
  on?: 'card' | 'background'
}

export function OAuthButtons({ position = 'bottom', on = 'card' }: OAuthButtonsProps) {
  const { t } = useTranslation()
  const { tokens } = useTheme()
  const router = useRouter()

  // GYM-323 — le fond RÉEL sous les boutons, d'où découlent les trois couleurs ci-dessous.
  const surCarte = on === 'card'
  const fond = surCarte ? tokens.surface : tokens.background
  // Bordure et encre : les jetons de `surface` sur une carte, ceux de `background` sinon.
  // ⚠️ `onBackgroundMuted` EN BORDURE, ET NON `border`. `border` est un jeton de
  // SÉPARATION (filet de carte, trait de liste), dérivé du fond : mesuré à 1,00–1,02
  // contre le fond, il ne dessine rien sur l'écran brandé. `onBackgroundMuted` est une
  // ENCRE, choisie par contraste réel — mesurée de 4,78 à 10,83 sur les six thèmes,
  // au-dessus du seuil de 3:1 des éléments non textuels.
  const bordure = surCarte ? tokens.border : tokens.onBackgroundMuted
  const encre = surCarte ? tokens.onSurface : tokens.onBackground

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

  const divider = (
    <View className="my-4 flex-row items-center gap-3">
      {/* GYM-323 — le filet du séparateur suit la même règle que la bordure des boutons :
          `border` sur une carte (inchangé), une encre atténuée sur le fond brandé, où
          `border` ne dessinerait rien. */}
      <View className="h-px flex-1" style={{ backgroundColor: bordure }} />
      <Text className="font-dmsans text-xs uppercase" style={{ color: tokens.onBackgroundMuted }}>
        {t('auth.or')}
      </Text>
      <View className="h-px flex-1" style={{ backgroundColor: bordure }} />
    </View>
  )

  // 🔴 GYM-323 — LE STYLE DU BOUTON APPLE SUIT LE FOND. Il était figé sur BLACK, ce qui
  // est juste sur une carte blanche (Dopamine) et INVISIBLE sur un fond sombre : mesuré à
  // 1,11 contre le #111111 d'une salle sombre, et 1,14 contre le fond Viniz. Apple fournit
  // BLACK / WHITE / WHITE_OUTLINE pour exactement cette raison — en choisir un selon le
  // fond est conforme aux HIG, pas une entorse.
  //
  // `prefersDarkInk` est la fonction que le thème emploie déjà pour choisir ses encres :
  // fond clair → encre sombre → bouton NOIR ; fond sombre → bouton BLANC. On ne réinvente
  // pas un second critère de luminance à côté de celui du garde-fou.
  //
  // ⚠️ EN 'card' AVEC LE THÈME DOPAMINE, `surface` VAUT #FFFFFF : `prefersDarkInk` rend
  // `true` et le bouton reste NOIR — exactement ce qui est affiché aujourd'hui.
  const fondRgb = parseHex(fond)
  const styleApple = !fondRgb || prefersDarkInk(fondRgb)
    ? AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
    : AppleAuthentication.AppleAuthenticationButtonStyle.WHITE

  // Apple — rendu uniquement sur iOS (recommandation HIG : bouton natif Apple).
  const appleButton = Platform.OS === 'ios' && (
    <AppleAuthentication.AppleAuthenticationButton
      key="apple"
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={styleApple}
      cornerRadius={12}
      style={{ width: '100%', height: 50 }}
      onPress={handleApple}
    />
  )

  const googleButton = (
    <Pressable
      key="google"
      onPress={handleGoogle}
      className="flex-row items-center justify-center gap-3 rounded-xl border px-6 py-3.5"
      // ⚠️ `backgroundColor: fond` ET NON `tokens.surface`. Sur l'écran brandé, le bouton
      // reprend le fond sur lequel il est posé et ne se distingue QUE par sa bordure
      // d'encre — un bouton secondaire, à côté du CTA de connexion qui porte l'accent de
      // la salle. Sur une carte, `fond` VAUT `tokens.surface` : rendu inchangé.
      style={{ borderColor: bordure, backgroundColor: fond }}
    >
      <GoogleLogo size={20} />
      <Text className="font-dmsans-medium text-base" style={{ color: encre }}>
        {t('auth.continue_with_google')}
      </Text>
    </Pressable>
  )

  // Ordre adaptatif par plateforme :
  // - iOS : Apple EN PREMIER puis Google (recommandation Apple HIG).
  // - Android : Google seul (Apple n'est de toute façon pas rendu hors iOS).
  const buttons = Platform.OS === 'ios' ? [appleButton, googleButton] : [googleButton]

  return (
    <View className="gap-2">
      {position === 'top' ? (
        <>
          {buttons}
          {divider}
        </>
      ) : (
        <>
          {divider}
          {buttons}
        </>
      )}
    </View>
  )
}
