// GYM-102 (2/5) — ÉCRAN 01 « LANCEMENT », VARIANTE VINIZ.
//
// ⚠️ CET ÉCRAN N'EXISTE QU'EN MODE `multi`. Dopamine garde son écran de lancement
// (GYM-241), inchangé, dans le même fichier de route : c'est `app/index.tsx` qui choisit,
// sur une constante figée à la compilation.
import { useEffect, useState } from 'react'
import { View, Text } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing,
} from 'react-native-reanimated'
import { SvgXml } from 'react-native-svg'
import { useAuthStore } from '../../stores/useAuthStore'
import { readSelectedGymSlug } from '../../lib/gymResolver'
import { VinizPulse } from './VinizPulse'
import { VINIZ_WORDMARK_SVG } from '../../assets/viniz/brandSvg'

/**
 * Le violet de marque. ⚠️ PAS UNE COULEUR CHOISIE ICI : c'est celle que le dépôt déclare
 * déjà pour la variante Viniz (`app.config.ts`, splash et adaptive icon en `#4827B4`,
 * GYM-258), et c'est aussi le fond plein retiré du SVG pour le rendre transparent. Le
 * démarrage natif et cet écran affichent donc le même violet : le passage de l'un à
 * l'autre ne se voit pas — la leçon de GYM-241, appliquée à l'autre marque.
 */
const VINIZ_INDIGO = '#4827B4'

/**
 * Durée avant navigation = UN cycle de pulse complet.
 *
 * La signature finit son fondu à 2,8 s, mais couper là laisserait le tracé à mi-course :
 * l'œil lirait une animation interrompue, pas un écran qui passe.
 */
const SPLASH_DURATION = 3400

const PULSE_WIDTH = 234
const WORDMARK_WIDTH = 240

/**
 * ⚠️ RECADRAGE, PAS RETOUCHE. Le fichier de marque est un carré 1500×1500 dont le mot
 * n'occupe qu'une bande centrale ; posé tel quel, il traînerait presque quatre fois sa
 * hauteur de vide. Le `viewBox` est donc resserré sur l'emprise MESURÉE de l'art
 * (x 92,9→1361,9, y 577,2→924,0), avec trois pixels de marge. Le .svg du dépôt, lui,
 * n'est pas modifié : il reste fidèle à l'original.
 */
const WORDMARK_VIEWBOX = '90 574 1275 353'
const WORDMARK_RATIO = 353 / 1275

export function VinizLaunch() {
  const { t } = useTranslation()
  const router = useRouter()
  const session = useAuthStore((s) => s.session)
  const [splashDone, setSplashDone] = useState(false)
  const [hasGym, setHasGym] = useState<boolean | null>(null)

  // Fondus, aux temps de la spec : wordmark 0,8 s à partir de 1,5 s, signature 0,7 s à
  // partir de 2,1 s.
  const wordmarkOpacity = useSharedValue(0)
  const taglineOpacity = useSharedValue(0)

  useEffect(() => {
    wordmarkOpacity.value = withDelay(1500, withTiming(1, { duration: 800, easing: Easing.out(Easing.quad) }))
    taglineOpacity.value = withDelay(2100, withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }))
    const timer = setTimeout(() => setSplashDone(true), SPLASH_DURATION)
    return () => clearTimeout(timer)
  }, [wordmarkOpacity, taglineOpacity])

  // Lu pendant que le pulse tourne : à la fin du splash la réponse est déjà là, et
  // l'écran n'a pas à marquer un temps d'arrêt pour interroger le stockage.
  useEffect(() => {
    let alive = true
    readSelectedGymSlug().then((slug) => { if (alive) setHasGym(slug !== null) })
    return () => { alive = false }
  }, [])

  // ── GYM-291 — 🔴 L'ÉCRAN D'ACCUEIL GÉNÉRIQUE EST SUPPRIMÉ ───────────────────────────
  //
  // Cet écran affichait, une fois le pulse terminé et la salle connue, deux boutons
  // « Se connecter » / « Créer un compte » — SANS MARQUE, sur le violet Viniz. Le membre
  // venait pourtant de choisir sa salle : on lui montrait un écran de plus, générique,
  // pour lui demander ce qu'il avait déjà dit.
  //
  // Les deux destinations restent atteignables : la connexion est brandée aux couleurs de
  // la salle (`BrandedLogin`), et elle porte déjà le lien « pas encore de compte →
  // s'inscrire ». Rien n'est perdu, un écran disparaît.
  //
  // ⚠️ LES TROIS SORTIES SONT EXHAUSTIVES ET S'EXCLUENT : session → l'app ; salle connue,
  // pas de session → la connexion brandée ; pas de salle → la recherche. Aucun état ne
  // laisse cet écran affiché après le splash, ce qui est la condition pour qu'il n'ait
  // plus rien à rendre en pied.
  useEffect(() => {
    if (!splashDone) return
    if (session) {
      router.replace('/(tabs)' as never)
      return
    }
    // Salle connue : droit à la connexion, aux couleurs de cette salle.
    if (hasGym === true) {
      router.replace('/(auth)/login' as never)
      return
    }
    // Pas de session ET aucune salle mémorisée : il n'y a rien à afficher tant qu'on ne
    // sait pas chez qui on est. On ne montre donc pas des boutons de connexion sans
    // marque — on demande d'abord la salle.
    if (hasGym === false) router.replace('/gym/select' as never)
  }, [splashDone, session, hasGym, router])

  const wordmarkStyle = useAnimatedStyle(() => ({ opacity: wordmarkOpacity.value }))
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }))

  return (
    <View className="flex-1" style={{ backgroundColor: VINIZ_INDIGO }}>
      <View className="flex-1 items-center justify-center">
        <VinizPulse width={PULSE_WIDTH} />

        <Animated.View style={[wordmarkStyle, { marginTop: 20 }]}>
          <SvgXml
            xml={VINIZ_WORDMARK_SVG}
            viewBox={WORDMARK_VIEWBOX}
            width={WORDMARK_WIDTH}
            height={WORDMARK_WIDTH * WORDMARK_RATIO}
          />
        </Animated.View>

        {/* ⚠️ Animated.View + Text, pas Animated.Text : NativeWind n'est prouvé sur
            aucun `Animated.Text` de ce dépôt, alors qu'`Animated.View` porte déjà des
            classes ailleurs (app/index.tsx). Une classe silencieusement ignorée sur le
            tout premier écran donnerait un texte non stylé, sans erreur pour le dire. */}
        <Animated.View style={taglineStyle}>
          <Text className="mt-4 font-dmsans text-sm text-white/70">
            {t('viniz_launch.tagline')}
          </Text>
        </Animated.View>
      </View>

    </View>
  )
}
