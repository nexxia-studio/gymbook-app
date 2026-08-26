// GYM-102 (2/5) — ÉCRAN 01, LE TRACÉ PULSE-V.
//
// Le pulse-V se dessine de gauche à droite comme sur un moniteur cardiaque, une bille
// lumineuse court à la pointe du tracé, puis s'éteint quand la ligne est complète.
//
// ═════════════════════════════════════════════════════════════════════════════════════
// TOUS LES NOMBRES DE CE FICHIER VIENNENT DE LA SPEC. AUCUN N'A ÉTÉ CHOISI ICI.
// ═════════════════════════════════════════════════════════════════════════════════════
// Les tableaux XS / DOT_X / DOT_Y / DOT_O, les bornes du masque et la durée de 3 400 ms
// sont recopiés tels quels. Si un mouvement paraît faux à l'écran, c'est ici qu'il faut
// comparer à la spec — pas ajuster à vue.
import { useEffect, useState } from 'react'
import { View, Platform, AccessibilityInfo } from 'react-native'
import Animated, {
  useSharedValue, withRepeat, withTiming, Easing, useAnimatedStyle, interpolate,
} from 'react-native-reanimated'
import { SvgXml } from 'react-native-svg'
import { VINIZ_PULSE_LINE_SVG } from '../../assets/viniz/brandSvg'

/** Boîte de référence de la spec. Tout le reste est proportionnel à sa largeur. */
const BOX_W = 117
const BOX_H = 89
/** L'image déborde la boîte et remonte : c'est ce qui cadre l'art sur le tracé. */
const ART_SIZE = 124
const ART_TOP = -17

const DURATION_MS = 3400

// Progression normalisée du cycle, et les trois pistes qu'elle pilote.
const XS = [0, 0.06, 0.176, 0.221, 0.286, 0.385, 0.434, 0.51, 0.6, 1]
const DOT_X = [4, 4, 33, 44, 58, 81, 92, 110, 110, 110]
const DOT_Y = [52, 52, 52, 32, 83, 3, 52, 52, 52, 52]
const DOT_O = [0, 1, 1, 1, 1, 1, 1, 1, 0, 0]

const MASK_XS = [0, 0.06, 0.52, 0.88, 1]
const MASK_OPACITY_XS = [0, 0.06, 0.88, 1]

const DOT_SIZE = 10
const HALO_SIZE = 26

const LIME = '#C8FF3D'
/** Le cœur de la bille est presque blanc : c'est le halo lime qui la colore. */
const DOT_CORE = '#F3F0FF'

/**
 * ⚠️ POSITION DE L'ART DANS SA BOÎTE — LE SEUL RÉGLAGE À VÉRIFIER SUR APPAREIL.
 *
 * Les coordonnées de la bille sont calées sur un art dont la spec annonce l'emprise à
 * « y 15,5 %→83 % » du viewBox. L'asset livré ici est DÉRIVÉ du SVG d'origine du dépôt
 * (cf. scripts/generate-viniz-brand-svg.js) et son art mesure y 16,0 %→84,0 % : mêmes
 * proportions, décalées d'environ 0,7 % — soit moins d'un pixel à 124 px, très en dessous
 * du diamètre de la bille.
 *
 * Si le .zip de la maquette apporte le fichier définitif et que la bille flotte à côté du
 * tracé, c'est cette constante qui la recolle. Elle vaut 0 tant que rien ne le prouve :
 * corriger un décalage qu'on n'a pas vu, c'est en créer un.
 */
const ART_Y_NUDGE = 0

export interface VinizPulseProps {
  /** Largeur de la boîte. Tout est proportionnel — la spec l'autorise explicitement. */
  width?: number
}

