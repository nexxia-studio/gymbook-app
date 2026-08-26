import { useEffect, useRef } from 'react'
import { Animated, Easing, Text } from 'react-native'
import { AlertCircle } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../lib/theme/ThemeProvider'
import { SEMANTIC } from '../../lib/theme/semantic'

// GYM-120 — bannière IN-SCREEN autonome, remplace components/ui/Toast.tsx dont l'animation
// reanimated s'auto-annulait (translateY.value = withTiming(0) immédiatement écrasé par
// withDelay(3000, withTiming(-100)) → la vue restait figée hors écran, jamais visible).
// Ici : RN Animated natif, zéro dépendance nouvelle, slide-in + auto-dismiss 3 s.
//
//  - anchor 'bottom' (défaut) : glisse depuis le bas, calé au-dessus de la tab bar
//    (écran Réservations — évite le header noir « Mes Cours »).
//  - anchor 'top' : glisse depuis le haut (écrans auth — la variante 'error' rouge reste
//    lisible même par-dessus le header sombre).
//  - variant 'error' : fond rouge + icône ; 'success' (défaut) : fond sombre.
// `message = null` → rien n'est monté.
type Anchor = 'top' | 'bottom'
type Variant = 'success' | 'error'

const DISTANCE = 120 // amplitude du slide (px), au-delà du bord d'ancrage

export function InScreenBanner({
  message,
  onHide,
  anchor = 'bottom',
  variant = 'success',
}: {
  message: string | null
  onHide: () => void
  anchor?: Anchor
  variant?: Variant
}) {
  const insets = useSafeAreaInsets()
  const { tokens } = useTheme()
  // Hors-écran = au-delà du bord d'ancrage : haut → négatif, bas → positif.
  const offscreen = anchor === 'top' ? -DISTANCE : DISTANCE
  const translateY = useRef(new Animated.Value(offscreen)).current
  const opacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!message) return
    let cancelled = false
    translateY.setValue(offscreen)
    opacity.setValue(0)

    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start()

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: offscreen, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]).start(() => { if (!cancelled) onHide() })
    }, 3000)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [message, offscreen, translateY, opacity, onHide])

  if (!message) return null

  const posStyle = anchor === 'top' ? { top: insets.top + 8 } : { bottom: 16 }

  // ── 🔴 DEUX VARIANTES, DEUX RÉGIMES DE COULEUR — ET ILS NE SE MÉLANGENT PAS ─────────
  // 'error' est un SIGNAL : fond fixe, encre fixe. 'success' est une surface de l'app :
  // fond de marque, encre que le garde-fou a retenue pour lui.
  //
  // ⚠️ ET L'ENCRE DE L'ERREUR NE PEUT PAS ÊTRE `onBackground`, MÊME SI LES DEUX VALENT
  // #FFFFFF CHEZ DOPAMINE. Une salle au fond clair reçoit un `onBackground` SOMBRE ; la
  // bannière d'erreur, elle, reste rouge quoi qu'il arrive. Poser l'un sur l'autre
  // donnerait du gris foncé sur rouge — 2,3:1 — illisible au moment précis où l'app a
  // quelque chose d'important à dire. Un fond fixe appelle une encre fixe.
  const bg = variant === 'error' ? SEMANTIC.danger : tokens.background
  const ink = variant === 'error' ? SEMANTIC.onDanger : tokens.onBackground

  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: 16, right: 16, zIndex: 50, transform: [{ translateY }], opacity, backgroundColor: bg, ...posStyle }}
      className="flex-row items-center gap-3 rounded-2xl px-4 py-3"
    >
      {variant === 'error' && <AlertCircle size={20} color={ink} />}
      <Text className="flex-1 font-dmsans-bold text-sm" style={{ color: ink }}>{message}</Text>
    </Animated.View>
  )
}
