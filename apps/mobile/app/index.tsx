import { useEffect, useState } from 'react'
import { View, Text, Image } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, withSequence, Easing,
} from 'react-native-reanimated'
import { Button } from '../components/ui/Button'
import { useAuthStore } from '../stores/useAuthStore'
import { GYM_MODE } from '../lib/gymResolver'
import { VinizLaunch } from '../components/viniz/VinizLaunch'

const SPLASH_DURATION = 2500

/**
 * GYM-241 — LE LOGO, À LA PLACE DU TEXTE.
 *
 * L'écran affichait « DOPAMINE » composé en BarlowCondensed : une approximation du logo,
 * pas le logo. C'est le premier écran de l'app, et le seul endroit où la marque était
 * dessinée par une police plutôt que par son fichier.
 *
 * ⚠️ LE FICHIER EST OPAQUE, DONC LE FOND DOIT ÊTRE EXACTEMENT LE SIEN. `splash-dopamine.png`
 * vient d'un JPG : aucune transparence, son fond est un carré NOIR PUR (coins mesurés à
 * 0,0,0). Posé sur le #111111 de `bg-move-dark`, ce carré se serait vu — un rectangle plus
 * sombre autour du logo, exactement le défaut qu'on corrige sur l'en-tête des emails au
 * même moment (GYM-238). D'où le #000000 explicite sur cet écran.
 *
 * ⚠️ ET C'EST AUSSI CE QUI SOUDE LES DEUX ÉCRANS. Le démarrage natif (app.config.ts) est
 * réglé sur le MÊME fichier et le MÊME noir : le passage du natif à l'animé ne se voit
 * plus. Changer l'un sans l'autre ferait réapparaître le flash.
 */
const SPLASH_BG = '#000000'
/** Largeur maîtrisée + `contain` : un logo étiré serait pire que le texte qu'il remplace. */
const LOGO_SIZE = 260

/**
 * GYM-102 (2/5) — L'AIGUILLAGE, ET RIEN D'AUTRE.
 *
 * ⚠️ `GYM_MODE` EST UNE CONSTANTE DE MODULE, FIGÉE À LA COMPILATION. Elle ne peut pas
 * changer entre deux rendus : l'ordre des hooks de chaque branche est donc stable, et
 * aucune des deux ne voit jamais l'autre.
 *
 * En mode `single`, cet écran rend exactement l'arbre d'avant — `DopamineWelcome` est le
 * composant de GYM-241, déplacé d'une ligne et pas modifié d'un caractère.
 */
export default function Launch() {
  return GYM_MODE === 'multi' ? <VinizLaunch /> : <DopamineWelcome />
}

function DopamineWelcome() {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useAuthStore((s) => s.session)
  const [splashDone, setSplashDone] = useState(false)

  // Logo animation — Netflix style
  const logoOpacity = useSharedValue(0)
  const logoScale = useSharedValue(0.8)
  const lineWidth = useSharedValue(0)

  useEffect(() => {
    // Phase 1: fade in + scale (800ms)
    logoOpacity.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) })
    logoScale.value = withSequence(
      withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }),
      // Phase 2: pulse after 900ms
      withDelay(100, withSequence(
        withTiming(1.05, { duration: 300 }),
        withTiming(1.0, { duration: 300 }),
      )),
    )

    // Accent line slides in after 600ms
    lineWidth.value = withDelay(600, withTiming(40, { duration: 400 }))

    // Navigate after splash duration
    const timer = setTimeout(() => {
      setSplashDone(true)
    }, SPLASH_DURATION)

    return () => clearTimeout(timer)
  }, [logoOpacity, logoScale, lineWidth])

  // Handle navigation after splash
  useEffect(() => {
    if (!splashDone) return
    if (session) {
      router.replace('/(tabs)' as never)
    }
    // If no session, show buttons (don't auto-redirect to login)
  }, [splashDone, session, router])

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }))

  const lineStyle = useAnimatedStyle(() => ({
    width: lineWidth.value,
  }))

  // Buttons animation (only after splash)
  const buttonsOpacity = useSharedValue(0)
  const buttonsTranslateY = useSharedValue(30)

  useEffect(() => {
    if (splashDone && !session) {
      buttonsOpacity.value = withTiming(1, { duration: 400 })
      buttonsTranslateY.value = withTiming(0, { duration: 400 })
    }
  }, [splashDone, session, buttonsOpacity, buttonsTranslateY])

  const buttonsStyle = useAnimatedStyle(() => ({
    opacity: buttonsOpacity.value,
    transform: [{ translateY: buttonsTranslateY.value }],
  }))

  return (
    <View className="flex-1" style={{ backgroundColor: SPLASH_BG }}>
      {/* Logo area — ⚠️ L'ANIMATION EST INCHANGÉE : fondu, montée en échelle et « beat »
          gardent leurs durées et leurs courbes d'origine. Seul le CONTENU de la vue animée
          change, jamais le mouvement. Le logo porte déjà « DOPAMINE / PERFORMANCE CLUB »,
          les deux lignes de texte disparaissent donc avec lui — les conserver aurait
          dédoublé le nom de la salle à l'écran. */}
      <Animated.View style={logoStyle} className="flex-1 items-center justify-center">
        <Image
          source={require('../assets/splash-dopamine.png')}
          style={{ width: LOGO_SIZE, height: LOGO_SIZE }}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="Dopamine Performance Club"
        />

        {/* Accent line */}
        <Animated.View
          style={[lineStyle, { height: 2, backgroundColor: '#C8F000', borderRadius: 1, marginTop: 24 }]}
        />
      </Animated.View>

      {/* Buttons — only visible after splash if not logged in */}
      {splashDone && !session && (
        <Animated.View style={buttonsStyle} className="gap-3 px-6 pb-12">
          <Button
            title={t('welcome.login')}
            onPress={() => router.push('/(auth)/login')}
            variant="primary"
          />
          <Button
            title={t('welcome.signup')}
            onPress={() => router.push('/(auth)/signup')}
            variant="secondary"
          />
          <Text className="mt-2 text-center font-dmsans text-xs text-white/30">
            {t('welcome.skip')}
          </Text>
        </Animated.View>
      )}
    </View>
  )
}