export function VinizPulse({ width = BOX_W }: VinizPulseProps) {
  const k = width / BOX_W

  // ⚠️ UNE SEULE sharedValue PILOTE LES DEUX VUES. C'est la condition pour que tout reste
  // sur le thread UI : deux horloges séparées dériveraient l'une de l'autre, et la bille
  // décrocherait du tracé au bout de quelques cycles.
  const t = useSharedValue(0)

  // Reduce Motion : le mouvement lui-même est ce qui gêne, pas sa durée. On affiche donc
  // le pulse ENTIER, immobile — pas une version accélérée.
  const [reduceMotion, setReduceMotion] = useState(false)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setReduceMotion(v) })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)
    return () => { alive = false; sub.remove() }
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      t.value = 0.7 // tracé complet, bille éteinte — l'état de fin de cycle
      return
    }
    t.value = 0
    t.value = withRepeat(
      // ⚠️ INTERPOLATION LINÉAIRE, ET C'EST STRUCTUREL : le masque et la bille lisent la
      // MÊME horloge. Toute courbe d'accélération les décalerait l'un par rapport à
      // l'autre, et la bille cesserait d'être collée à la pointe du tracé.
      withTiming(1, { duration: DURATION_MS, easing: Easing.linear }),
      -1,
      false,
    )
  }, [reduceMotion, t])

  const mask = useAnimatedStyle(() => ({
    width: interpolate(t.value, MASK_XS, [0, 12 * k, width, width, width]),
    opacity: interpolate(t.value, MASK_OPACITY_XS, [0, 1, 1, 0]),
  }))

  const dot = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, XS, DOT_O),
    transform: [
      // Les valeurs de la spec sont des coordonnées de COIN, déjà décalées du rayon de la
      // bille : rien à recentrer ici.
      { translateX: interpolate(t.value, XS, DOT_X) * k },
      { translateY: (interpolate(t.value, XS, DOT_Y) + ART_Y_NUDGE) * k },
    ],
  }))

  return (
    <View
      style={{ width, height: BOX_H * k }}
      accessibilityRole="image"
      accessibilityLabel="Viniz"
    >
      <Animated.View style={[{ height: BOX_H * k, overflow: 'hidden' }, mask]}>
        <SvgXml
          xml={VINIZ_PULSE_LINE_SVG}
          width={ART_SIZE * k}
          height={ART_SIZE * k}
          style={{ marginTop: ART_TOP * k }}
        />
      </Animated.View>

      {/* La bille n'existe pas quand le mouvement est désactivé : sans course, une bille
          posée quelque part sur le tracé ne veut plus rien dire. */}
      {!reduceMotion && (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', width: DOT_SIZE * k, height: DOT_SIZE * k }, dot]}
        >
          {/* ⚠️ ANDROID NE REND PAS shadowRadius — la bille y serait un point mat sans
              lueur. Le halo y est donc un vrai cercle lime, posé SOUS la bille et centré
              sur elle : (26 − 10) / 2 = 8 px de débord de chaque côté. */}
          {Platform.OS === 'android' && (
            <View
              style={{
                position: 'absolute',
                left: -((HALO_SIZE - DOT_SIZE) / 2) * k,
                top: -((HALO_SIZE - DOT_SIZE) / 2) * k,
                width: HALO_SIZE * k,
                height: HALO_SIZE * k,
                borderRadius: (HALO_SIZE / 2) * k,
                backgroundColor: LIME,
                opacity: 0.35,
              }}
            />
          )}
          <View
            style={{
              width: DOT_SIZE * k,
              height: DOT_SIZE * k,
              borderRadius: (DOT_SIZE / 2) * k,
              backgroundColor: DOT_CORE,
              // ⚠️ LE HALO EST UNE OMBRE STATIQUE, PAS UN FLOU ANIMÉ : elle est calculée
              // une fois, et ne coûte rien par frame. Un blur animé rendrait le même
              // effet au prix d'un recalcul à chaque image.
              shadowColor: LIME,
              shadowOpacity: 0.95,
              shadowRadius: 8 * k,
              shadowOffset: { width: 0, height: 0 },
              elevation: 0,
            }}
          />
        </Animated.View>
      )}
    </View>
  )
}
